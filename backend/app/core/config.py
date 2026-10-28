"""Application settings loaded from environment variables (backend/.env)."""

from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "FrameMind AI"
    app_version: str = "0.1.0"
    environment: str = "development"

    frontend_origin: str = "http://localhost:3000"

    storage_dir: Path = Path("storage")

    # Uploads
    max_upload_bytes: int = 1024 * 1024 * 1024  # 1 GB per video

    # FFmpeg / FFprobe
    ffprobe_timeout_seconds: float = 30
    ffmpeg_timeout_seconds: float = 120
    max_concurrent_extractions: int = 2
    # Short Clip sampling: frames per second taken from each clip, capped per clip to control cost.
    clip_sample_fps: float = 8
    clip_max_frames: int = 40
    # Extracted frames are scaled down to this width (never up). Keeps files and later AI calls small.
    frame_max_width: int = 1280

    # Reserved for the AI analysis milestone. Never hardcode the key.
    openai_api_key: Optional[str] = None
    openai_model: str = "gpt-4o"

    @property
    def storage_path(self) -> Path:
        path = self.storage_dir
        return path if path.is_absolute() else PROJECT_ROOT / path

    @property
    def videos_path(self) -> Path:
        return self.storage_path / "videos"

    @property
    def frames_path(self) -> Path:
        return self.storage_path / "frames"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.storage_path / 'framemind.db'}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
