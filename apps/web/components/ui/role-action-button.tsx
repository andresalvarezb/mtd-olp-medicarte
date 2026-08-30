'use client';

import type { ReactNode } from 'react';
import { useRole } from '@/components/layout/role-context';

/**
 * Acción visible solo para un rol (equivalente a data-role-action del prototipo).
 * El alcance real siempre se revalida en el backend.
 */
export function RoleActionButton({ allowedRole, children }: { allowedRole: string; children: ReactNode }) {
  const { role } = useRole();
  if (role !== allowedRole) return null;
  return <>{children}</>;
}
