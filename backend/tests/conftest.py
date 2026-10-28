"""Test setup: an isolated storage folder + database, and small generated videos.

STORAGE_DIR must be set before `app` is imported, because settings and the database engine are created at
import time. Tests that need FFmpeg are skipped when it isn't installed.
"""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Callable, Dict, Iterator, Optional

import pytest

_STORAGE = Path(tempfile.mkdtemp(prefix="framemind-test-"))
os.environ["STORAGE_DIR"] = str(_STORAGE)

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
needs_ffmpeg = pytest.mark.skipif(not HAS_FFMPEG, reason="FFmpeg/FFprobe not installed")


def pytest_sessionfinish(session, exitstatus) -> None:  # noqa: ARG001
    shutil.rmtree(_STORAGE, ignore_errors=True)


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def media_dir() -> Path:
    path = Path(tempfile.mkdtemp(prefix="framemind-media-"))
    yield path
    shutil.rmtree(path, ignore_errors=True)


def _make_video(path: Path, seconds: float, rate: int, codec_args: list) -> Path:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc=duration={seconds}:size=320x240:rate={rate}",
         *codec_args, str(path)],
        check=True,
        timeout=60,
    )
    return path


@pytest.fixture(scope="session")
def videos(media_dir: Path) -> Dict[str, Path]:
    """reference.mp4: 6 s, 30 fps H.264. current.webm: 8 s, 25 fps VP9. Different lengths on purpose."""
    if not HAS_FFMPEG:
        pytest.skip("FFmpeg/FFprobe not installed")
    reference = _make_video(media_dir / "reference.mp4", 6, 30, ["-c:v", "libx264", "-pix_fmt", "yuv420p"])
    current = _make_video(media_dir / "current.webm", 8, 25, ["-c:v", "libvpx-vp9", "-b:v", "200k"])
    corrupt = media_dir / "corrupt.mp4"
    # A valid-looking MP4 signature followed by garbage.
    corrupt.write_bytes(b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + os.urandom(4096))
    return {"reference": reference, "current": current, "corrupt": corrupt}


def upload(client: TestClient, path: Path, filename: Optional[str] = None, data: Optional[bytes] = None):
    return client.post(
        "/api/videos",
        params={"filename": filename or path.name},
        content=data if data is not None else path.read_bytes(),
        headers={"Content-Type": "application/octet-stream"},
    )


@pytest.fixture
def uploaded(client: TestClient, videos: Dict[str, Path]) -> Dict[str, dict]:
    ref = upload(client, videos["reference"])
    cur = upload(client, videos["current"])
    assert ref.status_code == 201, ref.text
    assert cur.status_code == 201, cur.text
    return {"reference": ref.json(), "current": cur.json()}


@pytest.fixture
def session(client: TestClient, uploaded: Dict[str, dict]) -> dict:
    response = client.post(
        "/api/sessions",
        json={"reference_video_id": uploaded["reference"]["id"], "current_video_id": uploaded["current"]["id"]},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def stored_files() -> Callable[[], set]:
    """Snapshot of every file under storage/videos and storage/frames."""

    def snapshot() -> set:
        settings = get_settings()
        return {p for root in (settings.videos_path, settings.frames_path) for p in root.rglob("*") if p.is_file()}

    return snapshot
