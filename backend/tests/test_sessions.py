import uuid

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from tests.conftest import needs_ffmpeg, upload

pytestmark = needs_ffmpeg


def frame_pair(ref_ms, cur_ms, **extra):
    return {"pair_type": "single_frame", "reference_timestamp_ms": ref_ms, "current_timestamp_ms": cur_ms, **extra}


def clip_pair(r0, r1, c0, c1, **extra):
    return {
        "pair_type": "short_clip",
        "reference_start_ms": r0,
        "reference_end_ms": r1,
        "current_start_ms": c0,
        "current_end_ms": c1,
        **extra,
    }


def test_create_and_get_session(client, session, uploaded):
    assert session["analysis_mode"] == "single_frame"
    assert session["reference_video"]["id"] == uploaded["reference"]["id"]
    assert session["current_video"]["id"] == uploaded["current"]["id"]
    assert session["pairs"] == []

    response = client.get(f"/api/sessions/{session['id']}")
    assert response.status_code == 200
    assert response.json()["id"] == session["id"]

    listed = client.get("/api/sessions").json()
    assert any(s["id"] == session["id"] for s in listed)


def test_create_session_with_unknown_video(client):
    response = client.post("/api/sessions", json={"reference_video_id": str(uuid.uuid4())})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "video_not_found"


def test_update_session_mode_and_name(client, session):
    response = client.patch(f"/api/sessions/{session['id']}", json={"analysis_mode": "short_clip", "name": " Boss fight "})
    assert response.status_code == 200
    data = response.json()
    assert data["analysis_mode"] == "short_clip"
    assert data["name"] == "Boss fight"
    # Fields that weren't sent are unchanged.
    assert data["reference_video"]["id"] == session["reference_video"]["id"]

    bad = client.patch(f"/api/sessions/{session['id']}", json={"analysis_mode": "auto"})
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "validation_error"


def test_single_frame_pair_with_different_timestamps(client, session):
    # Reference 1.0 s <-> Current 5.5 s: the same event at different times.
    response = client.post(f"/api/sessions/{session['id']}/pairs", json=frame_pair(1000, 5500, event_description=" Door opens "))
    assert response.status_code == 201, response.text
    pair = response.json()
    assert pair["pair_type"] == "single_frame"
    assert (pair["reference_timestamp_ms"], pair["current_timestamp_ms"]) == (1000, 5500)
    assert pair["event_description"] == "Door opens"
    assert pair["reference_start_ms"] is None

    pairs = client.get(f"/api/sessions/{session['id']}/pairs").json()
    assert [p["id"] for p in pairs] == [pair["id"]]


def test_short_clip_pair_with_different_lengths(client, session):
    # Reference 1.0–3.0 s (2 s) <-> Current 2.0–7.0 s (5 s).
    response = client.post(f"/api/sessions/{session['id']}/pairs", json=clip_pair(1000, 3000, 2000, 7000))
    assert response.status_code == 201, response.text
    pair = response.json()
    assert (pair["reference_start_ms"], pair["reference_end_ms"]) == (1000, 3000)
    assert (pair["current_start_ms"], pair["current_end_ms"]) == (2000, 7000)
    assert pair["reference_timestamp_ms"] is None


def _reason(response):
    assert response.status_code == 422, response.text
    return response.json()["error"]["details"]["reason"]


def test_invalid_pairs_are_rejected(client, session):
    url = f"/api/sessions/{session['id']}/pairs"
    # Reference is 6 s long, current 8 s.
    assert _reason(client.post(url, json=frame_pair(6001, 1000))) == "referenceOutOfRange"
    assert _reason(client.post(url, json=frame_pair(1000, 8001))) == "currentOutOfRange"
    assert _reason(client.post(url, json=clip_pair(3000, 2000, 1000, 2000))) == "referenceOrder"
    assert _reason(client.post(url, json=clip_pair(1000, 1050, 1000, 2000))) == "referenceTooShort"
    assert _reason(client.post(url, json=clip_pair(1000, 2000, 1000, 1099))) == "currentTooShort"
    assert _reason(client.post(url, json=clip_pair(0, 5000, 0, 8001))) == "currentOutOfRange"

    # Missing / mixed fields for the type.
    missing = client.post(url, json={"pair_type": "single_frame", "reference_timestamp_ms": 1000})
    assert missing.status_code == 422
    mixed = client.post(url, json={**frame_pair(1000, 1000), "reference_start_ms": 0})
    assert mixed.status_code == 422
    negative = client.post(url, json=frame_pair(-1, 1000))
    assert negative.status_code == 422

    assert client.get(url).json() == []


def test_clip_length_limits(client, videos):
    # Two 12 s videos so the 10 s limit can be tested on its own.
    long_video = videos["reference"].parent / "long.mp4"
    if not long_video.exists():
        import subprocess

        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=12:size=160x120:rate=10",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", str(long_video)],
            check=True,
        )
    vid = upload(client, long_video).json()["id"]
    sid = client.post("/api/sessions", json={"reference_video_id": vid, "current_video_id": vid}).json()["id"]
    url = f"/api/sessions/{sid}/pairs"
    assert client.post(url, json=clip_pair(0, 10_000, 1000, 1100)).status_code == 201
    assert _reason(client.post(url, json=clip_pair(0, 10_001, 0, 500))) == "referenceTooLong"
    assert _reason(client.post(url, json=clip_pair(0, 500, 0, 10_001))) == "currentTooLong"


def test_duplicate_pairs_follow_frontend_tolerance(client, session):
    url = f"/api/sessions/{session['id']}/pairs"
    assert client.post(url, json=frame_pair(2000, 3000)).status_code == 201
    assert _reason(client.post(url, json=frame_pair(2049, 2951))) == "duplicate"
    # 50 ms apart on one timestamp is a different pair.
    assert client.post(url, json=frame_pair(2050, 3000)).status_code == 201
    # The same times as a clip pair are not duplicates of frame pairs.
    assert client.post(url, json=clip_pair(2000, 3000, 3000, 4000)).status_code == 201


def test_pairs_need_both_videos(client, uploaded):
    sid = client.post("/api/sessions", json={"reference_video_id": uploaded["reference"]["id"]}).json()["id"]
    response = client.post(f"/api/sessions/{sid}/pairs", json=frame_pair(1000, 1000))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "session_videos_missing"


def test_create_pair_is_idempotent_with_client_id(client, session):
    url = f"/api/sessions/{session['id']}/pairs"
    pair_id = str(uuid.uuid4())
    first = client.post(url, json=frame_pair(1000, 2000, id=pair_id))
    retry = client.post(url, json=frame_pair(1000, 2000, id=pair_id))
    assert first.status_code == 201
    assert retry.status_code == 200
    assert retry.json()["id"] == pair_id
    assert len(client.get(url).json()) == 1

    conflict = client.post(url, json=frame_pair(1500, 2000, id=pair_id))
    assert conflict.status_code == 409


def test_update_and_delete_pair(client, session):
    url = f"/api/sessions/{session['id']}/pairs"
    pair = client.post(url, json=clip_pair(1000, 2000, 1000, 2000)).json()

    updated = client.patch(
        f"{url}/{pair['id']}",
        json={"reference_start_ms": 1500, "reference_end_ms": 4000, "current_start_ms": 500, "current_end_ms": 1000,
              "event_description": "Jump"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["reference_end_ms"] == 4000
    assert updated.json()["event_description"] == "Jump"

    wrong_type = client.patch(f"{url}/{pair['id']}", json={"reference_timestamp_ms": 1, "current_timestamp_ms": 1})
    assert wrong_type.status_code == 422

    assert client.delete(f"{url}/{pair['id']}").status_code == 204
    assert client.get(url).json() == []
    assert client.delete(f"{url}/{pair['id']}").status_code == 404


def test_session_restoration_after_restart(session):
    sid = session["id"]
    with TestClient(app) as first:
        first.post(f"/api/sessions/{sid}/pairs", json=frame_pair(1000, 5000, event_description="Unlock"))
        first.post(f"/api/sessions/{sid}/pairs", json=clip_pair(1000, 3000, 2000, 7000))
        first.patch(f"/api/sessions/{sid}", json={"analysis_mode": "short_clip"})

    # A fresh client (new app lifespan) reads everything back from SQLite, like a page refresh.
    with TestClient(app) as second:
        data = second.get(f"/api/sessions/{sid}").json()
    assert data["analysis_mode"] == "short_clip"
    assert data["reference_video"]["duration_ms"] == 6000
    assert data["current_video"]["duration_ms"] == 8000
    assert data["frame_pair_count"] == 1
    assert data["clip_pair_count"] == 1
    types = sorted(p["pair_type"] for p in data["pairs"])
    assert types == ["short_clip", "single_frame"]


def test_replacing_video_prunes_pairs_that_no_longer_fit(client, session, videos):
    sid = session["id"]
    url = f"/api/sessions/{sid}/pairs"
    fits = client.post(url, json=frame_pair(1000, 5000)).json()
    too_late = client.post(url, json=frame_pair(1000, 7500)).json()  # current 7.5 s

    # Replace the 8 s current video with the 6 s mp4.
    replacement = upload(client, videos["reference"]).json()
    old_current = session["current_video"]["id"]
    data = client.patch(f"/api/sessions/{sid}", json={"current_video_id": replacement["id"]}).json()
    assert data["pruned_pair_ids"] == [too_late["id"]]
    assert [p["id"] for p in data["pairs"]] == [fits["id"]]

    # The old current video is no longer used by any session, so it is deleted.
    assert client.get(f"/api/videos/{old_current}").status_code == 404


def test_delete_session_keeps_shared_videos(client, uploaded, stored_files):
    ref_id, cur_id = uploaded["reference"]["id"], uploaded["current"]["id"]
    body = {"reference_video_id": ref_id, "current_video_id": cur_id}
    a = client.post("/api/sessions", json=body).json()["id"]
    b = client.post("/api/sessions", json=body).json()["id"]
    client.post(f"/api/sessions/{a}/pairs", json=frame_pair(1000, 1000))
    client.post(f"/api/sessions/{a}/pairs/{client.get(f'/api/sessions/{a}/pairs').json()[0]['id']}/extract")

    assert client.delete(f"/api/sessions/{a}").status_code == 204
    assert client.get(f"/api/sessions/{a}").status_code == 404
    # Still used by session b.
    assert client.get(f"/api/videos/{ref_id}").status_code == 200
    assert client.get(f"/api/videos/{cur_id}").status_code == 200
    assert not (get_settings().frames_path / a).exists()

    assert client.delete(f"/api/sessions/{b}").status_code == 204
    assert client.get(f"/api/videos/{ref_id}").status_code == 404
    assert client.get(f"/api/videos/{cur_id}").status_code == 404
    assert not (get_settings().videos_path / f"{ref_id}.mp4").exists()
    assert not (get_settings().videos_path / f"{cur_id}.webm").exists()


def test_unknown_session_and_pair(client, session):
    missing = str(uuid.uuid4())
    assert client.get(f"/api/sessions/{missing}").status_code == 404
    assert client.get(f"/api/sessions/{missing}/pairs").status_code == 404
    assert client.patch(f"/api/sessions/{session['id']}/pairs/{missing}", json={}).status_code == 404
