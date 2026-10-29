from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import UTCDateTime, VideoRole

Category = Literal["camera", "composition", "lighting", "colors", "animation", "vfx"]
Severity = Literal["critical", "major", "minor", "suggestion"]
Confidence = Literal["high", "medium", "low"]
JobStatus = Literal["pending", "processing", "completed", "failed"]
Language = Literal["en", "vi", "ko"]
SUPPORTED_LANGUAGES = ("en", "vi", "ko")

FEEDBACK_SCHEMA_VERSION = "1.0"


# ---------- What the AI must return (validated before anything is saved) ----------


class AIIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    matching_pair_id: str = Field(max_length=64)
    category: Category
    severity: Severity
    title: str = Field(min_length=1, max_length=200)
    observation: str = Field(min_length=1, max_length=2000)
    impact: str = Field(min_length=1, max_length=2000)
    suggested_fix: str = Field(min_length=1, max_length=2000)
    unity_recommendation: str = Field(min_length=1, max_length=2000)
    confidence: Confidence
    reference_timestamp_ms: int = Field(ge=0)
    current_timestamp_ms: int = Field(ge=0)
    # Frame labels from the prompt, e.g. "R1", "C3".
    evidence_frames: List[str] = Field(default_factory=list, max_length=20)


class AIAnalysisOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"]
    summary: str = Field(max_length=4000)
    issues: List[AIIssue] = Field(max_length=20)


# ---------- API ----------


class AnalysisRunRequest(BaseModel):
    """Analyse these pairs (all of the given mode's type). Full Video is not supported yet."""

    analysis_mode: Literal["single_frame", "short_clip"]
    pair_ids: List[str] = Field(min_length=1, max_length=20)
    # UI language the feedback should be written in. Missing or unsupported values fall back to English.
    language: Language = "en"

    @field_validator("language", mode="before")
    @classmethod
    def _default_language(cls, value: object) -> str:
        if isinstance(value, str) and value.strip().lower() in SUPPORTED_LANGUAGES:
            return value.strip().lower()
        return "en"


class EvidenceOut(BaseModel):
    label: str
    role: VideoRole
    timestamp_ms: int
    # Null if the image was re-extracted or deleted since the analysis.
    media_id: Optional[str]
    url: Optional[str]


class FeedbackOut(BaseModel):
    id: str
    job_id: str
    matching_pair_id: Optional[str]
    category: Category
    severity: Severity
    confidence: Confidence
    title: str
    observation: str
    impact: str
    suggested_fix: str
    unity_recommendation: str
    reference_timestamp_ms: int
    current_timestamp_ms: int
    evidence: List[EvidenceOut]
    created_at: UTCDateTime


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    status: JobStatus
    analysis_mode: Literal["single_frame", "short_clip"]
    provider: str
    model: Optional[str]
    provider_version: Optional[str]
    language: Language
    pair_ids: List[str]
    summary: Optional[str]
    feedback_count: int
    rejected_issue_count: int
    error_code: Optional[str]
    error_message: Optional[str]
    created_at: UTCDateTime
    started_at: Optional[UTCDateTime]
    finished_at: Optional[UTCDateTime]


class AnalysisResultsOut(BaseModel):
    job: JobOut
    feedback: List[FeedbackOut]


class ProviderCapabilities(BaseModel):
    non_interactive: bool
    image_input: bool
    output_schema: bool
    restricted_permissions: bool


class LoginFlowOut(BaseModel):
    """The `codex login` flow started from Settings. Holds no credentials."""

    state: Literal["idle", "running", "succeeded", "failed", "cancelled"]
    # OpenAI sign-in page printed by `codex login` (open it if the browser didn't open by itself).
    login_url: Optional[str]
    started_at: Optional[float]
    finished_at: Optional[float]
    error: Optional[str]


class ProviderStatusOut(BaseModel):
    provider: str
    installed: bool
    version: Optional[str]
    version_supported: bool
    # True/False when `codex login status` gives a clear answer, null otherwise.
    authenticated: Optional[bool]
    # "chatgpt" | "api_key" | null. Never includes credentials.
    auth_mode: Optional[str]
    capabilities: ProviderCapabilities
    available: bool
    # Model chosen in Settings (null = Codex CLI default model).
    model: Optional[str]
    last_error: Optional[str]
    login: LoginFlowOut


class ModelOut(BaseModel):
    slug: str
    display_name: str
    description: str
    supports_images: bool


class ModelsOut(BaseModel):
    # "codex_catalog" = `codex debug models` for the signed-in account; "bundled_catalog" = list shipped with the
    # CLI (used if the account catalog can't be loaded); "unavailable" = only the CLI default can be used.
    source: Literal["codex_catalog", "bundled_catalog", "unavailable"]
    models: List[ModelOut]
    selected: Optional[str]
    # The saved model is not in the catalog any more (or can't be verified).
    selected_unavailable: bool
    error: Optional[str]


class ModelSelect(BaseModel):
    """null = use the Codex CLI default model."""

    model: Optional[str] = Field(default=None, max_length=100, pattern=r"^[A-Za-z0-9._:-]+$")
