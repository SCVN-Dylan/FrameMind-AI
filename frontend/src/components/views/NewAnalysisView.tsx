"use client";

import ComparisonWorkspace from "@/components/analysis/ComparisonWorkspace";
import PageHeader from "@/components/layout/PageHeader";
import { DemoBadge } from "@/components/ui/Badge";
import { useI18n } from "@/lib/i18n/I18nProvider";

export default function NewAnalysisView() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader
        title={t.newAnalysis.title}
        description={t.newAnalysis.description}
        actions={<DemoBadge variant="mode" />}
      />
      <ComparisonWorkspace />
    </>
  );
}
