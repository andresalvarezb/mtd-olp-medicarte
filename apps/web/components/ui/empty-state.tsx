interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  minHeight?: number;
}

export function EmptyState({ icon, title, description, minHeight }: EmptyStateProps) {
  return (
    <div className="empty-state" style={minHeight ? { minHeight } : undefined}>
      <div className="empty-icon">{icon}</div>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
