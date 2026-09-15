'use client';

import { PageHeader } from '@/components/ui/page-header';
import { useRole } from '@/components/layout/role-context';
import { UsersAdminSection } from './users-admin';
import { OperationalScopesSection } from './operational-scopes-section';

export function AdministracionView() {
  const { organizationId, hasPermission } = useRole();
  return (
    <>
      <PageHeader
        title="Usuarios y acceso"
        description="Identidades, roles y alcance operacional por punto de dispensación."
      />
      <UsersAdminSection organizationId={organizationId} enabled={hasPermission('users.manage')} />
      <OperationalScopesSection
        organizationId={organizationId}
        canRead={hasPermission('operational_scopes.read')}
        canManage={hasPermission('operational_scopes.manage')}
      />
    </>
  );
}
