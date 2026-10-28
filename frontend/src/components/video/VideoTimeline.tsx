"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import type { TimelineHighlight } from "@/lib/analysis";
import { clamp, formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";

/** `number` is the 1-based pair number shown on the marker. */
export type TimelineMarker = { id: string; ms: number; number: number; description?: string };

type VideoTimelineProps = {
  label: string;
  durationMs: number;
  currentMs: number;
  markers: TimelineMarker[];
  selectedMarkerId: string | null;
  disabled: boolean;
  onSeek: (ms: number) => void;
  /** Relative seek, used by arrow keys. */
  onSeekBy: (deltaMs: number) => void;
  onSelectMarker: (id: string) => void;
  /** Tailwind classes for the progress fill, so each video keeps its accent color. */
  accentClassName: string;
  /** Area that the current analysis settings would analyse (point or range). */
  analysisHighlight: TimelineHighlight | null;
  /** Classes for the analysed range band, e.g. "bg-primary/30 ring-primary-soft/70". */
  highlightClassName: string;
  /** Background class for the single-frame point marker. */
  pointClassName: string;
};

const pct = (ms: number, durationMs: number) => `${durationMs > 0 ? clamp((ms / durationMs) * 100, 0, 100) : 0}%`;

/** Seek bar for one video: drag or click to seek, numbered markers for matching pairs. */
export default function VideoTimeline(props: VideoTimelineProps) {
  const { label, durationMs, currentMs, markers, selectedMarkerId, disabled, onSeek, onSeekBy, onSelectMarker, accentClassName } = props;
  const { analysisHighlight, highlightClassName, pointClassName } = props;
  const trackRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  function msFromPointer(clientX: number) {
    const rect = trackRef.current!.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1) * durationMs;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    onSeek(msFromPointer(event.clientX));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(msFromPointer(event.clientX));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const step = event.shiftKey ? 5000 : 1000;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => onSeekBy(-step),
      ArrowRight: () => onSeekBy(step),
      Home: () => onSeek(0),
      End: () => onSeek(durationMs),
    };
    if (!(event.key in actions)) return;
    event.preventDefault();
    actions[event.key]();
  }

  return (
    <div className="relative pt-5">
      {/* Pair markers sit above the track */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-5">
        {markers.map((marker) => {
          const selected = marker.id === selectedMarkerId;
          return (
            <button
              key={marker.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelectMarker(marker.id)}
              title={[t.video.pairMarker(marker.number, formatTime(marker.ms)), marker.description].filter(Boolean).join(" · ")}
              aria-label={t.video.pairMarker(marker.number, formatTime(marker.ms))}
              aria-pressed={selected}
              className={`pointer-events-auto absolute top-0 flex h-4 min-w-4 -translate-x-1/2 items-center justify-center rounded px-1 font-mono text-[9px] font-semibold transition-all duration-200 ${
                selected
                  ? "z-10 scale-110 bg-foreground text-background shadow-md"
                  : "bg-surface-raised text-muted ring-1 ring-border hover:text-foreground"
              }`}
              style={{ left: pct(marker.ms, durationMs) }}
            >
              {marker.number}
            </button>
          );
        })}
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs)}
        aria-valuenow={Math.round(currentMs)}
        aria-valuetext={`${formatTime(currentMs)} / ${formatTime(durationMs)}`}
        aria-disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        className={`group relative flex h-5 touch-none items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-soft ${
          disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
        }`}
      >
        {/* Analysed area: a band for clips / full video, a tall tick for a single frame */}
        {!disabled && analysisHighlight?.kind === "range" && (
          <span
            className={`pointer-events-none absolute top-1/2 h-4 -translate-y-1/2 rounded-md ring-1 ${highlightClassName}`}
            style={{
              left: pct(analysisHighlight.startMs, durationMs),
              width: `calc(${pct(analysisHighlight.endMs, durationMs)} - ${pct(analysisHighlight.startMs, durationMs)})`,
              minWidth: 2,
            }}
          />
        )}
        {!disabled && analysisHighlight?.kind === "point" && (
          <span
            className={`pointer-events-none absolute top-1/2 h-5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${pointClassName}`}
            style={{ left: pct(analysisHighlight.ms, durationMs) }}
          />
        )}
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div className={`absolute inset-y-0 left-0 rounded-full ${accentClassName}`} style={{ width: pct(currentMs, durationMs) }} />
        </div>
        {/* Marker ticks on the track */}
        {markers.map((marker) => (
          <span
            key={marker.id}
            className={`pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
              marker.id === selectedMarkerId ? "bg-foreground" : "bg-foreground/40"
            }`}
            style={{ left: pct(marker.ms, durationMs) }}
          />
        ))}
        {/* Playhead */}
        {!disabled && (
          <span
            className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-[0_0_0_3px_rgb(124_58_237/0.45)] transition-transform group-hover:scale-110"
            style={{ left: pct(currentMs, durationMs) }}
          />
        )}
      </div>
    </div>
  );
}
