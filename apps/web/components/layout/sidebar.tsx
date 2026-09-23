'use client';

import {
  useEffect,
  useState,
  type ComponentType,
} from 'react';

import Link from 'next/link';

import {
  usePathname,
  useRouter,
} from 'next/navigation';

import {
  ArchiveIcon,
  ChevronDownIcon,
  DashboardIcon,
  ExitIcon,
  FileTextIcon,
  GearIcon,
  MagnifyingGlassIcon,
  ReaderIcon,
  UploadIcon,
} from '@radix-ui/react-icons';

import {
  NAV_SECTIONS,
  isNavGroup,
  type NavIcon,
  type NavItem,
} from '@/components/navigation/nav-config';

import {
  useRole,
} from '@/components/layout/role-context';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

type IconComponent =
  ComponentType<{
    width?: number;
    height?: number;
    'aria-hidden'?: boolean;
  }>;

const ICONS: Record<
  NavIcon,
  IconComponent
> = {
  dashboard: DashboardIcon,
  authorizations: ReaderIcon,
  inventory: ArchiveIcon,
  upload: UploadIcon,
  search: MagnifyingGlassIcon,
  purchaseOrder: FileTextIcon,
  tariff: GearIcon,
};

function NavigationIcon({
  icon,
}: {
  icon: NavIcon | undefined;
}) {
  if (!icon) {
    return null;
  }

  const Icon =
    ICONS[icon];

  return (
    <Icon
      width={15}
      height={15}
      aria-hidden
    />
  );
}

export function Sidebar({
  open,
  onClose,
}: SidebarProps) {
  const {
    roles,
    roleLabel,
    user,
    logout,
    hasPermission,
  } = useRole();

  const pathname =
    usePathname();

  const router =
    useRouter();

  const [
    openGroups,
    setOpenGroups,
  ] = useState<Set<string>>(
    () =>
      new Set([
        'Autorizaciones',
        'Inventario',
      ]),
  );

  function canAccess(
    item: NavItem,
  ): boolean {
    return (
      item.roles.some(
        (role) =>
          roles.includes(role),
      ) &&
      (
        item.permission ===
          undefined ||
        hasPermission(
          item.permission,
        )
      )
    );
  }

  useEffect(() => {
    for (
      const section
      of NAV_SECTIONS
    ) {
      for (
        const entry
        of section.items
      ) {
        if (
          !isNavGroup(
            entry,
          )
        ) {
          continue;
        }

        if (
          entry.children.some(
            (child) =>
              child.href ===
              pathname,
          )
        ) {
          setOpenGroups(
            new Set([
              entry.title,
            ]),
          );

          return;
        }
      }
    }

    /*
     * Si la ruta activa no pertenece a un grupo
     * desplegable, cerramos todos.
     */
    setOpenGroups(
      new Set(),
    );
  }, [pathname]);

  function toggleGroup(
    title: string,
  ) {
    setOpenGroups(
      (current) => {
        /*
         * Acordeón:
         * - si el grupo ya está abierto, lo cerramos;
         * - si está cerrado, abrimos únicamente ese grupo.
         */
        if (
          current.has(
            title,
          )
        ) {
          return new Set();
        }

        return new Set([
          title,
        ]);
      },
    );
  }

  function handleLogout() {
    logout();

    router.replace(
      '/login',
    );
  }

  return (
    <>
      <aside
        className={[
          'sidebar',
          'sidebar-auto-compact',
          open
            ? 'open'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label="Navegación principal"
      >
        <div className="sidebar-brand-row">
          <div className="brand">
            <div className="brand-symbol">
              MTD
            </div>

            <div className="brand-copy">
              <h1>
                Alto costo
              </h1>

              <p>
                Operación
              </p>
            </div>
          </div>
        </div>

        <nav className="nav">
          {NAV_SECTIONS.map(
            (section) => (
              <div
                key={
                  section.label
                }
                className="nav-group"
              >
                {section.items.map(
                  (entry) => {
                    if (
                      isNavGroup(
                        entry,
                      )
                    ) {
                      const children =
                        entry.children.filter(
                          canAccess,
                        );

                      if (
                        children.length ===
                        0
                      ) {
                        return null;
                      }

                      const active =
                        children.some(
                          (child) =>
                            pathname ===
                            child.href,
                        );

                      const expanded =
                        openGroups.has(
                          entry.title,
                        );

                      return (
                        <div
                          key={
                            entry.title
                          }
                          className="nav-parent-block"
                        >
                          <button
                            type="button"
                            className={[
                              'nav-item',
                              'nav-parent',
                              active
                                ? 'active'
                                : '',
                            ]
                              .filter(
                                Boolean,
                              )
                              .join(' ')}
                            aria-expanded={
                              expanded
                            }
                            aria-label={
                              entry.title
                            }
                            onClick={() =>
                              toggleGroup(
                                entry.title,
                              )
                            }
                          >
                            <span className="nav-icon">
                              <NavigationIcon
                                icon={
                                  entry.icon
                                }
                              />
                            </span>

                            <span className="nav-label">
                              {
                                entry.title
                              }
                            </span>

                            <span
                              className={[
                                'nav-chevron',
                                expanded
                                  ? 'expanded'
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              <ChevronDownIcon />
                            </span>
                          </button>

                          <div
                            className={[
                              'nav-submenu',
                              expanded
                                ? 'expanded'
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            aria-hidden={
                              !expanded
                            }
                          >
                            <div className="nav-submenu-inner">
                              {children.map(
                                (
                                  child,
                                ) => (
                                  <Link
                                    key={
                                      child.view
                                    }
                                    href={
                                      child.href
                                    }
                                    tabIndex={
                                      expanded
                                        ? 0
                                        : -1
                                    }
                                    className={[
                                      'nav-subitem',
                                      pathname ===
                                      child.href
                                        ? 'active'
                                        : '',
                                    ]
                                      .filter(
                                        Boolean,
                                      )
                                      .join(
                                        ' ',
                                      )}
                                    onClick={
                                      onClose
                                    }
                                  >
                                    <span className="nav-sub-icon">
                                      <NavigationIcon
                                        icon={
                                          child.icon
                                        }
                                      />
                                    </span>

                                    <span className="nav-sub-label">
                                      {
                                        child.title
                                      }
                                    </span>
                                  </Link>
                                ),
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    if (
                      !canAccess(
                        entry,
                      )
                    ) {
                      return null;
                    }

                    return (
                      <Link
                        key={
                          entry.view
                        }
                        href={
                          entry.href
                        }
                        aria-label={
                          entry.title
                        }
                        className={[
                          'nav-item',
                          pathname ===
                          entry.href
                            ? 'active'
                            : '',
                        ]
                          .filter(
                            Boolean,
                          )
                          .join(' ')}
                        onClick={
                          onClose
                        }
                      >
                        <span className="nav-icon">
                          <NavigationIcon
                            icon={
                              entry.icon
                            }
                          />
                        </span>

                        <span className="nav-label">
                          {
                            entry.title
                          }
                        </span>
                      </Link>
                    );
                  },
                )}
              </div>
            ),
          )}
        </nav>

        <div className="sidebar-account">
          <div className="sidebar-account-avatar">
            {user?.initials ??
              'UD'}
          </div>

          <div className="sidebar-account-copy">
            <strong>
              {user?.name ??
                'Usuario'}
            </strong>

            <span>
              {roleLabel}
            </span>
          </div>

          <button
            type="button"
            className="sidebar-logout"
            onClick={
              handleLogout
            }
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
          >
            <ExitIcon
              width={15}
              height={15}
            />
          </button>
        </div>
      </aside>

      <div
        className={[
          'mobile-backdrop',
          open
            ? 'show'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={
          onClose
        }
        aria-hidden="true"
      />
    </>
  );
}
