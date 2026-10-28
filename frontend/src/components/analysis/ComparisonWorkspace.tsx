"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Icon from "@/components/ui/Icon";
import VideoPanel, { type PlayerHighlight } from "@/components/video/VideoPanel";
import { useMatchedMoments } from "@/hooks/useMatchedMoments";
import { useSessionSync, type SessionSyncApi } from "@/hooks/useSessionSync";
import { useVideoPlayer, type VideoPlayerApi, type VideoPlayerControls } from "@/hooks/useVideoPlayer";
import { DEFAULT_ANALYSIS_SETTINGS, modeKind, momentStart, resolveAnalysisTarget, targetRange, timelineHighlight } from "@/lib/analysis";
import { apiUrl, type ApiSession } from "@/lib/api";
import { apiErrorText } from "@/lib/api-errors";
import { SEVERITY_META } from "@/lib/feedback";
import { formatOffset, formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { createDemoFeedbackInRange } from "@/lib/mock-data";
import type { AnalysisMode, AnalysisSettings, AnalysisTarget, FeedbackItem, MatchedMoment, VideoSlot, VideoSource } from "@/lib/types";

import AnalysisSettingsPanel from "./AnalysisSettingsPanel";
import AnalysisTimeline from "./AnalysisTimeline";
import ExtractedFramesPanel from "./ExtractedFramesPanel";
import FeedbackPanel from "./FeedbackPanel";

const NO_SOURCES: Record<VideoSlot, VideoSource | null> = { reference: null, current: null };

/** Keeps `?session=<id>` in the address bar so a refresh (or a History link) reopens the saved session. */
function setSessionInUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("session", id);
  else url.searchParams.delete("session");
  if (url.href !== window.location.href) window.history.replaceState(null, "", url);
}

/** Reads `?session=`. Isolated in its own Suspense boundary so the rest of the page can still be prerendered. */
function SessionParam({ onChange }: { onChange: (id: string | null) => void }) {
  const id = useSearchParams().get("session");
  useEffect(() => onChange(id), [id, onChange]);
  return null;
}

export default function ComparisonWorkspace() {
  const momentsApi = useMatchedMoments();
  const [prunedCount, setPrunedCount] = useState(0);
  /** Prune pairs only when the user picked a new file, never when a saved session's video loads. */
  const pruneOnReady = useRef<Record<VideoSlot, boolean>>({ reference: false, current: false });

  // When a replaced video loads, drop frame/clip pairs that no longer fit its length.
  const onReady = (slot: VideoSlot, durationMs: number) => {
    if (!pruneOnReady.current[slot]) return;
    pruneOnReady.current[slot] = false;
    const removed = momentsApi.prune(slot, durationMs);
    if (removed > 0) setPrunedCount(removed);
  };
  const reference = useVideoPlayer({ onReady: (ms) => onReady("reference", ms) });
  const current = useVideoPlayer({ onReady: (ms) => onReady("current", ms) });
  const { language, t } = useI18n();

  const [sources, setSources] = useState(NO_SOURCES);
  const [mode, setMode] = useState<AnalysisMode>(DEFAULT_ANALYSIS_SETTINGS.mode);
  /** What the last demo run covered; null = not analysed yet. Kept as a snapshot so results don't move. */
  const [analysis, setAnalysis] = useState<AnalysisTarget | null>(null);
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null);
  /** When set, both players move together. Value = current time − reference time (ms). */
  const [syncOffsetMs, setSyncOffsetMs] = useState<number | null>(null);

  const players: Record<VideoSlot, VideoPlayerApi> = { reference, current };

  /** Clears demo results and playback links that belong to the previous videos. */
  function clearDerivedState() {
    setAnalysis(null);
    setSelectedFeedbackId(null);
    setSyncOffsetMs(null);
    setPrunedCount(0);
  }

  const sync = useSessionSync({
    moments: momentsApi.moments,
    mode,
    onSessionIdChange: setSessionInUrl,
    onRestore: (session: ApiSession, restored: MatchedMoment[]) => {
      momentsApi.replaceAll(restored);
      setMode(session.analysis_mode);
      const toSource = (video: ApiSession["reference_video"]): VideoSource | null =>
        video ? { kind: "remote", url: apiUrl(video.url), name: video.original_filename, sizeBytes: video.file_size } : null;
      setSources({ reference: toSource(session.reference_video), current: toSource(session.current_video) });
      pruneOnReady.current = { reference: false, current: false };
      reference.controls.reset();
      current.controls.reset();
      clearDerivedState();
    },
  });

  const syncRef = useRef(sync);
  useEffect(() => {
    syncRef.current = sync;
  });
  /** Reacts to `?session=` (page load, refresh, History link). */
  const openSessionFromUrl = useCallback((id: string | null) => {
    const { sessionId, restoreState, restore } = syncRef.current;
    if (id === null) {
      // Back on /analysis/new without a param (e.g. via the sidebar): keep showing the open session.
      if (sessionId) setSessionInUrl(sessionId);
      return;
    }
    if (id === sessionId || (restoreState.status === "loading" && restoreState.id === id)) return;
    void restore(id);
  }, []);

  function startNewSession() {
    if ((sources.reference || sources.current) && !window.confirm(t.session.newConfirm)) return;
    sync.reset();
    momentsApi.replaceAll([]);
    setSources(NO_SOURCES);
    setMode(DEFAULT_ANALYSIS_SETTINGS.mode);
    reference.controls.reset();
    current.controls.reset();
    clearDerivedState();
  }
  const referenceReady = reference.state.status === "ready";
  const currentReady = current.state.status === "ready";
  const bothReady = referenceReady && currentReady;
  const limits = {
    referenceMs: referenceReady ? reference.state.durationMs : 0,
    currentMs: currentReady ? current.state.durationMs : 0,
  };

  // Each mode has its own selected pair; switching modes never touches the pairs.
  const kind = modeKind(mode);
  const settings: AnalysisSettings = {
    mode,
    selectedFramePairId: momentsApi.selected.frame,
    selectedClipPairId: momentsApi.selected.clip,
  };
  const targetResult = resolveAnalysisTarget(settings, momentsApi.moments, limits);
  const target = targetResult.ok ? targetResult.target : null;

  // Rebuilt on language change so the demo feedback is shown in the selected language.
  const feedback = useMemo(
    () => (analysis ? createDemoFeedbackInRange(targetRange(analysis), language) : null),
    [analysis, language],
  );
  const selectedFeedback = feedback?.find((item) => item.id === selectedFeedbackId) ?? null;

  /** Controls for one panel. In sync mode, actions are mirrored to the other video, keeping the offset. */
  function panelControls(slot: VideoSlot): VideoPlayerControls {
    const self = players[slot].controls;
    if (syncOffsetMs === null) return self;
    const other = players[slot === "reference" ? "current" : "reference"].controls;
    const toOther = (ms: number) => (slot === "reference" ? ms + syncOffsetMs : ms - syncOffsetMs);
    return {
      ...self,
      play: async () => {
        await Promise.all([self.play(), other.play()]);
      },
      pause: () => {
        self.pause();
        other.pause();
      },
      toggle: () => {
        if (players[slot].state.playing) {
          self.pause();
          other.pause();
        } else {
          void self.play();
          void other.play();
        }
      },
      seek: (ms) => {
        self.seek(ms);
        other.seek(toOther(ms));
      },
      seekBy: (deltaMs) => {
        self.seekBy(deltaMs);
        other.seekBy(deltaMs);
      },
      step: (deltaMs) => {
        self.step(deltaMs);
        other.step(deltaMs);
      },
    };
  }

  const jumpBoth = useCallback(
    (referenceMs: number, currentMs: number) => {
      reference.controls.pause();
      current.controls.pause();
      reference.controls.seek(referenceMs);
      current.controls.seek(currentMs);
    },
    [reference.controls, current.controls],
  );

  const selectMomentInApi = momentsApi.select;
  /** Select a frame/clip pair for analysis and seek both videos to its (start) times. */
  const selectMoment = useCallback(
    (moment: MatchedMoment) => {
      selectMomentInApi(moment.kind, moment.id);
      const start = momentStart(moment);
      jumpBoth(start.referenceMs, start.currentMs);
    },
    [selectMomentInApi, jumpBoth],
  );

  // Pairs of the active mode (none in Full Video), shown as numbered markers on the timelines.
  const modeMoments = kind ? momentsApi.moments.filter((m) => m.kind === kind) : [];

  const selectMarker = (id: string) => {
    const moment = modeMoments.find((m) => m.id === id);
    if (moment) selectMoment(moment);
  };

  const selectFeedback = useCallback(
    (item: FeedbackItem | null) => {
      setSelectedFeedbackId(item?.id ?? null);
      if (item) jumpBoth(item.referenceMs, item.currentMs);
    },
    [jumpBoth],
  );

  function changeFile(slot: VideoSlot, file: File | null) {
    setSources((prev) => ({ ...prev, [slot]: file ? { kind: "file", file, name: file.name, sizeBytes: file.size } : null }));
    players[slot].controls.reset();
    // Demo results and sync no longer match the new video. Pairs are kept and checked against the
    // new duration once it loads (see onReady above).
    pruneOnReady.current[slot] = Boolean(file);
    clearDerivedState();
    // The file plays locally right away; the upload runs in the background.
    if (file) void sync.uploadFile(slot, file);
    else sync.removeVideo(slot);
  }

  function seekOne(slot: VideoSlot, ms: number) {
    players[slot].controls.pause();
    players[slot].controls.seek(ms);
  }

  function playBoth() {
    void reference.controls.play();
    void current.controls.play();
  }

  function pauseBoth() {
    reference.controls.pause();
    current.controls.pause();
  }

  function restartBoth() {
    void reference.controls.restart();
    void current.controls.restart();
  }

  function toggleSync() {
    setSyncOffsetMs((prev) => (prev !== null ? null : current.state.currentMs - reference.state.currentMs));
  }

  function highlightFor(slot: VideoSlot): PlayerHighlight | null {
    if (!selectedFeedback) return null;
    const severity = SEVERITY_META[selectedFeedback.severity];
    const ms = slot === "reference" ? selectedFeedback.referenceMs : selectedFeedback.currentMs;
    return {
      ringClassName: severity.ring,
      dotClassName: severity.dot,
      text: `${t.categories[selectedFeedback.category]} · ${formatTime(ms)}`,
    };
  }

  const markers = (slot: VideoSlot) =>
    modeMoments.map((moment, index) => {
      const start = momentStart(moment);
      return {
        id: moment.id,
        ms: slot === "reference" ? start.referenceMs : start.currentMs,
        number: index + 1,
        description: moment.description,
      };
    });
  const selectedMarkerId = kind ? momentsApi.selected[kind] : null;

  const feedbackEmptyState = useMemo(
    () => (
      <EmptyState
        icon={bothReady ? "sparkles" : "upload"}
        title={bothReady ? t.workspace.readyTitle : t.workspace.noVideosTitle}
        description={bothReady ? t.workspace.readyText : t.workspace.noVideosText}
        className="rounded-xl border border-dashed border-border"
      />
    ),
    [bothReady, t],
  );

  const status =
    !sources.reference && !sources.current
      ? t.workspace.missingBoth
      : !sources.reference
        ? t.workspace.missingReference
        : !sources.current
          ? t.workspace.missingCurrent
          : t.workspace.ready;

  const selectedMoment = kind ? (momentsApi.moments.find((m) => m.id === momentsApi.selected[kind]) ?? null) : null;

  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={null}>
        <SessionParam onChange={openSessionFromUrl} />
      </Suspense>

      {/* Toolbar */}
      <Card className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{t.workspace.heading}</h2>
          <p className="mt-1 text-sm text-muted">{status}</p>
          <SessionStatus sync={sync} sources={sources} />
        </div>
        <Button size="sm" variant="secondary" onClick={startNewSession} className="shrink-0 self-start">
          <Icon name="plus" size={14} /> {t.session.newSession}
        </Button>
      </Card>

      {/* Players */}
      <div className="grid gap-6 xl:grid-cols-2">
        <VideoPanel
          title={t.video.referenceTitle}
          uploadHint={t.video.referenceHint}
          icon="film"
          iconClassName="text-primary-soft"
          accentClassName="bg-primary-soft"
          highlightClassName="bg-primary/35 ring-primary-soft/70"
          pointClassName="bg-primary-soft shadow-[0_0_8px_rgb(167_139_250/0.8)]"
          analysisHighlight={target && timelineHighlight(target, "reference")}
          source={sources.reference}
          onFileChange={(file) => changeFile("reference", file)}
          upload={sync.uploads.reference}
          onRetryUpload={() => sync.retryUpload("reference")}
          player={{ ...reference, controls: panelControls("reference") }}
          markers={markers("reference")}
          selectedMarkerId={selectedMarkerId}
          onSelectMarker={selectMarker}
          highlight={highlightFor("reference")}
        />
        <VideoPanel
          title={t.video.currentTitle}
          uploadHint={t.video.currentHint}
          icon="video"
          iconClassName="text-accent"
          accentClassName="bg-accent"
          highlightClassName="bg-accent/30 ring-accent/70"
          pointClassName="bg-accent shadow-[0_0_8px_rgb(59_130_246/0.8)]"
          analysisHighlight={target && timelineHighlight(target, "current")}
          source={sources.current}
          onFileChange={(file) => changeFile("current", file)}
          upload={sync.uploads.current}
          onRetryUpload={() => sync.retryUpload("current")}
          player={{ ...current, controls: panelControls("current") }}
          markers={markers("current")}
          selectedMarkerId={selectedMarkerId}
          onSelectMarker={selectMarker}
          highlight={highlightFor("current")}
        />
      </div>

      {/* Shared controls: each video keeps its own timestamp */}
      <Card className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!bothReady} onClick={playBoth}>
            <Icon name="play" size={12} /> {t.workspace.playBoth}
          </Button>
          <Button size="sm" disabled={!bothReady} onClick={pauseBoth}>
            <Icon name="pause" size={12} /> {t.workspace.pauseBoth}
          </Button>
          <Button size="sm" disabled={!bothReady} onClick={restartBoth}>
            <Icon name="restart" size={14} /> {t.workspace.restartBoth}
          </Button>
          <Button
            size="sm"
            disabled={!bothReady}
            onClick={toggleSync}
            aria-pressed={syncOffsetMs !== null}
            className={syncOffsetMs !== null ? "border-primary-soft/60! bg-primary/20! text-foreground" : ""}
            title={t.workspace.syncTooltip}
          >
            <Icon name="link" size={14} />
            {syncOffsetMs !== null ? t.workspace.synced(formatOffset(syncOffsetMs)) : t.workspace.sync}
          </Button>
        </div>
        <p className="text-xs text-muted">{t.workspace.sharedHint}</p>
      </Card>

      <AnalysisSettingsPanel
        mode={mode}
        onModeChange={setMode}
        momentsApi={momentsApi}
        durations={limits}
        referenceNowMs={reference.state.currentMs}
        currentNowMs={current.state.currentMs}
        onSelectMoment={selectMoment}
        momentStatus={sync.canSync ? sync.momentStatus : undefined}
        momentError={sync.pairError}
        result={targetResult}
        prunedCount={prunedCount}
        onDismissPruned={() => setPrunedCount(0)}
        onAnalyze={() => {
          if (!target) return;
          setAnalysis(target);
          setSelectedFeedbackId(null);
        }}
      />

      <ExtractedFramesPanel
        sessionId={sync.sessionId}
        mode={mode}
        moment={selectedMoment}
        momentStatus={selectedMoment && sync.canSync ? sync.momentStatus(selectedMoment.id) : null}
        canSync={sync.canSync}
        onSeek={seekOne}
      />

      <AnalysisTimeline
        durationMs={limits.currentMs}
        currentMs={current.state.currentMs}
        items={feedback ?? []}
        selectedId={selectedFeedbackId}
        onSelectItem={selectFeedback}
        onSeek={panelControls("current").seek}
        pairMarkers={markers("current")}
      />

      <FeedbackPanel
        items={feedback}
        selectedId={selectedFeedbackId}
        onSelect={selectFeedback}
        emptyState={feedbackEmptyState}
      />
    </div>
  );
}

/** Where the session stands on the backend: restoring, saved, saving pairs, or failed. */
function SessionStatus({ sync, sources }: { sync: SessionSyncApi; sources: Record<VideoSlot, VideoSource | null> }) {
  const { t } = useI18n();
  const s = t.session;
  const { restoreState } = sync;

  if (restoreState.status === "loading") {
    return (
      <p role="status" className="mt-2 flex items-center gap-2 text-xs text-muted">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary-soft/30 border-t-primary-soft" />
        {s.restoring}
      </p>
    );
  }
  if (restoreState.status === "error") {
    const notFound = restoreState.error.status === 404;
    return (
      <p role="alert" className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-rose-200">
        <Icon name="alert" size={13} />
        {notFound ? s.notFound : `${s.restoreFailed} ${apiErrorText(t, restoreState.error)}`}
        {!notFound && (
          <button type="button" onClick={() => void sync.restore(restoreState.id)} className="font-medium text-rose-100 underline-offset-2 hover:underline">
            {s.retry}
          </button>
        )}
      </p>
    );
  }

  const parts: ReactNode[] = [];
  if (sync.sessionId) {
    const name =
      sync.sessionName ?? (sources.reference && sources.current ? s.untitled(sources.reference.name, sources.current.name) : s.unnamed);
    parts.push(
      <span key="session" className="flex min-w-0 items-center gap-1.5 text-emerald-300">
        <Icon name="check" size={13} className="shrink-0" />
        <span className="truncate">
          {s.saved}: <span className="text-foreground">{name}</span>
        </span>
      </span>,
    );
  } else if (sources.reference || sources.current) {
    parts.push(
      <span key="local" className="text-muted">
        {s.notSaved}
      </span>,
    );
  }

  if (sync.sessionId && !sync.canSync && sync.pendingCount > 0) {
    parts.push(
      <span key="wait" className="text-muted">
        {s.waitingForUpload}
      </span>,
    );
  } else if (sync.canSync) {
    if (sync.saving) parts.push(<span key="saving" className="text-muted">{s.saving}</span>);
    else if (sync.pairErrorCount > 0)
      parts.push(
        <span key="failed" className="flex items-center gap-1.5 text-rose-200">
          {s.failed(sync.pairErrorCount)}
          <button type="button" onClick={sync.retryPairs} className="font-medium text-rose-100 underline-offset-2 hover:underline">
            {s.retry}
          </button>
        </span>,
      );
    else if (sync.pendingCount > 0) parts.push(<span key="pending" className="text-muted">{s.pending(sync.pendingCount)}</span>);
    else parts.push(<span key="ok" className="text-muted">{s.allSaved}</span>);
  }

  if (sync.sessionError) {
    parts.push(
      <span key="error" role="alert" className="text-rose-200">
        {s.error} {apiErrorText(t, sync.sessionError)}
      </span>,
    );
  }

  if (parts.length === 0) return null;
  return <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">{parts}</div>;
}
