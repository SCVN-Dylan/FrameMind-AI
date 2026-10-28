"use client";

import { SeverityBadge } from "@/components/ui/Badge";
import Icon from "@/components/ui/Icon";
import { SEVERITY_META } from "@/lib/feedback";
import { formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { FeedbackItem } from "@/lib/types";

type FeedbackCardProps = {
  item: FeedbackItem;
  index: number;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
};

export default function FeedbackCard({ item, index, expanded, selected, onToggle }: FeedbackCardProps) {
  const severity = SEVERITY_META[item.severity];
  const panelId = `feedback-${item.id}-details`;
  const { t } = useI18n();

  return (
    <article
      data-feedback-id={item.id}
      className={`rounded-xl border bg-background/50 transition-all duration-200 ${
        selected ? `border-transparent ring-1 ${severity.ring} bg-surface-raised/60` : "border-border/80 hover:border-primary-soft/40"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-start gap-3 rounded-xl p-4 text-left focus-visible:outline-2 focus-visible:outline-primary-soft"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-primary-soft">
          <Icon name={item.category} size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span className="font-mono">#{index + 1}</span>
            <span>{t.categories[item.category]}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 font-mono">
              <Icon name="clock" size={12} />
              {formatTime(item.currentMs)}
            </span>
          </span>
          <span className="mt-1 block text-sm font-medium text-foreground">{item.title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <SeverityBadge severity={item.severity} />
          <Icon
            name="chevronDown"
            size={16}
            className={`text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {expanded && (
        <div id={panelId} className="flex flex-col gap-4 border-t border-border/60 px-4 pt-4 pb-5">
          <p className="text-sm leading-relaxed text-muted">{item.summary}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Observation icon="film" label={t.feedback.reference} time={item.referenceMs} text={item.referenceNote} tone="text-primary-soft" />
            <Observation icon="video" label={t.feedback.current} time={item.currentMs} text={item.currentNote} tone="text-accent" />
          </div>

          <div className="rounded-xl border border-primary-soft/20 bg-primary/5 p-4">
            <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-primary-soft uppercase">
              <Icon name="wrench" size={14} />
              {t.feedback.unityFix}
            </p>
            <ol className="mt-3 flex flex-col gap-2">
              {item.unityFix.map((step, stepIndex) => (
                <li key={stepIndex} className="flex gap-3 text-sm text-foreground/90">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 font-mono text-[11px] text-primary-soft">
                    {stepIndex + 1}
                  </span>
                  <span className="leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </article>
  );
}

type ObservationProps = {
  icon: "film" | "video";
  label: string;
  time: number;
  text: string;
  tone: string;
};

function Observation({ icon, label, time, text, tone }: ObservationProps) {
  return (
    <div className="rounded-xl border border-border/70 bg-surface p-3">
      <p className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className={`flex items-center gap-1.5 font-medium ${tone}`}>
          <Icon name={icon} size={14} />
          {label}
        </span>
        <span className="font-mono">{formatTime(time)}</span>
      </p>
      <p className="mt-2 text-sm text-foreground/90">{text}</p>
    </div>
  );
}
