"""Matching pairs: the same gameplay event marked in both videos.

Validation mirrors the frontend rules in frontend/src/lib/analysis.ts:
- every timestamp lies within its own video's duration (the two videos' timestamps may differ),
- clip ranges: start < end, each 100 ms – 10 s long (reference and current lengths may differ),
- two pairs of the same type are duplicates when every timestamp is closer than 50 ms.
Invalid pairs raise AppError(422, "invalid_pair") with details.reason set to the frontend's error name.
"""

from typing import List, Optional, Sequence, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError, not_found
from app.db.models import AnalysisSession, MatchingPair, utcnow
from app.schemas.pairs import PairCreate, PairTimes, PairUpdate, check_update_fields
from app.services import extraction

CLIP_MIN_MS = 100
CLIP_MAX_MS = 10_000
DUPLICATE_TOLERANCE_MS = 50

_FRAME_FIELDS = ("reference_timestamp_ms", "current_timestamp_ms")
_CLIP_FIELDS = ("reference_start_ms", "reference_end_ms", "current_start_ms", "current_end_ms")
_ALL_FIELDS = _FRAME_FIELDS + _CLIP_FIELDS


def _invalid(reason: str, message: str) -> AppError:
    return AppError(422, "invalid_pair", message, {"reason": reason})


def timestamps(pair_type: str, times: PairTimes) -> Tuple[int, ...]:
    fields = _FRAME_FIELDS if pair_type == "single_frame" else _CLIP_FIELDS
    return tuple(getattr(times, name) for name in fields)


def _check_span(side: str, start: int, end: int, duration: int) -> None:
    if start < 0 or start > duration or end > duration:
        raise _invalid(f"{side}OutOfRange", f"The {side} clip must lie within 0–{duration} ms.")
    if end <= start:
        raise _invalid(f"{side}Order", f"The {side} clip must end after it starts.")
    if end - start < CLIP_MIN_MS:
        raise _invalid(f"{side}TooShort", f"The {side} clip must be at least {CLIP_MIN_MS} ms long.")
    if end - start > CLIP_MAX_MS:
        raise _invalid(f"{side}TooLong", f"The {side} clip can be at most {CLIP_MAX_MS} ms long.")


def end_ms(pair: MatchingPair, side: str) -> int:
    """Latest timestamp the pair uses in one video."""
    if pair.pair_type == "single_frame":
        return pair.reference_timestamp_ms if side == "reference" else pair.current_timestamp_ms  # type: ignore[return-value]
    return pair.reference_end_ms if side == "reference" else pair.current_end_ms  # type: ignore[return-value]


def validate(session: AnalysisSession, pair_type: str, times: PairTimes, ignore_id: Optional[str] = None) -> None:
    if session.reference_video is None or session.current_video is None:
        raise AppError(409, "session_videos_missing", "Attach both the reference and current video before adding pairs.")
    ref_ms, cur_ms = session.reference_video.duration_ms, session.current_video.duration_ms

    if pair_type == "single_frame":
        if not 0 <= times.reference_timestamp_ms <= ref_ms:  # type: ignore[operator]
            raise _invalid("referenceOutOfRange", f"The reference timestamp must be within 0–{ref_ms} ms.")
        if not 0 <= times.current_timestamp_ms <= cur_ms:  # type: ignore[operator]
            raise _invalid("currentOutOfRange", f"The current timestamp must be within 0–{cur_ms} ms.")
    else:
        _check_span("reference", times.reference_start_ms, times.reference_end_ms, ref_ms)  # type: ignore[arg-type]
        _check_span("current", times.current_start_ms, times.current_end_ms, cur_ms)  # type: ignore[arg-type]

    mine = timestamps(pair_type, times)
    for other in session.pairs:
        if other.id == ignore_id or other.pair_type != pair_type:
            continue
        theirs = timestamps(pair_type, other)  # type: ignore[arg-type]
        if all(abs(a - b) < DUPLICATE_TOLERANCE_MS for a, b in zip(mine, theirs)):
            raise _invalid("duplicate", "This pair already exists.")


def _clean(description: Optional[str]) -> Optional[str]:
    return (description or "").strip() or None


def list_pairs(db: Session, session_id: str) -> List[MatchingPair]:
    pairs = db.scalars(select(MatchingPair).where(MatchingPair.session_id == session_id)).all()
    return sort_pairs(pairs)


def sort_pairs(pairs: Sequence[MatchingPair]) -> List[MatchingPair]:
    def key(p: MatchingPair) -> Tuple[int, str]:
        start = p.reference_timestamp_ms if p.pair_type == "single_frame" else p.reference_start_ms
        return (start or 0, p.created_at.isoformat() if p.created_at else "")

    return sorted(pairs, key=key)


def get_pair(db: Session, session_id: str, pair_id: str) -> MatchingPair:
    pair = db.get(MatchingPair, pair_id)
    if pair is None or pair.session_id != session_id:
        raise not_found("pair", pair_id)
    return pair


def create_pair(db: Session, session: AnalysisSession, data: PairCreate) -> Tuple[MatchingPair, bool]:
    """Returns (pair, created). Re-sending the same id with the same content returns the existing pair."""
    if data.id:
        existing = db.get(MatchingPair, data.id)
        if existing is not None:
            same = (
                existing.session_id == session.id
                and existing.pair_type == data.pair_type
                and timestamps(data.pair_type, existing) == timestamps(data.pair_type, data)  # type: ignore[arg-type]
                and existing.event_description == _clean(data.event_description)
            )
            if same:
                return existing, False
            raise AppError(409, "pair_id_conflict", "A different pair with this id already exists.")

    validate(session, data.pair_type, data)
    pair = MatchingPair(
        session_id=session.id,
        pair_type=data.pair_type,
        event_description=_clean(data.event_description),
        **{name: getattr(data, name) for name in _ALL_FIELDS},
    )
    if data.id:
        pair.id = data.id.lower()
    db.add(pair)
    session.updated_at = utcnow()  # sessions are listed by last change
    db.commit()
    db.refresh(pair)
    return pair, True


def update_pair(db: Session, session: AnalysisSession, pair: MatchingPair, data: PairUpdate) -> MatchingPair:
    try:
        check_update_fields(pair.pair_type, data)
    except ValueError as exc:
        raise AppError(422, "validation_error", str(exc)) from exc
    validate(session, pair.pair_type, data, ignore_id=pair.id)

    stale_dirs = []
    if timestamps(pair.pair_type, data) != timestamps(pair.pair_type, pair):  # type: ignore[arg-type]
        # Extracted frames no longer match the new times.
        stale_dirs = extraction.delete_media_rows(db, session.id, pair_ids=[pair.id])
    for name in _FRAME_FIELDS if pair.pair_type == "single_frame" else _CLIP_FIELDS:
        setattr(pair, name, getattr(data, name))
    pair.event_description = _clean(data.event_description)
    session.updated_at = utcnow()
    db.commit()
    extraction.delete_dirs(stale_dirs)
    db.refresh(pair)
    return pair


def delete_pair(db: Session, session: AnalysisSession, pair: MatchingPair) -> None:
    stale_dirs = extraction.delete_media_rows(db, session.id, pair_ids=[pair.id])
    db.delete(pair)
    session.updated_at = utcnow()
    db.commit()
    extraction.delete_dirs(stale_dirs)
