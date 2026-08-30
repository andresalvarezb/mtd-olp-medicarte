import type { ReactNode } from 'react';

export function Timeline({ items }: { items: { title: string; description: string }[] }) {
  return (
    <div className="timeline">
      {items.map((item, index) => (
        <div className="tl-item" key={item.title}>
          <div className="tl-dot">{index + 1}</div>
          <div className="tl-copy">
            <strong>{item.title}</strong>
            <span>{item.description}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="note">{children}</div>;
}
