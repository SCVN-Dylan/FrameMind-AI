"use client";

import { useEffect, useState, type ReactNode } from "react";

import Icon from "@/components/ui/Icon";
import { useI18n } from "@/lib/i18n/I18nProvider";

import Sidebar, { Logo } from "./Sidebar";

export default function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { t } = useI18n();

  // Close the mobile drawer with Escape.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="flex min-h-full flex-1">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-border/70 bg-surface/60 lg:block">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t.shell.navigation}>
          <button
            type="button"
            aria-label={t.shell.closeNav}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-border bg-surface shadow-2xl">
            <button
              type="button"
              aria-label={t.shell.closeNav}
              onClick={() => setDrawerOpen(false)}
              className="absolute top-6 right-4 rounded-lg p-1.5 text-muted hover:bg-surface-raised hover:text-foreground"
            >
              <Icon name="x" size={18} />
            </button>
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border/70 bg-background/85 px-4 py-3 backdrop-blur lg:hidden">
          <Logo />
          <button
            type="button"
            aria-label={t.shell.openNav}
            onClick={() => setDrawerOpen(true)}
            className="rounded-lg border border-border p-2 text-muted hover:text-foreground"
          >
            <Icon name="menu" size={18} />
          </button>
        </div>

        <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
