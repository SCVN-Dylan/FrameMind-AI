"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  createPair,
  createSession,
  deletePair,
  getSession,
  updatePair,
  updateSession,
  uploadVideo,
  type ApiSession,
  type ApiSessionUpdate,
  type ApiVideo,
} from "@/lib/api";
import { diffMoments, momentSignature, momentToBody, momentToCreate, pairToMoment } from "@/lib/session-sync";
import type { AnalysisMode, MatchedMoment, VideoSlot } from "@/lib/types";

export type UploadState =
  | { status: "idle" }
  | { status: "uploading"; progress: number }
  /** All bytes sent; the server is checking the video with FFprobe. */
  | { status: "verifying" }
  | { status: "saved" }
  | { status: "error"; error: ApiError };

export type MomentSaveStatus = "saved" | "pending" | "saving" | "error";

export type RestoreState = { status: "idle" } | { status: "loading"; id: string } | { status: "error"; id: string; error: ApiError };

const SLOTS: VideoSlot[] = ["reference", "current"];
const IDLE_UPLOADS: Record<VideoSlot, UploadState> = { reference: { status: "idle" }, current: { status: "idle" } };
const NO_VIDEOS: Record<VideoSlot, ApiVideo | null> = { reference: null, current: null };

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(0, "unknown", error instanceof Error ? error.message : String(error));
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";
const videoField = (slot: VideoSlot) => (slot === "reference" ? "reference_video_id" : "current_video_id");

type Options = {
  moments: MatchedMoment[];
  mode: AnalysisMode;
  /**
   * Called when a saved session is loaded: replace the local pairs, mode and video sources. Runs in the
   * same render batch as the hook's own state, so pair sync and mode saving never see a half-restored state.
   */
  onRestore: (session: ApiSession, moments: MatchedMoment[]) => void;
  /** Called when the linked session changes (created, restored, or cleared), e.g. to update the URL. */
  onSessionIdChange?: (id: string | null) => void;
};

/**
 * Mirrors the comparison workspace to the backend:
 * - uploads each selected video (with progress) and attaches it to the session as reference/current,
 * - creates the session on the first upload and keeps its analysis mode up to date,
 * - saves frame/clip pairs by diffing local pairs against what the server has,
 * - restores a saved session (videos, pairs, mode).
 *
 * Local state stays the source of truth: if a request fails, nothing local is lost and the change is
 * retried later. Session changes run one at a time (no duplicate sessions); every async result is
 * checked against a generation counter so a stale response can't overwrite newer state.
 */
export function useSessionSync({ moments, mode, onRestore, onSessionIdChange }: Options) {
  const [sessionId, setSessionIdState] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [videos, setVideos] = useState(NO_VIDEOS);
  const [uploads, setUploads] = useState(IDLE_UPLOADS);
  const [sessionError, setSessionError] = useState<ApiError | null>(null);
  const [restoreState, setRestoreState] = useState<RestoreState>({ status: "idle" });

  const sessionIdRef = useRef<string | null>(null);
  /** Bumped on restore / new session. Results from an older generation are ignored. */
  const generation = useRef(0);
  const uploadGeneration = useRef<Record<VideoSlot, number>>({ reference: 0, current: 0 });
  const uploadAbort = useRef<Record<VideoSlot, AbortController | null>>({ reference: null, current: null });
  /** The file being uploaded per slot and, once uploaded, its server video (so a retry only re-attaches). */
  const pendingFiles = useRef<Record<VideoSlot, { file: File; video: ApiVideo | null } | null>>({ reference: null, current: null });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const savedMode = useRef<AnalysisMode | null>(null);
  const modeRef = useRef(mode);
  const onRestoreRef = useRef(onRestore);
  const onSessionIdChangeRef = useRef(onSessionIdChange);
  useEffect(() => {
    modeRef.current = mode;
    onRestoreRef.current = onRestore;
    onSessionIdChangeRef.current = onSessionIdChange;
  });

  const setSessionId = (id: string | null, notify = true) => {
    if (sessionIdRef.current === id) return;
    sessionIdRef.current = id;
    setSessionIdState(id);
    if (notify) onSessionIdChangeRef.current?.(id);
  };
  const setUpload = (slot: VideoSlot, state: UploadState) => setUploads((prev) => ({ ...prev, [slot]: state }));

  /** Runs session-level writes strictly one after another. */
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task, task);
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  // ---------- Pair sync ----------

  /** id -> signature of what the server has stored. The ref is read by the sync loop; the snapshot by render. */
  const saved = useRef(new Map<string, string>());
  const [savedSnapshot, setSavedSnapshot] = useState<ReadonlyMap<string, string>>(() => new Map());
  const publishSaved = () => setSavedSnapshot(new Map(saved.current));
  const [inFlight, setInFlight] = useState<string | null>(null);
  const [pairErrors, setPairErrors] = useState<Record<string, ApiError>>({});
  const [retryTick, setRetryTick] = useState(0);
  const momentsRef = useRef(moments);
  const running = useRef(false);
  const rerun = useRef(false);
  const canSync = sessionId !== null && videos.reference !== null && videos.current !== null;
  const canSyncRef = useRef(canSync);
  useEffect(() => {
    momentsRef.current = moments;
    canSyncRef.current = canSync;
  });

  const markSaved = (id: string, signature: string | null) => {
    if (signature === null) saved.current.delete(id);
    else saved.current.set(id, signature);
    publishSaved();
  };
  const setPairError = (id: string, error: ApiError | null) =>
    setPairErrors((prev) => {
      if (!error && !(id in prev)) return prev;
      const next = { ...prev };
      if (error) next[id] = error;
      else delete next[id];
      return next;
    });

  const reconcile = useCallback(async () => {
    if (running.current) {
      rerun.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        rerun.current = false;
        const gen = generation.current;
        const sid = sessionIdRef.current;
        if (!sid || !canSyncRef.current) break;

        for (const op of diffMoments(momentsRef.current, saved.current)) {
          if (gen !== generation.current || !canSyncRef.current) break;
          const id = op.type === "delete" ? op.id : op.moment.id;
          setInFlight(id);
          try {
            if (op.type === "create") {
              await createPair(sid, momentToCreate(op.moment));
              if (gen === generation.current) markSaved(id, momentSignature(op.moment));
            } else if (op.type === "update") {
              try {
                await updatePair(sid, id, momentToBody(op.moment));
                if (gen === generation.current) markSaved(id, momentSignature(op.moment));
              } catch (error) {
                // The server no longer has it (e.g. pruned after a video replacement): create it again.
                if (!(error instanceof ApiError && error.status === 404)) throw error;
                if (gen === generation.current) markSaved(id, null);
                rerun.current = true;
              }
            } else {
              try {
                await deletePair(sid, id);
              } catch (error) {
                if (!(error instanceof ApiError && error.status === 404)) throw error;
              }
              if (gen === generation.current) markSaved(id, null);
            }
            if (gen === generation.current) setPairError(id, null);
          } catch (error) {
            if (gen === generation.current) setPairError(id, toApiError(error));
          }
        }
      } while (rerun.current);
    } finally {
      running.current = false;
      setInFlight(null);
    }
    // markSaved / setPairError only touch refs and state setters, so the loop never needs a new identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (canSync) void reconcile();
  }, [moments, canSync, sessionId, retryTick, reconcile]);

  // Coming back online retries anything that failed.
  useEffect(() => {
    const onOnline = () => setRetryTick((n) => n + 1);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  const pendingOps = useMemo(() => diffMoments(moments, savedSnapshot), [moments, savedSnapshot]);
  const pendingIds = useMemo(() => new Set(pendingOps.map((op) => (op.type === "delete" ? op.id : op.moment.id))), [pendingOps]);

  const momentStatus = useCallback(
    (id: string): MomentSaveStatus => {
      if (inFlight === id) return "saving";
      if (pairErrors[id] && pendingIds.has(id)) return "error";
      return pendingIds.has(id) ? "pending" : "saved";
    },
    [inFlight, pairErrors, pendingIds],
  );

  const pairErrorCount = Object.keys(pairErrors).filter((id) => pendingIds.has(id)).length;

  // ---------- Session + videos ----------

  /** Applies a session update/creation result. Returns false if it is stale. */
  const applySession = (detail: ApiSession, gen: number): boolean => {
    if (gen !== generation.current) return false;
    setSessionId(detail.id);
    setSessionName(detail.name);
    savedMode.current = detail.analysis_mode;
    if (detail.pruned_pair_ids.length > 0) {
      for (const id of detail.pruned_pair_ids) saved.current.delete(id);
      publishSaved();
    }
    setSessionError(null);
    return true;
  };

  const writeSession = useCallback(
    (body: ApiSessionUpdate, gen: number) =>
      enqueue(async () => {
        if (gen !== generation.current) return null;
        const id = sessionIdRef.current;
        const detail = id ? await updateSession(id, body) : await createSession({ analysis_mode: modeRef.current, ...body });
        return applySession(detail, gen) ? detail : null;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enqueue],
  );

  const uploadFile = useCallback(
    async (slot: VideoSlot, file: File) => {
      const gen = generation.current;
      const mine = ++uploadGeneration.current[slot];
      const stale = () => mine !== uploadGeneration.current[slot] || gen !== generation.current;

      uploadAbort.current[slot]?.abort();
      const controller = new AbortController();
      uploadAbort.current[slot] = controller;
      const pending = pendingFiles.current[slot]?.file === file ? pendingFiles.current[slot]! : { file, video: null };
      pendingFiles.current[slot] = pending;
      // The server's video for this slot no longer matches what is shown; pair saving waits for the new one.
      setVideos((prev) => ({ ...prev, [slot]: null }));

      try {
        if (!pending.video) {
          setUpload(slot, { status: "uploading", progress: 0 });
          pending.video = await uploadVideo(file, {
            signal: controller.signal,
            onProgress: (fraction) => {
              if (!stale()) setUpload(slot, fraction >= 1 ? { status: "verifying" } : { status: "uploading", progress: fraction });
            },
          });
          if (stale()) return;
        }
        setUpload(slot, { status: "verifying" });
        const video = pending.video;
        const detail = await writeSession({ [videoField(slot)]: video.id }, gen);
        if (!detail || stale()) return;
        setVideos((prev) => ({ ...prev, [slot]: video }));
        setUpload(slot, { status: "saved" });
      } catch (error) {
        if (isAbort(error) || stale()) return;
        setUpload(slot, { status: "error", error: toApiError(error) });
      }
    },
    [writeSession],
  );

  const retryUpload = useCallback(
    (slot: VideoSlot) => {
      const pending = pendingFiles.current[slot];
      if (pending) void uploadFile(slot, pending.file);
    },
    [uploadFile],
  );

  const removeVideo = useCallback(
    (slot: VideoSlot) => {
      uploadGeneration.current[slot]++;
      uploadAbort.current[slot]?.abort();
      pendingFiles.current[slot] = null;
      setUpload(slot, { status: "idle" });
      setVideos((prev) => ({ ...prev, [slot]: null }));
      if (sessionIdRef.current) {
        writeSession({ [videoField(slot)]: null }, generation.current).catch((error) => setSessionError(toApiError(error)));
      }
    },
    [writeSession],
  );

  // Keep the saved analysis mode in step (only once a session exists).
  useEffect(() => {
    if (!sessionId || savedMode.current === mode) return;
    savedMode.current = mode;
    writeSession({ analysis_mode: mode }, generation.current).catch((error) => {
      savedMode.current = null;
      setSessionError(toApiError(error));
    });
  }, [mode, sessionId, writeSession]);

  const rename = useCallback(
    (name: string) => writeSession({ name: name.trim() || null }, generation.current).catch((error) => setSessionError(toApiError(error))),
    [writeSession],
  );

  /**
   * Forgets everything (local + server link). Does not delete anything on the server.
   * `notify: false` keeps the URL as it is (used while restoring, so a failed restore can be retried by reloading).
   */
  const reset = useCallback((notify = true) => {
    generation.current++;
    for (const slot of SLOTS) {
      uploadGeneration.current[slot]++;
      uploadAbort.current[slot]?.abort();
      pendingFiles.current[slot] = null;
    }
    saved.current = new Map();
    savedMode.current = null;
    publishSaved();
    setSessionId(null, notify);
    setSessionName(null);
    setVideos(NO_VIDEOS);
    setUploads(IDLE_UPLOADS);
    setSessionError(null);
    setPairErrors({});
    setRestoreState({ status: "idle" });
  }, []);

  /** Loads a saved session (see `onRestore`). Returns it, or null on failure. */
  const restore = useCallback(
    async (id: string): Promise<ApiSession | null> => {
      reset(false);
      const gen = generation.current;
      setRestoreState({ status: "loading", id });
      try {
        const detail = await getSession(id);
        if (gen !== generation.current) return null;
        const restored = detail.pairs.map(pairToMoment);
        saved.current = new Map(restored.map((m) => [m.id, momentSignature(m)]));
        publishSaved();
        applySession(detail, gen);
        onRestoreRef.current(detail, restored);
        setVideos({ reference: detail.reference_video, current: detail.current_video });
        setUploads({
          reference: detail.reference_video ? { status: "saved" } : { status: "idle" },
          current: detail.current_video ? { status: "saved" } : { status: "idle" },
        });
        setRestoreState({ status: "idle" });
        return detail;
      } catch (error) {
        if (gen !== generation.current) return null;
        setRestoreState({ status: "error", id, error: toApiError(error) });
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reset],
  );

  return {
    sessionId,
    sessionName,
    videos,
    uploads,
    sessionError,
    restoreState,
    /** True once both videos are on the server, so pairs can be saved and frames extracted. */
    canSync,
    pendingCount: pendingOps.length,
    saving: inFlight !== null,
    pairErrorCount,
    momentStatus,
    pairError: (id: string) => pairErrors[id] ?? null,
    retryPairs: () => setRetryTick((n) => n + 1),
    uploadFile,
    retryUpload,
    removeVideo,
    rename,
    restore,
    reset,
  };
}

export type SessionSyncApi = ReturnType<typeof useSessionSync>;
