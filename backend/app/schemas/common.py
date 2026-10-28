from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import PlainSerializer

# Datetimes are stored as naive UTC; send them with an explicit "Z" so browsers don't read them as local time.
UTCDateTime = Annotated[
    datetime,
    PlainSerializer(lambda d: d.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"), return_type=str),
]

VideoRole = Literal["reference", "current"]
AnalysisMode = Literal["single_frame", "short_clip", "full_video"]
PairType = Literal["single_frame", "short_clip"]

