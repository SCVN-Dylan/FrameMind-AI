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
