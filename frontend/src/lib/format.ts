/** 75_250 ms -> "01:15.25" (or "01:15.250" with 3 decimals). */
export function formatTime(ms: number, decimals: 2 | 3 = 2): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalUnits = Math.round(ms / (decimals === 3 ? 1 : 10));
  const unitsPerSecond = decimals === 3 ? 1000 : 100;
  const minutes = Math.floor(totalUnits / (60 * unitsPerSecond));
  const seconds = Math.floor(totalUnits / unitsPerSecond) % 60;
  const fraction = totalUnits % unitsPerSecond;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(decimals, "0")}`;
}

/** Parses "75.5", "1:15.5" or "01:15.250" into whole milliseconds. Returns null if malformed. */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length > 2 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return null;
  if (parts.length === 2 && parts[0].includes(".")) return null;
  const seconds = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]);
  return Math.round(seconds * 1000);
}

/** +3_200 -> "+3.20s" */
export function formatOffset(ms: number): string {
  return `${ms >= 0 ? "+" : "−"}${(Math.abs(ms) / 1000).toFixed(2)}s`;
}

/** "2026-10-21T14:30:00Z" -> "Oct 21, 2026" (en-US), "21 thg 10, 2026" (vi-VN), "2026년 10월 21일" (ko-KR) */
export function formatDate(iso: string, locale = "en-US"): string {
  return new Date(iso).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** 12_582_912 -> "12.0 MB" */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
