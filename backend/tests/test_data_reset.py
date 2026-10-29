"""Clear All Data (DELETE /api/data/all). Runs only against the temporary test storage from conftest.py.

Codex is always faked; no real model call, login or logout is made.
"""

import os
import subprocess
import threading
import time
from pathlib import Path

import pytest

from app.core.config import PROJECT_ROOT, get_settings
from app.db.database import SessionLocal
from app.db.models import AnalysisJob, AppSetting, AnalysisSession, ExtractedMedia, FeedbackItem, MatchingPair, Video
from app.services import analysis, app_settings, data_reset, standalone
from app.services.ai import codex_cli as codex_module
from tests.conftest import needs_ffmpeg, upload
from tests.test_analysis import FakeCodex, _frame_pair, _run, codex, inline_jobs  # noqa: F401  (fixtures)

URL = "/api/data/all?confirm=DELETE"
MODELS = (AnalysisSession, MatchingPair, ExtractedMedia, AnalysisJob, FeedbackItem, Video)


@pytest.fixture(autouse=True)
def _only_test_storage():
    """Guard: never run these tests against real data."""
    root = get_settings().storage_path.resolve()
    assert root.name.startswith("framemind-test-"), root
    assert root != (PROJECT_ROOT / "storage").resolve()


def _row_counts():
    with SessionLocal() as db:
        return {m.__tablename__: db.query(m).count() for m in MODELS}


def _stored_files():
    s = get_settings()
    return sorted(p for root in (s.videos_path, s.frames_path) for p in root.rglob("*") if p.is_file() and p.name != ".gitkeep")


# ---------- Request checks ----------


def test_requires_confirmation(client):
    for url in ("/api/data/all", "/api/data/all?confirm=delete", "/api/data/all?confirm=yes"):
        response = client.delete(url)
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "confirmation_required"


def test_refuses_other_origins(client):
    response = client.delete(URL, headers={"Origin": "https://evil.example"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_not_allowed"


def test_file_page_needs_pairing(client):
    response = client.delete(URL, headers={"Origin": "null"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "pairing_required"
    paired = client.delete(URL, headers={"Origin": "null", standalone.HEADER: standalone.pairing_code()})
    assert paired.status_code == 200, paired.text


# ---------- Full cleanup ----------


@pytest.fixture
def restore_model():
    yield
    with SessionLocal() as db:
        row = db.get(AppSetting, app_settings.CODEX_MODEL)
        if row is not None:
            db.delete(row)
            db.commit()


@needs_ffmpeg
def test_clears_everything_and_keeps_settings(restore_model, client, codex, session, inline_jobs, monkeypatch):
    settings = get_settings()
    (settings.videos_path / ".gitkeep").touch()
    pairing_before = standalone.code_path().read_text()
    leftover_tmp = Path(os.environ.get("TMPDIR", "/tmp")) / f"{data_reset.CODEX_TEMP_PREFIX}test-leftover"
    monkeypatch.setattr(data_reset.tempfile, "gettempdir", lambda: str(leftover_tmp.parent))
    leftover_tmp.mkdir(exist_ok=True)
    (settings.videos_path / f"abandoned{'.part'}").write_bytes(b"partial")

    pair = _frame_pair(client, session)
    assert _run(client, session, "single_frame", [pair["id"]]).status_code == 202
    counts = _row_counts()
    assert all(counts[t] >= 1 for t in counts), counts
    files = _stored_files()
    assert any(f.suffix == ".jpg" for f in files) and len(files) >= 3

    app_settings.put(app_settings.CODEX_MODEL, "model-a")  # chosen in Settings
    codex_calls_before = list(codex.calls)
    response = client.delete(URL)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["verified"] is True
    assert body["deleted"]["sessions"] >= 1 and body["deleted"]["feedback"] >= 1 and body["deleted"]["videos"] >= 2
    assert body["files_deleted"] == len(files) and body["bytes_freed"] > 0

    # Records and files are gone; schema, placeholders and settings stay.
    assert set(_row_counts().values()) == {0}
    assert _stored_files() == []
    assert (settings.videos_path / ".gitkeep").is_file()
    assert settings.videos_path.is_dir() and settings.frames_path.is_dir()
    assert (settings.storage_path / "framemind.db").is_file()
    assert not leftover_tmp.exists()
    assert app_settings.get(app_settings.CODEX_MODEL) == "model-a"
    assert standalone.code_path().read_text() == pairing_before
    # No Codex command ran (no logout, no login).
    assert codex.calls == codex_calls_before

    # The API answers with empty lists and the app works immediately.
    assert client.get("/api/sessions").json() == []
    assert client.get(f"/api/sessions/{session['id']}").status_code == 404
    assert client.get(f"/api/videos/{session['reference_video']['id']}").status_code == 404
    assert client.get("/api/health").json()["database"] is True


@needs_ffmpeg
def test_new_session_after_reset(client, codex, inline_jobs, videos):
    assert client.delete(URL).status_code == 200
    ref, cur = upload(client, videos["reference"]).json(), upload(client, videos["current"]).json()
    session = client.post("/api/sessions", json={"reference_video_id": ref["id"], "current_video_id": cur["id"]}).json()
    pair = _frame_pair(client, session)
    assert _run(client, session, "single_frame", [pair["id"]]).status_code == 202
    assert client.get(f"/api/analysis/{session['id']}/status").json()["status"] == "completed"


def test_repeated_reset_is_safe(client):
    first = client.delete(URL)
    second = client.delete(URL)
    assert first.status_code == 200 and second.status_code == 200
    assert second.json()["deleted"] == {k: 0 for k in ("sessions", "pairs", "jobs", "feedback", "media", "videos")}
    assert second.json()["files_deleted"] == 0


# ---------- Filesystem safety ----------


def test_symlinks_are_removed_not_followed(client, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    precious = outside / "precious.txt"
    precious.write_text("keep me")
    frames = get_settings().frames_path
    (frames / "link-to-dir").symlink_to(outside, target_is_directory=True)
    nested = frames / "session" / "pair"
    nested.mkdir(parents=True)
    (nested / "link-to-file").symlink_to(precious)

    assert client.delete(URL).status_code == 200
    assert precious.read_text() == "keep me"
    assert not (frames / "link-to-dir").exists() and not (frames / "link-to-dir").is_symlink()
    assert not (frames / "session").exists()


def test_refuses_symlinked_storage_folder(client, tmp_path, monkeypatch):
    root = tmp_path / "storage"
    elsewhere = tmp_path / "elsewhere"
    (root / "frames").mkdir(parents=True)
    elsewhere.mkdir()
    (elsewhere / "user-file.mov").write_bytes(b"x")
    (root / "videos").symlink_to(elsewhere, target_is_directory=True)
    monkeypatch.setattr(get_settings(), "storage_dir", root)

    response = client.delete(URL)
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "data_reset_unsafe_storage"
    assert (elsewhere / "user-file.mov").is_file()


@pytest.mark.parametrize("which", ["project", "home", "backend"])
def test_refuses_dangerous_storage_root(client, monkeypatch, which):
    target = {"project": PROJECT_ROOT, "home": Path.home(), "backend": PROJECT_ROOT / "backend"}[which]
    rows_before = _row_counts()
    monkeypatch.setattr(get_settings(), "storage_dir", target)
    response = client.delete(URL)
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "data_reset_unsafe_storage"
    assert _row_counts() == rows_before  # refused before touching the database


# ---------- Concurrency ----------


def test_writes_are_refused_during_reset(client):
    assert data_reset._block_writes(timeout=1)
    try:
        response = client.post("/api/sessions", json={})
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "data_reset_in_progress"
        assert client.get("/api/sessions").status_code == 200  # reads still work
    finally:
        data_reset._unblock_writes()
    assert client.post("/api/sessions", json={}).status_code == 201


def test_running_write_blocks_reset_and_nothing_is_deleted(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "data_reset_timeout_seconds", 0.2)
    created = client.post("/api/sessions", json={}).json()
    with data_reset._requests:
        data_reset._active_writes += 1  # an upload still streaming
    try:
        response = client.delete(URL)
    finally:
        with data_reset._requests:
            data_reset._active_writes -= 1
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "data_reset_busy"
    assert client.get(f"/api/sessions/{created['id']}").status_code == 200
    assert client.post("/api/sessions", json={}).status_code == 201  # gate reopened


def test_concurrent_reset_is_refused(client):
    assert data_reset._reset_lock.acquire(blocking=False)
    try:
        response = client.delete(URL)
    finally:
        data_reset._reset_lock.release()
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "data_reset_in_progress"


class HangingCodex(FakeCodex):
    """`codex exec` that runs until it is killed."""

    def __init__(self) -> None:
        super().__init__()
        self.entered = threading.Event()
        self.released = threading.Event()

    def popen(self, cmd, **kwargs):
        fake = self

        class Proc:
            pid = 5151
            returncode = None

            def communicate(self, input=None, timeout=None):
                fake.entered.set()
                fake.released.wait(10)
                self.returncode = -15

            def wait(self, timeout=None):
                self.returncode = -15
                return self.returncode

        return Proc()

    def kill(self, pid, sig):
        self.killed.append(sig)
        self.released.set()


@needs_ffmpeg
def test_running_analysis_is_cancelled_before_deleting(client, session, monkeypatch):
    fake = HangingCodex()
    monkeypatch.setattr(codex_module, "_which", lambda name: "/usr/local/bin/codex" if name == "codex" else None)
    monkeypatch.setattr(codex_module, "_run_process", fake.run)
    monkeypatch.setattr(codex_module, "_popen", fake.popen)
    monkeypatch.setattr(codex_module, "_killpg", fake.kill)
    codex_module.codex_cli._probe = None
    try:
        pair = _frame_pair(client, session)
        assert _run(client, session, "single_frame", [pair["id"]]).status_code == 202  # real background worker
        assert fake.entered.wait(30), "Codex never started"
        assert client.get(f"/api/analysis/{session['id']}/status").json()["status"] == "processing"

        started = time.monotonic()
        response = client.delete(URL)
        assert response.status_code == 200, response.text
        assert time.monotonic() - started < 15
        assert fake.killed, "the Codex process group was not signalled"
        assert set(_row_counts().values()) == {0}  # the job did not write feedback or recreate rows
        assert _stored_files() == []
        assert not analysis._futures

        # New analyses work again afterwards.
        assert not analysis._cancelled.is_set() and not codex_module.codex_cli._stopping
    finally:
        fake.released.set()
        codex_module.codex_cli._probe = None


def test_stop_all_refuses_runs_until_resumed(tmp_path, monkeypatch):
    fake = FakeCodex()
    monkeypatch.setattr(codex_module, "_which", lambda name: "/usr/local/bin/codex" if name == "codex" else None)
    monkeypatch.setattr(codex_module, "_run_process", fake.run)
    monkeypatch.setattr(codex_module, "_popen", fake.popen)
    service = codex_module.CodexCLIService()
    service.stop_all()
    with pytest.raises(codex_module.CodexError) as exc:
        service.run("prompt", [], tmp_path)
    assert exc.value.code == "analysis_cancelled"
    assert fake.calls == []  # Codex never started
    service.resume()
    assert not service._stopping


def test_reset_never_runs_codex_commands(client, monkeypatch):
    ran = []
    monkeypatch.setattr(codex_module, "_run_process", lambda args, **kw: ran.append(args) or subprocess.CompletedProcess(args, 0, "", ""))
    monkeypatch.setattr(codex_module, "_popen", lambda *a, **kw: ran.append(a))
    assert client.delete(URL).status_code == 200
    assert ran == []
