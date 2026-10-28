from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    app_name: str
    version: str
    environment: str
    database: bool
    storage: bool
    ffmpeg: bool
    openai_configured: bool
