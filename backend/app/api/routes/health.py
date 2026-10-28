from fastapi import APIRouter

from app.core.config import get_settings
from app.db.database import check_db
from app.schemas.health import HealthResponse
from app.services.storage import is_storage_ready
from app.services.video.ffmpeg import is_ffmpeg_available

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(
        status="ok",
        app_name=settings.app_name,
        version=settings.app_version,
        environment=settings.environment,
        database=check_db(),
        storage=is_storage_ready(),
        ffmpeg=is_ffmpeg_available(),
        openai_configured=bool(settings.openai_api_key),
    )
