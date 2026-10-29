"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Icon from "@/components/ui/Icon";
import { ApiError, deleteSession, listSessions, type ApiSessionSummary } from "@/lib/api";
import { apiErrorText } from "@/lib/api-errors";
import { formatDate, formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; sessions: ApiSessionSummary[] };

/** Comparison sessions saved in the backend. Opening one restores its videos and pairs in New Analysis. */
export default function SessionList() {
  const { t, locale } = useI18n();
  const s = t.sessions;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<ApiError | null>(null);

  const fetchSessions = useCallback((signal?: AbortSignal) => {
    listSessions(signal)
      .then((sessions) => setState({ status: "ready", sessions }))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", error: error instanceof ApiError ? error : new ApiError(0, "unknown", String(error)) });
      });
  }, []);

  // Refetch each time the page is shown, so sessions saved meanwhile appear.
  useEffect(() => {
    const controller = new AbortController();
    fetchSessions(controller.signal);
    return () => controller.abort();
  }, [fetchSessions]);

  function retry() {
    setState({ status: "loading" });
    fetchSessions();
  }

  async function remove(session: ApiSessionSummary, title: string) {
    if (!window.confirm(s.deleteConfirm(title))) return;
    setDeletingId(session.id);
    setDeleteError(null);
    try {
      await deleteSession(session.id);
      setState((prev) =>
        prev.status === "ready" ? { status: "ready", sessions: prev.sessions.filter((x) => x.id !== session.id) } : prev,
      );
    } catch (error) {
      setDeleteError(error instanceof ApiError ? error : new ApiError(0, "unknown", String(error)));
    } finally {
      setDeletingId(null);
    }
  }

  if (state.status === "loading") {
    return (
      <p role="status" className="flex items-center gap-2 px-1 py-6 text-sm text-muted">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-soft/30 border-t-primary-soft" />
        {s.loading}
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">
        <span>
          {s.loadFailed} {apiErrorText(t, state.error)}
        </span>
        <Button size="sm" variant="secondary" onClick={retry}>
          <Icon name="restart" size={14} /> {s.retry}
        </Button>
      </div>
    );
  }

  if (state.sessions.length === 0) {
    return (
      <EmptyState
        icon="film"
        title={s.emptyTitle}
        description={s.emptyText}
        className="rounded-xl border border-dashed border-border"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {deleteError && (
        <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
          {s.deleteFailed} {apiErrorText(t, deleteError)}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {state.sessions.map((session) => {
          const ref = session.reference_video;
          const cur = session.current_video;
          const title = session.name ?? (ref && cur ? t.session.untitled(ref.original_filename, cur.original_filename) : t.session.unnamed);
          return (
            <li
              key={session.id}
              className="group grid gap-3 rounded-xl border border-border/70 bg-background/40 p-4 transition-colors hover:border-primary-soft/40 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.5fr)_auto_auto] md:items-center md:gap-5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground" title={title}>
                  {title}
                </p>
                <p className="mt-0.5 text-xs text-muted">{s.updated(formatDate(session.updated_at, locale))}</p>
              </div>
              <div className="min-w-0 space-y-0.5 text-xs text-muted">
                <p className="flex items-center gap-1.5 truncate">
                  <Icon name="film" size={13} className="shrink-0 text-primary-soft" />
                  <span className="truncate">{ref ? `${ref.original_filename} · ${formatTime(ref.duration_ms)}` : s.noVideo}</span>
                </p>
                <p className="flex items-center gap-1.5 truncate">
                  <Icon name="video" size={13} className="shrink-0 text-accent" />
                  <span className="truncate">{cur ? `${cur.original_filename} · ${formatTime(cur.duration_ms)}` : s.noVideo}</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge>{s.framePairs(session.frame_pair_count)}</Badge>
                <Badge>{s.clipPairs(session.clip_pair_count)}</Badge>
                {session.analysis_status && (
                  <Badge
                    className={
                      session.analysis_status === "completed"
                        ? "border-primary-soft/40 bg-primary/15 text-primary-soft"
                        : session.analysis_status === "failed"
                          ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
                          : "border-accent/40 bg-accent/10 text-sky-200"
                    }
                  >
                    <Icon name="sparkles" size={11} /> {t.ai.status[session.analysis_status]}
                    {session.analysis_status === "completed" && ` · ${s.analysisIssues(session.feedback_count)}`}
                  </Badge>
                )}
                {session.extracted_pair_count > 0 && (
                  <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200">{s.extracted(session.extracted_pair_count)}</Badge>
                )}
              </div>
              <div className="flex items-center gap-1 md:justify-end">
                <Link
                  href={`/analysis/new?session=${session.id}`}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-primary-soft transition-colors hover:bg-surface-raised"
                >
                  {s.open} <Icon name="chevronRight" size={14} />
                </Link>
                <button
                  type="button"
                  onClick={() => void remove(session, title)}
                  disabled={deletingId === session.id}
                  aria-label={`${s.delete}: ${title}`}
                  title={s.delete}
                  className="rounded-lg p-1.5 text-muted transition-colors hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-40"
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
