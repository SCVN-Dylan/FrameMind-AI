// Shared frontend types. These mirror the shapes the backend will return in later milestones.
// All timestamps and durations are integers in MILLISECONDS.

export type FeedbackCategory =
  | "camera"
  | "composition"
  | "lighting"
  | "colors"
  | "animation"
  | "vfx";

export type Severity = "high" | "medium" | "low";

export type FeedbackItem = {
  id: string;
  category: FeedbackCategory;
  severity: Severity;
  title: string;
  summary: string;
  /** What the reference video does at this moment. */
  referenceNote: string;
  /** What the current gameplay does differently. */
  currentNote: string;
  /** Position in the reference video (ms). */
  referenceMs: number;
  /** Position in the current gameplay video (ms). */
  currentMs: number;
  /** Step-by-step suggestion for fixing it in Unity. */
  unityFix: string[];
};

export type AnalysisStatus = "completed" | "processing" | "failed" | "draft";

export type AnalysisRecord = {
  id: string;
  title: string;
  createdAt: string; // ISO date
  referenceVideo: string;
  currentVideo: string;
  /** Length of the current gameplay video (ms). */
  durationMs: number;
  status: AnalysisStatus;
  feedback: FeedbackItem[];
};

export type VideoSlot = "reference" | "current";

/** Facts about a loaded local video file. */
export type VideoMetadata = {
  name: string;
  sizeBytes: number;
  mimeType: string;
  durationMs: number;
  width: number;
  height: number;
};

/** Why a selected file was rejected before loading. */
export type VideoFileError = "empty" | "notVideo" | "unsupportedFormat" | "tooLarge";

/** Why the browser failed to load a video (maps to HTMLMediaElement MediaError codes). */
export type VideoLoadError = "aborted" | "network" | "decode" | "unsupported" | "unknown";

/** Why a play() call was rejected. */
export type VideoPlayError = "blocked" | "failed";

export type VideoPlayerState = {
  status: "empty" | "loading" | "ready" | "error";
  loadError: VideoLoadError | null;
  playError: VideoPlayError | null;
  currentMs: number;
  durationMs: number;
  playing: boolean;
  /** 0–1 */
  volume: number;
  muted: boolean;
  playbackRate: number;
  width: number;
  height: number;
};

// ---------- Matched gameplay moments ----------
// The SAME gameplay event marked in both videos (e.g. "player unlocks the machine"). Timestamps are
// expected to differ between the videos (start time, speed, timing). Input for AI comparison later.

/** Single Frame: one moment in each video. */
export type FramePair = {
  id: string;
  kind: "frame";
  referenceMs: number;
  currentMs: number;
  /** Optional note describing the event. */
  description?: string;
};

/** Effective time ranges (ms) in both videos. */
export type AnalysisRange = {
  referenceStartMs: number;
  referenceEndMs: number;
  currentStartMs: number;
  currentEndMs: number;
};

/** Short Clip: a from–to range in each video. The two clips may have different lengths. */
export type ClipPair = AnalysisRange & {
  id: string;
  kind: "clip";
  description?: string;
};

export type MatchedMoment = FramePair | ClipPair;
export type MomentKind = MatchedMoment["kind"];

// ---------- Analysis settings ----------

export type AnalysisMode = "single_frame" | "short_clip" | "full_video";

export type AnalysisSettings = {
  mode: AnalysisMode;
  /** Required for single_frame. */
  selectedFramePairId: string | null;
  /** Required for short_clip. */
  selectedClipPairId: string | null;
};

/** Exactly what would be analysed for the current settings. */
export type AnalysisTarget =
  | { mode: "single_frame"; pair: FramePair }
  | { mode: "short_clip"; pair: ClipPair }
  | { mode: "full_video"; range: AnalysisRange };

/** Why analysis can't run with the current settings. */
export type AnalysisIssue = "missingVideos" | "noPairs" | "noSelectedPair";
