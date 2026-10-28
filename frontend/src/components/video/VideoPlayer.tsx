"use client";

import { useLayoutEffect, useRef } from "react";

import type { VideoPlayerApi } from "@/hooks/useVideoPlayer";
import type { VideoSource } from "@/lib/types";

type VideoPlayerProps = {
  source: VideoSource;
  player: Pick<VideoPlayerApi, "videoRef" | "events">;
};

/**
 * Plays a local video file (browser object URL) or a video streamed from the backend.
 *
 * The object URL is created when the player becomes visible and revoked in the effect cleanup.
 * That cleanup runs when the file is replaced, when it is removed (unmount), and also when Next.js
 * hides this page with React <Activity> (Cache Components). On re-show we create a fresh URL and
 * resume from the last position, so memory is released while the user is on another page.
 * Backend videos are streamed with HTTP range requests, so seeking works without downloading everything.
 */
export default function VideoPlayer({ source, player }: VideoPlayerProps) {
  const { videoRef, events } = player;
  const resumeRef = useRef<{ source: VideoSource | null; time: number }>({ source: null, time: 0 });

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (resumeRef.current.source !== source) resumeRef.current = { source, time: 0 };

    const url = source.kind === "file" ? URL.createObjectURL(source.file) : source.url;
    const resumeAt = resumeRef.current.time;
    const onLoaded = () => {
      if (resumeAt > 0 && Number.isFinite(video.duration) && resumeAt < video.duration) video.currentTime = resumeAt;
    };
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.src = url;

    return () => {
      resumeRef.current.time = video.currentTime;
      video.removeEventListener("loadedmetadata", onLoaded);
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (source.kind === "file") URL.revokeObjectURL(url);
    };
  }, [source, videoRef]);

  return (
    <video
      ref={videoRef}
      playsInline
      preload="metadata"
      className="h-full w-full bg-black object-contain"
      {...events}
    />
  );
}
