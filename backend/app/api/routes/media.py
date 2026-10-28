from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.media import MediaOut
from app.services import extraction

router = APIRouter(prefix="/media", tags=["media"])


@router.get("/{media_id}", response_model=MediaOut, summary="Extracted image metadata")
def get_media(media_id: str, db: Session = Depends(get_db)) -> MediaOut:
    return extraction.media_out(extraction.get_media(db, media_id))


@router.get("/{media_id}/file", summary="Extracted image (JPEG)", response_class=FileResponse)
def get_media_file(media_id: str, db: Session = Depends(get_db)) -> FileResponse:
    path = extraction.media_file(extraction.get_media(db, media_id))
    return FileResponse(
        path,
        media_type="image/jpeg",
        # Images are immutable: re-extraction creates new media ids.
        headers={"Cache-Control": "private, max-age=86400, immutable", "X-Content-Type-Options": "nosniff"},
    )
