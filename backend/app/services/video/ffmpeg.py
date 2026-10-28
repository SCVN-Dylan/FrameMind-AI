"""FFmpeg / FFprobe wrappers.

Every call uses an argument list (never a shell string) and a timeout. Times passed in and returned are
integer milliseconds in the source video. Timestamps of extracted frames come from FFmpeg's `showinfo`
filter, so they are the real presentation times of the decoded frames (correct for variable frame rate too).
"""

import json
import logging
import re
import shutil
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_PTS_TIME = re.compile(r"\bn:\s*\d+\s+pts:\s*-?\d+\s+pts_time:(-?[\d.]+)")


class FFmpegUnavailableError(RuntimeError):
    """ffmpeg or ffprobe is not installed / not on PATH."""


class FFmpegError(RuntimeError):
    """FFmpeg ran but failed (bad input, unsupported codec, ...)."""


class FFmpegTimeoutError(FFmpegError):
    pass


@dataclass(frozen=True)
class ProbeResult:
    duration_ms: int
    width: int
    height: int
    fps: Optional[float]
    codec: str
    container: str


def is_ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _binary(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise FFmpegUnavailableError(f"{name} is not installed or not on PATH.")
    return path


def _run(args: Sequence[str], timeout: float) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(list(args), capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise FFmpegTimeoutError(f"{Path(args[0]).name} timed out after {timeout:.0f}s") from exc
    except FileNotFoundError as exc:
        raise FFmpegUnavailableError(f"{args[0]} could not be started.") from exc


def _last_error_line(stderr: str) -> str:
    lines = [line.strip() for line in stderr.splitlines() if line.strip()]
    return lines[-1][:300] if lines else "unknown error"


def _parse_rate(value: Optional[str]) -> Optional[float]:
    try:
        rate = Fraction(value or "0")
    except (ValueError, ZeroDivisionError):
        return None
    return round(float(rate), 3) if rate > 0 else None


def probe(path: Path) -> ProbeResult:
    """Reads container + first video stream metadata. Raises FFmpegError if there is no usable video stream."""
    settings = get_settings()
    result = _run(
        [
            _binary("ffprobe"),
            "-v", "error",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            "-select_streams", "v:0",
            str(path),
        ],
        settings.ffprobe_timeout_seconds,
    )
    if result.returncode != 0:
        raise FFmpegError(f"ffprobe could not read the file: {_last_error_line(result.stderr)}")
    try:
        data = json.loads(result.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise FFmpegError("ffprobe returned invalid output.") from exc

    streams = data.get("streams") or []
    fmt = data.get("format") or {}
    if not streams:
        raise FFmpegError("The file contains no video stream.")
    stream = streams[0]

    duration_s = None
    for candidate in (fmt.get("duration"), stream.get("duration")):
        try:
            duration_s = float(candidate)
            break
        except (TypeError, ValueError):
            continue
    width, height = int(stream.get("width") or 0), int(stream.get("height") or 0)
    if not duration_s or duration_s <= 0:
        raise FFmpegError("Could not determine the video duration.")
    if width <= 0 or height <= 0:
        raise FFmpegError("Could not determine the video resolution.")

    return ProbeResult(
        duration_ms=int(round(duration_s * 1000)),
        width=width,
        height=height,
        # avg_frame_rate is the real average for variable-frame-rate captures; r_frame_rate is the fallback.
        fps=_parse_rate(stream.get("avg_frame_rate")) or _parse_rate(stream.get("r_frame_rate")),
        codec=str(stream.get("codec_name") or "unknown"),
        container=str(fmt.get("format_name") or ""),
    )


def verify_decodable(path: Path) -> None:
    """Decodes the first video frame. Raises FFmpegError for corrupt files or codecs FFmpeg can't decode."""
    settings = get_settings()
    result = _run(
        [_binary("ffmpeg"), "-nostdin", "-v", "error", "-i", str(path), "-map", "0:v:0", "-frames:v", "1", "-f", "null", "-"],
        settings.ffprobe_timeout_seconds,
    )
    if result.returncode != 0:
        raise FFmpegError(f"The video could not be decoded: {_last_error_line(result.stderr)}")


def _seconds(ms: int) -> str:
    return f"{ms / 1000:.3f}"


def _scale_filter() -> str:
    width = get_settings().frame_max_width
    # Never upscale; keep the aspect ratio with an even height.
    return f"scale='min({width},iw)':-2"


def _pts_times(stderr: str) -> List[float]:
    return [float(match.group(1)) for match in _PTS_TIME.finditer(stderr)]


def _extract(args: List[str]) -> Tuple[List[float], str]:
    result = _run([_binary("ffmpeg"), "-nostdin", "-hide_banner", "-y", *args], get_settings().ffmpeg_timeout_seconds)
    if result.returncode != 0:
        raise FFmpegError(f"FFmpeg failed: {_last_error_line(result.stderr)}")
    return _pts_times(result.stderr), result.stderr


def extract_frame(video: Path, timestamp_ms: int, output: Path) -> int:
    """Writes the frame shown at `timestamp_ms` as a JPEG. Returns the frame's exact source timestamp (ms).

    A timestamp at the very end of a video may lie after the last frame; then the last frame is used.
    """
    if not video.is_file():
        raise FFmpegError(f"Video file is missing: {video.name}")
    output.parent.mkdir(parents=True, exist_ok=True)

    try:
        times, _ = _extract(
            ["-ss", _seconds(timestamp_ms), "-i", str(video), "-map", "0:v:0", "-an",
             "-vf", f"{_scale_filter()},showinfo", "-frames:v", "1", "-q:v", "2", str(output)]
        )
        if output.is_file() and times:
            return timestamp_ms + int(round(times[0] * 1000))
    except FFmpegTimeoutError:
        raise
    except FFmpegError:
        # FFmpeg exits with an error when the seek lands after the last frame ("no packets"). Fall through.
        output.unlink(missing_ok=True)

    # Past the last frame: decode the final second and keep overwriting one image, so the last frame wins.
    start_ms = max(0, timestamp_ms - 1000)
    times, _ = _extract(
        ["-ss", _seconds(start_ms), "-i", str(video), "-t", "1.1", "-map", "0:v:0", "-an",
         "-vf", f"{_scale_filter()},showinfo", "-update", "1", "-q:v", "2", str(output)]
    )
    if not output.is_file() or not times:
        raise FFmpegError(f"No frame could be extracted at {timestamp_ms} ms.")
    return start_ms + int(round(times[-1] * 1000))


def sampling_interval_ms(start_ms: int, end_ms: int, sample_fps: float, max_frames: int) -> float:
    """Spacing between sampled frames: `sample_fps`, widened so a clip never yields more than `max_frames`."""
    interval = 1000 / sample_fps
    length = end_ms - start_ms
    if length / interval > max_frames:
        interval = length / max_frames
    return interval


def extract_sequence(
    video: Path, start_ms: int, end_ms: int, output_dir: Path, prefix: str, sample_fps: float, max_frames: int
) -> List[Tuple[Path, int]]:
    """Samples frames from [start_ms, end_ms) at roughly `sample_fps`. Returns (image, source timestamp ms) in order.

    Frames are chosen by their real timestamps (`select` on t), so spacing follows the actual frames even
    for variable frame rate. The first image is always the frame at `start_ms`.
    """
    if not video.is_file():
        raise FFmpegError(f"Video file is missing: {video.name}")
    if end_ms <= start_ms:
        raise FFmpegError("Clip end must be after its start.")
    output_dir.mkdir(parents=True, exist_ok=True)

    interval_s = sampling_interval_ms(start_ms, end_ms, sample_fps, max_frames) / 1000
    length_s = (end_ms - start_ms) / 1000
    # Take the first frame at or after each grid point k * interval (k = frames selected so far). Anchoring
    # to the grid avoids drift: spacing stays ~interval on average whatever the source frame rate.
    select = f"select='lt(t\\,{length_s:.3f})*gte(t\\,selected_n*{interval_s:.6f}-0.001)'"
    pattern = output_dir / f"{prefix}_%03d.jpg"
    times, _ = _extract(
        ["-ss", _seconds(start_ms), "-i", str(video), "-t", f"{length_s + 0.1:.3f}", "-map", "0:v:0", "-an",
         "-vf", f"{select},{_scale_filter()},showinfo", "-fps_mode", "passthrough",
         "-frames:v", str(max_frames), "-q:v", "3", str(pattern)]
    )
    files = sorted(output_dir.glob(f"{prefix}_*.jpg"))
    if not files:
        raise FFmpegError(f"No frames could be extracted between {start_ms} and {end_ms} ms.")
    if len(times) < len(files):
        raise FFmpegError("Could not read the timestamps of the extracted frames.")
    return [(path, start_ms + int(round(t * 1000))) for path, t in zip(files, times)]
