interface MetricMiniProps {
  label: string;
  value: number | string;
}

export function MetricMini({ label, value }: MetricMiniProps) {
  return (
    <div className="metric-mini">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function MetricList({ children }: { children: React.ReactNode }) {
  return <div className="metric-list">{children}</div>;
}
