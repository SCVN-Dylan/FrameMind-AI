"""Clear All Data (Settings → Data Management): deletes every user-generated record and file, keeps the app working.

Deleted: sessions, matching pairs, analysis jobs, AI feedback, extracted-media rows and video rows (one SQLite
transaction), every file inside storage/videos and storage/frames (uploads, partial uploads, extracted frames) and
leftover `framemind-codex-*` temp folders. The schema, framemind.db itself and `app_settings` (the chosen AI model)
are kept, and so are the standalone pairing code and everything Codex CLI owns (installation, ~/.codex sign-in).

Order, so nothing can recreate data while it is deleted:
1. Refuse new write requests (`guard_request` middleware) and wait for running ones (uploads, extraction) to end.
2. Cancel analysis jobs: queued ones never start, running Codex processes are killed, workers stop.
3. Delete rows, then files, then check that both are really gone.
If step 1 or 2 doesn't finish in time nothing is deleted and a 409 explains why.

File deletion never follows symlinks and only touches entries directly inside the two storage folders, which must
be real directories inside the storage root (see `_owned_dir`).
"""

import logging
import os
import shutil
import stat
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterator, List

from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select

from app.core.config import BACKEND_DIR, get_settings
from app.core.errors import AppError
from app.db.database import SessionLocal
from app.db.models import AnalysisJob, AnalysisSession, ExtractedMedia, FeedbackItem, MatchingPair, Video
from app.services import analysis, extraction

logger = logging.getLogger(__name__)

PATH = "/api/data/all"
# Placeholder files kept in the storage folders of a source checkout.
KEEP_FILES = {".gitkeep"}
CODEX_TEMP_PREFIX = "framemind-codex-"
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")

# Child rows first, so foreign keys hold at every step.
TABLES = (
    ("feedback", FeedbackItem),
    ("jobs", AnalysisJob),
    ("media", ExtractedMedia),
    ("pairs", MatchingPair),
    ("sessions", AnalysisSession),
    ("videos", Video),
)

_reset_lock = threading.Lock()  # one reset at a time
_requests = threading.Condition()  # guards the two values below
_active_writes = 0
_resetting = False


@dataclass
class ResetResult:
    deleted: Dict[str, int] = field(default_factory=dict)
    files_deleted: int = 0
    bytes_freed: int = 0


# ---------- Request gate ----------


async def guard_request(request, call_next):
    """HTTP middleware: counts running write requests and refuses new ones while a reset runs."""
    global _active_writes
    counted = request.method not in SAFE_METHODS and request.url.path != PATH
    if counted:
        with _requests:
            if _resetting:
                return JSONResponse(
                    status_code=409,
                    content={"error": {"code": "data_reset_in_progress", "message": "All data is being cleared. Try again in a moment."}},
                )
            _active_writes += 1
    try:
        return await call_next(request)
    finally:
        if counted:
            with _requests:
                _active_writes -= 1
                _requests.notify_all()


def is_resetting() -> bool:
    with _requests:
        return _resetting


def _block_writes(timeout: float) -> bool:
    """Refuses new write requests, then waits for the running ones. False if they didn't end in time."""
    global _resetting
    with _requests:
        _resetting = True
        return _requests.wait_for(lambda: _active_writes == 0, timeout=timeout)


def _unblock_writes() -> None:
    global _resetting
    with _requests:
        _resetting = False


# ---------- Filesystem safety ----------


def _owned_dir(path: Path, root: Path) -> Path:
    """`path` if it is a real (non-symlink) directory directly inside the storage root; raises otherwise."""
    if path.is_symlink() or not path.is_dir():
        raise AppError(500, "data_reset_unsafe_storage", f"Storage folder {path.name!r} is missing or is a link; nothing was deleted.")
    resolved = path.resolve()
    if resolved.parent != root:
        raise AppError(500, "data_reset_unsafe_storage", f"Storage folder {path.name!r} is not inside the storage root; nothing was deleted.")
    return resolved


def _check_storage_root(root: Path) -> None:
    """The storage root must not be (or contain) the filesystem root, the home folder or the application code."""
    home = Path.home().resolve()
    code = BACKEND_DIR.resolve()
    if root == Path(root.anchor) or root == home or root in code.parents or root == code or code in root.parents:
        raise AppError(500, "data_reset_unsafe_storage", f"Refusing to clear the storage folder {root}; nothing was deleted.")


def storage_dirs() -> List[Path]:
    """storage/videos and storage/frames, verified. Raises before anything is deleted if either is unsafe."""
    settings = get_settings()
    root = settings.storage_path
    if root.is_symlink() and not root.resolve().is_dir():
        raise AppError(500, "data_reset_unsafe_storage", "The storage folder is a broken link; nothing was deleted.")
    root = root.resolve()
    _check_storage_root(root)
    return [_owned_dir(settings.videos_path, root), _owned_dir(settings.frames_path, root)]


def _entries(folder: Path) -> Iterator[os.DirEntry]:
    with os.scandir(folder) as it:
        for entry in it:
            if entry.name not in KEEP_FILES:
                yield entry


def _size(entry: os.DirEntry) -> int:
    """Bytes under an entry, without following links."""
    try:
        st = entry.stat(follow_symlinks=False)
    except OSError:
        return 0
    if not stat.S_ISDIR(st.st_mode):
        return st.st_size if stat.S_ISREG(st.st_mode) else 0
    total = 0
    for dirpath, _dirs, files in os.walk(entry.path, followlinks=False):
        for name in files:
            try:
                total += os.lstat(os.path.join(dirpath, name)).st_size
            except OSError:
                pass
    return total


def _count_files(entry: os.DirEntry) -> int:
    if not entry.is_dir(follow_symlinks=False):
        return 1
    return sum(len(files) for _d, _s, files in os.walk(entry.path, followlinks=False))


def _remove(entry: os.DirEntry) -> None:
    """Removes a file, a link (never its target) or a directory tree (links inside are unlinked, not followed)."""
    if entry.is_dir(follow_symlinks=False):
        shutil.rmtree(entry.path)
    else:
        os.unlink(entry.path)


def clear_folder(folder: Path, result: ResetResult) -> None:
    for entry in list(_entries(folder)):
        size, files = _size(entry), _count_files(entry)
        _remove(entry)
        result.bytes_freed += size
        result.files_deleted += files


def clear_codex_temp_dirs() -> None:
    """Leftover per-run Codex folders (normally removed when a run ends). Only runs once no job is running."""
    tmp = Path(tempfile.gettempdir())
    for entry in tmp.glob(f"{CODEX_TEMP_PREFIX}*"):
        if entry.is_dir() and not entry.is_symlink():
            shutil.rmtree(entry, ignore_errors=True)


# ---------- Database ----------


def _counts(db) -> Dict[str, int]:
    return {name: db.scalar(select(func.count()).select_from(model)) or 0 for name, model in TABLES}


def clear_database() -> Dict[str, int]:
    """Deletes all user rows in one transaction. `app_settings` and the schema are kept."""
    with SessionLocal() as db:
        try:
            counts = _counts(db)
            for _name, model in TABLES:
                db.execute(delete(model))
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.exception("Clear All Data: database delete failed")
            raise AppError(500, "data_reset_failed", "The database could not be cleared; no records were deleted.") from exc
    return counts


# ---------- Reset ----------


def _verify(dirs: List[Path]) -> None:
    with SessionLocal() as db:
        left = {name: n for name, n in _counts(db).items() if n}
    files_left = [entry.name for folder in dirs for entry in _entries(folder)]
    if left or files_left:
        raise AppError(
            500,
            "data_reset_incomplete",
            "Some data could not be deleted. Check the backend log and try again.",
            {"records_left": left, "files_left": files_left[:20]},
        )


def clear_all_data() -> ResetResult:
    if not _reset_lock.acquire(blocking=False):
        raise AppError(409, "data_reset_in_progress", "All data is already being cleared.")
    timeout = get_settings().data_reset_timeout_seconds
    try:
        dirs = storage_dirs()  # refuse unsafe storage before stopping anything
        if not _block_writes(timeout):
            raise AppError(409, "data_reset_busy", "An upload or frame extraction is still running. Wait for it to finish and try again.")
        if not analysis.cancel_all(timeout):
            raise AppError(409, "data_reset_busy", "A running analysis could not be stopped in time. Nothing was deleted; try again.")

        result = ResetResult(deleted=clear_database())
        errors: List[str] = []
        for folder in dirs:
            try:
                clear_folder(folder, result)
            except OSError as exc:
                logger.warning("Clear All Data: could not empty %s", folder, exc_info=True)
                errors.append(f"{folder.name}: {exc.strerror or exc}")
        clear_codex_temp_dirs()
        extraction.forget_pair_locks()
        if errors:
            raise AppError(500, "data_reset_incomplete", "Some files could not be deleted.", {"errors": errors})
        _verify(dirs)
        logger.info(
            "Clear All Data: deleted %s, %d file(s), %d bytes", result.deleted, result.files_deleted, result.bytes_freed
        )
        return result
    finally:
        analysis.resume_jobs()
        _unblock_writes()
        _reset_lock.release()
