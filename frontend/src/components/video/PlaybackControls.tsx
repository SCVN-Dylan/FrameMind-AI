"use client";

import { useState, type CSSProperties } from "react";

import Icon from "@/components/ui/Icon";
import type { VideoPlayerControls } from "@/hooks/useVideoPlayer";
import { formatTime, parseTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { VideoPlayerState } from "@/lib/types";
import { FRAME_STEP_MS, PLAYBACK_RATES } from "@/lib/video";

type PlaybackControlsProps = {
  state: VideoPlayerState;
  controls: VideoPlayerControls;
  disabled: boolean;
};

const iconButton =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

/** Play/pause, frame step, time, volume, mute, speed and "jump to" for one video. */
export default function PlaybackControls({ state, controls, disabled }: PlaybackControlsProps) {
  const { currentMs, durationMs, playing, volume, muted, playbackRate } = state;
  const { t } = useI18n();
  const effectiveVolume = muted ? 0 : volume;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex items-center gap-1">
        <button type="button" className={iconButton} disabled={disabled} onClick={() => controls.step(-FRAME_STEP_MS)} aria-label={t.video.prevFrame} title={t.video.prevFrame}>
          <Icon name="stepBack" size={16} />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={controls.toggle}
          aria-label={playing ? t.video.pause : t.video.play}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white shadow-md shadow-primary/30 transition-transform hover:scale-105 disabled:pointer-events-none disabled:opacity-40"
        >
          <Icon name={playing ? "pause" : "play"} size={15} />
        </button>
        <button type="button" className={iconButton} disabled={disabled} onClick={() => controls.step(FRAME_STEP_MS)} aria-label={t.video.nextFrame} title={t.video.nextFrame}>
          <Icon name="stepForward" size={16} />
        </button>
        <span className="ml-2 font-mono text-xs whitespace-nowrap text-muted tabular-nums">
          <span className="text-foreground">{formatTime(currentMs)}</span> / {formatTime(durationMs)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={iconButton}
            disabled={disabled}
            onClick={controls.toggleMute}
            aria-label={muted ? t.video.unmute : t.video.mute}
            title={muted ? t.video.unmute : t.video.mute}
          >
            <Icon name={effectiveVolume === 0 ? "volumeOff" : "volume"} size={16} />
          </button>
          <input
            type="range"
            aria-label={t.video.volume}
            className="seek-range w-16 sm:w-20"
            style={{ "--progress": `${effectiveVolume * 100}%` } as CSSProperties}
            min={0}
            max={1}
            step={0.05}
            value={effectiveVolume}
            disabled={disabled}
            onChange={(event) => controls.setVolume(Number(event.target.value))}
          />
        </div>
        <select
          aria-label={t.video.speed}
          title={t.video.speed}
          value={playbackRate}
          disabled={disabled}
          onChange={(event) => controls.setPlaybackRate(Number(event.target.value))}
          className="h-8 rounded-lg border border-border bg-background px-1.5 font-mono text-xs text-foreground focus:border-primary-soft focus:outline-none disabled:opacity-40"
        >
          {PLAYBACK_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}×
            </option>
          ))}
        </select>
        <JumpToTime disabled={disabled} durationMs={durationMs} onSeek={controls.seek} />
      </div>
    </div>
  );
}

function JumpToTime({ disabled, durationMs, onSeek }: { disabled: boolean; durationMs: number; onSeek: (ms: number) => void }) {
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const { t } = useI18n();

  function submit() {
    const ms = parseTime(text);
    if (ms === null || ms > durationMs) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSeek(ms);
    setText("");
  }

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
        placeholder="mm:ss.ss"
        aria-label={t.video.jumpTo}
        aria-invalid={invalid}
        className={`h-8 w-22 rounded-lg border bg-background px-2 font-mono text-xs text-foreground placeholder:text-muted/60 focus:outline-none disabled:opacity-40 ${
          invalid ? "border-rose-400/70" : "border-border focus:border-primary-soft"
        }`}
      />
      <button
        type="submit"
        disabled={disabled || text.trim() === ""}
        className="h-8 rounded-lg border border-border px-2.5 text-xs text-muted transition-colors hover:border-primary-soft/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        {t.video.go}
      </button>
    </form>
  );
}
