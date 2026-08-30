'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_SECTIONS, ROLE_META, ROLES, type Role } from '@/components/navigation/nav-config';
import { useRole } from '@/components/layout/role-context';

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { role, setRole } = useRole();
  const pathname = usePathname();

  const changeRole = (next: Role) => {
    setRole(next);
  };

  return (
    <>
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Navegación principal">
        <div className="brand">
          <div className="brand-mark">MTD</div>
          <div>
            <h1>OLP - MEDICARTE</h1>
            <p>Plataforma de alto costo</p>
          </div>
        </div>

        <div className="role-preview">
          <label htmlFor="role-select">Vista de demostración</label>
          <select id="role-select" value={role} onChange={(e) => changeRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_META[r].selectLabel}
              </option>
            ))}
          </select>
        </div>

        <nav className="nav">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((item) => item.roles.includes(role));
            if (items.length === 0) return null;
            return (
              <div key={section.label}>
                <div className="nav-section">{section.label}</div>
                {items.map((item) => (
                  <Link
                    key={item.view}
                    href={item.href}
                    className={`nav-item${pathname === item.href ? ' active' : ''}`}
                    onClick={onClose}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    {item.title}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <strong>Prototipo</strong>
          <br />
          Todas las bandejas se muestran vacías para representar el estado inicial del producto.
        </div>
      </aside>
      <div
        className={`mobile-backdrop${open ? ' show' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
    </>
  );
}
