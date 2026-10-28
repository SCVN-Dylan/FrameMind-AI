"use client";

import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Icon from "@/components/ui/Icon";
import VideoPanel, { type PlayerHighlight } from "@/components/video/VideoPanel";
import { useMatchedMoments } from "@/hooks/useMatchedMoments";
import { useVideoPlayer, type VideoPlayerApi, type VideoPlayerControls } from "@/hooks/useVideoPlayer";
import { DEFAULT_ANALYSIS_SETTINGS, modeKind, momentStart, resolveAnalysisTarget, targetRange, timelineHighlight } from "@/lib/analysis";
import { SEVERITY_META } from "@/lib/feedback";
import { formatOffset, formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { createDemoFeedbackInRange } from "@/lib/mock-data";
import type { AnalysisMode, AnalysisSettings, AnalysisTarget, FeedbackItem, MatchedMoment, VideoSlot } from "@/lib/types";

import AnalysisSettingsPanel from "./AnalysisSettingsPanel";
import AnalysisTimeline from "./AnalysisTimeline";
import FeedbackPanel from "./FeedbackPanel";

export default function ComparisonWorkspace() {
  const momentsApi = useMatchedMoments();
  const [prunedCount, setPrunedCount] = useState(0);

  // When a (replaced) video loads, drop frame/clip pairs that no longer fit its length.
  const onReady = (slot: VideoSlot, durationMs: number) => {
    const removed = momentsApi.prune(slot, durationMs);
    if (removed > 0) setPrunedCount(removed);
  };
  const reference = useVideoPlayer({ onReady: (ms) => onReady("reference", ms) });
  const current = useVideoPlayer({ onReady: (ms) => onReady("current", ms) });
  const { language, t } = useI18n();

  const [files, setFiles] = useState<Record<VideoSlot, File | null>>({ reference: null, current: null });
  const [mode, setMode] = useState<AnalysisMode>(DEFAULT_ANALYSIS_SETTINGS.mode);
  /** What the last demo run covered; null = not analysed yet. Kept as a snapshot so results don't move. */
  const [analysis, setAnalysis] = useState<AnalysisTarget | null>(null);
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null);
  /** When set, both players move together. Value = current time − reference time (ms). */
  const [syncOffsetMs, setSyncOffsetMs] = useState<number | null>(null);

  const players: Record<VideoSlot, VideoPlayerApi> = { reference, current };
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
    setFiles((prev) => ({ ...prev, [slot]: file }));
    players[slot].controls.reset();
    // Demo results and sync no longer match the new video. Pairs are kept and checked against the
    // new duration once it loads (see onReady above).
    setAnalysis(null);
    setSelectedFeedbackId(null);
    setSyncOffsetMs(null);
    setPrunedCount(0);
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
    !files.reference && !files.current
      ? t.workspace.missingBoth
      : !files.reference
        ? t.workspace.missingReference
        : !files.current
          ? t.workspace.missingCurrent
          : t.workspace.ready;

  return (
    <div className="flex flex-col gap-6">
      {/* Toolbar */}
      <Card className="p-5">
        <h2 className="text-lg font-semibold text-foreground">{t.workspace.heading}</h2>
        <p className="mt-1 text-sm text-muted">{status}</p>
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
          file={files.reference}
          onFileChange={(file) => changeFile("reference", file)}
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
          file={files.current}
          onFileChange={(file) => changeFile("current", file)}
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
        result={targetResult}
        prunedCount={prunedCount}
        onDismissPruned={() => setPrunedCount(0)}
        onAnalyze={() => {
          if (!target) return;
          setAnalysis(target);
          setSelectedFeedbackId(null);
        }}
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
