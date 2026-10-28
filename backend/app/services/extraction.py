"""Frame extraction for matching pairs.

Single Frame -> one JPEG per video, at each video's own timestamp.
Short Clip   -> an ordered JPEG sequence per video, sampled from each video's own range (lengths may differ).

Images go to storage/frames/<session>/<pair>/<run>/. A run is written to a hidden temp folder first and
renamed when complete, so a failed or interrupted run never leaves half a sequence behind. Each pair keeps
only its latest run. A global semaphore limits concurrent FFmpeg jobs; a per-pair lock prevents two
requests from extracting the same pair at once.
"""

import logging
import threading
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, not_found
from app.db.models import AnalysisSession, ExtractedMedia, MatchingPair, new_id
from app.schemas.media import ExtractionOut, MediaOut
from app.services import storage
from app.services.video import ffmpeg

logger = logging.getLogger(__name__)

_semaphore: Optional[threading.BoundedSemaphore] = None
_pair_locks: Dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _job_slot() -> threading.BoundedSemaphore:
    global _semaphore
    with _locks_guard:
        if _semaphore is None:
            _semaphore = threading.BoundedSemaphore(max(1, get_settings().max_concurrent_extractions))
        return _semaphore


def _pair_lock(pair_id: str) -> threading.Lock:
    with _locks_guard:
        return _pair_locks.setdefault(pair_id, threading.Lock())


def media_out(media: ExtractedMedia) -> MediaOut:
    return MediaOut(
        id=media.id,
        session_id=media.session_id,
        matching_pair_id=media.matching_pair_id,
        video_id=media.video_id,
        role=media.role,  # type: ignore[arg-type]
        media_type=media.media_type,  # type: ignore[arg-type]
        frame_index=media.frame_index,
        timestamp_ms=media.timestamp_ms,
        start_ms=media.start_ms,
        end_ms=media.end_ms,
        created_at=media.created_at,
        url=f"/api/media/{media.id}/file",
    )


def _pair_media(db: Session, pair_id: str) -> List[ExtractedMedia]:
    stmt = (
        select(ExtractedMedia)
        .where(ExtractedMedia.matching_pair_id == pair_id)
        .order_by(ExtractedMedia.role, ExtractedMedia.frame_index)
    )
    return list(db.scalars(stmt).all())


def _result(pair: MatchingPair, media: List[ExtractedMedia], cached: bool = False) -> ExtractionOut:
    return ExtractionOut(
        pair_id=pair.id,
        pair_type=pair.pair_type,  # type: ignore[arg-type]
        reference=[media_out(m) for m in media if m.role == "reference"],
        current=[media_out(m) for m in media if m.role == "current"],
        cached=cached,
    )


def get_pair_extraction(db: Session, pair: MatchingPair) -> ExtractionOut:
    return _result(pair, _pair_media(db, pair.id))


def delete_media_rows(db: Session, session_id: str, pair_ids: Optional[Iterable[str]] = None) -> List[Path]:
    """Deletes media rows of a session (or of some of its pairs). Returns folders to remove after commit."""
    stmt = delete(ExtractedMedia).where(ExtractedMedia.session_id == session_id)
    if pair_ids is None:
        dirs = [storage.session_frames_dir(session_id)]
    else:
        pair_ids = list(pair_ids)
        stmt = stmt.where(ExtractedMedia.matching_pair_id.in_(pair_ids))
        dirs = [storage.pair_frames_dir(session_id, pid) for pid in pair_ids]
    db.execute(stmt)
    return dirs


def delete_dirs(dirs: Iterable[Path]) -> None:
    frames_root = get_settings().frames_path
    for path in dirs:
        storage.delete_dir(path)
        storage.remove_empty_dirs(path.parent, frames_root)


def _video_path(session: AnalysisSession, role: str) -> Path:
    from app.services.videos import video_file  # local import: videos imports nothing from here

    video = session.reference_video if role == "reference" else session.current_video
    if video is None:
        raise AppError(409, "session_videos_missing", "Attach both the reference and current video first.")
    return video_file(video)


def _run_ffmpeg(pair: MatchingPair, session: AnalysisSession, tmp_dir: Path) -> List[Tuple[str, Path, int]]:
    """Returns (role, image path, source timestamp ms) for every extracted image, in order."""
    settings = get_settings()
    images: List[Tuple[str, Path, int]] = []
    for role in ("reference", "current"):
        video = _video_path(session, role)
        if pair.pair_type == "single_frame":
            ts = pair.reference_timestamp_ms if role == "reference" else pair.current_timestamp_ms
            output = tmp_dir / f"{role}_000.jpg"
            images.append((role, output, ffmpeg.extract_frame(video, ts, output)))  # type: ignore[arg-type]
        else:
            start = pair.reference_start_ms if role == "reference" else pair.current_start_ms
            end = pair.reference_end_ms if role == "reference" else pair.current_end_ms
            frames = ffmpeg.extract_sequence(
                video, start, end, tmp_dir, role, settings.clip_sample_fps, settings.clip_max_frames  # type: ignore[arg-type]
            )
            images.extend((role, path, ms) for path, ms in frames)
    return images


def extract_pair(db: Session, session: AnalysisSession, pair: MatchingPair, force: bool = False) -> ExtractionOut:
    """Extracts (or returns the already extracted) images for one pair."""
    from app.services.pairs import validate  # local import: pairs imports this module

    settings = get_settings()
    with _pair_lock(pair.id):
        existing = _pair_media(db, pair.id)
        has_both = {m.role for m in existing} == {"reference", "current"}
        if existing and has_both and not force:
            return _result(pair, existing, cached=True)

        # The videos may have been replaced since the pair was saved.
        validate(session, pair.pair_type, pair, ignore_id=pair.id)  # type: ignore[arg-type]
        if not ffmpeg.is_ffmpeg_available():
            raise AppError(503, "ffmpeg_unavailable", "FFmpeg is not installed on the server.")

        slot = _job_slot()
        if not slot.acquire(timeout=settings.ffmpeg_timeout_seconds):
            raise AppError(503, "extraction_busy", "Too many extractions are running. Try again shortly.")

        pair_dir = storage.pair_frames_dir(session.id, pair.id)
        run_id = new_id()
        tmp_dir = pair_dir / f"{storage.TEMP_DIR_PREFIX}{run_id}"
        final_dir = pair_dir / run_id
        try:
            tmp_dir.mkdir(parents=True, exist_ok=True)
            images = _run_ffmpeg(pair, session, tmp_dir)
            tmp_dir.rename(final_dir)
        except ffmpeg.FFmpegUnavailableError as exc:
            storage.delete_dir(tmp_dir)
            raise AppError(503, "ffmpeg_unavailable", str(exc)) from exc
        except ffmpeg.FFmpegTimeoutError as exc:
            storage.delete_dir(tmp_dir)
            raise AppError(504, "extraction_timeout", str(exc)) from exc
        except ffmpeg.FFmpegError as exc:
            storage.delete_dir(tmp_dir)
            raise AppError(422, "extraction_failed", str(exc)) from exc
        except BaseException:
            storage.delete_dir(tmp_dir)
            raise
        finally:
            slot.release()

        try:
            old_dirs = {storage.resolve(m.storage_path).parent for m in existing}
            for m in existing:
                db.delete(m)
            counters = {"reference": 0, "current": 0}
            media_type = "frame" if pair.pair_type == "single_frame" else "clip_frame"
            for role, path, ms in images:
                video = session.reference_video if role == "reference" else session.current_video
                is_clip = pair.pair_type == "short_clip"
                db.add(
                    ExtractedMedia(
                        session_id=session.id,
                        matching_pair_id=pair.id,
                        video_id=video.id,  # type: ignore[union-attr]
                        role=role,
                        media_type=media_type,
                        frame_index=counters[role],
                        timestamp_ms=ms,
                        start_ms=(pair.reference_start_ms if role == "reference" else pair.current_start_ms) if is_clip else None,
                        end_ms=(pair.reference_end_ms if role == "reference" else pair.current_end_ms) if is_clip else None,
                        storage_path=storage.relative(final_dir / path.name),
                    )
                )
                counters[role] += 1
            db.commit()
        except BaseException:
            db.rollback()
            storage.delete_dir(final_dir)
            raise

        for old in old_dirs - {final_dir.resolve()}:
            storage.delete_dir(old)
        logger.info(
            "Extracted %d reference + %d current images for pair %s", counters["reference"], counters["current"], pair.id
        )
        return _result(pair, _pair_media(db, pair.id))


def get_media(db: Session, media_id: str) -> ExtractedMedia:
    media = db.get(ExtractedMedia, media_id)
    if media is None:
        raise not_found("media", media_id)
    return media


def media_file(media: ExtractedMedia) -> Path:
    """Absolute path of an extracted image; only files inside storage/frames are ever served."""
    try:
        path = storage.resolve(media.storage_path)
    except ValueError:
        path = None
    frames_root = get_settings().frames_path.resolve()
    if path is None or frames_root not in path.parents or path.suffix != ".jpg" or not path.is_file():
        raise AppError(404, "media_file_missing", "The extracted image is missing from storage.")
    return path
