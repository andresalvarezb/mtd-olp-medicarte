'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useRole } from '@/components/layout/role-context';

export function AdministracionView() {
  const router = useRouter();
  const { hasPermission } = useRole();
  useEffect(() => {
    router.replace(
      hasPermission('users.manage')
        ? '/administracion/usuarios'
        : '/administracion/accesos-operacionales',
    );
  }, [hasPermission, router]);
  return null;
}
