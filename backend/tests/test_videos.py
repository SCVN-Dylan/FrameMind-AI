from pathlib import Path

from app.core.config import get_settings
from tests.conftest import needs_ffmpeg, upload

pytestmark = needs_ffmpeg


def test_valid_upload_and_metadata(client, videos, stored_files):
    response = upload(client, videos["reference"], filename="My Gameplay (final).mp4")
    assert response.status_code == 201, response.text
    data = response.json()

    assert data["original_filename"] == "My Gameplay (final).mp4"
    assert data["file_size"] == videos["reference"].stat().st_size
    assert data["duration_ms"] == 6000
    assert (data["width"], data["height"]) == (320, 240)
    assert data["fps"] == 30
    assert data["codec"] == "h264"
    assert data["created_at"].endswith("Z")
    assert data["url"] == f"/api/videos/{data['id']}/file"
    # Stored under a UUID name, never the original filename.
    stored = get_settings().videos_path / f"{data['id']}.mp4"
    assert stored.is_file()
    assert "storage_path" not in data

    again = client.get(f"/api/videos/{data['id']}")
    assert again.status_code == 200
    assert again.json() == data


def test_webm_metadata(client, videos):
    data = upload(client, videos["current"]).json()
    assert data["duration_ms"] == 8000
    assert data["fps"] == 25
    assert data["codec"] == "vp9"


def test_rejects_unsupported_extension(client, videos, stored_files):
    before = stored_files()
    response = upload(client, videos["reference"], filename="clip.avi")
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_format"
    assert stored_files() == before


def test_rejects_non_video_content_with_video_extension(client, stored_files):
    before = stored_files()
    response = upload(client, Path("notes.mp4"), data=b"hello, this is not a video at all" * 10)
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "invalid_content"
    assert stored_files() == before


def test_rejects_mismatched_extension(client, videos):
    # WebM bytes renamed to .mp4: the file signature doesn't match.
    response = upload(client, videos["current"], filename="renamed.mp4")
    assert response.status_code == 415


def test_rejects_empty_file(client):
    response = upload(client, Path("empty.mp4"), data=b"")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "empty_file"


def test_rejects_corrupt_video_and_cleans_up(client, videos, stored_files):
    before = stored_files()
    response = upload(client, videos["corrupt"])
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "corrupt_video"
    assert stored_files() == before


def test_rejects_oversized_upload_while_streaming(client, videos, stored_files, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_upload_bytes", 1000)
    before = stored_files()
    data = videos["reference"].read_bytes()
    assert len(data) > 1000

    # Content-Length is checked first...
    response = upload(client, videos["reference"])
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "file_too_large"

    # ...and the streamed byte count is enforced even when Content-Length is missing.
    def chunks():
        for i in range(0, len(data), 256):
            yield data[i : i + 256]

    response = client.post(
        "/api/videos", params={"filename": "big.mp4"}, content=chunks(), headers={"Content-Type": "application/octet-stream"}
    )
    assert response.status_code == 413
    assert stored_files() == before
    assert not list(get_settings().videos_path.glob("*.part"))


def test_filename_is_sanitised(client, videos):
    data = upload(client, videos["reference"], filename="../../etc/passwd\x00.mp4").json()
    assert data["original_filename"] == "passwd.mp4"
    assert (get_settings().videos_path / f"{data['id']}.mp4").is_file()


def test_missing_video_returns_404(client):
    response = client.get("/api/videos/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "video_not_found"
    assert client.get("/api/videos/00000000-0000-0000-0000-000000000000/file").status_code == 404


def test_video_streaming_supports_ranges(client, videos):
    data = upload(client, videos["reference"]).json()
    full = client.get(data["url"])
    assert full.status_code == 200
    assert full.headers["content-type"] == "video/mp4"
    assert full.content == videos["reference"].read_bytes()

    partial = client.get(data["url"], headers={"Range": "bytes=0-99"})
    assert partial.status_code == 206
    assert len(partial.content) == 100


def test_missing_ffmpeg_returns_503(client, videos, monkeypatch, stored_files):
    monkeypatch.setattr("app.services.video.ffmpeg.shutil.which", lambda _name: None)
    before = stored_files()
    response = upload(client, videos["reference"])
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ffmpeg_unavailable"
    assert stored_files() == before
    assert client.get("/api/health").json()["ffmpeg"] is False
