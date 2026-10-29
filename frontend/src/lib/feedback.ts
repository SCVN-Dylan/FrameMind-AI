// Display metadata (colors) for feedback categories, severities and statuses.

import type { AnalysisStatus, Confidence, FeedbackCategory, FeedbackItem, Severity } from "./types";

// Labels live in the i18n dictionaries (`t.categories`, `t.severity`, `t.status`).

export const CATEGORIES: FeedbackCategory[] = ["camera", "composition", "lighting", "colors", "animation", "vfx"];

export const SEVERITY_ORDER: Severity[] = ["critical", "major", "minor", "suggestion"];

export const SEVERITY_META: Record<
  Severity,
  { dot: string; badge: string; ring: string }
> = {
  critical: {
    dot: "bg-rose-500",
    badge: "border-rose-500/40 bg-rose-500/15 text-rose-200",
    ring: "ring-rose-500/70",
  },
  major: {
    dot: "bg-orange-400",
    badge: "border-orange-400/30 bg-orange-400/10 text-orange-200",
    ring: "ring-orange-400/60",
  },
  minor: {
    dot: "bg-amber-300",
    badge: "border-amber-300/30 bg-amber-300/10 text-amber-100",
    ring: "ring-amber-300/60",
  },
  suggestion: {
    dot: "bg-sky-400",
    badge: "border-sky-400/30 bg-sky-400/10 text-sky-200",
    ring: "ring-sky-400/60",
  },
};

export const CONFIDENCE_META: Record<Confidence, string> = {
  high: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  medium: "border-border bg-surface-raised text-foreground/80",
  low: "border-border bg-surface-raised text-muted",
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
  const counts: Record<Severity, number> = { critical: 0, major: 0, minor: 0, suggestion: 0 };
  for (const item of items) counts[item.severity] += 1;
  return counts;
}

export function sortByTime(items: FeedbackItem[]): FeedbackItem[] {
  return [...items].sort((a, b) => a.currentMs - b.currentMs);
}
