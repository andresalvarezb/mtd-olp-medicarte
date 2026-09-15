'use client';

import { Card, CardBody } from '@/components/ui/card';
import { useRole } from '@/components/layout/role-context';

export function useActivePointAccess() {
  const { me, organizationId } = useRole();
  const organization = me?.organizations.find((candidate) => candidate.id === organizationId);
  return organization?.pointAccess ?? { kind: 'unrestricted' as const, accessiblePointIds: [] };
}

export function EmptyPointScopeNotice() {
  return (
    <Card>
      <CardBody>
        <p role="status">No tienes puntos de dispensación asignados.</p>
      </CardBody>
    </Card>
  );
}

export function PointScopeGuard({ children }: { children: React.ReactNode }) {
  const pointAccess = useActivePointAccess();
  if (pointAccess.kind === 'explicit' && pointAccess.accessiblePointIds.length === 0) {
    return <EmptyPointScopeNotice />;
  }
  return children;
}
