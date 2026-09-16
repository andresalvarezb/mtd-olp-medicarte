'use client';

import type { ReactNode } from 'react';
import { useRole } from '@/components/layout/role-context';

/**
 * Acción visible solo para un rol según las credenciales del usuario.
 * El alcance real siempre se revalida en el backend.
 */
export function RoleActionButton({
  allowedRole,
  children,
}: {
  allowedRole: string;
  children: ReactNode;
}) {
  const { roles } = useRole();
  if (!roles.includes(allowedRole as never)) return null;
  return <>{children}</>;
}
