export type Role =
  | 'MTD'
  | 'MTD_GENERAL'
  | 'MTD_AUDITORIA'
  | 'COMPENSAR'
  | 'OLP'
  | 'MEDICARTE'
  | 'READ_ONLY';

export const ROLES: Role[] = [
  'MTD',
  'MTD_GENERAL',
  'MTD_AUDITORIA',
  'COMPENSAR',
  'OLP',
  'MEDICARTE',
  'READ_ONLY',
];

export const ROLE_META: Record<Role, { label: string; note: string }> = {
  MTD: { label: 'MTD Admin', note: 'Administración MTD.' },
  MTD_GENERAL: { label: 'MTD General', note: 'Operación MTD.' },
  MTD_AUDITORIA: { label: 'MTD Auditoría', note: 'Auditoría MTD.' },
  COMPENSAR: { label: 'Compensar', note: 'Organización Compensar.' },
  OLP: { label: 'OLP', note: 'Abastecimiento sin acceso a datos clínicos.' },
  MEDICARTE: { label: 'Medicarte', note: 'Programación y operación física.' },
  READ_ONLY: { label: 'Solo lectura', note: 'Acceso de consulta según organización.' },
};

export type ViewId =
  | 'foundation'
  | 'planningPeriods'
  | 'patientScheduling'
  | 'projectedDemand'
  | 'admin';

export interface NavItem {
  view: ViewId;
  href: string;
  title: string;
  icon: string;
  roles: Role[];
  permission?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Plataforma',
    items: [
      {
        view: 'foundation',
        href: '/',
        title: 'Base de reconstrucción',
        icon: '01',
        roles: ROLES,
      },
      {
        view: 'planningPeriods',
        href: '/periodos',
        title: 'Períodos',
        icon: '02',
        permission: 'planning_periods.read',
        roles: ['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY'],
      },
      {
        view: 'patientScheduling',
        href: '/programacion',
        title: 'Programación de pacientes',
        icon: '03',
        permission: 'patient_schedules.read',
        roles: ['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'MEDICARTE', 'READ_ONLY'],
      },
      {
        view: 'projectedDemand',
        href: '/demanda',
        title: 'Demanda proyectada',
        icon: '04',
        permission: 'projected_demand.read',
        roles: ['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY'],
      },
      {
        view: 'admin',
        href: '/administracion',
        title: 'Usuarios y acceso',
        icon: '05',
        permission: 'users.manage',
        roles: ['MTD'],
      },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

export function titleForPath(pathname: string): string {
  return ALL_NAV_ITEMS.find((item) => item.href === pathname)?.title ?? 'Plataforma';
}
