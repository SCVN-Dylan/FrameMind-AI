from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.videos import VideoOut
from app.services import videos

router = APIRouter(prefix="/videos", tags=["videos"])


@router.post(
    "",
    response_model=VideoOut,
    status_code=201,
    summary="Upload a video",
    description=(
        "Send the raw file bytes as the request body (Content-Type: application/octet-stream) and the original "
        "name in `filename`. The body is streamed to disk, never held in memory. MP4, MOV, WebM and OGG up to "
        "1 GB; content is checked by file signature and FFprobe. Attach the returned id to a session as its "
        "reference or current video."
    ),
    openapi_extra={
        "requestBody": {"required": True, "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}}
    },
)
async def upload_video(
    request: Request,
    filename: str = Query(..., min_length=1, max_length=255, description="Original file name, e.g. gameplay.mp4"),
    db: Session = Depends(get_db),
) -> VideoOut:
    length = request.headers.get("content-length")
    content_length = int(length) if length and length.isdigit() else None
    video = await videos.save_upload(db, filename, request.stream(), content_length)
    return videos.video_out(video)


@router.get("/{video_id}", response_model=VideoOut, summary="Video metadata")
def get_video(video_id: str, db: Session = Depends(get_db)) -> VideoOut:
    return videos.video_out(videos.get_video(db, video_id))


@router.get(
    "/{video_id}/file",
    summary="Stream a video",
    description="Serves the stored file with HTTP range support so the browser can seek.",
    response_class=FileResponse,
)
def get_video_file(video_id: str, db: Session = Depends(get_db)) -> FileResponse:
    video = videos.get_video(db, video_id)
    return FileResponse(
        videos.video_file(video),
        media_type=videos.media_type(video),
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )
