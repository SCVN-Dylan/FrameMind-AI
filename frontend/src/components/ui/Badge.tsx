"use client";

import type { ReactNode } from "react";

import { CONFIDENCE_META, SEVERITY_META, STATUS_META } from "@/lib/feedback";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { AnalysisStatus, Confidence, Severity } from "@/lib/types";

import Icon from "./Icon";

type BadgeProps = {
  children: ReactNode;
  className?: string;
  title?: string;
};

export function Badge({ children, className = "border-border bg-surface-raised text-muted", title }: BadgeProps) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

/** Marks anything that is sample data rather than a real result. */
export function DemoBadge({ variant = "data" }: { variant?: "data" | "mode" }) {
  const { t } = useI18n();
  return (
    <Badge className="border-primary-soft/40 bg-primary/15 text-primary-soft" title={t.demo.tooltip}>
      <Icon name="sparkles" size={12} />
      {t.demo[variant]}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const meta = SEVERITY_META[severity];
  const { t } = useI18n();
  return (
    <Badge className={meta.badge}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {t.severity[severity]}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: AnalysisStatus }) {
  const meta = STATUS_META[status];
  const { t } = useI18n();
  return (
    <Badge className={meta.badge}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${status === "processing" ? "animate-pulse" : ""}`} />
      {t.status[status]}
    </Badge>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const { t } = useI18n();
  return (
    <Badge className={CONFIDENCE_META[confidence]} title={t.feedback.confidenceLabel}>
      {t.feedback.confidence[confidence]}
    </Badge>
  );
}
