import { CLIP_LENGTH_MS, type MomentError, type VideoDurations } from "@/lib/analysis";
import { formatTime } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export type FormError = MomentError | "format" | "incomplete";

const seconds = (ms: number) => `${ms / 1000}s`;

/** User-facing message for a moment validation error. */
export function momentErrorText(t: Dictionary, error: FormError, durations: VideoDurations): string {
  const e = t.analysis.errors;
  switch (error) {
    case "referenceOutOfRange":
      return e.referenceOutOfRange(formatTime(durations.referenceMs));
    case "currentOutOfRange":
      return e.currentOutOfRange(formatTime(durations.currentMs));
    case "referenceTooShort":
      return e.referenceTooShort(seconds(CLIP_LENGTH_MS.min));
    case "currentTooShort":
      return e.currentTooShort(seconds(CLIP_LENGTH_MS.min));
    case "referenceTooLong":
      return e.referenceTooLong(seconds(CLIP_LENGTH_MS.max));
    case "currentTooLong":
      return e.currentTooLong(seconds(CLIP_LENGTH_MS.max));
    default:
      return e[error];
  }
}

/** "00:09.00 – 00:11.00" */
export const formatSpan = (startMs: number, endMs: number) => `${formatTime(startMs)} – ${formatTime(endMs)}`;

/** "2.00s" */
export const formatLength = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
