export type PillTone = 'gray' | 'blue' | 'green' | 'orange' | 'red' | 'purple';

export function StatusBadge({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}
