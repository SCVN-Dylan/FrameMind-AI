"use client";

import Icon from "@/components/ui/Icon";
import { LANGUAGES } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/I18nProvider";

/** Segmented EN / VI / KO control. */
export default function LanguageSwitcher({ showLabel = true }: { showLabel?: boolean }) {
  const { language, setLanguage, t } = useI18n();

  return (
    <div className="flex flex-col gap-2">
      {showLabel && (
        <p className="flex items-center gap-2 px-1 text-xs font-medium text-muted">
          <Icon name="globe" size={14} />
          {t.language}
        </p>
      )}
      <div role="radiogroup" aria-label={t.language} className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-background/60 p-1">
        {LANGUAGES.map((option) => {
          const active = option.id === language;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={option.name}
              lang={option.id}
              onClick={() => setLanguage(option.id)}
              className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition-all duration-200 focus-visible:outline-2 focus-visible:outline-primary-soft ${
                active ? "bg-brand-gradient text-white shadow-md shadow-primary/30" : "text-muted hover:bg-surface-raised hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
