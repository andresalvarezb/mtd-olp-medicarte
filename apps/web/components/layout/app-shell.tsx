'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { useRole } from '@/components/layout/role-context';
import { ALL_NAV_ITEMS } from '@/components/navigation/nav-config';

const PUBLIC_ROUTES = ['/login'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { role, status } = useRole();
  const pathname = usePathname();
  const router = useRouter();

  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  const currentItem = ALL_NAV_ITEMS.find((item) => item.href === pathname);

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated' && !isPublicRoute) {
      router.replace('/login');
      return;
    }
    if (status === 'authenticated' && pathname === '/login') {
      router.replace('/');
      return;
    }
    if (currentItem && !currentItem.roles.includes(role)) {
      router.replace('/');
    }
  }, [currentItem, role, router, status, isPublicRoute, pathname]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (isPublicRoute) {
    return <>{children}</>;
  }

  if (status !== 'authenticated') {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        Cargando…
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <section className="content">
        <Topbar onOpenMenu={() => setMenuOpen(true)} />
        <main className="main">
          {children}
        </main>
      </section>
    </div>
  );
}
