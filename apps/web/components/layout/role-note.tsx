'use client';

import { useRole } from '@/components/layout/role-context';

export function RoleNote() {
  const { roleNote } = useRole();
  return <div className="role-note">{roleNote}</div>;
}
