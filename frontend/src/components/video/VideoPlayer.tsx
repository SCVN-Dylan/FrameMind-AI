"use client";

import { useLayoutEffect, useRef } from "react";

import type { VideoPlayerApi } from "@/hooks/useVideoPlayer";

type VideoPlayerProps = {
  file: File;
  player: Pick<VideoPlayerApi, "videoRef" | "events">;
};

/**
 * Plays a local video file using a browser object URL.
 *
 * The object URL is created when the player becomes visible and revoked in the effect cleanup.
 * That cleanup runs when the file is replaced, when it is removed (unmount), and also when Next.js
 * hides this page with React <Activity> (Cache Components). On re-show we create a fresh URL and
 * resume from the last position, so memory is released while the user is on another page.
 */
export default function VideoPlayer({ file, player }: VideoPlayerProps) {
  const { videoRef, events } = player;
  const resumeRef = useRef<{ file: File | null; time: number }>({ file: null, time: 0 });

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (resumeRef.current.file !== file) resumeRef.current = { file, time: 0 };

    const url = URL.createObjectURL(file);
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
      URL.revokeObjectURL(url);
    };
  }, [file, videoRef]);

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
