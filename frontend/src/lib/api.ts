// All calls from the frontend to the FastAPI backend go through this file.

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type HealthResponse = {
  status: string;
  app_name: string;
  version: string;
  environment: string;
  database: boolean;
  storage: boolean;
  ffmpeg: boolean;
  openai_configured: boolean;
};

// ---------- Backend shapes (snake_case, as sent by FastAPI). All times are integer milliseconds. ----------

export type ApiVideo = {
  id: string;
  original_filename: string;
  file_size: number;
  duration_ms: number;
  width: number;
  height: number;
  fps: number | null;
  codec: string;
  container: string;
  created_at: string;
  /** Relative to API_BASE_URL. */
  url: string;
};

export type ApiAnalysisMode = "single_frame" | "short_clip" | "full_video";
export type ApiPairType = "single_frame" | "short_clip";

export type ApiPairTimes = {
  reference_timestamp_ms: number | null;
  current_timestamp_ms: number | null;
  reference_start_ms: number | null;
  reference_end_ms: number | null;
  current_start_ms: number | null;
  current_end_ms: number | null;
};

export type ApiPair = ApiPairTimes & {
  id: string;
  session_id: string;
  pair_type: ApiPairType;
  event_description: string | null;
  created_at: string;
  updated_at: string;
};

export type ApiPairBody = Partial<ApiPairTimes> & { event_description?: string | null };
export type ApiPairCreate = ApiPairBody & { id?: string; pair_type: ApiPairType };

export type ApiSessionSummary = {
  id: string;
  name: string | null;
  analysis_mode: ApiAnalysisMode;
  reference_video: ApiVideo | null;
  current_video: ApiVideo | null;
  frame_pair_count: number;
  clip_pair_count: number;
  extracted_pair_count: number;
  /** Status of the latest AI analysis job (null = never analysed). */
  analysis_status: ApiJobStatus | null;
  /** Feedback items of the latest completed analysis. */
  feedback_count: number;
  created_at: string;
  updated_at: string;
};

export type ApiSession = ApiSessionSummary & {
  pairs: ApiPair[];
  /** Pairs the server deleted because they no longer fit a replaced video (PATCH only). */
  pruned_pair_ids: string[];
};

export type ApiSessionUpdate = {
  name?: string | null;
  reference_video_id?: string | null;
  current_video_id?: string | null;
  analysis_mode?: ApiAnalysisMode;
};

export type ApiMedia = {
  id: string;
  session_id: string;
  matching_pair_id: string | null;
  video_id: string;
  role: "reference" | "current";
  media_type: "frame" | "clip_frame";
  frame_index: number;
  /** Exact source timestamp of the image in its video. */
  timestamp_ms: number | null;
  start_ms: number | null;
  end_ms: number | null;
  created_at: string;
  /** Relative to API_BASE_URL. */
  url: string;
};

export type ApiExtraction = {
  pair_id: string;
  pair_type: ApiPairType;
  reference: ApiMedia[];
  current: ApiMedia[];
  cached: boolean;
};

// ---------- Errors ----------

/** A failed API call. `status` 0 = the backend could not be reached; `code` comes from the backend's error body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isNetwork() {
    return this.status === 0;
  }

  /** For `invalid_pair` errors: the frontend's MomentError name (e.g. "referenceOutOfRange"). */
  get reason(): string | undefined {
    const details = this.details as { reason?: unknown } | undefined;
    return typeof details?.reason === "string" ? details.reason : undefined;
  }
}

function errorFromBody(status: number, body: unknown, fallback: string): ApiError {
  const error = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
  return new ApiError(status, error?.code ?? "http_error", error?.message ?? fallback, error?.details);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "network", `Could not reach ${API_BASE_URL}`);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw errorFromBody(response.status, body, `API ${path} failed with status ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function json(method: string, body?: unknown, signal?: AbortSignal): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal,
  };
}

/** Absolute URL for a relative `url` returned by the backend (videos, extracted images). */
export function apiUrl(relative: string): string {
  return `${API_BASE_URL}${relative}`;
}

// ---------- Health ----------

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health", { cache: "no-store" });
}

// ---------- Videos ----------

/**
 * Streams a file to the backend. Uses XMLHttpRequest because fetch() can't report upload progress.
 * `onProgress` gets 0–1 while bytes are sent; after 1 the server still verifies the video before answering.
 */
export function uploadVideo(
  file: File,
  { onProgress, signal }: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<ApiVideo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/api/videos?filename=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.responseType = "json";

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status === 201) resolve(xhr.response as ApiVideo);
      else reject(errorFromBody(xhr.status, xhr.response, `Upload failed with status ${xhr.status}`));
    };
    xhr.onerror = () => reject(new ApiError(0, "network", `Could not reach ${API_BASE_URL}`));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));

    if (signal?.aborted) return reject(new DOMException("Upload aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

export function getVideo(videoId: string): Promise<ApiVideo> {
  return request<ApiVideo>(`/api/videos/${videoId}`, { cache: "no-store" });
}

// ---------- Sessions ----------

export function listSessions(signal?: AbortSignal): Promise<ApiSessionSummary[]> {
  return request<ApiSessionSummary[]>("/api/sessions", json("GET", undefined, signal));
}

export function createSession(body: ApiSessionUpdate): Promise<ApiSession> {
  return request<ApiSession>("/api/sessions", json("POST", body));
}

export function getSession(sessionId: string, signal?: AbortSignal): Promise<ApiSession> {
  return request<ApiSession>(`/api/sessions/${sessionId}`, json("GET", undefined, signal));
}

export function updateSession(sessionId: string, body: ApiSessionUpdate): Promise<ApiSession> {
  return request<ApiSession>(`/api/sessions/${sessionId}`, json("PATCH", body));
}

export function deleteSession(sessionId: string): Promise<void> {
  return request<void>(`/api/sessions/${sessionId}`, json("DELETE"));
}

// ---------- Matching pairs ----------

export function createPair(sessionId: string, body: ApiPairCreate): Promise<ApiPair> {
  return request<ApiPair>(`/api/sessions/${sessionId}/pairs`, json("POST", body));
}

export function updatePair(sessionId: string, pairId: string, body: ApiPairBody): Promise<ApiPair> {
  return request<ApiPair>(`/api/sessions/${sessionId}/pairs/${pairId}`, json("PATCH", body));
}

export function deletePair(sessionId: string, pairId: string): Promise<void> {
  return request<void>(`/api/sessions/${sessionId}/pairs/${pairId}`, json("DELETE"));
}

// ---------- Frame extraction ----------

export function extractPair(sessionId: string, pairId: string, force = false, signal?: AbortSignal): Promise<ApiExtraction> {
  return request<ApiExtraction>(
    `/api/sessions/${sessionId}/pairs/${pairId}/extract${force ? "?force=true" : ""}`,
    json("POST", undefined, signal),
  );
}

export function getPairMedia(sessionId: string, pairId: string, signal?: AbortSignal): Promise<ApiExtraction> {
  return request<ApiExtraction>(`/api/sessions/${sessionId}/pairs/${pairId}/media`, json("GET", undefined, signal));
}

// ---------- AI analysis (local Codex CLI) ----------

export type ApiSeverity = "critical" | "major" | "minor" | "suggestion";
export type ApiConfidence = "high" | "medium" | "low";
export type ApiJobStatus = "pending" | "processing" | "completed" | "failed";

export type ApiJob = {
  id: string;
  session_id: string;
  status: ApiJobStatus;
  analysis_mode: "single_frame" | "short_clip";
  provider: string;
  model: string | null;
  provider_version: string | null;
  /** Language the feedback was generated in. */
  language: "en" | "vi" | "ko";
  pair_ids: string[];
  summary: string | null;
  feedback_count: number;
  rejected_issue_count: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type ApiEvidence = {
  label: string;
  role: "reference" | "current";
  timestamp_ms: number;
  media_id: string | null;
  /** Relative to API_BASE_URL; null if the frame was re-extracted since. */
  url: string | null;
};

export type ApiFeedback = {
  id: string;
  job_id: string;
  matching_pair_id: string | null;
  category: "camera" | "composition" | "lighting" | "colors" | "animation" | "vfx";
  severity: ApiSeverity;
  confidence: ApiConfidence;
  title: string;
  observation: string;
  impact: string;
  suggested_fix: string;
  unity_recommendation: string;
  reference_timestamp_ms: number;
  current_timestamp_ms: number;
  evidence: ApiEvidence[];
  created_at: string;
};

export type ApiAnalysisResults = { job: ApiJob; feedback: ApiFeedback[] };

export type ApiProviderStatus = {
  provider: string;
  installed: boolean;
  version: string | null;
  version_supported: boolean;
  authenticated: boolean | null;
  auth_mode: string | null;
  capabilities: { non_interactive: boolean; image_input: boolean; output_schema: boolean; restricted_permissions: boolean };
  available: boolean;
  /** Model chosen in Settings; null = Codex CLI default. */
  model: string | null;
  last_error: string | null;
  login: ApiLoginFlow;
};

/** The `codex login` flow started from Settings. Never contains credentials. */
export type ApiLoginFlow = {
  state: "idle" | "running" | "succeeded" | "failed" | "cancelled";
  /** OpenAI sign-in page printed by the CLI (if the browser didn't open by itself). */
  login_url: string | null;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
};

export type ApiModel = { slug: string; display_name: string; description: string; supports_images: boolean };

export type ApiModels = {
  /** codex_catalog = this account's catalog; bundled_catalog = list shipped with the CLI; unavailable = default only. */
  source: "codex_catalog" | "bundled_catalog" | "unavailable";
  models: ApiModel[];
  selected: string | null;
  selected_unavailable: boolean;
  error: string | null;
};

export function runAnalysis(
  sessionId: string,
  body: { analysis_mode: "single_frame" | "short_clip"; pair_ids: string[]; language: "en" | "vi" | "ko" },
): Promise<ApiJob> {
  return request<ApiJob>(`/api/analysis/${sessionId}/run`, json("POST", body));
}

/** Latest job of the session, or null if it was never analysed. */
export function getAnalysisStatus(sessionId: string, signal?: AbortSignal): Promise<ApiJob | null> {
  return request<ApiJob | null>(`/api/analysis/${sessionId}/status`, json("GET", undefined, signal));
}

export function getAnalysisResults(sessionId: string, jobId?: string, signal?: AbortSignal): Promise<ApiAnalysisResults> {
  const query = jobId ? `?job_id=${encodeURIComponent(jobId)}` : "";
  return request<ApiAnalysisResults>(`/api/analysis/${sessionId}/results${query}`, json("GET", undefined, signal));
}

export function getProviderStatus(refresh = false, signal?: AbortSignal): Promise<ApiProviderStatus> {
  return request<ApiProviderStatus>(`/api/ai/provider/status${refresh ? "?refresh=true" : ""}`, json("GET", undefined, signal));
}

// ---------- Codex account & model (Settings → AI provider) ----------

export function startCodexLogin(): Promise<ApiLoginFlow> {
  return request<ApiLoginFlow>("/api/ai/provider/login", json("POST"));
}

export function getCodexLogin(signal?: AbortSignal): Promise<ApiLoginFlow> {
  return request<ApiLoginFlow>("/api/ai/provider/login", json("GET", undefined, signal));
}

export function cancelCodexLogin(): Promise<ApiLoginFlow> {
  return request<ApiLoginFlow>("/api/ai/provider/login", json("DELETE"));
}

export function logoutCodex(): Promise<ApiProviderStatus> {
  return request<ApiProviderStatus>("/api/ai/provider/logout", json("POST"));
}

export function listCodexModels(refresh = false, signal?: AbortSignal): Promise<ApiModels> {
  return request<ApiModels>(`/api/ai/provider/models${refresh ? "?refresh=true" : ""}`, json("GET", undefined, signal));
}

/** null = Codex CLI default model. */
export function selectCodexModel(model: string | null): Promise<ApiModels> {
  return request<ApiModels>("/api/ai/provider/model", json("PUT", { model }));
}
