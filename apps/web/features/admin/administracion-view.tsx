'use client';

import { PageHeader } from '@/components/ui/page-header';
import { useRole } from '@/components/layout/role-context';
import { OperationalScopesSection } from './operational-scopes-section';
import { UsersAdminSection } from './users-admin';

export function AdministracionView() {
  const { organizationId, hasPermission } = useRole();
  return (
    <>
      <PageHeader
        title="Administración de usuarios y accesos"
        description="Gestiona cuentas, asignaciones de roles y el alcance por punto de dispensación. Los roles se configuran en la sección Roles y permisos."
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
