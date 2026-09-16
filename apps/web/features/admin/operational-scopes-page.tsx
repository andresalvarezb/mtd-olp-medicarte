'use client';
import { PageHeader } from '@/components/ui/page-header';
import { useRole } from '@/components/layout/role-context';
import { OperationalScopesSection } from './operational-scopes-section';
export function OperationalScopesPage() {
  const { organizationId, hasPermission } = useRole();
  return (
    <>
      <PageHeader
        title="Accesos operacionales"
        description="Gestiona el alcance por punto de dispensación."
      />
      <OperationalScopesSection
        organizationId={organizationId}
        canRead={hasPermission('operational_scopes.read')}
        canManage={hasPermission('operational_scopes.manage')}
      />
    </>
  );
}
