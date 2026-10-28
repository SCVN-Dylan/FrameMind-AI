"use client";

import BackendStatus from "@/components/BackendStatus";
import LanguageSwitcher from "@/components/layout/LanguageSwitcher";
import PageHeader from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { API_BASE_URL } from "@/lib/api";
import { CATEGORIES } from "@/lib/feedback";
import { useI18n } from "@/lib/i18n/I18nProvider";

export default function SettingsView() {
  const { t } = useI18n();
  const s = t.settings;

  return (
    <>
      <PageHeader title={s.title} description={s.description} />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={s.backendTitle} description={s.backendDescription(API_BASE_URL)} />
          <div className="px-5 pb-5">
            <BackendStatus />
          </div>
        </Card>

        <Card>
          <CardHeader title={s.languageTitle} description={s.languageDescription} />
          <div className="max-w-xs px-5 pb-5">
            <LanguageSwitcher showLabel={false} />
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title={s.prefsTitle} description={s.prefsDescription} action={<Badge>{s.comingSoon}</Badge>} />
          <fieldset disabled className="flex flex-col gap-5 px-5 pb-5 opacity-60">
            <label className="flex max-w-sm flex-col gap-1.5 text-sm">
              <span className="text-foreground">{s.framesPerPair}</span>
              <select className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground">
                <option>{s.frames(1)}</option>
                <option>{s.frames(3)}</option>
              </select>
            </label>
            <div className="flex flex-col gap-2 text-sm">
              <span className="text-foreground">{s.categories}</span>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((category) => (
                  <label
                    key={category}
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-muted"
                  >
                    <input type="checkbox" defaultChecked className="accent-primary" />
                    {t.categories[category]}
                  </label>
                ))}
              </div>
            </div>
          </fieldset>
        </Card>
      </div>

      <Card>
        <CardHeader title={s.aboutTitle} description={s.aboutDescription} />
        <p className="px-5 pb-5 text-sm leading-relaxed text-muted">
          {s.aboutBefore} <span className="text-primary-soft">{t.demo.mode}</span>
          {s.aboutAfter}
        </p>
      </Card>
    </>
  );
}
