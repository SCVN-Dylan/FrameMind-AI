import Icon, { type IconName } from "./Icon";

type StatCardProps = {
  label: string;
  value: string | number;
  hint: string;
  icon: IconName;
};

export default function StatCard({ label, value, hint, icon }: StatCardProps) {
  return (
    <div className="group rounded-2xl border border-border/70 bg-surface p-5 transition-colors duration-200 hover:border-primary-soft/40">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{label}</p>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary-soft transition-transform duration-200 group-hover:scale-105">
          <Icon name={icon} size={18} />
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}
