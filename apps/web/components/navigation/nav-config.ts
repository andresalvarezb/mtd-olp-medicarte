export type Role = 'MTD' | 'COMPENSAR' | 'OLP' | 'MEDICARTE';

export const ROLES: Role[] = ['MTD', 'COMPENSAR', 'OLP', 'MEDICARTE'];

export const ROLE_META: Record<Role, { label: string; note: string }> = {
  MTD: {
    label: 'MTD Admin',
    note: 'Vista MTD: acceso integral a operación, auditoría, integraciones y administración.',
  },
  COMPENSAR: {
    label: 'Compensar Viewer',
    note: 'Vista Compensar: consulta de autorizaciones y consolidado únicamente según permisos asignados.',
  },
  OLP: {
    label: 'OLP Operator',
    note: 'Vista OLP: consulta de autorizaciones disponibles, recepción de puntos de aplicación y coordinación logística.',
  },
  MEDICARTE: {
    label: 'Medicarte Operator',
    note: 'Vista Medicarte: disponibles, definición del punto de aplicación, registro de aplicación y carga de soportes.',
  },
};

export type ViewId =
  | 'dashboard'
  | 'authorizations'
  | 'imports'
  | 'mipres'
  | 'available'
  | 'application'
  | 'logistics'
  | 'supports'
  | 'audit'
  | 'notifications'
  | 'exports'
  | 'failures'
  | 'admin';

export interface NavSection {
  label: string;
  items: NavItem[];
}

export interface NavItem {
  view: ViewId;
  href: string;
  title: string;
  icon: string;
  roles: Role[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Principal',
    items: [
      {
        view: 'dashboard',
        href: '/',
        title: 'Resumen ejecutivo',
        icon: '01',
        roles: ['MTD', 'COMPENSAR', 'OLP', 'MEDICARTE'],
      },
      {
        view: 'authorizations',
        href: '/autorizaciones',
        title: 'Autorizaciones',
        icon: '02',
        roles: ['MTD', 'COMPENSAR'],
      },
    ],
  },
  {
    label: 'Operación',
    items: [
      { view: 'imports', href: '/cargas', title: 'Cargas', icon: '03', roles: ['MTD'] },
      {
        view: 'mipres',
        href: '/mipres',
        title: 'Direccionamientos MIPRES',
        icon: '04',
        roles: ['MTD'],
      },
      {
        view: 'available',
        href: '/listos-para-dispensar',
        title: 'Listos para dispensar',
        icon: '05',
        roles: ['MTD', 'OLP', 'MEDICARTE'],
      },
      {
        view: 'application',
        href: '/puntos-de-aplicacion',
        title: 'Puntos de aplicación',
        icon: '06',
        roles: ['MTD', 'MEDICARTE'],
      },
      {
        view: 'logistics',
        href: '/logistica-olp',
        title: 'Logística OLP',
        icon: '07',
        roles: ['MTD', 'OLP'],
      },
      {
        view: 'supports',
        href: '/soportes',
        title: 'Soportes',
        icon: '08',
        roles: ['MTD', 'MEDICARTE'],
      },
      { view: 'audit', href: '/auditoria', title: 'Auditoría', icon: '09', roles: ['MTD'] },
    ],
  },
  {
    label: 'Control',
    items: [
      {
        view: 'notifications',
        href: '/notificaciones',
        title: 'Notificaciones',
        icon: '10',
        roles: ['MTD'],
      },
      {
        view: 'exports',
        href: '/consolidado',
        title: 'Consolidado',
        icon: '11',
        roles: ['MTD', 'COMPENSAR', 'OLP', 'MEDICARTE'],
      },
      {
        view: 'failures',
        href: '/fallos-recuperables',
        title: 'Fallos recuperables',
        icon: '12',
        roles: ['MTD'],
      },
      {
        view: 'admin',
        href: '/administracion',
        title: 'Administración',
        icon: '13',
        roles: ['MTD'],
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

export function viewForPath(pathname: string): ViewId | undefined {
  return ALL_NAV_ITEMS.find((item) => item.href === pathname)?.view;
}

export function titleForPath(pathname: string): string {
  return ALL_NAV_ITEMS.find((item) => item.href === pathname)?.title ?? 'Resumen ejecutivo';
}
