'use client';

import { PageHeader } from '@/components/ui/page-header';
import { useRole } from '@/components/layout/role-context';
import { RolesAdminSection } from './roles-admin';

export function RolesView() {
  const { organizationId, hasPermission } = useRole();
  return (
    <>
      <PageHeader
        title="Roles y permisos"
        description="Define qué acciones puede ejecutar cada rol y crea roles personalizados con alcance organizacional."
      />
      <RolesAdminSection organizationId={organizationId} enabled={hasPermission('users.manage')} />
    </>
  );
}
