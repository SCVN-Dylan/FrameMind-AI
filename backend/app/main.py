"""FastAPI entry point. Run with: uvicorn app.main:app --reload"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.db.database import init_db
from app.services import analysis, standalone
from app.services.storage import cleanup_interrupted_work, ensure_storage_dirs

settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_storage_dirs()
    cleanup_interrupted_work()
    init_db()
    analysis.recover_interrupted_jobs()
    if settings.standalone_frontend_enabled:
        code = standalone.pairing_code()
        if settings.standalone_log_pairing_code:
            logging.getLogger("app.standalone").info("Standalone page pairing code: %s (also in %s)", code, standalone.code_path())
    yield
    analysis.shutdown()


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

@app.middleware("http")
async def require_pairing_for_file_pages(request: Request, call_next):
    """`Origin: null` (file:// pages, but also sandboxed iframes on any site) needs the standalone pairing code."""
    if request.headers.get("origin") == "null" and request.method != "OPTIONS":
        allowed = settings.standalone_frontend_enabled and (
            request.url.path in standalone.OPEN_PATHS or standalone.is_valid(request.headers.get(standalone.HEADER, ""))
        )
        if not allowed:
            return JSONResponse(
                status_code=403,
                content={"error": {"code": "pairing_required", "message": "Enter the pairing code shown by the backend."}},
            )
    return await call_next(request)


# Added last so it is the outermost layer: CORS headers are present on every response, including the 403 above.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin] + (["null"] if settings.standalone_frontend_enabled else []),
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", standalone.HEADER],
)

register_error_handlers(app)

app.include_router(api_router)
