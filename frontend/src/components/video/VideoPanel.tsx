"use client";

import { useState } from "react";

import { Card } from "@/components/ui/Card";
import Icon, { type IconName } from "@/components/ui/Icon";
import type { UploadState } from "@/hooks/useSessionSync";
import type { VideoPlayerApi } from "@/hooks/useVideoPlayer";
import type { TimelineHighlight } from "@/lib/analysis";
import { apiErrorText } from "@/lib/api-errors";
import { formatFileSize, formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { VideoFileError, VideoSource } from "@/lib/types";
import { MAX_VIDEO_SIZE_BYTES, VIDEO_ACCEPT, validateVideoFile } from "@/lib/video";

import PlaybackControls from "./PlaybackControls";
import VideoDropzone from "./VideoDropzone";
import VideoPlayer from "./VideoPlayer";
import VideoTimeline, { type TimelineMarker } from "./VideoTimeline";

/** Something selected elsewhere (e.g. a feedback item) to call out on this player. */
export type PlayerHighlight = { ringClassName: string; dotClassName: string; text: string };

type VideoPanelProps = {
  title: string;
  uploadHint: string;
  icon: IconName;
  iconClassName: string;
  /** Progress fill color of this video's timeline. */
  accentClassName: string;
  /** Analysed-area colors on the timeline (band and single-frame point). */
  highlightClassName: string;
  pointClassName: string;
  analysisHighlight: TimelineHighlight | null;
  source: VideoSource | null;
  onFileChange: (file: File | null) => void;
  /** Upload of this video to the backend. */
  upload: UploadState;
  onRetryUpload: () => void;
  player: VideoPlayerApi;
  markers: TimelineMarker[];
  selectedMarkerId: string | null;
  onSelectMarker: (id: string) => void;
  highlight: PlayerHighlight | null;
};

export default function VideoPanel(props: VideoPanelProps) {
  const { title, uploadHint, icon, iconClassName, source, onFileChange, player, highlight } = props;
  const { state, controls } = player;
  const [fileError, setFileError] = useState<{ code: VideoFileError; name: string } | null>(null);
  const { t } = useI18n();

  const ready = state.status === "ready";
  const fileErrorText = fileError
    ? fileError.code === "tooLarge"
      ? t.video.fileErrors.tooLarge(fileError.name, formatFileSize(MAX_VIDEO_SIZE_BYTES))
      : t.video.fileErrors[fileError.code](fileError.name)
    : null;

  function selectFile(next: File) {
    const code = validateVideoFile(next);
    if (code) {
      setFileError({ code, name: next.name });
      return;
    }
    setFileError(null);
    onFileChange(next);
  }

  const details = source
    ? [
        source.name,
        formatFileSize(source.sizeBytes),
        ready && state.width > 0 && `${state.width}×${state.height}`,
        ready && formatTime(state.durationMs),
      ]
        .filter(Boolean)
        .join(" · ")
    : t.video.noVideo;

  return (
    <Card className={`flex min-w-0 flex-col transition-shadow duration-300 ${highlight ? `ring-1 ${highlight.ringClassName}` : ""}`}>
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-raised ${iconClassName}`}>
            <Icon name={icon} size={17} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="truncate text-xs text-muted" title={source?.name}>
              {details}
            </p>
          </div>
        </div>
        {source && (
          <div className="flex shrink-0 items-center gap-1">
            <FilePickerButton label={t.video.replace} onSelect={selectFile} />
            <button
              type="button"
              onClick={() => {
                setFileError(null);
                onFileChange(null);
              }}
              aria-label={t.video.remove(title)}
              title={t.video.remove(title)}
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-rose-400/10 hover:text-rose-300"
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
      </div>

      {source && <UploadStatus upload={props.upload} onRetry={props.onRetryUpload} />}

      {source && fileErrorText && (
        <p role="alert" className="mx-4 mb-3 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
          {fileErrorText}
        </p>
      )}

      <div className="px-4">
        {source ? (
          <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-black">
            <VideoPlayer source={source} player={player} />

            {state.status === "loading" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-sm text-muted">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary-soft/30 border-t-primary-soft" />
                {t.video.loading}
              </div>
            )}

            {state.status === "error" && state.loadError && (
              <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center">
                <Icon name="alert" size={24} className="text-rose-300" />
                <p className="max-w-sm text-sm text-rose-200">{t.video.loadErrors[state.loadError]}</p>
                <FilePickerButton label={t.video.chooseAnother} onSelect={selectFile} prominent />
              </div>
            )}

            {highlight && ready && (
              <div className="pointer-events-none absolute top-3 left-3 flex max-w-[85%] items-center gap-2 rounded-lg border border-white/10 bg-black/70 px-2.5 py-1.5 text-xs text-white backdrop-blur">
                <span className={`h-2 w-2 shrink-0 rounded-full ${highlight.dotClassName}`} />
                <span className="truncate">{highlight.text}</span>
              </div>
            )}
          </div>
        ) : (
          <VideoDropzone
            label={title}
            hint={uploadHint}
            icon={icon}
            iconClassName={iconClassName}
            error={fileErrorText}
            onSelect={selectFile}
          />
        )}
      </div>

      <div className="flex flex-col gap-3 px-4 pt-2 pb-4">
        <VideoTimeline
          label={t.video.timeline(title)}
          durationMs={state.durationMs}
          currentMs={state.currentMs}
          markers={props.markers}
          selectedMarkerId={props.selectedMarkerId}
          disabled={!ready}
          onSeek={controls.seek}
          onSeekBy={controls.seekBy}
          onSelectMarker={props.onSelectMarker}
          accentClassName={props.accentClassName}
          analysisHighlight={props.analysisHighlight}
          highlightClassName={props.highlightClassName}
          pointClassName={props.pointClassName}
        />
        <PlaybackControls state={state} controls={controls} disabled={!ready} />
        {state.playError && (
          <p role="alert" className="text-xs text-amber-200">
            {t.video.playErrors[state.playError]}
          </p>
        )}
      </div>
    </Card>
  );
}

/** Upload progress / result for this video. Local playback keeps working whatever the upload does. */
function UploadStatus({ upload, onRetry }: { upload: UploadState; onRetry: () => void }) {
  const { t } = useI18n();
  if (upload.status === "idle") return null;

  if (upload.status === "error") {
    return (
      <div role="alert" className="mx-4 mb-3 flex items-start justify-between gap-3 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
        <span className="flex min-w-0 items-start gap-2">
          <Icon name="alert" size={14} className="mt-px shrink-0" />
          <span>
            {t.upload.failed} {apiErrorText(t, upload.error)} <span className="text-rose-200/70">{t.upload.localOnly}</span>
          </span>
        </span>
        <button type="button" onClick={onRetry} className="shrink-0 font-medium text-rose-100 underline-offset-2 hover:underline">
          {t.upload.retry}
        </button>
      </div>
    );
  }

  if (upload.status === "saved") {
    return (
      <p className="mx-4 mb-3 flex items-center gap-1.5 text-xs text-emerald-300">
        <Icon name="check" size={13} /> {t.upload.saved}
      </p>
    );
  }

  const percent = upload.status === "uploading" ? Math.round(upload.progress * 100) : 100;
  return (
    <div role="status" className="mx-4 mb-3 flex flex-col gap-1.5">
      <p className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary-soft/30 border-t-primary-soft" />
          {upload.status === "uploading" ? t.upload.uploading : t.upload.verifying}
        </span>
        <span className="font-mono tabular-nums">{percent}%</span>
      </p>
      <div className="h-1 overflow-hidden rounded-full bg-surface-raised">
        <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function FilePickerButton({ label, onSelect, prominent = false }: { label: string; onSelect: (file: File) => void; prominent?: boolean }) {
  return (
    <label
      className={`cursor-pointer rounded-lg px-2.5 py-1.5 text-xs transition-colors focus-within:ring-2 focus-within:ring-primary-soft/40 ${
        prominent
          ? "border border-border bg-surface-raised text-foreground hover:border-primary-soft/50"
          : "text-muted hover:bg-surface-raised hover:text-foreground"
      }`}
    >
      {label}
      <input
        type="file"
        accept={VIDEO_ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const next = event.target.files?.[0];
          if (next) onSelect(next);
          event.target.value = "";
        }}
      />
    </label>
  );
}
