"use client";

import type { MouseEvent } from "react";

import { Card, CardHeader } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Icon, { type IconName } from "@/components/ui/Icon";
import { CATEGORIES, SEVERITY_META, SEVERITY_ORDER } from "@/lib/feedback";
import { clamp, formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { FeedbackItem } from "@/lib/types";

type AnalysisTimelineProps = {
  /** Length of the current gameplay video (ms). 0 = no video. */
  durationMs: number;
  /** Playhead position in the current gameplay video (ms). Omit to hide the playhead. */
  currentMs?: number;
  items: FeedbackItem[];
  selectedId: string | null;
  onSelectItem: (item: FeedbackItem) => void;
  /** Click on the track (ms). Omit when there is no video to seek. */
  onSeek?: (time: number) => void;
  /** Matched moments of the active mode, on the current gameplay video. */
  pairMarkers?: { id: string; ms: number }[];
};

const pct = (time: number, duration: number) => `${clamp((time / duration) * 100, 0, 100)}%`;

/** Horizontal timeline of the current gameplay, with one lane of feedback markers per category. */
export default function AnalysisTimeline(props: AnalysisTimelineProps) {
  const { durationMs: duration, currentMs: currentTime, items, selectedId, onSelectItem, onSeek, pairMarkers: pairs = [] } = props;
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const { t } = useI18n();

  const lanes: { id: string; label: string; icon: IconName }[] = [
    ...CATEGORIES.map((id) => ({ id, label: t.categories[id], icon: id as IconName })),
    ...(pairs.length > 0 ? [{ id: "pairs", label: t.timeline.pairs, icon: "bookmark" as const }] : []),
  ];

  function seekFromClick(event: MouseEvent<HTMLDivElement>) {
    if (!onSeek) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(clamp((event.clientX - rect.left) / rect.width, 0, 1) * duration);
  }

  return (
    <Card>
      <CardHeader
        title={t.timeline.title}
        description={t.timeline.description}
        action={
          selected && (
            <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1 font-mono text-xs text-foreground">
              <span className={`h-2 w-2 rounded-full ${SEVERITY_META[selected.severity].dot}`} />
              {t.timeline.selected} {formatTime(selected.currentMs)}
            </span>
          )
        }
      />

      {duration <= 0 ? (
        <EmptyState
          icon="clock"
          title={t.timeline.emptyTitle}
          description={t.timeline.emptyText}
          className="pt-2"
        />
      ) : (
        <div className="px-5 pb-5">
          <div className="flex gap-3">
            {/* Lane labels */}
            <div className="w-[76px] shrink-0 pt-7 sm:w-[104px]">
              {lanes.map((lane) => (
                <div key={lane.id} className="flex h-9 items-center gap-2 text-xs text-muted">
                  <Icon name={lane.icon} size={14} className="shrink-0" />
                  <span className="truncate">{lane.label}</span>
                </div>
              ))}
            </div>

            <div className="min-w-0 flex-1">
              {/* Ruler */}
              <div className="relative mb-2 h-5 font-mono text-[10px] text-muted">
                {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                  <span
                    key={fraction}
                    className={`absolute top-0 ${fraction === 0 ? "" : fraction === 1 ? "-translate-x-full" : "-translate-x-1/2"} ${
                      fraction === 0.25 || fraction === 0.75 ? "hidden sm:inline" : ""
                    }`}
                    style={{ left: `${fraction * 100}%` }}
                  >
                    {formatTime(fraction * duration)}
                  </span>
                ))}
              </div>

              {/* Lanes */}
              <div
                className={`relative rounded-lg bg-background/40 ${onSeek ? "cursor-pointer" : ""}`}
                onClick={seekFromClick}
                title={onSeek ? t.timeline.clickToSeek : undefined}
              >
                {lanes.map((lane) => (
                  <div key={lane.id} className="relative h-9 border-b border-border/30 last:border-b-0">
                    <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/60" />
                    {lane.id === "pairs"
                      ? pairs.map((pair) => (
                          <span
                            key={pair.id}
                            title={t.timeline.markedPair(formatTime(pair.ms))}
                            className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/70"
                            style={{ left: pct(pair.ms, duration) }}
                          />
                        ))
                      : items
                          .filter((item) => item.category === lane.id)
                          .map((item) => (
                            <Marker
                              key={item.id}
                              item={item}
                              left={pct(item.currentMs, duration)}
                              selected={item.id === selectedId}
                              onSelect={onSelectItem}
                            />
                          ))}
                  </div>
                ))}

                {/* Selected-timestamp indicator and playhead, drawn across every lane */}
                {selected && (
                  <div
                    className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-primary-soft/70"
                    style={{ left: pct(selected.currentMs, duration) }}
                  />
                )}
                {currentTime !== undefined && (
                  <div
                    className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-foreground shadow-[0_0_8px_rgb(245_243_255/0.6)]"
                    style={{ left: pct(currentTime, duration) }}
                  >
                    <span className="absolute -top-1.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-foreground" />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
            {SEVERITY_ORDER.map((severity) => (
              <span key={severity} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full ${SEVERITY_META[severity].dot}`} />
                {t.severity[severity]}
              </span>
            ))}
            {currentTime !== undefined && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-0.5 rounded-full bg-foreground" />
                {t.timeline.playhead} <span className="font-mono">{formatTime(currentTime)}</span>
              </span>
            )}
            {items.length === 0 && <span>{t.timeline.noFeedback}</span>}
          </div>
        </div>
      )}
    </Card>
  );
}

type MarkerProps = {
  item: FeedbackItem;
  left: string;
  selected: boolean;
  onSelect: (item: FeedbackItem) => void;
};

function Marker({ item, left, selected, onSelect }: MarkerProps) {
  const severity = SEVERITY_META[item.severity];
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelect(item);
      }}
      aria-label={`${item.title} at ${formatTime(item.currentMs)}`}
      aria-pressed={selected}
      className="group absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full p-1.5 focus-visible:outline-2 focus-visible:outline-primary-soft"
      style={{ left }}
    >
      <span
        className={`block rounded-full transition-all duration-200 ${severity.dot} ${
          selected ? `h-4 w-4 ring-4 ${severity.ring}` : "h-3 w-3 group-hover:scale-125"
        }`}
      />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden w-max max-w-56 -translate-x-1/2 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-left text-xs text-foreground shadow-xl group-hover:block group-focus-visible:block">
        <span className="font-mono text-muted">{formatTime(item.currentMs)}</span> · {item.title}
      </span>
    </button>
  );
}
