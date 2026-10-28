"""Analysis sessions: which two videos are compared, the analysis mode, and their matching pairs.

Ownership and cleanup rules:
- A session owns its pairs and extracted images; deleting the session deletes them (rows and files).
- Videos are shared: a video is deleted only when no session references it any more.
- Replacing a session's video deletes the session's extracted images (they show the old video) and the
  pairs that no longer fit the new video's duration. Pairs that still fit are kept.
"""

from typing import Dict, List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import not_found
from app.db.models import AnalysisSession, ExtractedMedia, MatchingPair, utcnow
from app.schemas.pairs import PairOut
from app.schemas.sessions import SessionCreate, SessionDetail, SessionSummary, SessionUpdate
from app.services import extraction, pairs, storage, videos

_ROLES = ("reference", "current")


def _extracted_counts(db: Session, session_ids: List[str]) -> Dict[str, int]:
    if not session_ids:
        return {}
    stmt = (
        select(ExtractedMedia.session_id, func.count(func.distinct(ExtractedMedia.matching_pair_id)))
        .where(ExtractedMedia.session_id.in_(session_ids))
        .group_by(ExtractedMedia.session_id)
    )
    return {sid: count for sid, count in db.execute(stmt).all()}


def _summary_fields(session: AnalysisSession, extracted: int) -> dict:
    return dict(
        id=session.id,
        name=session.name,
        analysis_mode=session.analysis_mode,
        reference_video=videos.video_out(session.reference_video) if session.reference_video else None,
        current_video=videos.video_out(session.current_video) if session.current_video else None,
        frame_pair_count=sum(1 for p in session.pairs if p.pair_type == "single_frame"),
        clip_pair_count=sum(1 for p in session.pairs if p.pair_type == "short_clip"),
        extracted_pair_count=extracted,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


def detail(db: Session, session: AnalysisSession, pruned: Optional[List[str]] = None) -> SessionDetail:
    extracted = _extracted_counts(db, [session.id]).get(session.id, 0)
    return SessionDetail(
        **_summary_fields(session, extracted),
        pairs=[PairOut.model_validate(p) for p in pairs.sort_pairs(session.pairs)],
        pruned_pair_ids=pruned or [],
    )


def list_sessions(db: Session) -> List[SessionSummary]:
    sessions = db.scalars(select(AnalysisSession).order_by(AnalysisSession.updated_at.desc())).all()
    counts = _extracted_counts(db, [s.id for s in sessions])
    return [SessionSummary(**_summary_fields(s, counts.get(s.id, 0))) for s in sessions]


def get_session(db: Session, session_id: str) -> AnalysisSession:
    session = db.get(AnalysisSession, session_id)
    if session is None:
        raise not_found("session", session_id)
    return session


def create_session(db: Session, data: SessionCreate) -> AnalysisSession:
    for video_id in (data.reference_video_id, data.current_video_id):
        if video_id:
            videos.get_video(db, video_id)
    session = AnalysisSession(
        name=(data.name or "").strip() or None,
        reference_video_id=data.reference_video_id,
        current_video_id=data.current_video_id,
        analysis_mode=data.analysis_mode,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def update_session(db: Session, session: AnalysisSession, data: SessionUpdate) -> Tuple[AnalysisSession, List[str]]:
    """Applies the sent fields. Returns the session and the ids of pairs pruned by a video replacement."""
    sent = data.model_fields_set
    if "name" in sent:
        session.name = (data.name or "").strip() or None
    if "analysis_mode" in sent and data.analysis_mode is not None:
        session.analysis_mode = data.analysis_mode

    replaced: List[Tuple[str, Optional[str]]] = []  # (role, old video id)
    for role in _ROLES:
        field = f"{role}_video_id"
        if field not in sent:
            continue
        new_id = getattr(data, field)
        old_id = getattr(session, field)
        if new_id == old_id:
            continue
        if new_id:
            videos.get_video(db, new_id)
        setattr(session, field, new_id)
        replaced.append((role, old_id))

    pruned: List[str] = []
    stale_dirs = []
    stale_files: List[str] = []
    if replaced:
        db.flush()
        db.refresh(session)
        stale_dirs = extraction.delete_media_rows(db, session.id)
        for role, _ in replaced:
            video = session.reference_video if role == "reference" else session.current_video
            if video is None:
                continue  # detached: keep the pairs; they are re-checked when a new video is attached
            for pair in list(session.pairs):
                if pair.id not in pruned and pairs.end_ms(pair, role) > video.duration_ms:
                    pruned.append(pair.id)
                    session.pairs.remove(pair)
        db.flush()
        for _, old_id in replaced:
            path = videos.delete_if_unreferenced(db, old_id)
            if path:
                stale_files.append(path)

    session.updated_at = utcnow()
    db.commit()
    extraction.delete_dirs(stale_dirs)
    for path in stale_files:
        storage.delete_file(path)
    db.refresh(session)
    return session, pruned


def delete_session(db: Session, session: AnalysisSession) -> None:
    video_ids = [session.reference_video_id, session.current_video_id]
    stale_dirs = extraction.delete_media_rows(db, session.id)
    db.delete(session)
    db.flush()
    stale_files = [path for path in (videos.delete_if_unreferenced(db, vid) for vid in set(video_ids)) if path]
    db.commit()
    extraction.delete_dirs(stale_dirs)
    for path in stale_files:
        storage.delete_file(path)


def pair_session(db: Session, session_id: str, pair_id: str) -> Tuple[AnalysisSession, MatchingPair]:
    session = get_session(db, session_id)
    return session, pairs.get_pair(db, session_id, pair_id)
