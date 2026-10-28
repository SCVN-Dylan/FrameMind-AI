"use client";

import { ButtonLink } from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { useI18n } from "@/lib/i18n/I18nProvider";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <EmptyState
      icon="search"
      title={t.notFound.title}
      description={t.notFound.text}
      action={
        <ButtonLink href="/" variant="primary">
          {t.notFound.back}
        </ButtonLink>
      }
      className="flex-1"
    />
  );
}
