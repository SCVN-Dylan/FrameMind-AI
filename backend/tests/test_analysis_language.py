"""AI feedback follows the UI language. Codex is faked: it answers in the language the prompt asks for."""

import json
import re

import pytest
from sqlalchemy import create_engine, inspect, text

from app.db.database import add_missing_columns
from app.services import analysis
from tests.conftest import needs_ffmpeg
from tests.test_analysis import FakeCodex, _add_pair, _frame_pair, _Inline, codex, inline_jobs  # noqa: F401

TITLES = {
    "English": ("Player appears too small", "The player looks smaller than in the reference."),
    "Vietnamese (Tiếng Việt)": ("Nhân vật quá nhỏ trên màn hình", "Nhân vật trong bản hiện tại nhỏ hơn bản tham chiếu."),
    "Korean (한국어)": ("플레이어가 너무 작게 보입니다", "현재 빌드의 플레이어가 레퍼런스보다 작습니다."),
}


def _answer_in_requested_language(cmd, prompt):
    requested = re.search(r"in the requested language: (.+?)\.\n", prompt).group(1)
    title, observation = TITLES[requested]
    pair_id = re.search(r"Matching pair id: (\S+)", prompt).group(1)
    frames = FakeCodex.frames(prompt)
    ref = next(f for f in frames if f[1] == "reference")
    cur = next(f for f in frames if f[1] == "current")
    issue = {
        "matching_pair_id": pair_id,
        "category": "camera",
        "severity": "major",
        "title": title,
        "observation": observation,
        "impact": observation,
        "suggested_fix": "FOV",
        "unity_recommendation": "Cinemachine FOV",
        "confidence": "high",
        "reference_timestamp_ms": ref[2],
        "current_timestamp_ms": cur[2],
        "evidence_frames": [ref[0], cur[0]],
    }
    return 0, json.dumps({"schema_version": "1.0", "summary": title, "issues": [issue]}), ""


def _run(client, session, mode, pair_ids, language=None):
    body = {"analysis_mode": mode, "pair_ids": pair_ids}
    if language is not None:
        body["language"] = language
    return client.post(f"/api/analysis/{session['id']}/run", json=body)


@needs_ffmpeg
@pytest.mark.parametrize(
    "language, expected_name",
    [("vi", "Vietnamese (Tiếng Việt)"), ("en", "English"), ("ko", "Korean (한국어)")],
)
def test_single_frame_feedback_in_ui_language(client, codex, session, inline_jobs, language, expected_name):
    codex.exec_behaviour = _answer_in_requested_language
    pair = _frame_pair(client, session)
    job = _run(client, session, "single_frame", [pair["id"]], language).json()
    assert job["language"] == language

    prompt = codex.calls[-1]["prompt"]
    assert "IMPORTANT OUTPUT LANGUAGE REQUIREMENT" in prompt
    assert f"in the requested language: {expected_name}." in prompt
    assert "JSON field names and enum values MUST remain in English" in prompt
    # The schema file sent to Codex is unchanged (enums still English).
    assert "--output-schema" in codex.calls[-1]["cmd"]

    results = client.get(f"/api/analysis/{session['id']}/results").json()
    assert results["job"]["language"] == language
    [item] = results["feedback"]
    assert item["title"] == TITLES[expected_name][0]
    assert (item["category"], item["severity"], item["confidence"]) == ("camera", "major", "high")


@needs_ffmpeg
def test_short_clip_feedback_in_korean(client, codex, session, inline_jobs):
    codex.exec_behaviour = _answer_in_requested_language
    pair = _add_pair(
        client,
        session,
        {"pair_type": "short_clip", "reference_start_ms": 1000, "reference_end_ms": 2000, "current_start_ms": 2000, "current_end_ms": 5000},
    )
    job = _run(client, session, "short_clip", [pair["id"]], "ko").json()
    assert job["language"] == "ko"
    assert "Korean (한국어)" in codex.calls[-1]["prompt"]
    [item] = client.get(f"/api/analysis/{session['id']}/results").json()["feedback"]
    assert item["title"] == TITLES["Korean (한국어)"][0]


@needs_ffmpeg
@pytest.mark.parametrize("language", [None, "fr", "", "VI ", 42])
def test_missing_or_invalid_language_defaults_to_english(client, codex, session, inline_jobs, language):
    codex.exec_behaviour = _answer_in_requested_language
    pair = _frame_pair(client, session)
    response = _run(client, session, "single_frame", [pair["id"]], language)
    assert response.status_code == 202
    expected = "vi" if language == "VI " else "en"  # case/whitespace are normalised, unknown values fall back
    assert response.json()["language"] == expected


@needs_ffmpeg
def test_earlier_results_keep_their_language(client, codex, session, inline_jobs):
    codex.exec_behaviour = _answer_in_requested_language
    pair = _frame_pair(client, session)
    first = _run(client, session, "single_frame", [pair["id"]], "en").json()
    second = _run(client, session, "single_frame", [pair["id"]], "vi").json()

    jobs = client.get(f"/api/analysis/{session['id']}/jobs").json()
    assert [(j["id"], j["language"]) for j in jobs] == [(second["id"], "vi"), (first["id"], "en")]
    old = client.get(f"/api/analysis/{session['id']}/results", params={"job_id": first["id"]}).json()
    assert old["feedback"][0]["title"] == TITLES["English"][0]
    latest = client.get(f"/api/analysis/{session['id']}/results").json()
    assert latest["feedback"][0]["title"] == TITLES["Vietnamese (Tiếng Việt)"][0]


def test_migration_adds_language_column_to_existing_database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE analysis_jobs (id VARCHAR(36) PRIMARY KEY, status VARCHAR(20))"))
        conn.execute(text("INSERT INTO analysis_jobs (id, status) VALUES ('job-1', 'completed')"))
    add_missing_columns(engine)
    add_missing_columns(engine)  # idempotent
    assert "language" in {c["name"] for c in inspect(engine).get_columns("analysis_jobs")}
    with engine.connect() as conn:
        assert conn.execute(text("SELECT id, status, language FROM analysis_jobs")).one() == ("job-1", "completed", "en")
