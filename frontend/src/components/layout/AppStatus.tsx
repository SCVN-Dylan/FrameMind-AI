"use client";

import { useEffect, useState } from "react";

import { API_BASE_URL, getHealth } from "@/lib/api";
import { useI18n } from "@/lib/i18n/I18nProvider";

type Status = "checking" | "online" | "offline";

const DOT: Record<Status, string> = {
  checking: "bg-muted animate-pulse",
  online: "bg-emerald-400",
  offline: "bg-rose-400",
};

/** Small pill in the page header showing whether the FastAPI backend is reachable. */
export default function AppStatus() {
  const [status, setStatus] = useState<Status>("checking");
  const { t } = useI18n();

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then(() => !cancelled && setStatus("online"))
      .catch(() => !cancelled && setStatus("offline"));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <span
      title={status === "offline" ? t.appStatus.unreachable(API_BASE_URL) : API_BASE_URL}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted"
    >
      <span className={`h-2 w-2 rounded-full ${DOT[status]}`} />
      {t.appStatus[status]}
    </span>
  );
}
