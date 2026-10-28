// Display metadata (colors) for feedback categories, severities and statuses.

import type { AnalysisStatus, FeedbackCategory, FeedbackItem, Severity } from "./types";

// Labels live in the i18n dictionaries (`t.categories`, `t.severity`, `t.status`).

export const CATEGORIES: FeedbackCategory[] = ["camera", "composition", "lighting", "colors", "animation", "vfx"];

export const SEVERITY_ORDER: Severity[] = ["high", "medium", "low"];

export const SEVERITY_META: Record<
  Severity,
  { dot: string; badge: string; ring: string }
> = {
  high: {
    dot: "bg-rose-400",
    badge: "border-rose-400/30 bg-rose-400/10 text-rose-300",
    ring: "ring-rose-400/60",
  },
  medium: {
    dot: "bg-amber-400",
    badge: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    ring: "ring-amber-400/60",
  },
  low: {
    dot: "bg-sky-400",
    badge: "border-sky-400/30 bg-sky-400/10 text-sky-200",
    ring: "ring-sky-400/60",
  },
};

export const STATUS_META: Record<AnalysisStatus, { badge: string; dot: string }> = {
  completed: {
    badge: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    dot: "bg-emerald-400",
  },
  processing: {
    badge: "border-accent/40 bg-accent/10 text-sky-200",
    dot: "bg-accent",
  },
  failed: {
    badge: "border-rose-400/30 bg-rose-400/10 text-rose-300",
    dot: "bg-rose-400",
  },
  draft: {
    badge: "border-border bg-surface-raised text-muted",
    dot: "bg-muted",
  },
};

export function countBySeverity(items: FeedbackItem[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const item of items) counts[item.severity] += 1;
  return counts;
}

export function sortByTime(items: FeedbackItem[]): FeedbackItem[] {
  return [...items].sort((a, b) => a.currentMs - b.currentMs);
}
