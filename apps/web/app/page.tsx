'use client';

import {
  useEffect,
} from 'react';

import {
  useRouter,
} from 'next/navigation';

import {
  useRole,
} from '@/components/layout/role-context';


export default function HomePage() {
  const router =
    useRouter();

  const {
    roles,
    status,
  } =
    useRole();


  useEffect(
    () => {
      if (
        status !==
        'authenticated'
      ) {
        return;
      }

      if (
        roles.includes(
          'OLP',
        )
      ) {
        router.replace(
          '/ordenes-compra',
        );

        return;
      }

      if (
        roles.includes(
          'MEDICARTE',
        )
      ) {
        router.replace(
          '/autorizaciones/consulta',
        );

        return;
      }

      router.replace(
        '/indicadores',
      );
    },
    [
      roles,
      router,
      status,
    ],
  );


  return (
    <div
      className="app-loading"
      role="status"
      aria-live="polite"
    >
      Cargando…
    </div>
  );
}
