"use client";

import Link from "next/link";
import { useState } from "react";

import { StatusBadge } from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import Icon from "@/components/ui/Icon";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { AnalysisRecord, AnalysisStatus } from "@/lib/types";

type HistoryListProps = {
  records: AnalysisRecord[];
  /** Hide search and filters (used for the compact list on the dashboard). */
  compact?: boolean;
};

export default function HistoryList({ records, compact = false }: HistoryListProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AnalysisStatus | "all">("all");
  const { t, locale } = useI18n();

  const needle = query.trim().toLowerCase();
  const visible = records.filter(
    (record) =>
      (status === "all" || record.status === status) &&
      (needle === "" ||
        [record.title, record.referenceVideo, record.currentVideo].some((text) => text.toLowerCase().includes(needle))),
  );

  return (
    <div className="flex flex-col gap-4">
      {!compact && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative flex-1">
            <span className="sr-only">{t.history.searchLabel}</span>
            <Icon name="search" size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.history.searchPlaceholder}
              className="h-10 w-full rounded-xl border border-border bg-background pr-3 pl-9 text-sm text-foreground placeholder:text-muted/70 focus:border-primary-soft focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {(["all", "completed", "processing", "failed", "draft"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                aria-pressed={status === value}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  status === value
                    ? "border-primary-soft/50 bg-primary/20 text-foreground"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {value === "all" ? t.history.all : t.status[value]}
              </button>
            ))}
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon="search"
          title={t.history.noneTitle}
          description={t.history.noneText}
          className="rounded-xl border border-dashed border-border"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((record) => (
            <li key={record.id}>
              <Link
                href={`/history/${record.id}`}
                className="group grid gap-3 rounded-xl border border-border/70 bg-background/40 p-4 transition-all duration-200 hover:-translate-y-px hover:border-primary-soft/40 hover:bg-surface-raised/50 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_auto_auto_auto] md:items-center md:gap-5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{record.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{formatDate(record.createdAt, locale)}</p>
                </div>
                <div className="min-w-0 space-y-0.5 text-xs text-muted">
                  <p className="flex items-center gap-1.5 truncate">
                    <Icon name="film" size={13} className="shrink-0 text-primary-soft" />
                    <span className="truncate">{record.referenceVideo}</span>
                  </p>
                  <p className="flex items-center gap-1.5 truncate">
                    <Icon name="video" size={13} className="shrink-0 text-accent" />
                    <span className="truncate">{record.currentVideo}</span>
                  </p>
                </div>
                <p className="text-xs text-muted md:text-right">
                  {record.status === "completed" ? t.history.issues(record.feedback.length) : "—"}
                </p>
                <StatusBadge status={record.status} />
                <span className="inline-flex items-center gap-1 text-xs font-medium text-primary-soft transition-transform group-hover:translate-x-0.5">
                  {t.history.open} <Icon name="chevronRight" size={14} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
