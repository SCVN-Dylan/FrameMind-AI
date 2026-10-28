"use client";

import AnalysisReport from "@/components/analysis/AnalysisReport";
import PageHeader from "@/components/layout/PageHeader";
import { DemoBadge, StatusBadge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import { formatDate, formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { getDemoAnalysis } from "@/lib/mock-data";

/** `id` is validated by the page (unknown ids 404 before reaching this view). */
export default function AnalysisDetailView({ id }: { id: string }) {
  const { t, language, locale } = useI18n();
  const record = getDemoAnalysis(id, language);
  if (!record) return null;

  const meta = [
    { icon: "film", label: t.history.reference, value: record.referenceVideo },
    { icon: "video", label: t.history.current, value: record.currentVideo },
    { icon: "clock", label: t.history.duration, value: record.durationMs > 0 ? formatTime(record.durationMs) : "—" },
  ] as const;

  return (
    <>
      <ButtonLink href="/history" variant="ghost" size="sm" className="-ml-2 self-start">
        <Icon name="arrowLeft" size={15} /> {t.history.back}
      </ButtonLink>

      <PageHeader
        title={record.title}
        description={t.history.analysisFrom(formatDate(record.createdAt, locale))}
        actions={
          <>
            <StatusBadge status={record.status} />
            <DemoBadge />
          </>
        }
      />

      <Card className="grid gap-4 p-5 sm:grid-cols-3">
        {meta.map((item) => (
          <div key={item.icon} className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-raised text-primary-soft">
              <Icon name={item.icon} size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-muted">{item.label}</p>
              <p className="truncate text-sm text-foreground" title={item.value}>
                {item.value}
              </p>
            </div>
          </div>
        ))}
      </Card>

      <AnalysisReport record={record} />
    </>
  );
}
