'use client';

import type { ReactNode } from 'react';
import { useRole } from '@/components/layout/role-context';

/** Acción visible solo cuando el perfil tiene el permiso correspondiente. */
export function RoleActionButton({
  requiredPermission,
  children,
}: {
  requiredPermission: string;
  children: ReactNode;
}) {
  const { hasPermission } = useRole();
  if (!hasPermission(requiredPermission)) return null;
  return <>{children}</>;
}
