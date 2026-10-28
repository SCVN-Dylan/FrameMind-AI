"use client";

import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";

import { clamp } from "@/lib/format";
import type { VideoPlayerState } from "@/lib/types";
import { toVideoLoadError } from "@/lib/video";

export const INITIAL_PLAYER_STATE: VideoPlayerState = {
  status: "empty",
  loadError: null,
  playError: null,
  currentMs: 0,
  durationMs: 0,
  playing: false,
  volume: 1,
  muted: false,
  playbackRate: 1,
  width: 0,
  height: 0,
};

type VideoEvent = SyntheticEvent<HTMLVideoElement>;

export type VideoPlayerControls = {
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => void;
  seek: (ms: number) => void;
  /** Seek relative to the element's actual position (safe for rapid repeated calls). */
  seekBy: (deltaMs: number) => void;
  /** Pause, then seek relative to the current position (frame stepping). */
  step: (deltaMs: number) => void;
  restart: () => Promise<void>;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (rate: number) => void;
  /** Back to the empty state (call when the file is removed or replaced). */
  reset: () => void;
};

export type VideoPlayerApi = ReturnType<typeof useVideoPlayer>;

type UseVideoPlayerOptions = {
  /** Called each time a video finishes loading, with its real duration (ms). */
  onReady?: (durationMs: number) => void;
};

/**
 * State + imperative controls for one native <video> element.
 *
 * The element is the source of truth; its media events are mirrored into React state. State updates
 * that change nothing are skipped, so `timeupdate` while paused doesn't re-render the page.
 */
export function useVideoPlayer({ onReady }: UseVideoPlayerOptions = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<VideoPlayerState>(INITIAL_PLAYER_STATE);
  // Latest callback, read from the (stable) event handlers below.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });
  /** True while working around a WebM file that reports duration = Infinity. */
  const fixingDurationRef = useRef(false);

  const { controls, events } = useMemo(() => {
    const update = (patch: Partial<VideoPlayerState>) =>
      setState((prev) => {
        for (const key in patch) {
          if (patch[key as keyof VideoPlayerState] !== prev[key as keyof VideoPlayerState]) return { ...prev, ...patch };
        }
        return prev;
      });

    const readPlayback = (video: HTMLVideoElement): Partial<VideoPlayerState> => ({
      currentMs: Math.round(video.currentTime * 1000),
      durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0,
      playing: !video.paused && !video.ended,
      volume: video.volume,
      muted: video.muted,
      playbackRate: video.playbackRate,
    });

    const sync = (event: VideoEvent) => update(readPlayback(event.currentTarget));

    const markReady = (video: HTMLVideoElement) => {
      // readPlayback keeps volume/speed, so choices survive reloading the same file.
      update({ ...readPlayback(video), status: "ready", width: video.videoWidth, height: video.videoHeight });
      onReadyRef.current?.(Math.round(video.duration * 1000));
    };

    const play = async () => {
      const video = videoRef.current;
      if (!video || !video.getAttribute("src")) return;
      try {
        await video.play();
        update({ playError: null });
      } catch (error) {
        // AbortError = play() was interrupted by pause() or a new source. That's expected, not a failure.
        if (error instanceof DOMException && error.name === "AbortError") return;
        const blocked = error instanceof DOMException && error.name === "NotAllowedError";
        update({ playError: blocked ? "blocked" : "failed", playing: false });
      }
    };

    const seek = (ms: number) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration)) return;
      video.currentTime = clamp(ms, 0, video.duration * 1000) / 1000;
      // Update immediately so timelines feel responsive while dragging; `seeked` confirms it.
      update({ currentMs: Math.round(video.currentTime * 1000) });
    };

    const controls: VideoPlayerControls = {
      play,
      pause: () => videoRef.current?.pause(),
      toggle: () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused || video.ended) void play();
        else video.pause();
      },
      seek,
      seekBy: (deltaMs) => {
        const video = videoRef.current;
        if (video) seek(video.currentTime * 1000 + deltaMs);
      },
      step: (deltaMs) => {
        const video = videoRef.current;
        if (!video) return;
        video.pause();
        seek(video.currentTime * 1000 + deltaMs);
      },
      restart: async () => {
        seek(0);
        await play();
      },
      setVolume: (volume) => {
        const video = videoRef.current;
        if (!video) return;
        video.volume = clamp(volume, 0, 1);
        video.muted = volume === 0;
      },
      toggleMute: () => {
        const video = videoRef.current;
        if (!video) return;
        video.muted = !video.muted;
        if (!video.muted && video.volume === 0) video.volume = 0.5;
      },
      setPlaybackRate: (rate) => {
        if (videoRef.current) videoRef.current.playbackRate = rate;
      },
      reset: () => {
        fixingDurationRef.current = false;
        setState(INITIAL_PLAYER_STATE);
      },
    };

    const events = {
      onLoadStart: (event: VideoEvent) => {
        // Fires when a new src is set. Ignore the empty src set during cleanup.
        if (!event.currentTarget.getAttribute("src")) return;
        update({ status: "loading", loadError: null, playError: null });
      },
      onLoadedMetadata: (event: VideoEvent) => {
        const video = event.currentTarget;
        if (!Number.isFinite(video.duration)) {
          // Some WebM files (e.g. made with MediaRecorder) don't store their duration. Seeking far
          // past the end makes the browser scan the file and fire `durationchange` with the real value.
          fixingDurationRef.current = true;
          video.currentTime = Number.MAX_SAFE_INTEGER;
          return;
        }
        markReady(video);
      },
      onDurationChange: (event: VideoEvent) => {
        const video = event.currentTarget;
        if (fixingDurationRef.current && Number.isFinite(video.duration)) {
          fixingDurationRef.current = false;
          video.currentTime = 0;
          markReady(video);
          return;
        }
        sync(event);
      },
      onError: (event: VideoEvent) => {
        const video = event.currentTarget;
        if (!video.getAttribute("src")) return; // src removed on cleanup, not a real error
        update({ status: "error", loadError: toVideoLoadError(video.error), playing: false });
      },
      onTimeUpdate: (event: VideoEvent) => {
        if (!fixingDurationRef.current) sync(event);
      },
      onSeeked: (event: VideoEvent) => {
        if (!fixingDurationRef.current) sync(event);
      },
      onPlay: sync,
      onPause: sync,
      onEnded: sync,
      onVolumeChange: sync,
      onRateChange: sync,
    };

    return { controls, events };
  }, []);

  return { videoRef, state, controls, events };
}
