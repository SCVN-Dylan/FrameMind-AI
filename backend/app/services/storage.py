"""Local file storage for uploaded videos and extracted frames.

The database stores paths relative to the storage root ("videos/<id>.mp4"). `resolve()` turns them back
into absolute paths and refuses anything that would point outside the storage folder.
"""

import logging
import shutil
from pathlib import Path

from app.core.config import get_settings

logger = logging.getLogger(__name__)

PARTIAL_UPLOAD_SUFFIX = ".part"
TEMP_DIR_PREFIX = ".tmp-"


def ensure_storage_dirs() -> None:
    settings = get_settings()
    for path in (settings.storage_path, settings.videos_path, settings.frames_path):
        path.mkdir(parents=True, exist_ok=True)


def is_storage_ready() -> bool:
    settings = get_settings()
    return settings.videos_path.is_dir() and settings.frames_path.is_dir()


def relative(path: Path) -> str:
    """Absolute path inside storage -> relative POSIX path for the database."""
    return path.resolve().relative_to(get_settings().storage_path.resolve()).as_posix()


def resolve(relative_path: str) -> Path:
    """Relative path from the database -> absolute path. Raises ValueError if it escapes the storage root."""
    root = get_settings().storage_path.resolve()
    path = (root / relative_path).resolve()
    if path != root and root not in path.parents:
        raise ValueError(f"Path escapes storage root: {relative_path!r}")
    return path


def session_frames_dir(session_id: str) -> Path:
    return get_settings().frames_path / session_id


def pair_frames_dir(session_id: str, pair_id: str) -> Path:
    return session_frames_dir(session_id) / pair_id


def delete_file(relative_path: str) -> None:
    try:
        resolve(relative_path).unlink(missing_ok=True)
    except (OSError, ValueError):
        logger.warning("Could not delete %s", relative_path, exc_info=True)


def delete_dir(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)


def remove_empty_dirs(path: Path, stop_at: Path) -> None:
    """Removes `path` and its parents while they are empty, up to (not including) `stop_at`."""
    path, stop_at = path.resolve(), stop_at.resolve()
    while path != stop_at and stop_at in path.parents:
        try:
            path.rmdir()
        except OSError:
            return
        path = path.parent


def cleanup_interrupted_work() -> None:
    """Deletes partial uploads and temporary extraction folders left behind by a crash or restart."""
    settings = get_settings()
    for part in settings.videos_path.glob(f"*{PARTIAL_UPLOAD_SUFFIX}"):
        logger.info("Removing interrupted upload %s", part.name)
        part.unlink(missing_ok=True)
    for tmp in settings.frames_path.glob(f"*/*/{TEMP_DIR_PREFIX}*"):
        logger.info("Removing interrupted extraction %s", tmp)
        delete_dir(tmp)
