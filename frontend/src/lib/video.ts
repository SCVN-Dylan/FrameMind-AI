// Local video file rules. Files stay in browser memory (no upload yet), so the size limit is
// about keeping the tab responsive, not about the server.

import type { VideoFileError, VideoLoadError } from "./types";

export const MAX_VIDEO_SIZE_BYTES = 1024 * 1024 * 1024; // 1 GB

/** Containers that browsers can generally play. Actual playback still depends on the codec. */
const ALLOWED_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/ogg", "video/x-m4v"];
const ALLOWED_EXTENSIONS = ["mp4", "m4v", "webm", "mov", "ogv", "ogg"];

/** Value for <input type="file" accept>. */
export const VIDEO_ACCEPT = [...ALLOWED_MIME_TYPES, ...ALLOWED_EXTENSIONS.map((ext) => `.${ext}`)].join(",");

/** Frame step size. The real frame rate is unknown in the browser, so assume 30 fps. */
export const FRAME_STEP_MS = Math.round(1000 / 30);

export const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2] as const;

export function validateVideoFile(file: File): VideoFileError | null {
  if (file.size === 0) return "empty";

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = file.type.toLowerCase();
  const allowedMime = ALLOWED_MIME_TYPES.includes(mime);
  const allowedExtension = ALLOWED_EXTENSIONS.includes(extension);

  if (!mime.startsWith("video/") && !allowedExtension) return "notVideo";
  // A video, but in a container browsers can't play (e.g. .avi, .mkv, .wmv, .flv).
  if (!allowedMime && !allowedExtension) return "unsupportedFormat";
  if (file.size > MAX_VIDEO_SIZE_BYTES) return "tooLarge";
  return null;
}

/** Maps the browser's MediaError code to our error type. */
export function toVideoLoadError(error: MediaError | null): VideoLoadError {
  switch (error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "aborted";
    case MediaError.MEDIA_ERR_NETWORK:
      return "network";
    case MediaError.MEDIA_ERR_DECODE:
      return "decode";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "unsupported";
    default:
      return "unknown";
  }
}
