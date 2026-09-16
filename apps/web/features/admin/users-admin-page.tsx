'use client';
import { PageHeader } from '@/components/ui/page-header';
import { useRole } from '@/components/layout/role-context';
import { UsersAdminSection } from './users-admin';
export function UsersAdminPage() {
  const { organizationId, hasPermission } = useRole();
  return (
    <>
      <PageHeader title="Usuarios" description="Gestiona usuarios y asignaciones." />
      <UsersAdminSection organizationId={organizationId} enabled={hasPermission('users.manage')} />
    </>
  );
}
