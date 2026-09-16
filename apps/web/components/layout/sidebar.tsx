'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_SECTIONS } from '@/components/navigation/nav-config';
import { useRole } from '@/components/layout/role-context';

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { roles, hasPermission } = useRole();
  const pathname = usePathname();

  return (
    <>
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Navegación principal">
        <div className="brand">
          <img className="brand-mark" src="/mtd_logo.jpeg" alt="MTD" />
          <div>
            <h1>OLP - MEDICARTE</h1>
            <p>Plataforma de alto costo</p>
          </div>
        </div>

        <nav className="nav">
          {NAV_SECTIONS.map((section) => {
            const items = section.items
              .filter(
                (item) =>
                  (!item.permission || hasPermission(item.permission)) &&
                  item.roles.some((r) => roles.includes(r)),
              )
              .sort((a, b) => Number.parseInt(a.icon, 10) - Number.parseInt(b.icon, 10));
            if (items.length === 0) return null;
            return (
              <div key={section.label}>
                <div className="nav-section">{section.label}</div>
                {items.map((item, index) => (
                  <Link
                    key={item.view}
                    href={item.href}
                    className={`nav-item${pathname === item.href ? ' active' : ''}`}
                    onClick={onClose}
                  >
                    <span className="nav-icon">{String(index + 1).padStart(2, '0')}</span>
                    {item.title}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div
        className={`mobile-backdrop${open ? ' show' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
    </>
  );
}
