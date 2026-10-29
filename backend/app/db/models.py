"""Database tables. Binary files live on disk; these rows hold their metadata and relative paths.

All ids are UUID strings. All timestamps inside videos are integer milliseconds. Datetimes are naive UTC.
"""

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Video(Base):
    __tablename__ = "videos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    original_filename: Mapped[str] = mapped_column(String(255))
    # Relative to the storage root, e.g. "videos/<id>.mp4". Never built from the original filename.
    storage_path: Mapped[str] = mapped_column(String(512))
    file_size: Mapped[int] = mapped_column(Integer)
    duration_ms: Mapped[int] = mapped_column(Integer)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    fps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    codec: Mapped[str] = mapped_column(String(64))
    # Container name reported by FFprobe (e.g. "mov,mp4,m4a,3gp,3g2,mj2").
    container: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AnalysisSession(Base):
    __tablename__ = "analysis_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    # Null = no custom name; the UI shows "<reference> vs <current>".
    name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    reference_video_id: Mapped[Optional[str]] = mapped_column(ForeignKey("videos.id"), nullable=True)
    current_video_id: Mapped[Optional[str]] = mapped_column(ForeignKey("videos.id"), nullable=True)
    analysis_mode: Mapped[str] = mapped_column(String(20), default="single_frame")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    reference_video: Mapped[Optional[Video]] = relationship(foreign_keys=[reference_video_id])
    current_video: Mapped[Optional[Video]] = relationship(foreign_keys=[current_video_id])
    pairs: Mapped[List["MatchingPair"]] = relationship(back_populates="session", cascade="all, delete-orphan")


class MatchingPair(Base):
    """The same gameplay event marked in both videos. The two videos' timestamps are expected to differ."""

    __tablename__ = "matching_pairs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("analysis_sessions.id", ondelete="CASCADE"), index=True)
    pair_type: Mapped[str] = mapped_column(String(20))  # "single_frame" | "short_clip"
    event_description: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    # single_frame
    reference_timestamp_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    current_timestamp_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # short_clip (the two ranges may have different lengths)
    reference_start_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    reference_end_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    current_start_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    current_end_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    session: Mapped[AnalysisSession] = relationship(back_populates="pairs")


class ExtractedMedia(Base):
    """One image extracted with FFmpeg. A clip pair produces an ordered sequence per video."""

    __tablename__ = "extracted_media"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("analysis_sessions.id", ondelete="CASCADE"), index=True)
    matching_pair_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("matching_pairs.id", ondelete="CASCADE"), nullable=True, index=True
    )
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id"))
    role: Mapped[str] = mapped_column(String(10))  # "reference" | "current"
    media_type: Mapped[str] = mapped_column(String(20))  # "frame" | "clip_frame"
    # Position in the sequence (0 for a single frame).
    frame_index: Mapped[int] = mapped_column(Integer, default=0)
    # Exact source timestamp of this image in its video.
    timestamp_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # The clip range this frame was sampled from (clip frames only).
    start_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    end_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Relative to the storage root, e.g. "frames/<session>/<pair>/<run>/reference_000.jpg".
    storage_path: Mapped[str] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AnalysisJob(Base):
    """One click on Analyze: the pairs to analyse, the provider used, its state and summary."""

    __tablename__ = "analysis_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("analysis_sessions.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | processing | completed | failed
    analysis_mode: Mapped[str] = mapped_column(String(20))  # single_frame | short_clip
    provider: Mapped[str] = mapped_column(String(40))  # e.g. "codex_cli"
    model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    provider_version: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    # Language the AI was asked to write in ("en" | "vi" | "ko"). Feedback is stored exactly as generated.
    language: Mapped[str] = mapped_column(String(5), default="en", server_default="en")
    # JSON list of the matching pair ids analysed (kept even if a pair is deleted later).
    pair_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Issues the backend dropped while validating the AI output (wrong pair id, unknown evidence, ...).
    rejected_issue_count: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    feedback: Mapped[List["FeedbackItem"]] = relationship(
        back_populates="job", cascade="all, delete-orphan", order_by="FeedbackItem.position"
    )


class FeedbackItem(Base):
    """One validated issue from the AI. Ids are generated by the backend, never taken from model output."""

    __tablename__ = "feedback_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    job_id: Mapped[str] = mapped_column(ForeignKey("analysis_jobs.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("analysis_sessions.id", ondelete="CASCADE"), index=True)
    # Null if the pair was deleted after the analysis; the timestamps below still locate the issue.
    matching_pair_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("matching_pairs.id", ondelete="SET NULL"), nullable=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)
    category: Mapped[str] = mapped_column(String(20))
    severity: Mapped[str] = mapped_column(String(20))
    confidence: Mapped[str] = mapped_column(String(10))
    title: Mapped[str] = mapped_column(String(200))
    observation: Mapped[str] = mapped_column(Text)
    impact: Mapped[str] = mapped_column(Text)
    suggested_fix: Mapped[str] = mapped_column(Text)
    unity_recommendation: Mapped[str] = mapped_column(Text)
    reference_timestamp_ms: Mapped[int] = mapped_column(Integer)
    current_timestamp_ms: Mapped[int] = mapped_column(Integer)
    # JSON list of {"label", "role", "timestamp_ms", "media_id"} for the frames the issue cites.
    evidence_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    job: Mapped[AnalysisJob] = relationship(back_populates="feedback")


class AppSetting(Base):
    """Local app preferences (key/value), e.g. the AI model chosen in Settings. Never holds credentials."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
