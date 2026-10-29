"""FastAPI entry point. Run with: uvicorn app.main:app --reload"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.db.database import init_db
from app.services import analysis
from app.services.storage import cleanup_interrupted_work, ensure_storage_dirs

settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_storage_dirs()
    cleanup_interrupted_work()
    init_db()
    analysis.recover_interrupted_jobs()
    yield
    analysis.shutdown()


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)

register_error_handlers(app)

app.include_router(api_router)
