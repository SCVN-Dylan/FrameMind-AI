"use client";

import { useCallback, useState } from "react";

import { momentEndMs, validateMoment, type MomentDraft, type MomentError, type VideoDurations } from "@/lib/analysis";
import type { MatchedMoment, MomentKind } from "@/lib/types";

const cleanDescription = (text?: string) => text?.trim() || undefined;

const startOf = (m: MatchedMoment) => (m.kind === "frame" ? m.referenceMs : m.referenceStartMs);
const byReferenceStart = (a: MatchedMoment, b: MatchedMoment) => startOf(a) - startOf(b);

/**
 * Frame pairs and clip pairs the user marked, plus the selected one of each kind.
 * Both kinds live in one list so switching analysis mode never deletes anything.
 * This is the local source of truth; useSessionSync mirrors it to the backend. Ids are UUIDs so the
 * backend can store them as-is (and a retried save can't create a duplicate).
 */
export function useMatchedMoments() {
  const [moments, setMoments] = useState<MatchedMoment[]>([]);
  const [selected, setSelected] = useState<Record<MomentKind, string | null>>({ frame: null, clip: null });

  const select = useCallback((kind: MomentKind, id: string | null) => {
    setSelected((prev) => ({ ...prev, [kind]: id }));
  }, []);

  const add = useCallback(
    (draft: MomentDraft, durations: VideoDurations): MomentError | null => {
      const error = validateMoment(draft, moments, durations);
      if (error) return error;
      const moment = { ...draft, id: crypto.randomUUID(), description: cleanDescription(draft.description) } as MatchedMoment;
      setMoments((prev) => [...prev, moment].sort(byReferenceStart));
      setSelected((prev) => ({ ...prev, [moment.kind]: moment.id }));
      return null;
    },
    [moments],
  );

  const update = useCallback(
    (id: string, draft: MomentDraft, durations: VideoDurations): MomentError | null => {
      const error = validateMoment(draft, moments, durations, id);
      if (error) return error;
      setMoments((prev) =>
        prev
          .map((m) => (m.id === id ? ({ ...draft, id, description: cleanDescription(draft.description) } as MatchedMoment) : m))
          .sort(byReferenceStart),
      );
      return null;
    },
    [moments],
  );

  const remove = useCallback((id: string) => {
    setMoments((prev) => prev.filter((m) => m.id !== id));
    setSelected((prev) => ({ frame: prev.frame === id ? null : prev.frame, clip: prev.clip === id ? null : prev.clip }));
  }, []);

  const clear = useCallback((kind: MomentKind) => {
    setMoments((prev) => prev.filter((m) => m.kind !== kind));
    setSelected((prev) => ({ ...prev, [kind]: null }));
  }, []);

  /**
   * Drops moments that no longer fit a (replaced) video. Returns how many were removed.
   * Moments that still fit are kept, since the user may have replaced the file with a re-export.
   */
  const prune = useCallback(
    (side: "reference" | "current", durationMs: number): number => {
      const invalidIds = new Set(moments.filter((m) => momentEndMs(m, side) > durationMs).map((m) => m.id));
      if (invalidIds.size === 0) return 0;
      setMoments((prev) => prev.filter((m) => !invalidIds.has(m.id)));
      setSelected((prev) => ({
        frame: prev.frame && invalidIds.has(prev.frame) ? null : prev.frame,
        clip: prev.clip && invalidIds.has(prev.clip) ? null : prev.clip,
      }));
      return invalidIds.size;
    },
    [moments],
  );

  /** Replaces everything (restoring a saved session). Selection is cleared. */
  const replaceAll = useCallback((next: MatchedMoment[]) => {
    setMoments([...next].sort(byReferenceStart));
    setSelected({ frame: null, clip: null });
  }, []);

  return { moments, selected, select, add, update, remove, clear, prune, replaceAll };
}

export type MatchedMomentsApi = ReturnType<typeof useMatchedMoments>;
