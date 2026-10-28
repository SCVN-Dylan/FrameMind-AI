import type { ReactNode } from "react";

import AppStatus from "./AppStatus";

type PageHeaderProps = {
  title: string;
  description: string;
  /** Extra items shown next to the status pill (badges, buttons). */
  actions?: ReactNode;
};

export default function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted sm:text-base">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        <AppStatus />
      </div>
    </header>
  );
}
