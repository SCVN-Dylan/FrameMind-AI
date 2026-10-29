from pydantic import BaseModel


class DeletedCounts(BaseModel):
    sessions: int
    pairs: int
    jobs: int
    feedback: int
    media: int
    videos: int


class DataResetOut(BaseModel):
    """Result of Clear All Data. Sent only after the backend checked that no records or files are left."""

    deleted: DeletedCounts
    files_deleted: int
    bytes_freed: int
    verified: bool
