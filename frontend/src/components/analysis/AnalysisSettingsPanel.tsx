"use client";

import type { ReactNode } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import Icon, { type IconName } from "@/components/ui/Icon";
import type { MatchedMomentsApi } from "@/hooks/useMatchedMoments";
import type { MomentSaveStatus } from "@/hooks/useSessionSync";
import type { ApiError } from "@/lib/api";
import { modeKind, type AnalysisTargetResult, type VideoDurations } from "@/lib/analysis";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { AnalysisMode, MatchedMoment } from "@/lib/types";

import { ClipForm, FrameForm } from "./MomentForms";
import MomentList from "./MomentList";
import { formatSpan } from "./momentText";

const MODES: { id: AnalysisMode; icon: IconName }[] = [
  { id: "single_frame", icon: "camera" },
  { id: "short_clip", icon: "film" },
  { id: "full_video", icon: "video" },
];

type AnalysisSettingsPanelProps = {
  mode: AnalysisMode;
  onModeChange: (mode: AnalysisMode) => void;
  momentsApi: MatchedMomentsApi;
  /** Durations of the loaded videos (0 = not loaded). */
  durations: VideoDurations;
  referenceNowMs: number;
  currentNowMs: number;
  /** Select a moment for analysis and seek both videos to it. */
  onSelectMoment: (moment: MatchedMoment) => void;
  /** Backend save state per pair (undefined = not connected to a saved session yet). */
  momentStatus?: (id: string) => MomentSaveStatus;
  momentError?: (id: string) => ApiError | null;
  result: AnalysisTargetResult;
  /** Number of pairs removed after a video was replaced (0 = no notice). */
  prunedCount: number;
  onDismissPruned: () => void;
  onAnalyze: () => void;
  /** Why Analyze can't run right now (pair not saved, Codex unavailable, ...); null = ready. */
  analyzeBlocker: string | null;
  analyzing: boolean;
  /** Codex CLI status line shown under the button. */
  providerStatus: ReactNode;
};

/**
 * One place to decide what to analyse: pick a mode, mark the moment(s) for that mode in both videos,
 * then analyse. Frame pairs and clip pairs are separate lists; switching modes keeps both.
 */
export default function AnalysisSettingsPanel(props: AnalysisSettingsPanelProps) {
  const { mode, momentsApi, durations, result } = props;
  const { t } = useI18n();
  const a = t.analysis;
  const kind = modeKind(mode);
  const enabled = durations.referenceMs > 0 && durations.currentMs > 0;

  const issueText = !result.ok
    ? result.issue === "noPairs"
      ? kind === "clip"
        ? a.issues.noClipPairs
        : a.issues.noFramePairs
      : a.issues[result.issue]
    : null;

  return (
    <Card>
      <CardHeader title={a.title} description={a.description} action={<Icon name="sliders" size={20} className="text-primary-soft" />} />

      <div className="flex flex-col gap-5 px-5 pb-5">
        {/* Mode selector */}
        <div>
          <div role="radiogroup" aria-label={a.modeLabel} className="grid gap-2 sm:grid-cols-3">
            {MODES.map(({ id, icon }) => {
              const active = mode === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => props.onModeChange(id)}
                  className={`flex flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-primary-soft ${
                    active ? "border-primary-soft/70 bg-primary/15" : "border-border/80 bg-background/40 hover:border-primary-soft/40"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          active ? "border-primary-soft bg-primary-soft" : "border-muted/60"
                        }`}
                      >
                        {active && <span className="h-1.5 w-1.5 rounded-full bg-background" />}
                      </span>
                      {a.modes[id].title}
                    </span>
                    <Icon name={icon} size={15} className={active ? "text-primary-soft" : "text-muted"} />
                  </span>
                  <span className="text-xs leading-relaxed text-muted">{a.modes[id].text}</span>
                  {id === "full_video" && (
                    <span title={a.futureTooltip} className="self-start">
                      <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-200">{a.future}</Badge>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted">{a.modes[mode].bestFor}</p>
        </div>

        {props.prunedCount > 0 && (
          <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-xs text-amber-100">
            <span className="flex items-start gap-2">
              <Icon name="info" size={15} className="mt-px shrink-0" />
              {a.pruned(props.prunedCount)}
            </span>
            <button type="button" onClick={props.onDismissPruned} className="shrink-0 text-amber-200 underline-offset-2 hover:underline">
              {a.dismiss}
            </button>
          </div>
        )}

        {kind ? (
          <>
            <div className="flex flex-col gap-1.5 rounded-xl border border-primary-soft/25 bg-primary/10 px-3.5 py-2.5 text-xs leading-relaxed">
              <p className="flex items-start gap-2 text-primary-soft">
                <Icon name="sparkles" size={14} className="mt-px shrink-0" />
                {a.futureUse}
              </p>
              <p className="pl-[22px] text-muted">{kind === "frame" ? a.frameExample : a.clipExample}</p>
            </div>

            {kind === "frame" ? (
              <FrameForm
                referenceNowMs={props.referenceNowMs}
                currentNowMs={props.currentNowMs}
                durations={durations}
                enabled={enabled}
                onAdd={(draft) => momentsApi.add(draft, durations)}
              />
            ) : (
              <ClipForm
                referenceNowMs={props.referenceNowMs}
                currentNowMs={props.currentNowMs}
                durations={durations}
                enabled={enabled}
                onAdd={(draft) => momentsApi.add(draft, durations)}
              />
            )}

            <MomentList
              kind={kind}
              moments={momentsApi.moments.filter((m) => m.kind === kind)}
              selectedId={momentsApi.selected[kind]}
              durations={durations}
              enabled={enabled}
              onSelect={props.onSelectMoment}
              status={props.momentStatus}
              error={props.momentError}
              onUpdate={(id, draft) => momentsApi.update(id, draft, durations)}
              onRemove={momentsApi.remove}
              onClear={() => momentsApi.clear(kind)}
            />
          </>
        ) : (
          <FullVideoInfo durations={durations} />
        )}

        {/* Analyze: runs the local Codex CLI on the selected pair */}
        <div className="flex flex-col gap-2 border-t border-border/60 pt-5">
          <Button
            variant="primary"
            className="h-12 w-full text-base"
            disabled={!result.ok || props.analyzeBlocker !== null || props.analyzing}
            onClick={props.onAnalyze}
            title={t.ai.usageNote}
          >
            {props.analyzing ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Icon name="sparkles" size={18} />
            )}
            {a.buttons[mode]}
            <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide">{t.ai.source}</span>
          </Button>
          {issueText || props.analyzeBlocker ? (
            <p role="alert" className="text-center text-xs text-amber-200">
              {issueText ?? props.analyzeBlocker}
            </p>
          ) : (
            <p className="text-center text-xs text-muted">{t.ai.usageNote}</p>
          )}
          {props.providerStatus}
        </div>
      </div>
    </Card>
  );
}

function FullVideoInfo({ durations }: { durations: VideoDurations }) {
  const { t } = useI18n();
  const a = t.analysis;
  const loaded = durations.referenceMs > 0 && durations.currentMs > 0;
  return (
    <>
      {loaded && (
        <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-background/50 p-4">
          <h3 className="text-sm font-medium text-foreground">{a.fullTitle}</h3>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-primary-soft">{a.reference}</span>
            <span className="font-mono text-foreground tabular-nums">{formatSpan(0, durations.referenceMs)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-accent">{a.current}</span>
            <span className="font-mono text-foreground tabular-nums">{formatSpan(0, durations.currentMs)}</span>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-xs leading-relaxed text-amber-100">
        <p className="flex items-start gap-2">
          <Icon name="alert" size={15} className="mt-px shrink-0" />
          {a.fullWarning}
        </p>
        <p className="pl-[23px] text-amber-200/80">{a.fullFuture}</p>
      </div>
    </>
  );
}
