"""Video uploads: streamed to disk, validated (extension, file signature, FFprobe, first-frame decode), stored.

Files are saved as storage/videos/<uuid>.<ext>. The original filename is kept only as metadata.
While uploading, data goes to <uuid>.part; any failure deletes it, so no half-written files remain.
"""

import logging
import unicodedata
from pathlib import Path, PurePath
from typing import AsyncIterator, Optional

from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings
from app.core.errors import AppError, not_found
from app.db.models import AnalysisSession, Video, new_id
from app.schemas.videos import VideoOut
from app.services import storage
from app.services.video import ffmpeg

logger = logging.getLogger(__name__)

# extension -> (container family, served MIME type)
VIDEO_TYPES = {
    "mp4": ("mp4", "video/mp4"),
    "m4v": ("mp4", "video/mp4"),
    "mov": ("mp4", "video/quicktime"),
    "webm": ("webm", "video/webm"),
    "ogg": ("ogg", "video/ogg"),
    "ogv": ("ogg", "video/ogg"),
}

# ISO-BMFF / QuickTime files start with a box whose type is at bytes 4–8.
_MP4_BOXES = {b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip", b"pnot"}
# Substrings FFprobe reports in format_name for each family.
_FFPROBE_FORMATS = {"mp4": ("mp4", "mov"), "webm": ("webm", "matroska"), "ogg": ("ogg",)}


def clean_filename(filename: str) -> str:
    """Display-safe original name: no directories, no control characters, at most 255 characters."""
    name = PurePath(filename.replace("\\", "/")).name
    name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C").strip()
    return name[:255]


def extension_of(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def _signature_family(head: bytes) -> Optional[str]:
    if len(head) >= 8 and head[4:8] in _MP4_BOXES:
        return "mp4"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "webm"
    if head.startswith(b"OggS"):
        return "ogg"
    return None


def video_out(video: Video) -> VideoOut:
    return VideoOut(
        id=video.id,
        original_filename=video.original_filename,
        file_size=video.file_size,
        duration_ms=video.duration_ms,
        width=video.width,
        height=video.height,
        fps=video.fps,
        codec=video.codec,
        container=video.container,
        created_at=video.created_at,
        url=f"/api/videos/{video.id}/file",
    )


async def save_upload(
    db: Session, filename: str, chunks: AsyncIterator[bytes], content_length: Optional[int]
) -> Video:
    settings = get_settings()
    original = clean_filename(filename)
    ext = extension_of(original)
    if not original or ext not in VIDEO_TYPES:
        raise AppError(415, "unsupported_format", "Only MP4, MOV, WebM and OGG videos are supported.")
    family = VIDEO_TYPES[ext][0]
    if content_length is not None and content_length > settings.max_upload_bytes:
        raise AppError(413, "file_too_large", f"The video is larger than {settings.max_upload_bytes // (1024 * 1024)} MB.")
    if not ffmpeg.is_ffmpeg_available():
        raise AppError(503, "ffmpeg_unavailable", "FFmpeg/FFprobe is not installed on the server.")

    video_id = new_id()
    part = settings.videos_path / f"{video_id}{storage.PARTIAL_UPLOAD_SUFFIX}"
    final = settings.videos_path / f"{video_id}.{ext}"
    size = 0
    head = b""
    try:
        with part.open("wb") as out:
            async for chunk in chunks:
                if not chunk:
                    continue
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise AppError(
                        413, "file_too_large", f"The video is larger than {settings.max_upload_bytes // (1024 * 1024)} MB."
                    )
                if len(head) < 16:
                    head += chunk[: 16 - len(head)]
                    if len(head) >= 16 and _signature_family(head) != family:
                        raise AppError(415, "invalid_content", f"The file content is not a valid .{ext} video.")
                out.write(chunk)

        if size == 0:
            raise AppError(400, "empty_file", "The uploaded file is empty.")
        if _signature_family(head) != family:
            raise AppError(415, "invalid_content", f"The file content is not a valid .{ext} video.")
        part.rename(final)

        try:
            info = await run_in_threadpool(ffmpeg.probe, final)
            await run_in_threadpool(ffmpeg.verify_decodable, final)
        except ffmpeg.FFmpegUnavailableError as exc:
            raise AppError(503, "ffmpeg_unavailable", str(exc)) from exc
        except ffmpeg.FFmpegError as exc:
            raise AppError(422, "corrupt_video", f"The video is damaged or uses an unsupported codec. {exc}") from exc
        if not any(name in info.container for name in _FFPROBE_FORMATS[family]):
            raise AppError(415, "invalid_content", f"The file content does not match its .{ext} extension.")

        video = Video(
            id=video_id,
            original_filename=original,
            storage_path=storage.relative(final),
            file_size=size,
            duration_ms=info.duration_ms,
            width=info.width,
            height=info.height,
            fps=info.fps,
            codec=info.codec,
            container=info.container,
        )
        db.add(video)
        db.commit()
        db.refresh(video)
    except BaseException:
        # Includes client disconnects and cancellations: never leave partial or unregistered files behind.
        part.unlink(missing_ok=True)
        final.unlink(missing_ok=True)
        db.rollback()
        raise

    logger.info("Stored video %s (%s, %d bytes, %d ms)", video.id, video.codec, size, video.duration_ms)
    return video


def get_video(db: Session, video_id: str) -> Video:
    video = db.get(Video, video_id)
    if video is None:
        raise not_found("video", video_id)
    return video


def video_file(video: Video) -> Path:
    """Absolute path of a stored video. Raises 404 if the file is gone or the stored path is unsafe."""
    try:
        path = storage.resolve(video.storage_path)
    except ValueError:
        path = None
    if path is None or not path.is_file() or get_settings().videos_path.resolve() not in path.parents:
        raise AppError(404, "video_file_missing", "The video file is missing from storage.")
    return path


def media_type(video: Video) -> str:
    return VIDEO_TYPES.get(extension_of(video.storage_path), ("", "application/octet-stream"))[1]


def is_referenced(db: Session, video_id: str) -> bool:
    stmt = select(AnalysisSession.id).where(
        or_(AnalysisSession.reference_video_id == video_id, AnalysisSession.current_video_id == video_id)
    )
    return db.execute(stmt.limit(1)).first() is not None


def delete_if_unreferenced(db: Session, video_id: Optional[str]) -> Optional[str]:
    """Deletes a video row when no session uses it any more. Call after the referencing change is flushed.

    Returns the file's relative path; the caller removes it with storage.delete_file() after committing,
    so a failed commit never leaves a row without its file.
    """
    if not video_id or is_referenced(db, video_id):
        return None
    video = db.get(Video, video_id)
    if video is None:
        return None
    path = video.storage_path
    db.delete(video)
    db.flush()
    logger.info("Deleting unreferenced video %s", video_id)
    return path
