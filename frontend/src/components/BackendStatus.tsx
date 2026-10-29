"use client";

import { useEffect, useState } from "react";

import { API_BASE_URL, getHealth, type HealthResponse } from "@/lib/api";
import { useI18n } from "@/lib/i18n/I18nProvider";

type State =
  | { kind: "loading" }
  | { kind: "ok"; health: HealthResponse }
  | { kind: "error"; message: string };

export default function BackendStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const { t } = useI18n();

  useEffect(() => {
    getHealth()
      .then((health) => setState({ kind: "ok", health }))
      .catch((error: Error) =>
        setState({ kind: "error", message: error.message }),
      );
  }, []);

  if (state.kind === "loading") {
    return <p className="text-sm text-muted">{t.backend.checking}</p>;
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">
        <p className="font-medium">{t.backend.unreachable(API_BASE_URL)}</p>
        <p className="mt-1 text-rose-200/80">{state.message}</p>
        <p className="mt-2 text-rose-200/80">
          {t.backend.startWith} <code className="font-mono">uvicorn app.main:app --reload</code> {t.backend.inside}{" "}
          <code className="font-mono">backend/</code>. {t.backend.stillWorks}
        </p>
      </div>
    );
  }

  const { health } = state;
  const checks: [string, boolean][] = [
    [t.backend.database, health.database],
    [t.backend.storage, health.storage],
    [t.backend.ffmpeg, health.ffmpeg],
  ];

  return (
    <div className="rounded-xl border border-border bg-background/50 p-4 text-sm">
      <p className="font-medium text-emerald-300">
        {t.backend.connected(health.version, health.environment)}
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-2 text-muted">
        {checks.map(([label, ok]) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-muted/60"}`}
            />
            {label}: {ok ? t.backend.ready : t.backend.notSetUp}
          </li>
        ))}
      </ul>
    </div>
  );
}
