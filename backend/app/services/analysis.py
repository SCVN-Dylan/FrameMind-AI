"""AI analysis jobs: one per click on Analyze.

Flow: validate the request -> create a `pending` job (only one active job per session) -> a bounded background
worker marks it `processing`, extracts (or reuses) the frames of each pair, runs Codex once per pair, validates and
normalizes the issues, and stores them -> `completed` or `failed`. Job state lives in SQLite; jobs that were running
when the backend stopped are marked failed on startup.

Normalization never trusts the model: feedback ids are generated here, the pair id must match, cited frame labels
must exist, timestamps must be timestamps of the frames that were actually sent (otherwise they are snapped to the
nearest sent frame), duplicates are dropped.
"""

import json
import logging
import shutil
import tempfile
import threading
from concurrent.futures import Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, not_found
from app.db.database import SessionLocal
from app.db.models import AnalysisJob, AnalysisSession, ExtractedMedia, FeedbackItem, MatchingPair, utcnow
from app.schemas.analysis import (
    AIAnalysisOutput,
    AnalysisResultsOut,
    AnalysisRunRequest,
    EvidenceOut,
    FeedbackOut,
    JobOut,
)
from app.services import extraction, unity_project
from app.services.ai.codex_account import codex_account
from app.services.ai.codex_cli import PROVIDER, CodexError, codex_cli
from app.services.ai.prompt import ProjectContext, PromptFrame, build_prompt

logger = logging.getLogger(__name__)

ACTIVE = ("pending", "processing")
MAX_ISSUES_PER_PAIR = 20  # same as the schema limit on AIAnalysisOutput.issues
_create_lock = threading.Lock()
_executor: Optional[ThreadPoolExecutor] = None
_executor_lock = threading.Lock()
# Submitted jobs not finished yet, and the flag Clear All Data sets to stop them (see cancel_all()).
_futures: Set[Future] = set()
_cancelled = threading.Event()


def _worker() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(
                max_workers=max(1, get_settings().codex_max_concurrent_jobs), thread_name_prefix="analysis"
            )
        return _executor


def _submit(job_id: str) -> None:
    future = _worker().submit(run_job, job_id)
    if isinstance(future, Future):
        with _executor_lock:
            _futures.add(future)
        future.add_done_callback(_forget)


def _forget(future: Future) -> None:
    with _executor_lock:
        _futures.discard(future)


def cancel_all(timeout: float) -> bool:
    """Stops every queued and running job: queued ones never start, running Codex processes are killed and the
    worker stops before its next pair. Waits up to `timeout` seconds for the workers to finish. Returns True when
    none is left. New jobs are refused until resume_jobs()."""
    _cancelled.set()
    with _executor_lock:
        futures = list(_futures)
    for future in futures:
        future.cancel()
    codex_cli.stop_all()
    _, still_running = wait(futures, timeout=timeout)
    return not still_running


def resume_jobs() -> None:
    _cancelled.clear()
    codex_cli.resume()


def _raise_if_cancelled() -> None:
    if _cancelled.is_set():
        raise AppError(409, "analysis_cancelled", "The analysis was cancelled because all data is being cleared.")


def shutdown() -> None:
    global _executor
    with _executor_lock:
        if _executor is not None:
            _executor.shutdown(wait=False, cancel_futures=True)
            _executor = None


# ---------- Serialisation ----------


def job_out(job: AnalysisJob) -> JobOut:
    return JobOut(
        id=job.id,
        session_id=job.session_id,
        status=job.status,  # type: ignore[arg-type]
        analysis_mode=job.analysis_mode,  # type: ignore[arg-type]
        provider=job.provider,
        model=job.model,
        provider_version=job.provider_version,
        language=job.language if job.language in ("en", "vi", "ko") else "en",  # type: ignore[arg-type]
        unity_project=Path(job.unity_project_path).name if job.unity_project_path else None,
        pair_ids=json.loads(job.pair_ids_json or "[]"),
        summary=job.summary,
        feedback_count=len(job.feedback),
        rejected_issue_count=job.rejected_issue_count,
        error_code=job.error_code,
        error_message=job.error_message,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


def feedback_out(item: FeedbackItem, existing_media: Dict[str, bool]) -> FeedbackOut:
    evidence = []
    for ev in json.loads(item.evidence_json or "[]"):
        media_id = ev.get("media_id") if existing_media.get(ev.get("media_id") or "") else None
        evidence.append(
            EvidenceOut(
                label=ev["label"],
                role=ev["role"],
                timestamp_ms=ev["timestamp_ms"],
                media_id=media_id,
                url=f"/api/media/{media_id}/file" if media_id else None,
            )
        )
    return FeedbackOut(
        id=item.id,
        job_id=item.job_id,
        matching_pair_id=item.matching_pair_id,
        category=item.category,  # type: ignore[arg-type]
        severity=item.severity,  # type: ignore[arg-type]
        confidence=item.confidence,  # type: ignore[arg-type]
        title=item.title,
        observation=item.observation,
        impact=item.impact,
        suggested_fix=item.suggested_fix,
        unity_recommendation=item.unity_recommendation,
        reference_timestamp_ms=item.reference_timestamp_ms,
        current_timestamp_ms=item.current_timestamp_ms,
        evidence=evidence,
        created_at=item.created_at,
    )


def results_out(db: Session, job: AnalysisJob) -> AnalysisResultsOut:
    media_ids = {ev.get("media_id") for item in job.feedback for ev in json.loads(item.evidence_json or "[]")}
    media_ids.discard(None)
    found = set(db.scalars(select(ExtractedMedia.id).where(ExtractedMedia.id.in_(media_ids))).all()) if media_ids else set()
    existing = {mid: True for mid in found}
    return AnalysisResultsOut(job=job_out(job), feedback=[feedback_out(item, existing) for item in job.feedback])


# ---------- Queries ----------


def latest_job(db: Session, session_id: str, status: Optional[str] = None) -> Optional[AnalysisJob]:
    stmt = select(AnalysisJob).where(AnalysisJob.session_id == session_id)
    if status:
        stmt = stmt.where(AnalysisJob.status == status)
    return db.scalars(stmt.order_by(AnalysisJob.created_at.desc()).limit(1)).first()


def list_jobs(db: Session, session_id: str) -> List[AnalysisJob]:
    stmt = select(AnalysisJob).where(AnalysisJob.session_id == session_id).order_by(AnalysisJob.created_at.desc())
    return list(db.scalars(stmt).all())


def has_active_job(db: Session) -> bool:
    return db.scalars(select(AnalysisJob.id).where(AnalysisJob.status.in_(ACTIVE)).limit(1)).first() is not None


def get_job(db: Session, session_id: str, job_id: str) -> AnalysisJob:
    job = db.get(AnalysisJob, job_id)
    if job is None or job.session_id != session_id:
        raise not_found("analysis_job", job_id)
    return job


def recover_interrupted_jobs() -> int:
    """Marks jobs that were pending/processing when the backend stopped as failed. Returns how many."""
    with SessionLocal() as db:
        result = db.execute(
            update(AnalysisJob)
            .where(AnalysisJob.status.in_(ACTIVE))
            .values(
                status="failed",
                error_code="interrupted",
                error_message="The backend stopped while this analysis was running. Run it again.",
                finished_at=utcnow(),
            )
        )
        db.commit()
        count = result.rowcount or 0
    if count:
        logger.info("Marked %d interrupted analysis job(s) as failed", count)
    return count


# ---------- Starting a job ----------


def codex_app_error(exc: CodexError) -> AppError:
    status = {
        "codex_timeout": 504,
        "codex_invalid_output": 502,
        "codex_failed": 502,
        "codex_project_sandbox_failed": 502,
        "model_unsupported": 422,
        "codex_already_logged_in": 409,
    }.get(exc.code, 503)
    return AppError(status, exc.code, exc.message)


def start_job(db: Session, session: AnalysisSession, request: AnalysisRunRequest) -> AnalysisJob:
    settings = get_settings()
    if settings.ai_provider != PROVIDER:
        raise AppError(503, "provider_not_supported", f"AI provider {settings.ai_provider!r} is not supported.")
    if session.reference_video is None or session.current_video is None:
        raise AppError(409, "session_videos_missing", "Attach both the reference and current video first.")

    pair_ids = list(dict.fromkeys(request.pair_ids))
    if len(pair_ids) > settings.ai_max_pairs_per_job:
        raise AppError(422, "too_many_pairs", f"Analyse at most {settings.ai_max_pairs_per_job} pairs at once.")
    pair_by_id = {p.id: p for p in session.pairs}
    for pid in pair_ids:
        pair = pair_by_id.get(pid)
        if pair is None:
            raise not_found("pair", pid)
        if pair.pair_type != request.analysis_mode:
            raise AppError(422, "pair_type_mismatch", f"Pair {pid} is not a {request.analysis_mode} pair.")

    try:
        probe = codex_cli.ensure_available()
        # The model chosen in Settings, checked against this account's Codex model catalog.
        model = codex_account.validate_model(codex_account.selected_model())
    except CodexError as exc:
        raise codex_app_error(exc) from exc
    # The Unity project connected in Settings (None = videos only). Fails if it is connected but unreadable.
    project = unity_project.connected()
    if project is not None and not project.readable_dirs:
        project = None  # connected, but no folder chosen (or all chosen folders are gone): videos only

    with _create_lock:
        if _cancelled.is_set():
            raise AppError(409, "data_reset_in_progress", "All data is being cleared. Try again in a moment.")
        active = db.scalars(
            select(AnalysisJob).where(AnalysisJob.session_id == session.id, AnalysisJob.status.in_(ACTIVE)).limit(1)
        ).first()
        if active is not None:
            raise AppError(409, "analysis_in_progress", "An analysis is already running for this session.", {"job_id": active.id})
        job = AnalysisJob(
            session_id=session.id,
            status="pending",
            analysis_mode=request.analysis_mode,
            provider=PROVIDER,
            model=model,  # stored per job: changing the model later never affects this job
            provider_version=probe.version,
            language=request.language,
            unity_project_path=str(project.root) if project else None,  # stored per job, like the model
            unity_project_folders=json.dumps([f for f in project.folders if f not in project.missing_folders]) if project else None,
            pair_ids_json=json.dumps(pair_ids),
        )
        db.add(job)
        db.commit()
        db.refresh(job)

    _submit(job.id)
    return job


# ---------- Running a job ----------


@dataclass(frozen=True)
class SentFrame:
    label: str
    role: str
    timestamp_ms: int
    media_id: str
    path: Path


def pick_evenly(items: Sequence, count: int) -> List:
    """`count` items spread evenly over `items`, keeping order, first and last."""
    if len(items) <= count:
        return list(items)
    if count == 1:
        return [items[0]]
    return [items[round(i * (len(items) - 1) / (count - 1))] for i in range(count)]


def _frames_for_pair(db: Session, session: AnalysisSession, pair: MatchingPair) -> List[SentFrame]:
    result = extraction.extract_pair(db, session, pair)  # reuses frames extracted earlier
    limit = 1 if pair.pair_type == "single_frame" else max(1, get_settings().ai_max_frames_per_clip)
    frames: List[SentFrame] = []
    for role, prefix, media in (("reference", "R", result.reference), ("current", "C", result.current)):
        if not media:
            raise AppError(422, "extraction_failed", f"No {role} frames could be extracted for pair {pair.id}.")
        for index, m in enumerate(pick_evenly(media, limit), start=1):
            path = extraction.media_file(extraction.get_media(db, m.id))
            frames.append(SentFrame(f"{prefix}{index}", role, m.timestamp_ms or 0, m.id, path))
    return frames


def _nearest(value: int, options: Sequence[int]) -> int:
    return min(options, key=lambda option: abs(option - value))


def normalize_issues(
    output: AIAnalysisOutput, pair: MatchingPair, frames: Sequence[SentFrame], mode: str
) -> Tuple[List[dict], int]:
    """Validated issues ready to store, and how many were rejected."""
    by_label = {f.label.upper(): f for f in frames}
    times = {
        "reference": sorted({f.timestamp_ms for f in frames if f.role == "reference"}),
        "current": sorted({f.timestamp_ms for f in frames if f.role == "current"}),
    }
    kept: List[dict] = []
    seen = set()
    rejected = 0
    for issue in output.issues:
        if issue.matching_pair_id.strip() != pair.id:
            rejected += 1
            continue
        key = (issue.category, issue.title.strip().lower())
        if key in seen or len(kept) >= MAX_ISSUES_PER_PAIR:
            rejected += 1
            continue
        seen.add(key)

        # Timestamps must be the timestamps of frames we actually sent.
        ref_ms = _nearest(issue.reference_timestamp_ms, times["reference"])
        cur_ms = _nearest(issue.current_timestamp_ms, times["current"])

        cited = [by_label[label.strip().upper()] for label in issue.evidence_frames if label.strip().upper() in by_label]
        cited = list(dict.fromkeys(cited))
        if not cited:
            # Fall back to the frames at the issue's timestamps.
            cited = [f for f in frames if (f.role == "reference" and f.timestamp_ms == ref_ms) or (f.role == "current" and f.timestamp_ms == cur_ms)]

        confidence = issue.confidence
        if mode == "single_frame" and issue.category == "animation":
            confidence = "low"  # a still image can't show motion

        kept.append(
            dict(
                matching_pair_id=pair.id,
                category=issue.category,
                severity=issue.severity,
                confidence=confidence,
                title=issue.title.strip(),
                observation=issue.observation.strip(),
                impact=issue.impact.strip(),
                suggested_fix=issue.suggested_fix.strip(),
                unity_recommendation=issue.unity_recommendation.strip(),
                reference_timestamp_ms=ref_ms,
                current_timestamp_ms=cur_ms,
                evidence_json=json.dumps(
                    [{"label": f.label, "role": f.role, "timestamp_ms": f.timestamp_ms, "media_id": f.media_id} for f in cited]
                ),
            )
        )
    return kept, rejected


def _job_project(job: AnalysisJob) -> Optional[unity_project.UnityProject]:
    """The Unity project this job may read, re-checked now (it may have moved since the job was queued)."""
    if not job.unity_project_path:
        return None
    if not unity_project.supported():
        raise AppError(409, "unity_project_unsupported", "Reading a Unity project is only supported on macOS.")
    folders = json.loads(job.unity_project_folders or "[]")
    try:
        project = unity_project.inspect(job.unity_project_path, folders)
    except AppError as exc:
        raise AppError(409, "unity_project_unavailable", f"The Unity project can't be read any more: {exc.message}") from exc
    if not project.readable_dirs:
        raise AppError(409, "unity_project_unavailable", "The chosen Unity project folders can't be read any more.")
    return project


def _analyse_pair(
    db: Session,
    session: AnalysisSession,
    pair: MatchingPair,
    mode: str,
    model: Optional[str],
    language: str = "en",
    project: Optional[unity_project.UnityProject] = None,
) -> Tuple[AIAnalysisOutput, List[dict], int]:
    frames = _frames_for_pair(db, session, pair)
    workdir = Path(tempfile.mkdtemp(prefix="framemind-codex-")).resolve()
    try:
        images = []
        for order, frame in enumerate(frames, start=1):
            target = workdir / f"{order:02d}_{frame.label}_{frame.role}_{frame.timestamp_ms}ms.jpg"
            shutil.copyfile(frame.path, target)
            images.append(target)
        prompt_frames = [PromptFrame(f.label, f.role, f.timestamp_ms) for f in frames]
        description = (pair.event_description or "").replace('"', "'").replace("\n", " ")[:200]
        context = None
        if project is not None:
            context = ProjectContext(
                name=project.name,
                root=str(project.root),
                readable_dirs=[str(d) for d in project.readable_dirs],
                unity_version=project.unity_version,
                text_serialization=project.text_serialization,
            )
        prompt = build_prompt(pair.id, mode, prompt_frames, description, language, project=context)
        _raise_if_cancelled()
        output = codex_cli.run(
            prompt, images, workdir, model=model, project_dirs=project.readable_dirs if project else ()
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    issues, rejected = normalize_issues(output, pair, frames, mode)
    return output, issues, rejected


def _set(db: Session, job: AnalysisJob, **values) -> None:
    for key, value in values.items():
        setattr(job, key, value)
    db.commit()


def run_job(job_id: str) -> None:
    """Background worker. Never raises: every outcome is written to the job row."""
    with SessionLocal() as db:
        job = db.get(AnalysisJob, job_id)
        if job is None or job.status != "pending":
            return
        _set(db, job, status="processing", started_at=utcnow())
        try:
            session = db.get(AnalysisSession, job.session_id)
            if session is None:
                raise AppError(404, "session_not_found", "The session was deleted.")
            pairs = {p.id: p for p in session.pairs}
            project = _job_project(job)
            summaries: List[str] = []
            stored: List[dict] = []
            rejected_total = 0
            pair_ids = json.loads(job.pair_ids_json)
            for number, pid in enumerate(pair_ids, start=1):
                pair = pairs.get(pid)
                if pair is None:
                    raise AppError(404, "pair_not_found", "A pair was deleted while the analysis was running.")
                _raise_if_cancelled()
                output, issues, rejected = _analyse_pair(
                    db, session, pair, job.analysis_mode, job.model, job.language, project
                )
                rejected_total += rejected
                stored.extend(issues)
                if output.summary.strip():
                    label = (pair.event_description or f"#{number}") if len(pair_ids) > 1 else None
                    summaries.append(f"{label}: {output.summary.strip()}" if label else output.summary.strip())

            _raise_if_cancelled()  # never store feedback for data that is being cleared
            for position, values in enumerate(stored):
                db.add(FeedbackItem(job_id=job.id, session_id=job.session_id, position=position, **values))
            _set(
                db,
                job,
                status="completed",
                summary="\n".join(summaries) or None,
                rejected_issue_count=rejected_total,
                finished_at=utcnow(),
            )
            logger.info("Analysis %s completed: %d issue(s), %d rejected", job.id, len(stored), rejected_total)
        except CodexError as exc:
            db.rollback()
            _set(db, job, status="failed", error_code=exc.code, error_message=exc.message, finished_at=utcnow())
            logger.warning("Analysis %s failed: %s", job.id, exc.code)
        except AppError as exc:
            db.rollback()
            _set(db, job, status="failed", error_code=exc.code, error_message=exc.message, finished_at=utcnow())
        except Exception:  # noqa: BLE001 - the job row must always end in a final state
            db.rollback()
            logger.exception("Analysis %s crashed", job_id)
            _set(db, job, status="failed", error_code="internal_error", error_message="Unexpected error; see backend log.", finished_at=utcnow())
