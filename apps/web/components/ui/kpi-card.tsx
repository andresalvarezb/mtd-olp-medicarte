import type { ReactNode } from 'react';
import { formatNumber } from '@/lib/labels';

interface KpiCardProps {
  label: string;
  value: number | string;
  foot: string;
  icon: string;
  iconBg: string;
  iconColor: string;
}

export function KpiCard({ label, value, foot, icon, iconBg, iconColor }: KpiCardProps) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span>{label}</span>
        <div className="kpi-icon" style={{ background: iconBg, color: iconColor }}>
          {icon}
        </div>
      </div>
      <div className="kpi-value">{typeof value === 'number' ? formatNumber(value) : value}</div>
      <div className="kpi-foot">{foot}</div>
    </div>
  );
}

export function KpiGrid({ children, columns = 4 }: { children: ReactNode; columns?: 3 | 4 }) {
  return <div className={`grid ${columns === 3 ? 'three-col' : 'kpis'}`}>{children}</div>;
}
