"use client";

import { useState } from "react";

import EmptyState from "@/components/ui/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { AnalysisRecord, FeedbackItem } from "@/lib/types";

import AnalysisTimeline from "./AnalysisTimeline";
import FeedbackPanel from "./FeedbackPanel";

/** Read-only view of a saved analysis (timeline + feedback, no video players). */
export default function AnalysisReport({ record }: { record: AnalysisRecord }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { t } = useI18n();
  const select = (item: FeedbackItem | null) => setSelectedId(item?.id ?? null);

  if (record.status !== "completed") {
    return (
      <EmptyState
        icon={record.status === "failed" ? "alert" : "clock"}
        title={t.history.noFeedbackTitle}
        description={t.history.notReady[record.status]}
        action={<ButtonLink href="/analysis/new" variant="primary">{t.history.startNew}</ButtonLink>}
        className="rounded-2xl border border-dashed border-border bg-surface"
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AnalysisTimeline durationMs={record.durationMs} items={record.feedback} selectedId={selectedId} onSelectItem={select} />
      <FeedbackPanel items={record.feedback} selectedId={selectedId} onSelect={select} emptyState={null} />
    </div>
  );
}
