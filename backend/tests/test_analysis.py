"""AI analysis with the Codex CLI provider. Codex itself is always mocked: no real model call is made."""

import json
import os
import re
import subprocess
from typing import Callable, List, Optional

import pytest
from fastapi.testclient import TestClient

from app.core.config import PROJECT_ROOT, get_settings
from app.db.database import SessionLocal
from app.db.models import AnalysisJob
from app.main import app
from app.schemas.analysis import AIAnalysisOutput
from app.services import analysis
from app.services.ai import codex_cli as codex_module
from app.services.ai.codex_cli import CodexCLIService, CodexError, parse_answer
from tests.conftest import needs_ffmpeg

HELP_TEXT = """Run Codex non-interactively
  -c, --config <key=value>
      --disable <FEATURE>
  -i, --image <FILE>...
  -C, --cd <DIR>
      --skip-git-repo-check
      --ephemeral
      --ignore-user-config
      --output-schema <FILE>
  -o, --output-last-message <FILE>
"""

FRAME_LINE = re.compile(r"(R\d+|C\d+) = (REFERENCE|CURRENT) video at [\d.]+s \(timestamp_ms (\d+)\)")


class FakeCodex:
    """Stands in for the `codex` binary: answers probe commands and `codex exec` runs."""

    def __init__(self) -> None:
        self.version = "codex-cli 0.165.0"
        self.help = HELP_TEXT
        self.login = "Logged in using ChatGPT"
        self.calls: List[dict] = []
        # (cmd, prompt) -> (returncode, answer text or None, stderr)
        self.exec_behaviour: Callable = self.good_answer
        self.timeout = False
        self.killed: List[int] = []

    # --- subprocess.run (probe) ---
    def run(self, args, **kwargs):
        assert "shell" not in kwargs
        out = {"--version": self.version, "--help": self.help, "status": self.login}[args[-1]]
        return subprocess.CompletedProcess(args, 0, out, "")

    # --- subprocess.Popen (exec) ---
    def popen(self, cmd, **kwargs):
        fake = self

        class Proc:
            pid = 4242
            returncode: Optional[int] = None

            def communicate(self, input=None, timeout=None):
                prompt = input.decode()
                fake.calls.append({"cmd": cmd, "prompt": prompt, "env": kwargs["env"], "cwd": kwargs["cwd"], "kwargs": kwargs})
                if fake.timeout:
                    raise subprocess.TimeoutExpired(cmd, timeout)
                code, answer, stderr = fake.exec_behaviour(cmd, prompt)
                if answer is not None:
                    with open(cmd[cmd.index("--output-last-message") + 1], "w") as handle:
                        handle.write(answer)
                kwargs["stderr"].write(stderr.encode())
                self.returncode = code

            def wait(self, timeout=None):
                self.returncode = -9
                return self.returncode

        return Proc()

    @staticmethod
    def frames(prompt):
        return [(label, role.lower(), int(ms)) for label, role, ms in FRAME_LINE.findall(prompt)]

    def good_answer(self, cmd, prompt):
        pair_id = re.search(r"Matching pair id: (\S+)", prompt).group(1)
        frames = self.frames(prompt)
        ref = [f for f in frames if f[1] == "reference"]
        cur = [f for f in frames if f[1] == "current"]
        issue = {
            "matching_pair_id": pair_id,
            "category": "camera",
            "severity": "major",
            "title": "Player appears too small",
            "observation": "The player occupies less screen space in the current build.",
            "impact": "The main action is less readable.",
            "suggested_fix": "Move the camera closer to the player.",
            "unity_recommendation": "Review the Cinemachine follow distance and field of view.",
            "confidence": "high",
            "reference_timestamp_ms": ref[-1][2],
            "current_timestamp_ms": cur[-1][2],
            "evidence_frames": [ref[-1][0], cur[-1][0]],
        }
        body = {"schema_version": "1.0", "summary": "Framing differs.", "issues": [issue]}
        return 0, json.dumps(body), ""


@pytest.fixture
def codex(monkeypatch):
    fake = FakeCodex()
    monkeypatch.setattr(codex_module, "_which", lambda name: "/usr/local/bin/codex" if name == "codex" else None)
    monkeypatch.setattr(codex_module, "_run_process", fake.run)
    monkeypatch.setattr(codex_module, "_popen", fake.popen)
    monkeypatch.setattr(codex_module, "_killpg", lambda pid, sig: fake.killed.append(sig))
    codex_module.codex_cli._probe = None
    codex_module.codex_cli.last_error = None
    yield fake
    codex_module.codex_cli._probe = None


class _Inline:
    """Runs jobs immediately in the request thread so tests are deterministic."""

    def submit(self, fn, *args):
        fn(*args)


class _Never:
    def submit(self, fn, *args):
        pass


@pytest.fixture
def inline_jobs(monkeypatch):
    monkeypatch.setattr(analysis, "_worker", lambda: _Inline())


def _add_pair(client, session, body):
    response = client.post(f"/api/sessions/{session['id']}/pairs", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _frame_pair(client, session, ref_ms=1000, cur_ms=5000):
    return _add_pair(client, session, {"pair_type": "single_frame", "reference_timestamp_ms": ref_ms, "current_timestamp_ms": cur_ms})


def _run(client, session, mode, pair_ids):
    return client.post(f"/api/analysis/{session['id']}/run", json={"analysis_mode": mode, "pair_ids": pair_ids})


# ---------- Provider detection ----------


def test_provider_status_ready(client, codex):
    data = client.get("/api/ai/provider/status?refresh=true").json()
    assert data["provider"] == "codex_cli"
    assert data["installed"] and data["version"] == "0.165.0" and data["version_supported"]
    assert data["authenticated"] is True and data["auth_mode"] == "chatgpt"
    assert all(data["capabilities"].values())
    assert data["available"] is True
    assert "token" not in json.dumps(data).lower()


def test_codex_not_installed(client, codex, monkeypatch):
    monkeypatch.setattr(codex_module, "_which", lambda name: None)
    data = client.get("/api/ai/provider/status?refresh=true").json()
    assert data["installed"] is False and data["available"] is False
    assert "npm install -g @openai/codex" in data["last_error"]


@needs_ffmpeg
def test_run_refused_when_codex_missing(client, codex, session, monkeypatch, inline_jobs):
    monkeypatch.setattr(codex_module, "_which", lambda name: None)
    pair = _frame_pair(client, session)
    response = _run(client, session, "single_frame", [pair["id"]])
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "codex_not_installed"


def test_unsupported_version(client, codex):
    codex.version = "codex-cli 0.100.2"
    data = client.get("/api/ai/provider/status?refresh=true").json()
    assert data["version_supported"] is False and data["available"] is False
    assert "0.165.0" in data["last_error"]


def test_missing_cli_options(client, codex):
    codex.help = "Run Codex non-interactively\n  -i, --image <FILE>...\n"
    data = client.get("/api/ai/provider/status?refresh=true").json()
    assert data["available"] is False
    assert data["capabilities"]["output_schema"] is False


def test_not_authenticated(client, codex):
    codex.login = "Not logged in"
    data = client.get("/api/ai/provider/status?refresh=true").json()
    assert data["authenticated"] is False and data["available"] is False
    assert "codex login" in data["last_error"]


def test_api_key_auth_is_refused(client, codex):
    codex.login = "Logged in using an API key - sk-proj-***"
    data = client.get("/api/ai/provider/status?refresh=true").json()
    assert data["auth_mode"] == "api_key" and data["available"] is False


# ---------- Successful runs ----------


@needs_ffmpeg
def test_single_frame_analysis_with_different_timestamps(client, codex, session, inline_jobs, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-never-reach-codex")
    pair = _frame_pair(client, session, ref_ms=1000, cur_ms=5000)
    response = _run(client, session, "single_frame", [pair["id"]])
    assert response.status_code == 202, response.text
    job = response.json()

    status = client.get(f"/api/analysis/{session['id']}/status").json()
    assert status["id"] == job["id"] and status["status"] == "completed"
    assert status["provider"] == "codex_cli" and status["provider_version"] == "0.165.0"

    results = client.get(f"/api/analysis/{session['id']}/results").json()
    assert results["job"]["summary"] == "Framing differs."
    [item] = results["feedback"]
    assert item["matching_pair_id"] == pair["id"]
    assert (item["reference_timestamp_ms"], item["current_timestamp_ms"]) == (1000, 5000)
    assert item["severity"] == "major" and item["confidence"] == "high"
    assert {e["label"] for e in item["evidence"]} == {"R1", "C1"}
    assert all(e["url"] and e["url"].startswith("/api/media/") for e in item["evidence"])

    # Exactly two labelled images were sent; the command was locked down; no API key leaked.
    [call] = codex.calls
    cmd = call["cmd"]
    images = [cmd[i + 1] for i, a in enumerate(cmd) if a == "--image"]
    assert len(images) == 2 and "R1_reference_1000ms" in images[0] and "C1_current_5000ms" in images[1]
    assert "OPENAI_API_KEY" not in call["env"]
    assert "shell" not in call["kwargs"]
    joined = " ".join(cmd)
    assert '":root"="deny"' in joined and "--ignore-user-config" in cmd and "--ephemeral" in cmd
    assert "dangerously" not in joined and "danger-full-access" not in joined and "--sandbox" not in cmd
    for feature in ("shell_tool", "unified_exec", "view_image", "browser_use", "computer_use"):
        assert feature in cmd
    assert pair["id"] not in cmd  # user/pair data goes through stdin, never into arguments
    assert "Do NOT claim anything about motion" in call["prompt"]
    # Codex runs in a throwaway folder outside the project, which is deleted afterwards.
    assert not call["cwd"].startswith(str(PROJECT_ROOT)) and "framemind-codex-" in call["cwd"]
    assert not os.path.exists(call["cwd"])


@needs_ffmpeg
def test_short_clip_analysis_with_different_durations(client, codex, session, inline_jobs, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_max_frames_per_clip", 4)
    # Reference 1.0–2.0 s (1 s) <-> Current 2.0–5.0 s (3 s).
    pair = _add_pair(
        client,
        session,
        {"pair_type": "short_clip", "reference_start_ms": 1000, "reference_end_ms": 2000, "current_start_ms": 2000, "current_end_ms": 5000},
    )
    assert _run(client, session, "short_clip", [pair["id"]]).status_code == 202

    [call] = codex.calls
    frames = FakeCodex.frames(call["prompt"])
    ref = [f for f in frames if f[1] == "reference"]
    cur = [f for f in frames if f[1] == "current"]
    assert len(ref) == 4 and len(cur) == 4
    assert [f[0] for f in ref] == ["R1", "R2", "R3", "R4"]
    assert ref == sorted(ref, key=lambda f: f[2]) and cur == sorted(cur, key=lambda f: f[2])
    assert ref[0][2] == 1000 and 1000 <= ref[-1][2] < 2000
    assert cur[0][2] == 2000 and 4000 <= cur[-1][2] < 5000
    assert "do NOT claim exact animation timing" in call["prompt"]

    [item] = client.get(f"/api/analysis/{session['id']}/results").json()["feedback"]
    assert item["reference_timestamp_ms"] == ref[-1][2]
    assert item["current_timestamp_ms"] == cur[-1][2]


@needs_ffmpeg
def test_zero_issues_is_valid(client, codex, session, inline_jobs):
    codex.exec_behaviour = lambda cmd, prompt: (0, json.dumps({"schema_version": "1.0", "summary": "Looks the same.", "issues": []}), "")
    pair = _frame_pair(client, session)
    _run(client, session, "single_frame", [pair["id"]])
    results = client.get(f"/api/analysis/{session['id']}/results").json()
    assert results["job"]["status"] == "completed" and results["feedback"] == []


# ---------- Failures ----------


@needs_ffmpeg
@pytest.mark.parametrize(
    "answer, code",
    [
        ("this is not json", "codex_invalid_output"),
        (json.dumps({"schema_version": "1.0", "summary": "x", "issues": [{"category": "camera"}]}), "codex_invalid_output"),
        (json.dumps({"schema_version": "2.0", "summary": "x", "issues": []}), "codex_invalid_output"),
        (None, "codex_invalid_output"),
    ],
)
def test_invalid_output_fails_job(client, codex, session, inline_jobs, answer, code):
    codex.exec_behaviour = lambda cmd, prompt: (0, answer, "")
    pair = _frame_pair(client, session)
    _run(client, session, "single_frame", [pair["id"]])
    status = client.get(f"/api/analysis/{session['id']}/status").json()
    assert status["status"] == "failed" and status["error_code"] == code
    assert client.get(f"/api/analysis/{session['id']}/results").status_code == 404


@needs_ffmpeg
def test_timeout_kills_process_and_fails_job(client, codex, session, inline_jobs):
    codex.timeout = True
    pair = _frame_pair(client, session)
    _run(client, session, "single_frame", [pair["id"]])
    status = client.get(f"/api/analysis/{session['id']}/status").json()
    assert status["status"] == "failed" and status["error_code"] == "codex_timeout"
    assert codex.killed  # the process group was signalled


@needs_ffmpeg
def test_nonzero_exit_fails_job_without_leaking_tokens(client, codex, session, inline_jobs):
    codex.exec_behaviour = lambda cmd, prompt: (1, None, "error: request failed Bearer abc.def.ghi\nstream disconnected sk-proj-1234567890abcdef")
    pair = _frame_pair(client, session)
    _run(client, session, "single_frame", [pair["id"]])
    status = client.get(f"/api/analysis/{session['id']}/status").json()
    assert status["status"] == "failed" and status["error_code"] == "codex_failed"
    assert "sk-proj" not in status["error_message"] and "abc.def" not in status["error_message"]


@needs_ffmpeg
def test_duplicate_job_is_refused(client, codex, session, monkeypatch):
    monkeypatch.setattr(analysis, "_worker", lambda: _Never())  # first job stays pending
    pair = _frame_pair(client, session)
    first = _run(client, session, "single_frame", [pair["id"]])
    assert first.status_code == 202
    second = _run(client, session, "single_frame", [pair["id"]])
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "analysis_in_progress"
    assert second.json()["error"]["details"]["job_id"] == first.json()["id"]


@needs_ffmpeg
def test_request_validation(client, codex, session, inline_jobs):
    frame = _frame_pair(client, session)
    assert _run(client, session, "short_clip", [frame["id"]]).json()["error"]["code"] == "pair_type_mismatch"
    assert _run(client, session, "full_video", [frame["id"]]).status_code == 422
    assert _run(client, session, "single_frame", ["00000000-0000-0000-0000-000000000000"]).status_code == 404
    assert _run(client, session, "single_frame", []).status_code == 422


# ---------- Persistence ----------


@needs_ffmpeg
def test_results_survive_restart_and_interrupted_jobs_fail(client, codex, session, inline_jobs, monkeypatch):
    pair = _frame_pair(client, session)
    _run(client, session, "single_frame", [pair["id"]])

    # A job left "processing" by a crash.
    with SessionLocal() as db:
        db.add(AnalysisJob(session_id=session["id"], status="processing", analysis_mode="single_frame", provider="codex_cli", pair_ids_json="[]"))
        db.commit()

    with TestClient(app) as restarted:
        status = restarted.get(f"/api/analysis/{session['id']}/status").json()
        assert status["status"] == "failed" and status["error_code"] == "interrupted"
        results = restarted.get(f"/api/analysis/{session['id']}/results").json()
        assert results["job"]["status"] == "completed" and len(results["feedback"]) == 1
        jobs = restarted.get(f"/api/analysis/{session['id']}/jobs").json()
        assert [j["status"] for j in jobs] == ["failed", "completed"]
        listed = next(s for s in restarted.get("/api/sessions").json() if s["id"] == session["id"])
        assert listed["analysis_status"] == "failed" and listed["feedback_count"] == 1


@needs_ffmpeg
def test_deleting_session_deletes_analysis(client, codex, session, inline_jobs):
    pair = _frame_pair(client, session)
    _run(client, session, "single_frame", [pair["id"]])
    assert client.delete(f"/api/sessions/{session['id']}").status_code == 204
    with SessionLocal() as db:
        assert db.query(AnalysisJob).filter_by(session_id=session["id"]).count() == 0


# ---------- Output validation (unit) ----------


class _Pair:
    id = "11111111-1111-1111-1111-111111111111"


FRAMES = [
    analysis.SentFrame("R1", "reference", 1000, "m-r1", None),  # type: ignore[arg-type]
    analysis.SentFrame("R2", "reference", 1500, "m-r2", None),  # type: ignore[arg-type]
    analysis.SentFrame("C1", "current", 5000, "m-c1", None),  # type: ignore[arg-type]
    analysis.SentFrame("C2", "current", 6200, "m-c2", None),  # type: ignore[arg-type]
]


def _issue(**overrides):
    base = {
        "matching_pair_id": _Pair.id,
        "category": "lighting",
        "severity": "minor",
        "title": "Scene is darker",
        "observation": "o",
        "impact": "i",
        "suggested_fix": "f",
        "unity_recommendation": "u",
        "confidence": "medium",
        "reference_timestamp_ms": 1000,
        "current_timestamp_ms": 5000,
        "evidence_frames": ["R1", "C1"],
    }
    base.update(overrides)
    return base


def _normalize(issues, mode="short_clip"):
    output = AIAnalysisOutput.model_validate({"schema_version": "1.0", "summary": "s", "issues": issues})
    return analysis.normalize_issues(output, _Pair(), FRAMES, mode)


def test_normalize_rejects_wrong_pair_and_duplicates():
    kept, rejected = _normalize([_issue(), _issue(), _issue(matching_pair_id="other", title="x")])
    assert len(kept) == 1 and rejected == 2


def test_normalize_snaps_fabricated_timestamps_to_sent_frames():
    [item], _ = _normalize([_issue(reference_timestamp_ms=1400, current_timestamp_ms=99999)])
    assert (item["reference_timestamp_ms"], item["current_timestamp_ms"]) == (1500, 6200)


def test_normalize_drops_unknown_evidence_and_falls_back():
    [item], _ = _normalize([_issue(evidence_frames=["R9", "X1"], reference_timestamp_ms=1500, current_timestamp_ms=6200)])
    assert [e["label"] for e in json.loads(item["evidence_json"])] == ["R2", "C2"]


def test_normalize_single_frame_animation_is_low_confidence():
    [item], _ = _normalize([_issue(category="animation", confidence="high")], mode="single_frame")
    assert item["confidence"] == "low"


def test_parse_answer_accepts_code_fence_and_rejects_extra_fields():
    body = {"schema_version": "1.0", "summary": "s", "issues": []}
    assert parse_answer("```json\n" + json.dumps(body) + "\n```").summary == "s"
    with pytest.raises(CodexError):
        parse_answer(json.dumps({**body, "run": "rm -rf /"}))


def test_build_command_has_no_prompt_or_shell_and_reads_only_workdir(tmp_path):
    service = CodexCLIService()
    image = tmp_path / "01_R1_reference_0ms.jpg"
    cmd = service.build_command("/usr/local/bin/codex", tmp_path, [image], tmp_path / "s.json", tmp_path / "a.json")
    assert cmd[:2] == ["/usr/local/bin/codex", "exec"]
    assert cmd[-2:] == ["--image", str(image)]  # nothing positional after images: the prompt is on stdin
    filesystem = next(arg for arg in cmd if ".filesystem=" in arg)
    assert '":root"="deny"' in filesystem and f'"{tmp_path.resolve()}"="read"' in filesystem
    assert 'approval_policy="never"' in cmd


@needs_ffmpeg
def test_status_is_null_before_first_analysis(client, codex, session):
    response = client.get(f"/api/analysis/{session['id']}/status")
    assert response.status_code == 200 and response.json() is None
    assert client.get(f"/api/analysis/{session['id']}/results").status_code == 404
