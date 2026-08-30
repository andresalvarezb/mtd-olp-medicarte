import type { ReactNode } from 'react';

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function FilterActions({ children }: { children: ReactNode }) {
  return <div style={{ alignSelf: 'end' }}>{children}</div>;
}
