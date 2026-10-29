"""Settings → Data Management: Clear All Data."""

from fastapi import APIRouter, Depends, Query

from app.core.errors import AppError, require_local_request
from app.schemas.data import DataResetOut, DeletedCounts
from app.services import data_reset

router = APIRouter(prefix="/data", tags=["data"])

CONFIRMATION = "DELETE"


@router.delete(
    "/all",
    response_model=DataResetOut,
    summary="Clear All Data",
    description=(
        "Permanently deletes every session, matching pair, analysis job, AI feedback item, uploaded video and "
        "extracted frame, then checks that none is left. Running analyses are cancelled first and new writes are "
        "refused meanwhile (409 `data_reset_in_progress`). Keeps the database schema, the selected AI model, the "
        "pairing code and the Codex CLI sign-in. Only accepted from this computer, with `confirm=DELETE`."
    ),
    dependencies=[Depends(require_local_request)],
)
def clear_all_data(confirm: str = Query("", description="Must be exactly DELETE")) -> DataResetOut:
    if confirm != CONFIRMATION:
        raise AppError(400, "confirmation_required", "Send confirm=DELETE to clear all data.")
    result = data_reset.clear_all_data()
    return DataResetOut(
        deleted=DeletedCounts(**result.deleted),
        files_deleted=result.files_deleted,
        bytes_freed=result.bytes_freed,
        verified=True,
    )
