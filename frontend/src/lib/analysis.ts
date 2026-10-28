// Pure helpers for analysis settings: validating matched moments and resolving what would be analysed.

import type {
  AnalysisIssue,
  AnalysisRange,
  AnalysisSettings,
  AnalysisTarget,
  ClipPair,
  FramePair,
  MatchedMoment,
  MomentKind,
} from "./types";

/** Allowed length of each clip in a clip pair. */
export const CLIP_LENGTH_MS = { min: 100, max: 10_000 } as const;

/** Two pairs closer than this on every timestamp count as the same pair. */
export const DUPLICATE_TOLERANCE_MS = 50;

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  mode: "single_frame",
  selectedFramePairId: null,
  selectedClipPairId: null,
};

/** Video lengths (ms) that pairs are checked against. 0 = video not loaded. */
export type VideoDurations = { referenceMs: number; currentMs: number };

export type MomentError =
  | "missingVideo"
  | "referenceOutOfRange"
  | "currentOutOfRange"
  | "referenceOrder"
  | "currentOrder"
  | "referenceTooShort"
  | "currentTooShort"
  | "referenceTooLong"
  | "currentTooLong"
  | "duplicate";

/** A moment without an id, as entered in a form. */
export type MomentDraft = Omit<FramePair, "id"> | Omit<ClipPair, "id">;

/** All timestamps of a moment, in a fixed order, for duplicate comparison. */
function timestamps(m: MomentDraft): number[] {
  return m.kind === "frame"
    ? [m.referenceMs, m.currentMs]
    : [m.referenceStartMs, m.referenceEndMs, m.currentStartMs, m.currentEndMs];
}

function checkSpan(
  side: "reference" | "current",
  startMs: number,
  endMs: number,
  durationMs: number,
): MomentError | null {
  if (startMs < 0 || endMs > durationMs || startMs > durationMs) return `${side}OutOfRange`;
  if (endMs <= startMs) return `${side}Order`;
  if (endMs - startMs < CLIP_LENGTH_MS.min) return `${side}TooShort`;
  if (endMs - startMs > CLIP_LENGTH_MS.max) return `${side}TooLong`;
  return null;
}

export function validateMoment(
  draft: MomentDraft,
  existing: MatchedMoment[],
  durations: VideoDurations,
  ignoreId?: string,
): MomentError | null {
  if (durations.referenceMs <= 0 || durations.currentMs <= 0) return "missingVideo";

  if (draft.kind === "frame") {
    if (draft.referenceMs < 0 || draft.referenceMs > durations.referenceMs) return "referenceOutOfRange";
    if (draft.currentMs < 0 || draft.currentMs > durations.currentMs) return "currentOutOfRange";
  } else {
    const error =
      checkSpan("reference", draft.referenceStartMs, draft.referenceEndMs, durations.referenceMs) ??
      checkSpan("current", draft.currentStartMs, draft.currentEndMs, durations.currentMs);
    if (error) return error;
  }

  const mine = timestamps(draft);
  const duplicate = existing.some(
    (m) =>
      m.id !== ignoreId &&
      m.kind === draft.kind &&
      timestamps(m).every((ms, i) => Math.abs(ms - mine[i]) < DUPLICATE_TOLERANCE_MS),
  );
  return duplicate ? "duplicate" : null;
}

/** Latest timestamp a moment uses in one video (to check it still fits a replaced video). */
export function momentEndMs(m: MatchedMoment, side: "reference" | "current"): number {
  if (m.kind === "frame") return side === "reference" ? m.referenceMs : m.currentMs;
  return side === "reference" ? m.referenceEndMs : m.currentEndMs;
}

/** Start of a moment in each video (where to seek when it is selected). */
export function momentStart(m: MatchedMoment): { referenceMs: number; currentMs: number } {
  return m.kind === "frame"
    ? { referenceMs: m.referenceMs, currentMs: m.currentMs }
    : { referenceMs: m.referenceStartMs, currentMs: m.currentStartMs };
}

export function modeKind(mode: AnalysisSettings["mode"]): MomentKind | null {
  if (mode === "single_frame") return "frame";
  if (mode === "short_clip") return "clip";
  return null;
}

export function fullRange(durations: VideoDurations): AnalysisRange {
  return { referenceStartMs: 0, referenceEndMs: durations.referenceMs, currentStartMs: 0, currentEndMs: durations.currentMs };
}

export type AnalysisTargetResult = { ok: true; target: AnalysisTarget } | { ok: false; issue: AnalysisIssue };

/** Resolves the settings into exactly what would be analysed, or the reason it isn't possible. */
export function resolveAnalysisTarget(
  settings: AnalysisSettings,
  moments: MatchedMoment[],
  durations: VideoDurations,
): AnalysisTargetResult {
  if (durations.referenceMs <= 0 || durations.currentMs <= 0) return { ok: false, issue: "missingVideos" };
  if (settings.mode === "full_video") return { ok: true, target: { mode: "full_video", range: fullRange(durations) } };

  if (settings.mode === "single_frame") {
    const frames = moments.filter((m): m is FramePair => m.kind === "frame");
    if (frames.length === 0) return { ok: false, issue: "noPairs" };
    const pair = frames.find((m) => m.id === settings.selectedFramePairId);
    return pair ? { ok: true, target: { mode: "single_frame", pair } } : { ok: false, issue: "noSelectedPair" };
  }

  const clips = moments.filter((m): m is ClipPair => m.kind === "clip");
  if (clips.length === 0) return { ok: false, issue: "noPairs" };
  const pair = clips.find((m) => m.id === settings.selectedClipPairId);
  return pair ? { ok: true, target: { mode: "short_clip", pair } } : { ok: false, issue: "noSelectedPair" };
}

/** Ranges covered by a target. A single frame is a zero-length range at the pair timestamps. */
export function targetRange(target: AnalysisTarget): AnalysisRange {
  if (target.mode === "full_video") return target.range;
  const p = target.pair;
  if (p.kind === "clip") {
    return {
      referenceStartMs: p.referenceStartMs,
      referenceEndMs: p.referenceEndMs,
      currentStartMs: p.currentStartMs,
      currentEndMs: p.currentEndMs,
    };
  }
  return { referenceStartMs: p.referenceMs, referenceEndMs: p.referenceMs, currentStartMs: p.currentMs, currentEndMs: p.currentMs };
}

/** The analysed area of one video, for drawing on its timeline. */
export type TimelineHighlight = { kind: "point"; ms: number } | { kind: "range"; startMs: number; endMs: number };

export function timelineHighlight(target: AnalysisTarget, side: "reference" | "current"): TimelineHighlight {
  const r = targetRange(target);
  const [startMs, endMs] = side === "reference" ? [r.referenceStartMs, r.referenceEndMs] : [r.currentStartMs, r.currentEndMs];
  return target.mode === "single_frame" ? { kind: "point", ms: startMs } : { kind: "range", startMs, endMs };
}
