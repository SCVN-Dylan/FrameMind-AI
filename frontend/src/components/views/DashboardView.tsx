"use client";

import PageHeader from "@/components/layout/PageHeader";
import HistoryList from "@/components/history/HistoryList";
import { DemoBadge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import StatCard from "@/components/ui/StatCard";
import { CATEGORIES } from "@/lib/feedback";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { getDemoHistory } from "@/lib/mock-data";
import type { AnalysisRecord } from "@/lib/types";

const STEP_ICONS = ["upload", "bookmark", "sparkles"] as const;

function getDemoStats(history: AnalysisRecord[]) {
  const completed = history.filter((record) => record.status === "completed");
  const allFeedback = completed.flatMap((record) => record.feedback);
  const topCategory = CATEGORIES.map((id) => ({
    id,
    count: allFeedback.filter((item) => item.category === id).length,
  })).sort((a, b) => b.count - a.count)[0];

  return {
    total: history.length,
    completed: completed.length,
    issues: allFeedback.length,
    highSeverity: allFeedback.filter((item) => item.severity === "high").length,
    topCategory,
  };
}

export default function DashboardView() {
  const { t, language } = useI18n();
  const history = getDemoHistory(language);
  const stats = getDemoStats(history);
  const d = t.dashboard;

  return (
    <>
      <PageHeader title={d.title} description={d.description} />

      {/* Welcome */}
      <Card className="relative overflow-hidden p-6 sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-primary/25 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 right-40 h-64 w-64 rounded-full bg-accent/15 blur-3xl"
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <p className="text-sm font-medium text-primary-soft">{d.welcome}</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {d.heroStart} <span className="text-brand-gradient">{d.heroAccent}</span>
              {d.heroEnd}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">{d.heroText}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/analysis/new" variant="primary" className="h-11 px-5">
              <Icon name="plus" size={18} />
              {d.newAnalysis}
            </ButtonLink>
            <ButtonLink href="/history" className="h-11 px-5">
              {d.viewHistory}
            </ButtonLink>
          </div>
        </div>
      </Card>

      {/* Stats */}
      <section aria-labelledby="stats-heading" className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 id="stats-heading" className="text-sm font-medium text-muted">
            {d.statistics}
          </h2>
          <DemoBadge />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={d.totalAnalyses} value={stats.total} hint={d.completedHint(stats.completed)} icon="history" />
          <StatCard label={d.issuesFound} value={stats.issues} hint={d.issuesFoundHint} icon="search" />
          <StatCard label={d.highSeverity} value={stats.highSeverity} hint={d.highSeverityHint} icon="alert" />
          <StatCard
            label={d.mostCommon}
            value={t.categories[stats.topCategory.id]}
            hint={d.mostCommonHint(stats.topCategory.count)}
            icon={stats.topCategory.id}
          />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title={d.recentTitle}
            description={d.recentDescription}
            action={
              <>
                <DemoBadge />
                <ButtonLink href="/history" variant="ghost" size="sm">
                  {d.viewAll} <Icon name="chevronRight" size={14} />
                </ButtonLink>
              </>
            }
          />
          <div className="px-5 pb-5">
            <HistoryList records={history.slice(0, 3)} compact />
          </div>
        </Card>

        <Card>
          <CardHeader title={d.howTitle} description={d.howDescription} />
          <ol className="flex flex-col gap-4 px-5 pb-5">
            {d.steps.map((step, index) => (
              <li key={index} className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary-soft">
                  <Icon name={STEP_ICONS[index]} size={17} />
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {index + 1}. {step.title}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
