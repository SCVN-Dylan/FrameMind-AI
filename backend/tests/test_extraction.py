import subprocess

import pytest

from app.core.config import get_settings
from app.db.database import SessionLocal
from app.db.models import ExtractedMedia
from app.services.video import ffmpeg
from tests.conftest import needs_ffmpeg


def _pair(client, session, body):
    response = client.post(f"/api/sessions/{session['id']}/pairs", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _extract(client, session, pair, **params):
    return client.post(f"/api/sessions/{session['id']}/pairs/{pair['id']}/extract", params=params)


@needs_ffmpeg
def test_single_frame_extraction_uses_each_videos_own_timestamp(client, session):
    pair = _pair(client, session, {"pair_type": "single_frame", "reference_timestamp_ms": 1000, "current_timestamp_ms": 5000})
    response = _extract(client, session, pair)
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["pair_type"] == "single_frame"
    assert data["cached"] is False
    assert len(data["reference"]) == 1 and len(data["current"]) == 1
    ref, cur = data["reference"][0], data["current"][0]
    # 30 fps reference: the frame at exactly 1.000 s. 25 fps current: the frame at exactly 5.000 s.
    assert ref["timestamp_ms"] == 1000
    assert cur["timestamp_ms"] == 5000
    assert ref["video_id"] == session["reference_video"]["id"]
    assert cur["video_id"] == session["current_video"]["id"]
    assert ref["media_type"] == "frame"

    image = client.get(ref["url"])
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/jpeg"
    assert image.content[:3] == b"\xff\xd8\xff"

    meta = client.get(f"/api/media/{ref['id']}")
    assert meta.status_code == 200
    assert meta.json()["timestamp_ms"] == 1000

    # Second call returns the stored images instead of running FFmpeg again.
    again = _extract(client, session, pair).json()
    assert again["cached"] is True
    assert again["reference"][0]["id"] == ref["id"]
    assert client.get(f"/api/sessions/{session['id']}/pairs/{pair['id']}/media").json()["reference"][0]["id"] == ref["id"]


@needs_ffmpeg
def test_frame_at_the_very_end_of_a_video(client, session):
    # 6000 ms is the reference duration; the last real frame is at ~5967 ms (30 fps).
    pair = _pair(client, session, {"pair_type": "single_frame", "reference_timestamp_ms": 6000, "current_timestamp_ms": 8000})
    data = _extract(client, session, pair).json()
    assert 5900 <= data["reference"][0]["timestamp_ms"] <= 6000
    assert 7900 <= data["current"][0]["timestamp_ms"] <= 8000


@needs_ffmpeg
def test_short_clip_extracts_sequences_with_different_lengths(client, session, monkeypatch):
    monkeypatch.setattr(get_settings(), "clip_sample_fps", 4)
    monkeypatch.setattr(get_settings(), "clip_max_frames", 40)
    # Reference 1.0–2.0 s (1 s) <-> Current 2.0–5.0 s (3 s).
    pair = _pair(
        client,
        session,
        {"pair_type": "short_clip", "reference_start_ms": 1000, "reference_end_ms": 2000, "current_start_ms": 2000,
         "current_end_ms": 5000},
    )
    response = _extract(client, session, pair)
    assert response.status_code == 200, response.text
    data = response.json()

    ref_times = [m["timestamp_ms"] for m in data["reference"]]
    cur_times = [m["timestamp_ms"] for m in data["current"]]
    assert len(ref_times) == 4  # 1 s at 4 fps
    assert len(cur_times) == 12  # 3 s at 4 fps
    assert ref_times[0] == 1000 and cur_times[0] == 2000
    assert ref_times == sorted(ref_times) and cur_times == sorted(cur_times)
    assert all(1000 <= t < 2000 for t in ref_times)
    assert all(2000 <= t < 5000 for t in cur_times)
    # Spacing is ~250 ms (snapped to real frames: 33 ms at 30 fps, 40 ms at 25 fps).
    assert all(230 <= b - a <= 290 for a, b in zip(ref_times, ref_times[1:]))
    assert [m["frame_index"] for m in data["current"]] == list(range(12))
    assert {m["media_type"] for m in data["reference"] + data["current"]} == {"clip_frame"}
    assert data["current"][0]["start_ms"] == 2000 and data["current"][0]["end_ms"] == 5000


@needs_ffmpeg
def test_clip_frame_count_is_capped(client, session, monkeypatch):
    monkeypatch.setattr(get_settings(), "clip_sample_fps", 30)
    monkeypatch.setattr(get_settings(), "clip_max_frames", 5)
    pair = _pair(
        client,
        session,
        {"pair_type": "short_clip", "reference_start_ms": 0, "reference_end_ms": 5000, "current_start_ms": 0,
         "current_end_ms": 2000},
    )
    data = _extract(client, session, pair).json()
    assert len(data["reference"]) == 5
    assert len(data["current"]) == 5


@needs_ffmpeg
def test_force_reextract_replaces_old_files(client, session):
    pair = _pair(client, session, {"pair_type": "single_frame", "reference_timestamp_ms": 2000, "current_timestamp_ms": 2000})
    first = _extract(client, session, pair).json()
    second = _extract(client, session, pair, force=True).json()
    assert second["cached"] is False
    assert second["reference"][0]["id"] != first["reference"][0]["id"]
    assert client.get(first["reference"][0]["url"]).status_code == 404
    pair_dir = get_settings().frames_path / session["id"] / pair["id"]
    assert len([p for p in pair_dir.iterdir() if p.is_dir()]) == 1


@needs_ffmpeg
def test_updating_pair_times_discards_extracted_frames(client, session):
    pair = _pair(client, session, {"pair_type": "single_frame", "reference_timestamp_ms": 2000, "current_timestamp_ms": 2000})
    media = _extract(client, session, pair).json()["reference"][0]
    client.patch(
        f"/api/sessions/{session['id']}/pairs/{pair['id']}",
        json={"reference_timestamp_ms": 2500, "current_timestamp_ms": 2000},
    )
    assert client.get(f"/api/media/{media['id']}").status_code == 404
    assert client.get(f"/api/sessions/{session['id']}/pairs/{pair['id']}/media").json()["reference"] == []


@needs_ffmpeg
def test_extraction_with_missing_video_file(client, session):
    pair = _pair(client, session, {"pair_type": "single_frame", "reference_timestamp_ms": 1000, "current_timestamp_ms": 1000})
    stored = get_settings().videos_path / f"{session['reference_video']['id']}.mp4"
    stored.unlink()
    response = _extract(client, session, pair)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "video_file_missing"
    assert not list((get_settings().frames_path / session["id"]).rglob("*.jpg"))


@needs_ffmpeg
def test_extraction_without_ffmpeg(client, session, monkeypatch):
    pair = _pair(client, session, {"pair_type": "single_frame", "reference_timestamp_ms": 1000, "current_timestamp_ms": 1000})
    monkeypatch.setattr("app.services.video.ffmpeg.shutil.which", lambda _name: None)
    response = _extract(client, session, pair)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ffmpeg_unavailable"


@needs_ffmpeg
def test_media_serving_refuses_paths_outside_frames(client, session):
    pair = _pair(client, session, {"pair_type": "single_frame", "reference_timestamp_ms": 1000, "current_timestamp_ms": 1000})
    media_id = _extract(client, session, pair).json()["reference"][0]["id"]

    with SessionLocal() as db:
        media = db.get(ExtractedMedia, media_id)
        for evil in ("../backend/.env", "../../etc/passwd", f"videos/{session['reference_video']['id']}.mp4"):
            media.storage_path = evil
            db.commit()
            assert client.get(f"/api/media/{media_id}/file").status_code == 404
    assert client.get("/api/media/..%2F..%2Fetc%2Fpasswd/file").status_code == 404


# ---------- Unit tests (FFmpeg mocked) ----------


def test_sampling_interval_respects_cap():
    assert ffmpeg.sampling_interval_ms(0, 2000, 8, 40) == 125
    assert ffmpeg.sampling_interval_ms(0, 10_000, 8, 40) == 250  # 80 frames capped to 40


def test_ffmpeg_timeout_is_reported(monkeypatch, tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    monkeypatch.setattr(ffmpeg.shutil, "which", lambda name: f"/usr/bin/{name}")

    def fake_run(*_args, **kwargs):
        assert kwargs.get("timeout") and "shell" not in kwargs
        raise subprocess.TimeoutExpired(cmd="ffmpeg", timeout=kwargs["timeout"])

    monkeypatch.setattr(ffmpeg.subprocess, "run", fake_run)
    with pytest.raises(ffmpeg.FFmpegTimeoutError):
        ffmpeg.extract_frame(video, 0, tmp_path / "out.jpg")


def test_ffmpeg_failure_is_reported(monkeypatch, tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    monkeypatch.setattr(ffmpeg.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(
        ffmpeg.subprocess,
        "run",
        lambda args, **_kw: subprocess.CompletedProcess(args, 1, "", "Invalid data found when processing input"),
    )
    with pytest.raises(ffmpeg.FFmpegError, match="Invalid data"):
        ffmpeg.extract_sequence(video, 0, 1000, tmp_path, "reference", 8, 40)


def test_missing_ffmpeg_binary(monkeypatch, tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    monkeypatch.setattr(ffmpeg.shutil, "which", lambda _name: None)
    assert ffmpeg.is_ffmpeg_available() is False
    with pytest.raises(ffmpeg.FFmpegUnavailableError):
        ffmpeg.probe(video)
