'use client';

import { PageHeader } from '@/components/ui/page-header';
import { useRole } from '@/components/layout/role-context';
import { UsersAdminSection } from './users-admin';

export function AdministracionView() {
  const { organizationId, hasPermission } = useRole();
  return (
    <>
      <PageHeader
        title="Usuarios y acceso"
        description="Administración de identidades, organizaciones y roles conservada como fundamento de ESP-015."
      />
      <UsersAdminSection organizationId={organizationId} enabled={hasPermission('users.manage')} />
    </>
  );
}
