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

export const ROLE_META: Record<
  Role,
  {
    label: string;
    note: string;
  }
> = {
  MTD: {
    label: 'MTD Admin',
    note: 'Administración MTD.',
  },

  MTD_GENERAL: {
    label: 'MTD General',
    note: 'Operación MTD.',
  },

  MTD_AUDITORIA: {
    label: 'MTD Auditoría',
    note: 'Auditoría MTD.',
  },

  COMPENSAR: {
    label: 'Compensar',
    note: 'Organización Compensar.',
  },

  OLP: {
    label: 'OLP',
    note: 'Operación OLP.',
  },

  MEDICARTE: {
    label: 'Medicarte',
    note: 'Operación Medicarte.',
  },

  READ_ONLY: {
    label: 'Solo lectura',
    note: 'Consulta.',
  },
};

export type NavIcon =
  | 'dashboard'
  | 'authorizations'
  | 'inventory'
  | 'upload'
  | 'search'
  | 'purchaseOrder'
  | 'tariff';

export type ViewId =
  | 'operationalIndicators'
  | 'authorizations'
  | 'authorizationQuery'
  | 'purchaseOrders'
  | 'purchaseConfiguration'
  | 'inventoryAvailability'

  // Vistas internas conservadas fuera
  // del menú principal.
  | 'planningPeriods'
  | 'projectedDemand'
  | 'supplierPurchaseOrders'
  | 'supplierDeliveries'
  | 'medicarteDeliveries'
  | 'medicarteReceipts'
  | 'inventory'
  | 'stockTransfers'
  | 'patientApplications'
  | 'operationalOutcomes'
  | 'applicationAudits'
  | 'bulkImports'
  | 'operationalIntegrity'
  | 'operationalScopes'
  | 'admin'
  | 'roles';

export interface NavItem {
  kind?: 'item';

  view: ViewId;

  href: string;

  title: string;

  icon?: NavIcon;

  roles: Role[];

  permission?: string;
}

export interface NavGroup {
  kind: 'group';

  title: string;

  icon: NavIcon;

  children: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

export interface NavSection {
  label: string;

  items: NavEntry[];
}

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return entry.kind === 'group';
}

const MTD_ROLES: Role[] = ['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY'];

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Operación',

    items: [
      {
        view: 'operationalIndicators',

        href: '/indicadores',

        title: 'Dashboard',

        icon: 'dashboard',

        permission: 'analytics.read',

        roles: MTD_ROLES,
      },

      {
        kind: 'group',

        title: 'Autorizaciones',

        icon: 'authorizations',

        children: [
          {
            view: 'authorizations',

            href: '/autorizaciones',

            title: 'Cargar',

            icon: 'upload',

            permission: 'authorizations.read',

            roles: MTD_ROLES,
          },

          {
            view: 'authorizationQuery',

            href: '/autorizaciones/consulta',

            title: 'Consultar',

            icon: 'search',

            permission: 'authorizations.read',

            roles: MTD_ROLES,
          },
        ],
      },

      {
        kind: 'group',

        title: 'Inventario',

        icon: 'inventory',

        children: [
          {
            view: 'inventoryAvailability',

            href: '/inventario/disponibilidad',

            title: 'Disponibilidad',

            icon: 'inventory',

            permission: 'inventory.read',

            roles: MTD_ROLES,
          },

          {
            view: 'purchaseOrders',

            href: '/ordenes-compra',

            title: 'Orden de compra',

            icon: 'purchaseOrder',

            permission: 'purchase_orders.read',

            roles: MTD_ROLES,
          },

          {
            view: 'purchaseConfiguration',

            href: '/ordenes-compra/configuracion',

            title: 'Anexo Tarifario',

            icon: 'tariff',

            permission: 'tariff_annex.read',

            roles: ['MTD'],
          },
        ],
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) =>
  section.items.flatMap((entry) => (isNavGroup(entry) ? entry.children : [entry])),
);

export function titleForPath(pathname: string): string {
  return ALL_NAV_ITEMS.find((item) => item.href === pathname)?.title ?? 'Plataforma';
}
