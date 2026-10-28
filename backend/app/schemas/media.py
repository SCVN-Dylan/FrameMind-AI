from typing import List, Literal, Optional

from pydantic import BaseModel

from app.schemas.common import PairType, UTCDateTime, VideoRole


class MediaOut(BaseModel):
    id: str
    session_id: str
    matching_pair_id: Optional[str]
    video_id: str
    role: VideoRole
    media_type: Literal["frame", "clip_frame"]
    frame_index: int
    timestamp_ms: Optional[int]
    start_ms: Optional[int]
    end_ms: Optional[int]
    created_at: UTCDateTime
    # Image URL (relative to the API base URL). Filesystem paths are never exposed.
    url: str


class ExtractionOut(BaseModel):
    """Extracted images for one pair, ordered by time within each video."""

    pair_id: str
    pair_type: PairType
    reference: List[MediaOut]
    current: List[MediaOut]
    # True when the images already existed and nothing was re-extracted.
    cached: bool = False
