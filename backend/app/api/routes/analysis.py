from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.database import get_db
from app.schemas.analysis import AnalysisResultsOut, AnalysisRunRequest, JobOut
from app.services import analysis, sessions

router = APIRouter(tags=["analysis"])


@router.post(
    "/analysis/{session_id}/run",
    response_model=JobOut,
    status_code=202,
    summary="Start an AI analysis",
    description=(
        "Analyses the given Single Frame or Short Clip pairs with the local Codex CLI in the background "
        "(one Codex run per pair). Returns the `pending` job; poll `/status`. Only one job per session can be "
        "active (409 `analysis_in_progress`, with `details.job_id`). Full Video is not supported yet."
    ),
)
def run_analysis(session_id: str, data: AnalysisRunRequest, db: Session = Depends(get_db)) -> JobOut:
    job = analysis.start_job(db, sessions.get_session(db, session_id), data)
    return analysis.job_out(job)


@router.get(
    "/analysis/{session_id}/status",
    response_model=Optional[JobOut],
    summary="Latest analysis job of a session",
    description="`null` when the session has never been analysed.",
)
def analysis_status(session_id: str, db: Session = Depends(get_db)) -> Optional[JobOut]:
    sessions.get_session(db, session_id)
    job = analysis.latest_job(db, session_id)
    return analysis.job_out(job) if job else None


@router.get(
    "/analysis/{session_id}/results",
    response_model=AnalysisResultsOut,
    summary="Feedback of a completed analysis",
    description="The latest completed job of the session, or the job given by `job_id`.",
)
def analysis_results(
    session_id: str, job_id: Optional[str] = Query(None), db: Session = Depends(get_db)
) -> AnalysisResultsOut:
    sessions.get_session(db, session_id)
    job = analysis.get_job(db, session_id, job_id) if job_id else analysis.latest_job(db, session_id, "completed")
    if job is None:
        raise AppError(404, "analysis_not_found", "This session has no completed analysis yet.")
    if job.status != "completed":
        raise AppError(409, "analysis_not_completed", f"The analysis is {job.status}.", {"status": job.status})
    return analysis.results_out(db, job)


@router.get("/analysis/{session_id}/jobs", response_model=List[JobOut], summary="All analysis jobs of a session")
def analysis_jobs(session_id: str, db: Session = Depends(get_db)) -> List[JobOut]:
    sessions.get_session(db, session_id)
    return [analysis.job_out(job) for job in analysis.list_jobs(db, session_id)]
