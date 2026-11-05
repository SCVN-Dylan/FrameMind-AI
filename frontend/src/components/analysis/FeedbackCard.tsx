"use client";

import { useEffect, useRef, useState } from "react";

import { ConfidenceBadge, SeverityBadge } from "@/components/ui/Badge";
import Icon from "@/components/ui/Icon";
import { SEVERITY_META } from "@/lib/feedback";
import { formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { FeedbackEvidence, FeedbackItem } from "@/lib/types";

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
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {item.confidence && <ConfidenceBadge confidence={item.confidence} />}
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
          {item.impact ? (
            // Real AI feedback: observation, impact and the frames it is based on.
            <>
              <Section label={t.feedback.observation} text={item.summary} />
              <Section label={t.feedback.impact} text={item.impact} />
              <div className="grid gap-3 sm:grid-cols-2">
                <TimeChip icon="film" label={t.feedback.reference} time={item.referenceMs} tone="text-primary-soft" />
                <TimeChip icon="video" label={t.feedback.current} time={item.currentMs} tone="text-accent" />
              </div>
              {item.suggestedFix && <Section label={t.feedback.suggestedFix} text={item.suggestedFix} />}
              {item.evidence && item.evidence.length > 0 && <Evidence evidence={item.evidence} />}
            </>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-muted">{item.summary}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Observation icon="film" label={t.feedback.reference} time={item.referenceMs} text={item.referenceNote ?? ""} tone="text-primary-soft" />
                <Observation icon="video" label={t.feedback.current} time={item.currentMs} text={item.currentNote ?? ""} tone="text-accent" />
              </div>
            </>
          )}

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

function Section({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-sm leading-relaxed text-foreground/90">{text}</p>
    </div>
  );
}

function TimeChip({ icon, label, time, tone }: { icon: "film" | "video"; label: string; time: number; tone: string }) {
  return (
    <p className="flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-surface px-3 py-2 text-xs text-muted">
      <span className={`flex items-center gap-1.5 font-medium ${tone}`}>
        <Icon name={icon} size={14} />
        {label}
      </span>
      <span className="font-mono">{formatTime(time, 3)}</span>
    </p>
  );
}

/** The frames Codex cited for this issue. Clicking a frame opens it full screen. */
function Evidence({ evidence }: { evidence: FeedbackEvidence[] }) {
  const { t } = useI18n();
  const viewable = evidence.filter((frame) => frame.imageUrl);
  const [open, setOpen] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{t.feedback.evidence}</p>
      <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {evidence.map((frame) => {
          const border = frame.slot === "reference" ? "border-primary-soft/40" : "border-accent/40";
          const caption = `${frame.label} ${formatTime(frame.ms, 3)}`;
          return (
            <li key={frame.label} className="w-28 shrink-0">
              {frame.imageUrl ? (
                <button
                  type="button"
                  title={t.feedback.enlarge}
                  aria-label={`${t.feedback.enlarge}: ${caption}`}
                  onClick={(e) => {
                    triggerRef.current = e.currentTarget;
                    setOpen(viewable.indexOf(frame));
                  }}
                  className={`block w-full cursor-zoom-in overflow-hidden rounded-lg border bg-black transition-shadow hover:ring-2 hover:ring-primary-soft/70 focus-visible:outline-2 focus-visible:outline-primary-soft ${border}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- served by the local backend */}
                  <img src={frame.imageUrl} alt={caption} className="aspect-video w-full object-contain" loading="lazy" />
                </button>
              ) : (
                <div className={`overflow-hidden rounded-lg border bg-black ${border}`}>
                  <div className="flex aspect-video items-center justify-center text-[10px] text-muted">{frame.label}</div>
                </div>
              )}
              <p className={`mt-1 text-center font-mono text-[10px] ${frame.slot === "reference" ? "text-primary-soft" : "text-accent"}`}>
                {frame.label} · {formatTime(frame.ms, 3)}
              </p>
            </li>
          );
        })}
      </ul>
      {open !== null && viewable.length > 0 && (
        <Lightbox
          frames={viewable}
          index={open}
          onIndex={setOpen}
          onClose={() => {
            setOpen(null);
            triggerRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function Lightbox({
  frames,
  index,
  onIndex,
  onClose,
}: {
  frames: FeedbackEvidence[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  const frame = frames[index];
  const many = frames.length > 1;
  const go = (d: number) => onIndex((index + d + frames.length) % frames.length);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      } else if (many && e.key === "ArrowLeft") {
        e.preventDefault();
        onIndex((index - 1 + frames.length) % frames.length);
      } else if (many && e.key === "ArrowRight") {
        e.preventDefault();
        onIndex((index + 1) % frames.length);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [index, many, frames.length, onIndex, onClose]);

  const btn =
    "absolute flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-primary-soft";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.feedback.evidence}
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "IMG") onClose();
      }}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-black/90 px-2 pt-14 pb-20 backdrop-blur-sm sm:px-[72px] sm:pb-6"
    >
      <button ref={closeRef} type="button" onClick={onClose} aria-label={t.feedback.closeImage} title={t.feedback.closeImage} className={`${btn} top-3 right-3`}>
        <Icon name="x" size={22} />
      </button>
      {many && (
        <button type="button" onClick={() => go(-1)} aria-label={t.feedback.prevImage} title={t.feedback.prevImage} className={`${btn} bottom-4 left-4 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2`}>
          <Icon name="chevronRight" size={24} className="rotate-180" />
        </button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the local backend */}
      <img
        src={frame.imageUrl ?? undefined}
        alt={`${frame.label} ${formatTime(frame.ms, 3)}`}
        className="max-h-[calc(100vh-140px)] max-w-full cursor-zoom-out rounded-lg object-contain shadow-2xl"
      />
      <p className={`font-mono text-sm ${frame.slot === "reference" ? "text-primary-soft" : "text-accent"}`}>
        {frame.label} · {formatTime(frame.ms, 3)}
        {many && `   (${index + 1}/${frames.length})`}
      </p>
      {many && (
        <button type="button" onClick={() => go(1)} aria-label={t.feedback.nextImage} title={t.feedback.nextImage} className={`${btn} right-4 bottom-4 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2`}>
          <Icon name="chevronRight" size={24} />
        </button>
      )}
    </div>
  );
}
