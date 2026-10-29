"""Codex sign-in, logout and model selection. The Codex CLI is always faked: no real login or inference."""

import io
import json
import subprocess
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.db.database import SessionLocal
from app.db.models import AnalysisJob, AppSetting
from app.main import app
from app.services import analysis
from app.services.ai import codex_cli as codex_module
from app.services.ai.codex_account import LoginFlow, codex_account
from tests.conftest import needs_ffmpeg
from tests.test_analysis import FakeCodex, _frame_pair, _Inline, _Never, _run

CATALOG = {
    "models": [
        {"slug": "model-b", "display_name": "Model B", "description": "second", "visibility": "list", "priority": 2, "input_modalities": ["text", "image"]},
        {"slug": "model-a", "display_name": "Model A", "description": "first", "visibility": "list", "priority": 1, "input_modalities": ["text", "image"]},
        {"slug": "text-only", "display_name": "Text Only", "visibility": "list", "priority": 3, "input_modalities": ["text"]},
        {"slug": "internal-reviewer", "display_name": "Hidden", "visibility": "hide", "priority": 0, "input_modalities": ["text", "image"]},
    ]
}


class FakeAccountCodex(FakeCodex):
    """Adds `logout`, `debug models` and the `login` browser flow to the fake CLI."""

    def __init__(self) -> None:
        super().__init__()
        self.logged_in = True
        self.account = "first"
        self.catalog = CATALOG
        self.catalog_fails = False
        self.bundled_fails = False
        self.logout_works = True
        self.login_result = (0, "Successfully logged in.")
        self.ran = []
        self.hold_login = None

    def run(self, args, **kwargs):
        assert "shell" not in kwargs
        self.ran.append(list(args[1:]))
        tail = args[1:]
        if tail == ["login", "status"]:
            out = "Logged in using ChatGPT" if self.logged_in else "Not logged in"
            return subprocess.CompletedProcess(args, 0 if self.logged_in else 1, out, "")
        if tail == ["logout"]:
            if self.logout_works:
                self.logged_in = False
                return subprocess.CompletedProcess(args, 0, "Successfully logged out", "")
            return subprocess.CompletedProcess(args, 1, "", "Error logging out: permission denied")
        if tail[:2] == ["debug", "models"]:
            bundled = "--bundled" in tail
            if (self.bundled_fails if bundled else self.catalog_fails):
                return subprocess.CompletedProcess(args, 1, "", "network error")
            return subprocess.CompletedProcess(args, 0, json.dumps(self.catalog), "")
        return super().run(args, **kwargs)

    def popen(self, cmd, **kwargs):
        if cmd[1:] != ["login"]:
            return super().popen(cmd, **kwargs)
        fake = self
        code, message = self.login_result
        assert kwargs["stdin"] == subprocess.DEVNULL and "shell" not in kwargs

        class LoginProc:
            pid = 999
            returncode = None
            stdout = io.BytesIO(
                (
                    "Starting local login server on http://localhost:1455.\n"
                    "If your browser did not open, navigate to this URL to authenticate:\n"
                    "https://auth.openai.com/oauth/authorize?client_id=app_x&state=abc\n"
                    f"{message}\n"
                ).encode()
            )

            def wait(self, timeout=None):
                if fake.hold_login is not None:
                    fake.hold_login.wait(5)
                self.returncode = code
                if code == 0 and fake.hold_login is None:
                    fake.logged_in = True
                    fake.account = "second"
                return code

        return LoginProc()


@pytest.fixture
def codex(monkeypatch):
    fake = FakeAccountCodex()
    monkeypatch.setattr(codex_module, "_which", lambda name: "/usr/local/bin/codex" if name == "codex" else None)
    monkeypatch.setattr(codex_module, "_run_process", fake.run)
    monkeypatch.setattr(codex_module, "_popen", fake.popen)
    monkeypatch.setattr(codex_module, "_killpg", lambda pid, sig: fake.killed.append(sig))
    codex_module.codex_cli._probe = None
    codex_account._flow = LoginFlow()
    codex_account.invalidate_models()
    with SessionLocal() as db:
        db.query(AppSetting).delete()
        db.commit()
    yield fake
    codex_module.codex_cli._probe = None
    codex_account._flow = LoginFlow()
    codex_account.invalidate_models()
    with SessionLocal() as db:
        db.query(AppSetting).delete()
        db.commit()


def _wait_login(client, state="running", timeout=3.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        data = client.get("/api/ai/provider/login").json()
        if data["state"] != state:
            return data
        time.sleep(0.02)
    raise AssertionError("login flow did not finish")


# ---------- Login ----------


def test_login_not_installed(client, codex, monkeypatch):
    monkeypatch.setattr(codex_module, "_which", lambda name: None)
    response = client.post("/api/ai/provider/login")
    assert response.status_code == 503 and response.json()["error"]["code"] == "codex_not_installed"


def test_login_success(client, codex):
    codex.logged_in = False
    response = client.post("/api/ai/provider/login")
    assert response.status_code == 202
    assert response.json()["state"] in ("running", "succeeded")
    data = _wait_login(client)
    assert data["state"] == "succeeded" and data["error"] is None
    assert data["login_url"] is None  # one-time URL is dropped when the flow ends
    status = client.get("/api/ai/provider/status").json()
    assert status["authenticated"] is True and status["auth_mode"] == "chatgpt" and status["available"]
    assert status["login"]["state"] == "succeeded"
    assert "access_token" not in json.dumps(status) and "id_token" not in json.dumps(status)


def test_login_exposes_browser_url_while_running(client, codex):
    codex.logged_in = False
    codex.hold_login = threading.Event()  # keep the fake `codex login` waiting for the user
    assert client.post("/api/ai/provider/login").status_code == 202
    deadline = time.time() + 2
    data = client.get("/api/ai/provider/login").json()
    while time.time() < deadline and not data["login_url"]:
        time.sleep(0.01)
        data = client.get("/api/ai/provider/login").json()
    assert data["state"] == "running"
    # The OpenAI sign-in page printed by the CLI, not its localhost callback server.
    assert data["login_url"].startswith("https://auth.openai.com/oauth/authorize")

    # Cancelling stops the CLI process.
    assert client.delete("/api/ai/provider/login").json()["state"] == "cancelled"
    assert codex.killed
    codex.hold_login.set()


def test_login_failure_reports_cli_error(client, codex):
    codex.logged_in = False
    codex.login_result = (1, "Error logging in: Port 127.0.0.1:1455 is already in use")
    client.post("/api/ai/provider/login")
    data = _wait_login(client)
    assert data["state"] == "failed"
    assert "already in use" in data["error"]
    assert client.get("/api/ai/provider/status").json()["authenticated"] is False


def test_login_refused_when_signed_in(client, codex):
    response = client.post("/api/ai/provider/login")
    assert response.status_code == 409 and response.json()["error"]["code"] == "codex_already_logged_in"


def test_login_from_other_origin_is_refused(client, codex):
    codex.logged_in = False
    response = client.post("/api/ai/provider/login", headers={"Origin": "http://evil.example"})
    assert response.status_code == 403 and response.json()["error"]["code"] == "origin_not_allowed"
    assert client.put("/api/ai/provider/model", json={"model": "model-a"}, headers={"Origin": "http://evil.example"}).status_code == 403
    assert client.post("/api/ai/provider/logout", headers={"Origin": "http://evil.example"}).status_code == 403


# ---------- Logout / switch account ----------


def test_logout_success(client, codex):
    response = client.post("/api/ai/provider/logout", headers={"Origin": "http://localhost:3000"})
    assert response.status_code == 200
    data = response.json()
    assert data["authenticated"] is False and data["available"] is False
    assert ["logout"] in codex.ran
    assert codex.ran.index(["logout"]) < len(codex.ran) - 1  # status was re-checked after logout


def test_logout_failure_is_not_reported_as_success(client, codex):
    codex.logout_works = False
    response = client.post("/api/ai/provider/logout")
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "codex_logout_failed"
    assert client.get("/api/ai/provider/status").json()["authenticated"] is True


def test_switch_account(client, codex):
    assert client.post("/api/ai/provider/logout").status_code == 200
    assert client.post("/api/ai/provider/login").status_code == 202
    assert _wait_login(client)["state"] == "succeeded"
    assert codex.account == "second"
    assert client.get("/api/ai/provider/status").json()["authenticated"] is True


@needs_ffmpeg
def test_logout_refused_while_analysis_runs(client, codex, session, monkeypatch):
    monkeypatch.setattr(analysis, "_worker", lambda: _Never())
    pair = _frame_pair(client, session)
    assert _run(client, session, "single_frame", [pair["id"]]).status_code == 202
    response = client.post("/api/ai/provider/logout")
    assert response.status_code == 409 and response.json()["error"]["code"] == "analysis_in_progress"
    with SessionLocal() as db:  # don't leave an active job behind for other tests
        db.query(AnalysisJob).filter(AnalysisJob.status == "pending").update({"status": "failed"})
        db.commit()


# ---------- Models ----------


def test_models_listed_from_account_catalog(client, codex):
    data = client.get("/api/ai/provider/models").json()
    assert data["source"] == "codex_catalog"
    assert [m["slug"] for m in data["models"]] == ["model-a", "model-b", "text-only"]  # hidden excluded, by priority
    assert {m["slug"]: m["supports_images"] for m in data["models"]}["text-only"] is False
    assert data["selected"] is None and data["selected_unavailable"] is False


def test_models_fall_back_to_bundled_then_unavailable(client, codex):
    codex.catalog_fails = True
    assert client.get("/api/ai/provider/models?refresh=true").json()["source"] == "bundled_catalog"
    codex.bundled_fails = True
    data = client.get("/api/ai/provider/models?refresh=true").json()
    assert data["source"] == "unavailable" and data["models"] == [] and data["error"]


def test_model_selection_persists_across_restart(client, codex):
    response = client.put("/api/ai/provider/model", json={"model": "model-b"})
    assert response.status_code == 200 and response.json()["selected"] == "model-b"
    with TestClient(app) as restarted:
        assert restarted.get("/api/ai/provider/models").json()["selected"] == "model-b"
        assert restarted.get("/api/ai/provider/status").json()["model"] == "model-b"
    # Back to the CLI default.
    assert client.put("/api/ai/provider/model", json={"model": None}).json()["selected"] is None


def test_unsupported_models_are_rejected(client, codex):
    for slug, code in (("not-a-model", "model_unsupported"), ("text-only", "model_unsupported"), ("internal-reviewer", "model_unsupported")):
        response = client.put("/api/ai/provider/model", json={"model": slug})
        assert response.status_code == 422 and response.json()["error"]["code"] == code
    assert client.put("/api/ai/provider/model", json={"model": "bad name; rm -rf"}).status_code == 422
    codex.catalog_fails = codex.bundled_fails = True
    response = client.put("/api/ai/provider/model", json={"model": "model-a"})
    assert response.status_code == 503 and response.json()["error"]["code"] == "model_unverifiable"


# ---------- Analyze with the selected model ----------


@needs_ffmpeg
def test_analyze_uses_selected_model_and_running_jobs_keep_theirs(client, codex, session, monkeypatch):
    client.put("/api/ai/provider/model", json={"model": "model-a"})
    monkeypatch.setattr(analysis, "_worker", lambda: _Inline())
    pair = _frame_pair(client, session)
    job = _run(client, session, "single_frame", [pair["id"]]).json()
    assert job["model"] == "model-a"
    cmd = codex.calls[-1]["cmd"]
    assert cmd[cmd.index("--model") + 1] == "model-a"

    # A queued job keeps its model when the selection changes; new jobs use the new one.
    monkeypatch.setattr(analysis, "_worker", lambda: _Never())
    queued = _run(client, session, "single_frame", [pair["id"]]).json()
    client.put("/api/ai/provider/model", json={"model": "model-b"})
    with SessionLocal() as db:
        assert db.get(AnalysisJob, queued["id"]).model == "model-a"
        db.get(AnalysisJob, queued["id"]).status = "failed"
        db.commit()
    monkeypatch.setattr(analysis, "_worker", lambda: _Inline())
    clip_pair = client.post(
        f"/api/sessions/{session['id']}/pairs",
        json={"pair_type": "short_clip", "reference_start_ms": 0, "reference_end_ms": 1000, "current_start_ms": 1000, "current_end_ms": 3000},
    ).json()
    clip_job = _run(client, session, "short_clip", [clip_pair["id"]]).json()
    assert clip_job["model"] == "model-b"
    cmd = codex.calls[-1]["cmd"]
    assert cmd[cmd.index("--model") + 1] == "model-b"


@needs_ffmpeg
def test_default_model_passes_no_model_flag(client, codex, session, monkeypatch):
    monkeypatch.setattr(analysis, "_worker", lambda: _Inline())
    pair = _frame_pair(client, session)
    job = _run(client, session, "single_frame", [pair["id"]]).json()
    assert job["model"] is None and "--model" not in codex.calls[-1]["cmd"]


@needs_ffmpeg
def test_analyze_refused_when_selected_model_disappears(client, codex, session, monkeypatch):
    monkeypatch.setattr(analysis, "_worker", lambda: _Inline())
    client.put("/api/ai/provider/model", json={"model": "model-b"})
    codex.catalog = {"models": [m for m in CATALOG["models"] if m["slug"] != "model-b"]}
    codex_account.invalidate_models()
    pair = _frame_pair(client, session)
    response = _run(client, session, "single_frame", [pair["id"]])
    assert response.status_code == 422 and response.json()["error"]["code"] == "model_unsupported"
    assert client.get("/api/ai/provider/models").json()["selected_unavailable"] is True


@needs_ffmpeg
def test_expired_sign_in_fails_job_and_rechecks(client, codex, session, monkeypatch):
    monkeypatch.setattr(analysis, "_worker", lambda: _Inline())
    codex.exec_behaviour = lambda cmd, prompt: (1, None, "ERROR: unexpected status 401 Unauthorized: token expired")
    pair = _frame_pair(client, session)
    _run(client, session, "single_frame", [pair["id"]])
    status = client.get(f"/api/analysis/{session['id']}/status").json()
    assert status["status"] == "failed" and status["error_code"] == "codex_not_authenticated"
    assert codex_module.codex_cli._probe is None  # cached "signed in" state was dropped
