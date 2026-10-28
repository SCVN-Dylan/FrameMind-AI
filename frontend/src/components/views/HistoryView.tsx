"use client";

import HistoryList from "@/components/history/HistoryList";
import PageHeader from "@/components/layout/PageHeader";
import { DemoBadge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { getDemoHistory } from "@/lib/mock-data";

export default function HistoryView() {
  const { t, language } = useI18n();
  return (
    <>
      <PageHeader
        title={t.history.title}
        description={t.history.description}
        actions={
          <ButtonLink href="/analysis/new" variant="primary" size="sm">
            <Icon name="plus" size={15} /> {t.nav.newAnalysis}
          </ButtonLink>
        }
      />
      <Card>
        <CardHeader title={t.history.cardTitle} description={t.history.cardDescription} action={<DemoBadge />} />
        <div className="px-5 pb-5">
          <HistoryList records={getDemoHistory(language)} />
        </div>
      </Card>
    </>
  );
}
