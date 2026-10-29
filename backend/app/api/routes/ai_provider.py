"""Codex CLI provider: status, ChatGPT sign-in, logout and model selection (Settings → AI provider).

Actions that change the local machine (login, logout, model) only accept requests from this computer and from the
FrameMind frontend origin. No endpoint returns or logs credentials.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, require_local_request
from app.db.database import get_db
from app.schemas.analysis import LoginFlowOut, ModelOut, ModelSelect, ModelsOut, ProviderCapabilities, ProviderStatusOut
from app.services import analysis
from app.services.ai.codex_account import LoginFlow, codex_account
from app.services.ai.codex_cli import PROVIDER, CodexError, codex_cli

router = APIRouter(prefix="/ai/provider", tags=["ai provider"])


def _login_out(flow: LoginFlow) -> LoginFlowOut:
    return LoginFlowOut(
        state=flow.state,  # type: ignore[arg-type]
        login_url=flow.login_url,
        started_at=flow.started_at,
        finished_at=flow.finished_at,
        error=flow.error,
    )


def _status(refresh: bool) -> ProviderStatusOut:
    settings = get_settings()
    login = _login_out(codex_account.login_state())
    if settings.ai_provider != PROVIDER:
        return ProviderStatusOut(
            provider=settings.ai_provider,
            installed=False,
            version=None,
            version_supported=False,
            authenticated=None,
            auth_mode=None,
            capabilities=ProviderCapabilities(non_interactive=False, image_input=False, output_schema=False, restricted_permissions=False),
            available=False,
            model=None,
            last_error=f"AI provider {settings.ai_provider!r} is not supported.",
            login=login,
        )
    probe = codex_cli.probe(force=refresh)
    return ProviderStatusOut(
        provider=PROVIDER,
        installed=probe.installed,
        version=probe.version,
        version_supported=probe.version_supported,
        authenticated=probe.authenticated,
        auth_mode=probe.auth_mode,
        capabilities=ProviderCapabilities(**probe.capabilities),
        available=probe.available,
        model=codex_account.selected_model(),
        last_error=probe.error or codex_cli.last_error,
        login=login,
    )


def _no_active_analysis(db: Session) -> None:
    if analysis.has_active_job(db):
        raise AppError(409, "analysis_in_progress", "Wait for the running analysis to finish first.")


@router.get(
    "/status",
    response_model=ProviderStatusOut,
    summary="AI provider status",
    description="Codex CLI install, version, sign-in mode, verified options, selected model and login flow. No credentials.",
)
def provider_status(refresh: bool = Query(False, description="Re-check instead of using the 60 s cache")) -> ProviderStatusOut:
    return _status(refresh)


@router.post(
    "/login",
    response_model=LoginFlowOut,
    status_code=202,
    summary="Start ChatGPT sign-in",
    description=(
        "Runs the official `codex login` flow on this computer: Codex opens OpenAI's sign-in page in the browser "
        "(`login_url` is returned too, in case it didn't open). Poll `GET /login` until `succeeded` or `failed`. "
        "Refused while signed in (log out first to switch accounts) or while an analysis runs."
    ),
    dependencies=[Depends(require_local_request)],
)
def start_login(db: Session = Depends(get_db)) -> LoginFlowOut:
    _no_active_analysis(db)
    try:
        return _login_out(codex_account.start_login())
    except CodexError as exc:
        raise analysis.codex_app_error(exc) from exc


@router.get("/login", response_model=LoginFlowOut, summary="Sign-in flow state")
def login_state() -> LoginFlowOut:
    return _login_out(codex_account.login_state())


@router.delete(
    "/login", response_model=LoginFlowOut, summary="Cancel the sign-in flow", dependencies=[Depends(require_local_request)]
)
def cancel_login() -> LoginFlowOut:
    return _login_out(codex_account.cancel_login())


@router.post(
    "/logout",
    response_model=ProviderStatusOut,
    summary="Log out of Codex CLI",
    description="Runs `codex logout`, then confirms with `codex login status`. Refused while an analysis runs.",
    dependencies=[Depends(require_local_request)],
)
def logout(db: Session = Depends(get_db)) -> ProviderStatusOut:
    _no_active_analysis(db)
    try:
        codex_account.logout()
    except CodexError as exc:
        raise AppError(502 if exc.code == "codex_logout_failed" else 503, exc.code, exc.message) from exc
    return _status(refresh=False)


@router.get(
    "/models",
    response_model=ModelsOut,
    summary="Models available to the signed-in Codex account",
    description="From `codex debug models` (falls back to the CLI's bundled catalog). Hidden models are not listed.",
)
def list_models(refresh: bool = Query(False)) -> ModelsOut:
    selected = codex_account.selected_model()
    try:
        catalog = codex_account.catalog(refresh=refresh)
    except CodexError as exc:
        return ModelsOut(source="unavailable", models=[], selected=selected, selected_unavailable=bool(selected), error=exc.message)
    models = [ModelOut(**{k: m[k] for k in ("slug", "display_name", "description", "supports_images")}) for m in catalog["models"]]
    unavailable = bool(selected) and not any(m.slug == selected and m.supports_images for m in models)
    return ModelsOut(source=catalog["source"], models=models, selected=selected, selected_unavailable=unavailable, error=None)


@router.put(
    "/model",
    response_model=ModelsOut,
    summary="Choose the analysis model",
    description="Saved in the local database and used by future Analyze jobs. `null` = Codex CLI default model.",
    dependencies=[Depends(require_local_request)],
)
def select_model(data: ModelSelect) -> ModelsOut:
    try:
        codex_account.set_model(data.model)
    except CodexError as exc:
        raise analysis.codex_app_error(exc) from exc
    return list_models(refresh=False)
