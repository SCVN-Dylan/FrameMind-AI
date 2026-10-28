from typing import List, Optional

from pydantic import BaseModel, Field

from app.schemas.common import AnalysisMode, UTCDateTime
from app.schemas.pairs import PairOut
from app.schemas.videos import VideoOut


class SessionCreate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    reference_video_id: Optional[str] = None
    current_video_id: Optional[str] = None
    analysis_mode: AnalysisMode = "single_frame"


class SessionUpdate(BaseModel):
    """Only the fields that are sent are changed. Send `null` to detach a video or clear the name."""

    name: Optional[str] = Field(default=None, max_length=200)
    reference_video_id: Optional[str] = None
    current_video_id: Optional[str] = None
    analysis_mode: Optional[AnalysisMode] = None


class SessionSummary(BaseModel):
    id: str
    name: Optional[str]
    analysis_mode: AnalysisMode
    reference_video: Optional[VideoOut]
    current_video: Optional[VideoOut]
    frame_pair_count: int
    clip_pair_count: int
    extracted_pair_count: int
    created_at: UTCDateTime
    updated_at: UTCDateTime


class SessionDetail(SessionSummary):
    pairs: List[PairOut]
    # Pairs deleted by this request because they no longer fit a replaced video (PATCH only).
    pruned_pair_ids: List[str] = []
