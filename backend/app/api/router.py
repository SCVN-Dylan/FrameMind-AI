"""Collects every route module under the /api prefix."""

from fastapi import APIRouter

from app.api.routes import health, media, sessions, videos

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(videos.router)
api_router.include_router(sessions.router)
api_router.include_router(media.router)
