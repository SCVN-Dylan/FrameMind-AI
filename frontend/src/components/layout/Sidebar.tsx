"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import Icon, { type IconName } from "@/components/ui/Icon";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/I18nProvider";

import LanguageSwitcher from "./LanguageSwitcher";

const NAV_ITEMS: { href: string; label: keyof Dictionary["nav"]; icon: IconName }[] = [
  { href: "/", label: "dashboard", icon: "dashboard" },
  { href: "/analysis/new", label: "newAnalysis", icon: "plus" },
  { href: "/history", label: "history", icon: "history" },
  { href: "/settings", label: "settings", icon: "settings" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-primary-soft">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-lg shadow-primary/30">
        <Icon name="logo" size={22} />
      </span>
      <span className="text-lg font-semibold tracking-tight">
        FrameMind <span className="text-brand-gradient">AI</span>
      </span>
    </Link>
  );
}

type SidebarProps = {
  /** Called after a nav link is clicked (used to close the mobile drawer). */
  onNavigate?: () => void;
};

export default function Sidebar({ onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <div className="flex h-full flex-col gap-8 overflow-y-auto px-4 py-6">
      <div className="px-2">
        <Logo />
      </div>

      <nav aria-label={t.nav.main} className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onNavigate={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${
                active
                  ? "bg-primary/15 text-foreground"
                  : "text-muted hover:bg-surface-raised hover:text-foreground"
              }`}
            >
              {active && (
                <span className="absolute top-2 bottom-2 left-0 w-1 rounded-full bg-brand-gradient" aria-hidden="true" />
              )}
              <Icon
                name={item.icon}
                size={18}
                className={active ? "text-primary-soft" : "text-muted transition-colors group-hover:text-foreground"}
              />
              {t.nav[item.label]}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-4">
        <LanguageSwitcher />
        <div className="rounded-2xl border border-primary-soft/25 bg-primary/10 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-primary-soft">
            <Icon name="sparkles" size={16} />
            {t.demo.sidebarTitle}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">{t.demo.sidebarText}</p>
        </div>
      </div>
    </div>
  );
}
