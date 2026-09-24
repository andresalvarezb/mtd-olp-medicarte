import type { ReactNode } from 'react';

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="toolbar filter-bar">{children}</div>;
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field filter-field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function FilterActions({ children }: { children: ReactNode }) {
  return <div className="filter-actions">{children}</div>;
}
