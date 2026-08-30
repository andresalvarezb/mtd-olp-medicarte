import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card${className ? ` ${className}` : ''}`}>{children}</div>;
}

interface CardHeadProps {
  title: string;
  subtitle?: string;
  aside?: ReactNode;
}

export function CardHead({ title, subtitle, aside }: CardHeadProps) {
  return (
    <div className="card-head">
      <div>
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {aside}
    </div>
  );
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card-body${className ? ` ${className}` : ''}`}>{children}</div>;
}
