'use client';

import { usePathname, useRouter } from 'next/navigation';
import { ROLE_META, titleForPath } from '@/components/navigation/nav-config';
import { useRole } from '@/components/layout/role-context';

interface TopbarProps {
  onOpenMenu: () => void;
}

export function Topbar({ onOpenMenu }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { role, roleLabel, user, logout } = useRole();
  const title = titleForPath(pathname);

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  return (
    <header className="topbar">
      <div className="top-left">
        <button className="mobile-menu" onClick={onOpenMenu} aria-label="Abrir menú">
          ☰
        </button>
        <div>
          <div className="crumbs">
            Plataforma / <span>{ROLE_META[role].selectLabel.split(' — ')[0]}</span>
          </div>
          <div className="page-name">{title}</div>
        </div>
      </div>
      <div className="top-actions">
        <span className="env-badge">PROTOTIPO</span>
        <div className="user-chip">
          <div className="avatar">{user?.initials ?? 'UD'}</div>
          <div className="user-meta">
            <strong>{user?.name ?? 'Usuario demostración'}</strong>
            <span>{roleLabel}</span>
          </div>
        </div>
        <button className="logout-btn" onClick={handleLogout} aria-label="Cerrar sesión">
          Salir
        </button>
      </div>
    </header>
  );
}
