export type Role = 'MTD' | 'MTD_GENERAL' | 'MTD_AUDITORIA' | 'COMPENSAR' | 'OLP' | 'MEDICARTE';

export const ROLES: Role[] = [
  'MTD',
  'MTD_GENERAL',
  'MTD_AUDITORIA',
  'COMPENSAR',
  'OLP',
  'MEDICARTE',
];

export const ROLE_META: Record<Role, { label: string; note: string }> = {
  MTD: {
    label: 'MTD Admin',
    note: 'Vista MTD: acceso integral a operación, auditoría, integraciones y administración.',
  },
  MTD_GENERAL: {
    label: 'MTD General',
    note: 'Consulta y exportación de las etapas operativas autorizadas.',
  },
  MTD_AUDITORIA: {
    label: 'MTD Auditoría',
    note: 'Consulta gerencial y de autorizaciones, con operación completa de Auditoría.',
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
  | 'tariff'
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
  permission: string;
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
        permission: 'view.dashboard',
        roles: ['MTD', 'MTD_AUDITORIA', 'COMPENSAR'],
      },
      {
        view: 'authorizations',
        href: '/autorizaciones',
        title: 'Autorizaciones',
        icon: '02',
        permission: 'view.authorizations',
        roles: ['MTD', 'MTD_AUDITORIA', 'COMPENSAR'],
      },
    ],
  },
  {
    label: 'Operación',
    items: [
      {
        view: 'imports',
        href: '/cargas',
        title: 'Cargas',
        icon: '03',
        permission: 'view.admin',
        roles: ['MTD'],
      },
      {
        view: 'mipres',
        href: '/mipres',
        title: 'Direccionamientos MIPRES',
        icon: '04',
        permission: 'view.mipres',
        roles: ['MTD', 'MTD_GENERAL'],
      },
      {
        view: 'available',
        href: '/listos-para-dispensar',
        title: 'Listos para dispensar',
        icon: '05',
        permission: 'view.available',
        roles: ['MTD', 'MTD_GENERAL', 'OLP', 'MEDICARTE'],
      },
      {
        view: 'application',
        href: '/puntos-de-aplicacion',
        title: 'Puntos de aplicación',
        icon: '06',
        permission: 'view.application',
        roles: ['MTD', 'MTD_GENERAL', 'MEDICARTE'],
      },
      {
        view: 'logistics',
        href: '/logistica-olp',
        title: 'Logística OLP',
        icon: '07',
        permission: 'view.logistics',
        roles: ['MTD', 'MTD_GENERAL', 'OLP'],
      },
      {
        view: 'supports',
        href: '/soportes',
        title: 'Soportes',
        icon: '08',
        permission: 'view.supports',
        roles: ['MTD', 'MTD_GENERAL', 'MEDICARTE'],
      },
      {
        view: 'audit',
        href: '/auditoria',
        title: 'Auditoría',
        icon: '09',
        permission: 'view.audit',
        roles: ['MTD', 'MTD_AUDITORIA'],
      },
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
        permission: 'view.notifications',
        roles: ['MTD'],
      },
      {
        view: 'exports',
        href: '/consolidado',
        title: 'Consolidado',
        icon: '11',
        permission: 'view.consolidated',
        roles: ['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'COMPENSAR', 'OLP', 'MEDICARTE'],
      },
      {
        view: 'failures',
        href: '/fallos-recuperables',
        title: 'Fallos recuperables',
        icon: '12',
        permission: 'view.failures',
        roles: ['MTD'],
      },
      {
        view: 'tariff',
        href: '/anexo-tarifario',
        title: 'Anexo Tarifario',
        icon: '13',
        permission: 'view.tariff',
        roles: ['MTD'],
      },
      {
        view: 'admin',
        href: '/administracion',
        title: 'Administración',
        icon: '14',
        permission: 'view.admin',
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
