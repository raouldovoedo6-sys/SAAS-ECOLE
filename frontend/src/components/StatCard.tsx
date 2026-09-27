import type { LucideIcon } from "lucide-react";

type StatColor = "blue" | "green" | "amber" | "red" | "purple";

export function StatCard({
  icon: Icon,
  color,
  label,
  value,
}: {
  icon: LucideIcon;
  color: StatColor;
  label: string;
  value: string;
}) {
  return (
    <div className="kpi-card">
      <span className={`kpi-icon ${color}`}>
        <Icon size={20} />
      </span>
      <div className="kpi-body">
        <span className="kpi-label">{label}</span>
        <span className="kpi-value">{value}</span>
      </div>
    </div>
  );
}
