from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.common import PairType, UTCDateTime

Ms = Field(default=None, ge=0, le=24 * 60 * 60 * 1000)

_FRAME_FIELDS = ("reference_timestamp_ms", "current_timestamp_ms")
_CLIP_FIELDS = ("reference_start_ms", "reference_end_ms", "current_start_ms", "current_end_ms")


class PairTimes(BaseModel):
    reference_timestamp_ms: Optional[int] = Ms
    current_timestamp_ms: Optional[int] = Ms
    reference_start_ms: Optional[int] = Ms
    reference_end_ms: Optional[int] = Ms
    current_start_ms: Optional[int] = Ms
    current_end_ms: Optional[int] = Ms


def _check_fields(pair_type: str, times: PairTimes) -> None:
    required, forbidden = (_FRAME_FIELDS, _CLIP_FIELDS) if pair_type == "single_frame" else (_CLIP_FIELDS, _FRAME_FIELDS)
    missing = [name for name in required if getattr(times, name) is None]
    extra = [name for name in forbidden if getattr(times, name) is not None]
    if missing:
        raise ValueError(f"{pair_type} pairs need: {', '.join(missing)}")
    if extra:
        raise ValueError(f"{pair_type} pairs must not set: {', '.join(extra)}")


class PairCreate(PairTimes):
    """Single Frame: reference_timestamp_ms + current_timestamp_ms.
    Short Clip: reference_start/end_ms + current_start/end_ms (the two ranges may differ in length).

    `id` is optional. The frontend sends its own UUID so a retried request can't create a duplicate.
    """

    id: Optional[str] = Field(default=None, pattern=r"^[0-9a-fA-F-]{36}$")
    pair_type: PairType
    event_description: Optional[str] = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _fields_match_type(self) -> "PairCreate":
        _check_fields(self.pair_type, self)
        return self


class PairUpdate(PairTimes):
    """Full replacement of the pair's times and description. The pair type can't change."""

    event_description: Optional[str] = Field(default=None, max_length=200)


class PairOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    pair_type: PairType
    event_description: Optional[str]
    reference_timestamp_ms: Optional[int]
    current_timestamp_ms: Optional[int]
    reference_start_ms: Optional[int]
    reference_end_ms: Optional[int]
    current_start_ms: Optional[int]
    current_end_ms: Optional[int]
    created_at: UTCDateTime
    updated_at: UTCDateTime


def check_update_fields(pair_type: str, update: PairUpdate) -> None:
    _check_fields(pair_type, update)
