from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.schemas.common import UTCDateTime


class VideoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    original_filename: str
    file_size: int
    duration_ms: int
    width: int
    height: int
    fps: Optional[float]
    codec: str
    container: str
    created_at: UTCDateTime
    # Where the browser can stream the file from (relative to the API base URL).
    url: str
