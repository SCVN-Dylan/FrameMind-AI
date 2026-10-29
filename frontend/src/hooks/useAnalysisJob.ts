"use client";

import { useCallback, useEffect, useState } from "react";

import {
  ApiError,
  getAnalysisResults,
  getAnalysisStatus,
  runAnalysis,
  type ApiAnalysisResults,
  type ApiJob,
} from "@/lib/api";

const POLL_MS = 2000;
const isActive = (job: ApiJob | null) => job?.status === "pending" || job?.status === "processing";

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, "unknown", error instanceof Error ? error.message : String(error));
}

type State = {
  /** The session this state belongs to; state for another session is ignored. */
  sessionId: string | null;
  job: ApiJob | null;
  results: ApiAnalysisResults | null;
  error: ApiError | null;
  starting: boolean;
};

const EMPTY: State = { sessionId: null, job: null, results: null, error: null, starting: false };

/**
 * The AI analysis of one session: starts jobs, polls their status until they finish, loads the results, and
 * restores the latest job + results when a saved session is opened (page refresh included).
 * Polling runs in an effect, so it pauses while Next.js hides the page and resumes when it is shown again.
 */
export function useAnalysisJob(sessionId: string | null) {
  const [raw, setState] = useState<State>(EMPTY);
  const state = raw.sessionId === sessionId ? raw : { ...EMPTY, sessionId };
  const { job, results } = state;

  const update = useCallback(
    (forSession: string, patch: Partial<State>) =>
      setState((prev) => (prev.sessionId === forSession ? { ...prev, ...patch } : { ...EMPTY, sessionId: forSession, ...patch })),
    [],
  );

  // Restore the latest job and the latest completed results of a session.
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    const ignore404 = (error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      if (error instanceof DOMException && error.name === "AbortError") return undefined;
      throw error;
    };
    getAnalysisStatus(sessionId, controller.signal)
      .then(async (latest) => {
        // Results only exist once a job has completed; skip the request for never-analysed sessions.
        const completed = latest ? await getAnalysisResults(sessionId, undefined, controller.signal).catch(ignore404) : null;
        if (completed === undefined) return;
        update(sessionId, { job: latest, results: completed });
      })
      .catch((error) => update(sessionId, { error: toApiError(error) }));
    return () => controller.abort();
  }, [sessionId, update]);

  // Poll while the job is pending/processing.
  const pollKey = job && isActive(job) ? `${job.id}:${job.status}:${job.started_at}` : null;
  useEffect(() => {
    if (!sessionId || !pollKey) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      timer = setTimeout(async () => {
        try {
          const next = await getAnalysisStatus(sessionId);
          if (cancelled || !next) return;
          if (isActive(next)) {
            update(sessionId, { job: next, error: null });
            poll();
            return;
          }
          const finished = next.status === "completed" ? await getAnalysisResults(sessionId, next.id) : null;
          if (!cancelled) update(sessionId, { job: next, error: null, ...(finished ? { results: finished } : {}) });
        } catch (error) {
          if (cancelled) return;
          update(sessionId, { error: toApiError(error) });
          poll(); // keep trying: the backend may be restarting
        }
      }, POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, pollKey, update]);

  const start = useCallback(
    /** `language`: the current UI language; Codex writes the feedback in it. */
    async (mode: ApiJob["analysis_mode"], pairIds: string[], language: ApiJob["language"]) => {
      if (!sessionId) return;
      update(sessionId, { starting: true, error: null });
      try {
        const created = await runAnalysis(sessionId, { analysis_mode: mode, pair_ids: pairIds, language });
        update(sessionId, { job: created, starting: false });
      } catch (error) {
        const apiError = toApiError(error);
        if (apiError.code === "analysis_in_progress") {
          // Another tab or click already started one: follow it instead.
          const running = await getAnalysisStatus(sessionId).catch(() => null);
          update(sessionId, { job: running, starting: false });
          return;
        }
        update(sessionId, { error: apiError, starting: false });
      }
    },
    [sessionId, update],
  );

  return {
    job,
    results,
    error: state.error,
    starting: state.starting,
    active: state.starting || isActive(job),
    start,
  };
}

export type AnalysisJobApi = ReturnType<typeof useAnalysisJob>;
