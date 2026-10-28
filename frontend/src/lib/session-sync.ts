// Pure helpers for keeping frontend frame/clip pairs and the backend's matching pairs in step.

import type { ApiPair, ApiPairBody, ApiPairCreate } from "./api";
import type { MatchedMoment } from "./types";

export function pairToMoment(pair: ApiPair): MatchedMoment {
  const description = pair.event_description ?? undefined;
  if (pair.pair_type === "single_frame") {
    return {
      id: pair.id,
      kind: "frame",
      referenceMs: pair.reference_timestamp_ms ?? 0,
      currentMs: pair.current_timestamp_ms ?? 0,
      description,
    };
  }
  return {
    id: pair.id,
    kind: "clip",
    referenceStartMs: pair.reference_start_ms ?? 0,
    referenceEndMs: pair.reference_end_ms ?? 0,
    currentStartMs: pair.current_start_ms ?? 0,
    currentEndMs: pair.current_end_ms ?? 0,
    description,
  };
}

/** Body for PATCH: all times of the pair's type plus the description. */
export function momentToBody(moment: MatchedMoment): ApiPairBody {
  const event_description = moment.description ?? null;
  if (moment.kind === "frame") {
    return { reference_timestamp_ms: moment.referenceMs, current_timestamp_ms: moment.currentMs, event_description };
  }
  return {
    reference_start_ms: moment.referenceStartMs,
    reference_end_ms: moment.referenceEndMs,
    current_start_ms: moment.currentStartMs,
    current_end_ms: moment.currentEndMs,
    event_description,
  };
}

/** Body for POST. The client-made id makes retries safe (the backend returns the existing pair). */
export function momentToCreate(moment: MatchedMoment): ApiPairCreate {
  return { id: moment.id, pair_type: moment.kind === "frame" ? "single_frame" : "short_clip", ...momentToBody(moment) };
}

/** Stable text form of what is saved for a moment; equal text = nothing to save. */
export function momentSignature(moment: MatchedMoment): string {
  return JSON.stringify(momentToCreate(moment));
}

/** Only the times (no description): extracted frames stay valid while this is unchanged. */
export function momentTimesKey(moment: MatchedMoment): string {
  return moment.kind === "frame"
    ? `${moment.id}:${moment.referenceMs}:${moment.currentMs}`
    : `${moment.id}:${moment.referenceStartMs}-${moment.referenceEndMs}:${moment.currentStartMs}-${moment.currentEndMs}`;
}

export type SyncOp =
  | { type: "create"; moment: MatchedMoment }
  | { type: "update"; moment: MatchedMoment }
  | { type: "delete"; id: string };

/** What has to be sent so the server (`saved`: id -> signature) matches the local moments. */
export function diffMoments(local: MatchedMoment[], saved: ReadonlyMap<string, string>): SyncOp[] {
  const ops: SyncOp[] = [];
  const localIds = new Set<string>();
  for (const moment of local) {
    localIds.add(moment.id);
    const signature = saved.get(moment.id);
    if (signature === undefined) ops.push({ type: "create", moment });
    else if (signature !== momentSignature(moment)) ops.push({ type: "update", moment });
  }
  for (const id of saved.keys()) if (!localIds.has(id)) ops.push({ type: "delete", id });
  return ops;
}
