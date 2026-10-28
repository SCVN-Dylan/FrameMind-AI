"""Local file storage for uploaded videos and extracted frames."""

from app.core.config import get_settings


def ensure_storage_dirs() -> None:
    settings = get_settings()
    for path in (settings.storage_path, settings.videos_path, settings.frames_path):
        path.mkdir(parents=True, exist_ok=True)


def is_storage_ready() -> bool:
    settings = get_settings()
    return settings.videos_path.is_dir() and settings.frames_path.is_dir()
