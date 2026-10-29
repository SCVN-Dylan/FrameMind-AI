"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import type { AnalysisJobApi } from "@/hooks/useAnalysisJob";
import { apiErrorText } from "@/lib/api-errors";
import { formatDate } from "@/lib/format";
import { LANGUAGES } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/I18nProvider";

/** mm:ss since `iso`, refreshed every second. No progress percentage: Codex reports none. */
function useElapsed(iso: string | null, running: boolean): string {
  // Set only from the timer (never during render), so prerendering stays deterministic.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!iso || now === null) return "00:00";
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** State of the latest AI analysis of the session: running, finished (with summary) or failed. */
export default function AnalysisJobCard({ analysis, onRetry }: { analysis: AnalysisJobApi; onRetry: (() => void) | null }) {
  const { t, locale, language } = useI18n();
  const ai = t.ai;
  const { job, error } = analysis;
  const running = job?.status === "pending" || job?.status === "processing";
  const elapsed = useElapsed(job?.started_at ?? job?.created_at ?? null, running);

  if (!job && !error) return null;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Icon name="sparkles" size={18} className="text-primary-soft" /> {ai.title}
        </h2>
        {job && (
          <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200" title={ai.sourceTooltip}>
            {ai.providerLine(job.provider_version ?? "?", job.model ?? ai.defaultModel)}
          </Badge>
        )}
      </div>

      {job && running && (
        <div role="status" className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-sm text-foreground">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-soft/30 border-t-primary-soft" />
            {job.status === "pending" ? ai.pending : ai.processing(job.pair_ids.length)}
            <span className="font-mono text-xs text-muted">{ai.elapsed(elapsed)}</span>
          </p>
          <p className="text-xs text-muted">{ai.waitHint}</p>
        </div>
      )}

      {job?.status === "completed" && (
        <div className="flex flex-col gap-1.5">
          <p className="flex items-center gap-2 text-sm text-emerald-300">
            <Icon name="check" size={15} /> {ai.completed}
            {job.finished_at && <span className="text-xs text-muted">· {ai.finishedAt(formatDate(job.finished_at, locale))}</span>}
          </p>
          {job.summary && <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">{job.summary}</p>}
          {job.rejected_issue_count > 0 && <p className="text-xs text-amber-200">{ai.rejected(job.rejected_issue_count)}</p>}
          {job.language !== language && (
            // Feedback is kept exactly as generated; switching the UI language does not re-run the analysis.
            <p className="flex items-start gap-1.5 text-xs text-muted">
              <Icon name="globe" size={13} className="mt-px shrink-0" />
              {ai.generatedIn(LANGUAGES.find((l) => l.id === job.language)?.name ?? job.language)}
            </p>
          )}
        </div>
      )}

      {job?.status === "failed" && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3.5 py-2.5 text-sm text-rose-200">
          <span className="flex items-start gap-2">
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
            <span>
              {ai.failed}{" "}
              {job.error_code ? (t.apiErrors as Record<string, string>)[job.error_code] ?? job.error_message : job.error_message}
            </span>
          </span>
          {onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              <Icon name="restart" size={14} /> {ai.retry}
            </Button>
          )}
        </div>
      )}

      {error && !running && (
        <p role="alert" className="text-xs text-rose-200">
          {apiErrorText(t, error)}
        </p>
      )}
    </Card>
  );
}
