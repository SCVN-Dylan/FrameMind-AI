"use client";

import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import type { MomentSaveStatus } from "@/hooks/useSessionSync";
import { ApiError, apiUrl, extractPair, getPairMedia, type ApiExtraction, type ApiMedia } from "@/lib/api";
import { apiErrorText } from "@/lib/api-errors";
import { formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { momentTimesKey } from "@/lib/session-sync";
import type { AnalysisMode, MatchedMoment, VideoSlot } from "@/lib/types";

import { formatSpan } from "./momentText";

type ExtractedFramesPanelProps = {
  sessionId: string | null;
  mode: AnalysisMode;
  /** The selected pair of the active mode (null = none selected). */
  moment: MatchedMoment | null;
  momentStatus: MomentSaveStatus | null;
  /** Both videos are on the server. */
  canSync: boolean;
  /** Seek one video to an extracted frame's timestamp. */
  onSeek: (slot: VideoSlot, ms: number) => void;
};

/**
 * Frames the backend extracted with FFmpeg for the selected pair: one image per video (Single Frame) or an
 * ordered sequence per video (Short Clip). Results are cached per pair and its times, so editing a pair
 * never shows frames of its old times.
 */
export default function ExtractedFramesPanel({ sessionId, mode, moment, momentStatus, canSync, onSeek }: ExtractedFramesPanelProps) {
  const { t } = useI18n();
  const e = t.extraction;
  const [results, setResults] = useState<Record<string, ApiExtraction>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, ApiError>>({});
  const loadedKeys = useRef(new Set<string>());

  const key = moment ? `${sessionId}:${momentTimesKey(moment)}` : null;
  const ready = Boolean(sessionId && moment && canSync && momentStatus === "saved");
  const result = key ? results[key] : undefined;
  const error = key ? errors[key] : undefined;

  // Load frames extracted earlier (e.g. after restoring a session). Cheap: no FFmpeg run.
  useEffect(() => {
    if (!ready || !key || !sessionId || !moment || loadedKeys.current.has(key)) return;
    loadedKeys.current.add(key);
    const controller = new AbortController();
    getPairMedia(sessionId, moment.id, controller.signal)
      .then((data) => setResults((prev) => ({ ...prev, [key]: data })))
      .catch(() => loadedKeys.current.delete(key)); // try again next time the pair is selected
    return () => controller.abort();
  }, [ready, key, sessionId, moment]);

  async function extract() {
    if (!key || !sessionId || !moment) return;
    const hasFrames = Boolean(result && result.reference.length > 0);
    setBusyKey(key);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      const data = await extractPair(sessionId, moment.id, hasFrames);
      setResults((prev) => ({ ...prev, [key]: data }));
    } catch (err) {
      const apiError = err instanceof ApiError ? err : new ApiError(0, "unknown", String(err));
      setErrors((prev) => ({ ...prev, [key]: apiError }));
    } finally {
      setBusyKey((current) => (current === key ? null : current));
    }
  }

  const busy = busyKey !== null && busyKey === key;
  const hasFrames = Boolean(result && (result.reference.length > 0 || result.current.length > 0));

  return (
    <Card>
      <CardHeader
        title={e.title}
        description={e.description}
        action={
          <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200" title={e.realTooltip}>
            <Icon name="film" size={12} /> {e.real}
          </Badge>
        }
      />
      <div className="flex flex-col gap-4 px-5 pb-5">
        {mode === "full_video" ? (
          <Notice>{e.fullVideo}</Notice>
        ) : !moment ? (
          <Notice>{e.noPair}</Notice>
        ) : !ready ? (
          <Notice>{e.needSaved}</Notice>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <PairSummary moment={moment} />
              <Button size="sm" variant={hasFrames ? "secondary" : "primary"} disabled={busy} onClick={extract}>
                {busy ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <Icon name={hasFrames ? "restart" : "film"} size={14} />
                )}
                {busy ? e.extracting : hasFrames ? e.reextract : e.extract}
              </Button>
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
                {e.failed} {apiErrorText(t, error)}
              </p>
            )}

            {hasFrames && result ? (
              moment.kind === "frame" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FrameImage media={result.reference[0]} slot="reference" onSeek={onSeek} />
                  <FrameImage media={result.current[0]} slot="current" onSeek={onSeek} />
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <FrameStrip frames={result.reference} slot="reference" onSeek={onSeek} />
                  <FrameStrip frames={result.current} slot="current" onSeek={onSeek} />
                </div>
              )
            ) : (
              !busy && result && <Notice>{e.none}</Notice>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function Notice({ children }: { children: string }) {
  return <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-xs text-muted">{children}</p>;
}

function PairSummary({ moment }: { moment: MatchedMoment }) {
  const { t } = useI18n();
  const a = t.analysis;
  return (
    <div className="flex min-w-0 flex-col gap-0.5 font-mono text-xs">
      {moment.description && <span className="truncate font-sans text-sm text-foreground">{moment.description}</span>}
      {moment.kind === "frame" ? (
        <span>
          <span className="text-primary-soft">
            {a.reference} {formatTime(moment.referenceMs)}
          </span>
          <span className="text-muted"> ↔ </span>
          <span className="text-accent">
            {a.current} {formatTime(moment.currentMs)}
          </span>
        </span>
      ) : (
        <span>
          <span className="text-primary-soft">
            {a.reference} {formatSpan(moment.referenceStartMs, moment.referenceEndMs)}
          </span>
          <span className="text-muted"> ↔ </span>
          <span className="text-accent">
            {a.current} {formatSpan(moment.currentStartMs, moment.currentEndMs)}
          </span>
        </span>
      )}
    </div>
  );
}

const SLOT_STYLE: Record<VideoSlot, { text: string; ring: string }> = {
  reference: { text: "text-primary-soft", ring: "hover:ring-primary-soft/70 focus-visible:ring-primary-soft" },
  current: { text: "text-accent", ring: "hover:ring-accent/70 focus-visible:ring-accent" },
};

function FrameImage({ media, slot, onSeek }: { media?: ApiMedia; slot: VideoSlot; onSeek: (slot: VideoSlot, ms: number) => void }) {
  const { t } = useI18n();
  if (!media) return null;
  const ms = media.timestamp_ms ?? 0;
  const label = slot === "reference" ? t.analysis.reference : t.analysis.current;
  return (
    <figure className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onSeek(slot, ms)}
        title={t.extraction.seekHint}
        className={`overflow-hidden rounded-xl border border-border bg-black ring-2 ring-transparent transition focus-visible:outline-none ${SLOT_STYLE[slot].ring}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served by the local backend, not optimisable by next/image */}
        <img src={apiUrl(media.url)} alt={`${label} ${formatTime(ms, 3)}`} className="aspect-video w-full object-contain" loading="lazy" />
      </button>
      <figcaption className="flex items-center justify-between font-mono text-xs">
        <span className={SLOT_STYLE[slot].text}>{label}</span>
        <span className="text-muted tabular-nums">{formatTime(ms, 3)}</span>
      </figcaption>
    </figure>
  );
}

function FrameStrip({ frames, slot, onSeek }: { frames: ApiMedia[]; slot: VideoSlot; onSeek: (slot: VideoSlot, ms: number) => void }) {
  const { t } = useI18n();
  if (frames.length === 0) return null;
  const label = slot === "reference" ? t.analysis.reference : t.analysis.current;
  const first = frames[0];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-xs">
        <span className={SLOT_STYLE[slot].text}>
          {label} {formatSpan(first.start_ms ?? 0, first.end_ms ?? 0)}
        </span>
        <span className="text-muted">{t.extraction.frames(frames.length)}</span>
      </p>
      <ol className="flex gap-2 overflow-x-auto pb-2">
        {frames.map((frame) => {
          const ms = frame.timestamp_ms ?? 0;
          return (
            <li key={frame.id} className="w-32 shrink-0">
              <button
                type="button"
                onClick={() => onSeek(slot, ms)}
                title={t.extraction.seekHint}
                className={`block w-full overflow-hidden rounded-lg border border-border bg-black ring-2 ring-transparent transition focus-visible:outline-none ${SLOT_STYLE[slot].ring}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- served by the local backend */}
                <img src={apiUrl(frame.url)} alt={`${label} ${formatTime(ms, 3)}`} className="aspect-video w-full object-contain" loading="lazy" />
              </button>
              <span className="mt-1 block text-center font-mono text-[10px] text-muted tabular-nums">{formatTime(ms, 3)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
