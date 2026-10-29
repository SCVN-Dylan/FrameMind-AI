"""One error shape for the whole API: {"error": {"code": ..., "message": ..., "details": ...}}."""

from typing import Any, Optional

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    """Raised by services. `code` is a stable machine-readable id the frontend can switch on."""

    def __init__(self, status_code: int, code: str, message: str, details: Optional[Any] = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def not_found(what: str, id_: str) -> AppError:
    return AppError(404, f"{what}_not_found", f"{what.replace('_', ' ').capitalize()} {id_} does not exist.")


def _body(code: str, message: str, details: Optional[Any] = None) -> dict:
    error: dict = {"code": code, "message": message}
    if details is not None:
        error["details"] = jsonable_encoder(details)
    return {"error": error}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=_body(exc.code, exc.message, exc.details))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        message = errors[0]["msg"] if errors else "Invalid request."
        return JSONResponse(status_code=422, content=_body("validation_error", message, errors))

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=_body("http_error", str(exc.detail)))


_LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}


def require_local_request(request: Request) -> None:
    """FastAPI dependency for endpoints that act on the local machine (Codex sign-in, logout, settings).

    Only requests from this computer are accepted, and a browser request must come from the configured
    frontend origin. This stops other sites open in the browser from triggering them.
    """
    from app.core.config import get_settings

    host = request.client.host if request.client else ""
    if host not in _LOCAL_HOSTS:
        raise AppError(403, "local_only", "This action is only available from this computer.")
    origin = request.headers.get("origin")
    if origin is not None and origin != get_settings().frontend_origin:
        raise AppError(403, "origin_not_allowed", "Requests from this origin are not allowed.")
