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
  | 'planningPeriods'
  | 'projectedDemand'
  | 'purchaseOrders'
  | 'supplierPurchaseOrders'
  | 'supplierDeliveries'
  | 'medicarteDeliveries'
  | 'medicarteReceipts'
  | 'inventory'
  | 'stockTransfers'
  | 'patientApplications'
  | 'operationalOutcomes'
  | 'applicationAudits'
  | 'operationalIndicators'
  | 'bulkImports'
  | 'operationalIntegrity'
  | 'operationalScopes'
  | 'admin'
  | 'roles';

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
        view: 'operationalIndicators',
        href: '/indicadores',
        title: 'Indicadores',
        icon: '01',
        permission: 'analytics.read',
        roles: ['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY'],
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
        view: 'projectedDemand',
        href: '/demanda',
        title: 'Demanda proyectada',
        icon: '03',
        permission: 'projected_demand.read',
        roles: ['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY'],
      },
      {
        view: 'purchaseOrders',
        href: '/ordenes-compra',
        title: 'Órdenes de compra',
        icon: '04',
        permission: 'purchase_orders.read',
        roles: ['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY'],
      },
      {
        view: 'supplierPurchaseOrders',
        href: '/logistica-olp',
        title: 'Revisión OLP',
        icon: '05',
        permission: 'purchase_orders.read',
        roles: ['OLP'],
      },
      {
        view: 'supplierDeliveries',
        href: '/entregas-olp',
        title: 'Entregas OLP',
        icon: '06',
        permission: 'supplier_deliveries.read',
        roles: ['OLP'],
      },
      {
        view: 'medicarteDeliveries',
        href: '/entregas',
        title: 'Entregas en camino',
        icon: '07',
        permission: 'supplier_deliveries.read',
        roles: ['MEDICARTE'],
      },
      {
        view: 'medicarteReceipts',
        href: '/recepciones',
        title: 'Recepciones',
        icon: '08',
        permission: 'medicarte_receipts.read',
        roles: ['MEDICARTE'],
      },
      {
        view: 'inventory',
        href: '/inventario',
        title: 'Inventario operacional',
        icon: '09',
        permission: 'inventory.read',
        roles: ['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'MEDICARTE'],
      },
      {
        view: 'stockTransfers',
        href: '/traslados',
        title: 'Traslados',
        icon: '10',
        permission: 'stock_transfers.read',
        roles: ['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'MEDICARTE'],
      },
      {
        view: 'patientApplications',
        href: '/aplicaciones',
        title: 'Aplicaciones al paciente',
        icon: '11',
        permission: 'patient_applications.read',
        roles: ['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY'],
      },
      {
        view: 'operationalOutcomes',
        href: '/resultados-operacionales',
        title: 'Resultados operacionales',
        icon: '12',
        permission: 'patient_operational_outcomes.read',
        roles: ['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'MEDICARTE', 'READ_ONLY'],
      },
      {
        view: 'applicationAudits',
        href: '/auditorias',
        title: 'Auditoría de aplicaciones',
        icon: '13',
        permission: 'application_audits.read',
        roles: ['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY'],
      },
      {
        view: 'bulkImports',
        href: '/importaciones',
        title: 'Importaciones',
        icon: '14',
        permission: 'bulk_imports.read',
        roles: ['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'MEDICARTE', 'READ_ONLY'],
      },
      {
        view: 'operationalIntegrity',
        href: '/integridad',
        title: 'Integridad operacional',
        icon: '15',
        permission: 'reconciliation.read',
        roles: ['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY'],
      },
      {
        view: 'admin',
        href: '/administracion/usuarios',
        title: 'Usuarios y acceso',
        icon: '16',
        permission: 'users.manage',
        roles: ['MTD'],
      },
      {
        view: 'operationalScopes',
        href: '/administracion/accesos-operacionales',
        title: 'Accesos operacionales',
        icon: '17',
        permission: 'operational_scopes.read',
        roles: ['MTD', 'MTD_AUDITORIA'],
      },
      {
        view: 'roles',
        href: '/administracion/roles',
        title: 'Roles y permisos',
        icon: '18',
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
