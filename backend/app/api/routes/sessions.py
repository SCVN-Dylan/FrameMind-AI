from typing import List

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.media import ExtractionOut
from app.schemas.pairs import PairCreate, PairOut, PairUpdate
from app.schemas.sessions import SessionCreate, SessionDetail, SessionSummary, SessionUpdate
from app.services import extraction, pairs, sessions

router = APIRouter(prefix="/sessions", tags=["sessions"])


# ---------- Sessions ----------


@router.get("", response_model=List[SessionSummary], summary="List sessions (newest change first)")
def list_sessions(db: Session = Depends(get_db)) -> List[SessionSummary]:
    return sessions.list_sessions(db)


@router.post("", response_model=SessionDetail, status_code=201, summary="Create a session")
def create_session(data: SessionCreate, db: Session = Depends(get_db)) -> SessionDetail:
    return sessions.detail(db, sessions.create_session(db, data))


@router.get("/{session_id}", response_model=SessionDetail, summary="Session with videos and pairs")
def get_session(session_id: str, db: Session = Depends(get_db)) -> SessionDetail:
    return sessions.detail(db, sessions.get_session(db, session_id))


@router.patch(
    "/{session_id}",
    response_model=SessionDetail,
    summary="Update a session",
    description=(
        "Only sent fields change. Replacing a video deletes the session's extracted images and the pairs that "
        "no longer fit the new video (listed in `pruned_pair_ids`). The old video is deleted if no other "
        "session uses it."
    ),
)
def update_session(session_id: str, data: SessionUpdate, db: Session = Depends(get_db)) -> SessionDetail:
    session, pruned = sessions.update_session(db, sessions.get_session(db, session_id), data)
    return sessions.detail(db, session, pruned)


@router.delete(
    "/{session_id}",
    status_code=204,
    summary="Delete a session",
    description="Deletes its pairs and extracted images. Videos are deleted only if no other session uses them.",
)
def delete_session(session_id: str, db: Session = Depends(get_db)) -> Response:
    sessions.delete_session(db, sessions.get_session(db, session_id))
    return Response(status_code=204)


# ---------- Matching pairs ----------


@router.get("/{session_id}/pairs", response_model=List[PairOut], summary="List matching pairs")
def list_pairs(session_id: str, db: Session = Depends(get_db)) -> List[PairOut]:
    sessions.get_session(db, session_id)
    return [PairOut.model_validate(p) for p in pairs.list_pairs(db, session_id)]


@router.post(
    "/{session_id}/pairs",
    response_model=PairOut,
    status_code=201,
    summary="Create a matching pair",
    description=(
        "Single Frame: `reference_timestamp_ms` + `current_timestamp_ms` (they may differ). Short Clip: "
        "`reference_start_ms`/`reference_end_ms` + `current_start_ms`/`current_end_ms` (each 0.1–10 s; lengths "
        "may differ). Send your own `id` to make retries safe: the same id and content returns 200."
    ),
)
def create_pair(session_id: str, data: PairCreate, response: Response, db: Session = Depends(get_db)) -> PairOut:
    pair, created = pairs.create_pair(db, sessions.get_session(db, session_id), data)
    if not created:
        response.status_code = 200
    return PairOut.model_validate(pair)


@router.patch(
    "/{session_id}/pairs/{pair_id}",
    response_model=PairOut,
    summary="Update a matching pair",
    description="Send all times of the pair's type plus the description. Changed times discard its extracted images.",
)
def update_pair(session_id: str, pair_id: str, data: PairUpdate, db: Session = Depends(get_db)) -> PairOut:
    session, pair = sessions.pair_session(db, session_id, pair_id)
    return PairOut.model_validate(pairs.update_pair(db, session, pair, data))


@router.delete("/{session_id}/pairs/{pair_id}", status_code=204, summary="Delete a matching pair")
def delete_pair(session_id: str, pair_id: str, db: Session = Depends(get_db)) -> Response:
    session, pair = sessions.pair_session(db, session_id, pair_id)
    pairs.delete_pair(db, session, pair)
    return Response(status_code=204)


# ---------- Extraction ----------


@router.post(
    "/{session_id}/pairs/{pair_id}/extract",
    response_model=ExtractionOut,
    summary="Extract frames for a pair",
    description=(
        "Single Frame: one image per video at its own timestamp. Short Clip: an ordered sequence per video "
        "from its own range, sampled at CLIP_SAMPLE_FPS and capped at CLIP_MAX_FRAMES. Existing images are "
        "returned (`cached: true`) unless `force=true`."
    ),
)
def extract_pair(
    session_id: str,
    pair_id: str,
    force: bool = Query(False, description="Re-extract even if images already exist"),
    db: Session = Depends(get_db),
) -> ExtractionOut:
    session, pair = sessions.pair_session(db, session_id, pair_id)
    return extraction.extract_pair(db, session, pair, force=force)


@router.get("/{session_id}/pairs/{pair_id}/media", response_model=ExtractionOut, summary="Extracted images of a pair")
def get_pair_media(session_id: str, pair_id: str, db: Session = Depends(get_db)) -> ExtractionOut:
    _, pair = sessions.pair_session(db, session_id, pair_id)
    return extraction.get_pair_extraction(db, pair)
