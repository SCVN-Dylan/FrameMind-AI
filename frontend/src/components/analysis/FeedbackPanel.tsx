"use client";

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Card, CardHeader } from "@/components/ui/Card";
import { DemoBadge } from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import Icon from "@/components/ui/Icon";
import { CATEGORIES, countBySeverity, SEVERITY_META, SEVERITY_ORDER, sortByTime } from "@/lib/feedback";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { FeedbackCategory, FeedbackItem } from "@/lib/types";

import FeedbackCard from "./FeedbackCard";

type FeedbackPanelProps = {
  items: FeedbackItem[] | null;
  selectedId: string | null;
  onSelect: (item: FeedbackItem | null) => void;
  /** Shown when `items` is null (no analysis yet). */
  emptyState: ReactNode;
  isDemo?: boolean;
  /** Header badge for real (non-demo) results. */
  badge?: ReactNode;
  /** Note shown above real results. */
  notice?: string;
  /** Empty-list text for real results. */
  emptyTitle?: string;
  emptyText?: string;
};

type Filter = FeedbackCategory | "all";

// Memoized: the workspace re-renders on every video time update, but feedback rarely changes.
export default memo(function FeedbackPanel({ items, selectedId, onSelect, emptyState, isDemo = true, badge, notice, emptyTitle, emptyText }: FeedbackPanelProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  const sorted = useMemo(() => (items ? sortByTime(items) : []), [items]);
  const visible = filter === "all" ? sorted : sorted.filter((item) => item.category === filter);

  // Keep the selected card in view inside the scrollable list (without scrolling the whole page).
  useEffect(() => {
    const list = listRef.current;
    const card = selectedId ? list?.querySelector<HTMLElement>(`[data-feedback-id="${selectedId}"]`) : null;
    if (!list || !card) return;
    const top = card.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + 80 > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: Math.max(top - 8, 0), behavior: "smooth" });
    }
  }, [selectedId]);

  function toggle(item: FeedbackItem) {
    const isOpen = expanded.has(item.id) || item.id === selectedId;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    if (isOpen) {
      if (item.id === selectedId) onSelect(null);
    } else {
      onSelect(item);
    }
  }

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader
        title={t.feedback.title}
        description={t.feedback.description}
        action={items && isDemo ? <DemoBadge variant="mode" /> : items ? badge : undefined}
      />

      {!items ? (
        <div className="px-5 pb-5">{emptyState}</div>
      ) : items.length === 0 ? (
        <EmptyState icon="check" title={emptyTitle ?? t.feedback.noItemsTitle} description={emptyText ?? t.feedback.noItemsText} />
      ) : (
        <div className="flex flex-col gap-4 px-5 pb-5">
          {isDemo && (
            <p className="flex items-start gap-2 rounded-xl border border-primary-soft/25 bg-primary/10 px-3.5 py-2.5 text-xs leading-relaxed text-primary-soft">
              <Icon name="info" size={15} className="mt-px shrink-0" />
              {t.feedback.demoNotice}
            </p>
          )}
          {!isDemo && notice && (
            <p className="flex items-start gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/5 px-3.5 py-2.5 text-xs leading-relaxed text-emerald-100/90">
              <Icon name="info" size={15} className="mt-px shrink-0" />
              {notice}
            </p>
          )}

          <FeedbackSummary items={sorted} />

          <div role="tablist" aria-label={t.feedback.filterLabel} className="flex flex-wrap gap-1.5">
            <FilterChip label={t.feedback.all} count={sorted.length} active={filter === "all"} onClick={() => setFilter("all")} />
            {CATEGORIES.map((category) => (
              <FilterChip
                key={category}
                label={t.categories[category]}
                count={sorted.filter((item) => item.category === category).length}
                active={filter === category}
                onClick={() => setFilter(category)}
              />
            ))}
          </div>

          <div ref={listRef} className="relative flex max-h-[640px] flex-col gap-2.5 overflow-y-auto pr-1">
            {visible.length === 0 ? (
              <EmptyState
                icon={filter === "all" ? "check" : filter}
                title={filter === "all" ? t.feedback.noItemsTitle : t.feedback.noCategoryTitle(t.categories[filter])}
                description={t.feedback.noCategoryText}
              />
            ) : (
              visible.map((item) => (
                <FeedbackCard
                  key={item.id}
                  item={item}
                  index={sorted.indexOf(item)}
                  selected={item.id === selectedId}
                  expanded={expanded.has(item.id) || item.id === selectedId}
                  onToggle={() => toggle(item)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </Card>
  );
});

function FeedbackSummary({ items }: { items: FeedbackItem[] }) {
  const { t } = useI18n();
  const counts = countBySeverity(items);
  const categoryCounts = CATEGORIES.map((id) => ({ id, count: items.filter((i) => i.category === id).length }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
  const top = categoryCounts.slice(0, 2).map((c) => t.categories[c.id]);

  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-background/50 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <p className="text-sm text-foreground">
          <span className="text-2xl font-semibold">{items.length}</span>{" "}
          <span className="text-muted">{t.feedback.differences}</span>
        </p>
        {top.length > 0 && (
          <p className="mt-1 text-xs text-muted">
            {t.feedback.biggestGaps} <span className="text-foreground">{top.join(` ${t.feedback.and} `)}</span>
            {counts.critical + counts.major > 0 && <> · {t.feedback.fixHighFirst(counts.critical + counts.major)}</>}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {SEVERITY_ORDER.map((severity) => (
          <div key={severity} className="min-w-16 rounded-lg border border-border/70 bg-surface px-3 py-2 text-center">
            <p className="text-lg font-semibold text-foreground">{counts[severity]}</p>
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_META[severity].dot}`} />
              {t.severity[severity]}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-200 ${
        active
          ? "border-primary-soft/50 bg-primary/20 text-foreground"
          : "border-border text-muted hover:border-primary-soft/40 hover:text-foreground"
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 font-mono text-[10px] ${active ? "bg-primary/40 text-white" : "bg-surface-raised"}`}>
        {count}
      </span>
    </button>
  );
}
