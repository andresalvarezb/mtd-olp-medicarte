export const ACCESS_PERMISSION_LIFECYCLES = ['ACTIVE', 'LEGACY', 'ORPHAN', 'RETIRED'] as const;

export type AccessPermissionLifecycle = (typeof ACCESS_PERMISSION_LIFECYCLES)[number];

export const ACCESS_ACTOR_BOUNDARIES = [
  'SYSTEM',
  'MTD_ONLY',
  'MEDICARTE_POINT',
  'OLP_ONLY',
  'COMPENSAR_ONLY',
  'ACTOR_PROJECTION',
  'ORGANIZATION',
] as const;

export type AccessActorBoundary = (typeof ACCESS_ACTOR_BOUNDARIES)[number];

export type AccessPermissionDefinition = Readonly<{
  permissionCode: string;
  moduleCode: string;
  actionCode: string;
  lifecycle: AccessPermissionLifecycle;
  actorBoundary: AccessActorBoundary;
  configurable: boolean;
  structural: boolean;
  systemAllowed: boolean;
}>;

export type AccessModuleAction = Readonly<{
  code: string;
  label: string;
  permissionCode: string;
  lifecycle: AccessPermissionLifecycle;
  actorBoundary: AccessActorBoundary;
  configurable: boolean;
  structural: boolean;
  systemAllowed: boolean;
}>;

export type AccessModuleDefinition = Readonly<{
  code: string;
  label: string;
  description: string;
  route: string;
  section: string;
  icon: string;
  displayOrder: number;
  actions: readonly AccessModuleAction[];
}>;

type PermissionOptions = Readonly<{
  configurable?: boolean;
  structural?: boolean;
  systemAllowed?: boolean;
}>;

function permission(
  permissionCode: string,
  moduleCode: string,
  actionCode: string,
  lifecycle: AccessPermissionLifecycle,
  actorBoundary: AccessActorBoundary,
  options: PermissionOptions = {},
): AccessPermissionDefinition {
  return {
    permissionCode,
    moduleCode,
    actionCode,
    lifecycle,
    actorBoundary,
    configurable: options.configurable ?? (lifecycle === 'ACTIVE' && options.structural !== true),
    structural: options.structural ?? lifecycle !== 'ACTIVE',
    systemAllowed: options.systemAllowed ?? lifecycle !== 'ORPHAN',
  };
}

/**
 * Canonical target mapping for every permission currently present after
 * migrations 0000-0051. The registry is metadata only; PostgreSQL and domain
 * policies remain the authorization authorities.
 */
export const ACCESS_PERMISSION_REGISTRY: readonly AccessPermissionDefinition[] = [
  permission('platform.foundation.execute', 'foundation', 'EXECUTE', 'ORPHAN', 'MTD_ONLY'),
  permission('authorizations.read', 'authorizations', 'VIEW', 'LEGACY', 'ACTOR_PROJECTION'),
  permission(
    'authorizations.read_sensitive',
    'authorizations',
    'VIEW_SENSITIVE',
    'ACTIVE',
    'MTD_ONLY',
  ),
  permission('imports.create', 'imports', 'CREATE', 'LEGACY', 'MTD_ONLY'),
  permission('imports.confirm', 'imports', 'CONFIRM', 'LEGACY', 'MTD_ONLY'),
  permission('mipres.recheck', 'authorizations', 'RECHECK', 'LEGACY', 'MTD_ONLY'),
  permission('application_site.read', 'applications', 'VIEW_SITE', 'LEGACY', 'ACTOR_PROJECTION'),
  permission('audit.start', 'application-audits', 'START', 'LEGACY', 'MTD_ONLY'),
  permission('audit.reject', 'application-audits', 'REJECT', 'LEGACY', 'MTD_ONLY'),
  permission('audit.approve', 'application-audits', 'APPROVE', 'LEGACY', 'MTD_ONLY'),
  permission('exports.create', 'exports', 'CREATE', 'LEGACY', 'ACTOR_PROJECTION'),
  permission('users.manage', 'users', 'MANAGE', 'ACTIVE', 'SYSTEM', {
    structural: true,
    systemAllowed: true,
  }),
  permission('platform.jobs.manage', 'jobs', 'MANAGE', 'ACTIVE', 'SYSTEM', {
    structural: true,
    systemAllowed: true,
  }),
  permission(
    'bulk_updates.dispensation_location',
    'bulk-updates',
    'EDIT_DISPENSATION_LOCATION',
    'LEGACY',
    'MEDICARTE_POINT',
  ),
  permission('bulk_updates.read', 'bulk-updates', 'VIEW', 'LEGACY', 'ACTOR_PROJECTION'),
  permission(
    'bulk_updates.dispensation_date',
    'bulk-updates',
    'EDIT_DISPENSATION_DATE',
    'LEGACY',
    'OLP_ONLY',
  ),
  permission(
    'bulk_updates.application_date',
    'bulk-updates',
    'EDIT_APPLICATION_DATE',
    'LEGACY',
    'MEDICARTE_POINT',
  ),
  permission(
    'operational_exports.create',
    'exports',
    'CREATE_OPERATIONAL',
    'ACTIVE',
    'ACTOR_PROJECTION',
  ),
  permission(
    'bulk_updates.purchase_order',
    'purchase-orders',
    'IMPORT_PURCHASE_ORDER',
    'LEGACY',
    'MTD_ONLY',
  ),
  permission('tariff_annex.read', 'tariff', 'VIEW', 'LEGACY', 'MTD_ONLY'),
  permission('tariff_annex.create', 'tariff', 'CREATE', 'LEGACY', 'MTD_ONLY'),
  permission('tariff_annex.import', 'tariff', 'IMPORT', 'LEGACY', 'MTD_ONLY'),
  permission('tariff_annex.update', 'tariff', 'EDIT', 'LEGACY', 'MTD_ONLY'),
  permission('tariff_annex.delete', 'tariff', 'DEACTIVATE', 'LEGACY', 'MTD_ONLY'),
  permission('dashboard.read', 'dashboard', 'VIEW', 'LEGACY', 'ORGANIZATION', {
    configurable: true,
  }),
  permission('audit.read', 'application-audits', 'VIEW_LEGACY', 'LEGACY', 'MTD_ONLY'),
  permission('audit.write', 'application-audits', 'EDIT_LEGACY', 'LEGACY', 'MTD_ONLY'),
  permission('consolidated.read', 'dashboard', 'VIEW_CONSOLIDATED', 'LEGACY', 'MTD_ONLY', {
    configurable: true,
  }),
  permission('view.dashboard', 'dashboard', 'NAVIGATE', 'LEGACY', 'ORGANIZATION'),
  permission('view.authorizations', 'authorizations', 'NAVIGATE', 'LEGACY', 'ACTOR_PROJECTION'),
  permission('view.mipres', 'authorizations', 'NAVIGATE_MIPRES', 'LEGACY', 'MTD_ONLY'),
  permission('view.available', 'availability', 'NAVIGATE', 'LEGACY', 'ACTOR_PROJECTION'),
  permission('view.application', 'applications', 'NAVIGATE', 'LEGACY', 'ACTOR_PROJECTION'),
  permission('view.logistics', 'logistics', 'NAVIGATE', 'LEGACY', 'ACTOR_PROJECTION'),
  permission('view.supports', 'supports', 'NAVIGATE', 'LEGACY', 'ACTOR_PROJECTION'),
  permission('view.audit', 'application-audits', 'NAVIGATE', 'LEGACY', 'MTD_ONLY'),
  permission(
    'view.consolidated',
    'dashboard',
    'NAVIGATE_CONSOLIDATED',
    'LEGACY',
    'ACTOR_PROJECTION',
  ),
  permission('view.failures', 'platform-failures', 'VIEW', 'LEGACY', 'MTD_ONLY'),
  permission('view.tariff', 'tariff', 'NAVIGATE', 'LEGACY', 'MTD_ONLY'),
  permission('view.admin', 'users', 'NAVIGATE', 'LEGACY', 'SYSTEM'),
  permission('view.imports', 'imports', 'NAVIGATE', 'LEGACY', 'ACTOR_PROJECTION'),
  permission('view.purchase_orders', 'purchase-orders', 'NAVIGATE', 'LEGACY', 'ACTOR_PROJECTION'),
  permission('authorizations.reprocess', 'authorizations', 'REPROCESS', 'LEGACY', 'MTD_ONLY'),
  permission('planning_periods.read', 'planning', 'VIEW', 'ACTIVE', 'MTD_ONLY', {
    configurable: true,
  }),
  permission('planning_periods.manage', 'planning', 'MANAGE', 'ACTIVE', 'MTD_ONLY', {
    configurable: true,
  }),
  permission('patient_schedules.read', 'scheduling', 'VIEW', 'ACTIVE', 'MEDICARTE_POINT', {
    configurable: true,
  }),
  permission('patient_schedules.manage', 'scheduling', 'MANAGE', 'ACTIVE', 'MEDICARTE_POINT', {
    configurable: true,
  }),
  permission('projected_demand.read', 'demand', 'VIEW', 'ACTIVE', 'MTD_ONLY', {
    configurable: true,
  }),
  permission('projected_demand.manage', 'demand', 'CONSOLIDATE', 'ACTIVE', 'MTD_ONLY'),
  permission('purchase_orders.read', 'purchase-orders', 'VIEW', 'ACTIVE', 'ACTOR_PROJECTION', {
    configurable: true,
  }),
  permission('purchase_orders.manage', 'purchase-orders', 'MANAGE', 'ACTIVE', 'MTD_ONLY', {
    configurable: true,
  }),
  permission(
    'purchase_orders.review_supplier',
    'purchase-orders',
    'REVIEW_SUPPLIER',
    'ACTIVE',
    'OLP_ONLY',
  ),
  permission(
    'supplier_deliveries.read',
    'supplier-deliveries',
    'VIEW',
    'ACTIVE',
    'ACTOR_PROJECTION',
    {
      configurable: true,
    },
  ),
  permission('supplier_deliveries.manage', 'supplier-deliveries', 'MANAGE', 'ACTIVE', 'OLP_ONLY'),
  permission('medicarte_receipts.read', 'medicarte-receipts', 'VIEW', 'ACTIVE', 'ORGANIZATION', {
    configurable: true,
  }),
  permission(
    'medicarte_receipts.manage',
    'medicarte-receipts',
    'RECEIVE_CONFIRM',
    'ACTIVE',
    'MEDICARTE_POINT',
  ),
  permission('inventory.read', 'inventory', 'VIEW', 'ACTIVE', 'MEDICARTE_POINT', {
    configurable: true,
  }),
  permission('stock_transfers.read', 'stock-transfers', 'VIEW', 'ACTIVE', 'MEDICARTE_POINT', {
    configurable: true,
  }),
  permission('stock_transfers.manage', 'stock-transfers', 'TRANSFER', 'ACTIVE', 'MEDICARTE_POINT', {
    configurable: true,
  }),
  permission(
    'patient_applications.read',
    'patient-applications',
    'VIEW',
    'ACTIVE',
    'MEDICARTE_POINT',
    {
      configurable: true,
    },
  ),
  permission(
    'patient_applications.manage',
    'patient-applications',
    'APPLY_MANAGE',
    'ACTIVE',
    'MEDICARTE_POINT',
  ),
  permission('patient_operational_outcomes.read', 'outcomes', 'VIEW', 'ACTIVE', 'MEDICARTE_POINT', {
    configurable: true,
  }),
  permission(
    'patient_operational_outcomes.manage',
    'outcomes',
    'RECORD',
    'ACTIVE',
    'MEDICARTE_POINT',
  ),
  permission('application_audits.read', 'application-audits', 'VIEW', 'ACTIVE', 'MTD_ONLY'),
  permission(
    'application_audits.manage',
    'application-audits',
    'REVIEW_DECIDE',
    'ACTIVE',
    'MTD_ONLY',
  ),
  permission('analytics.read', 'analytics', 'VIEW', 'ACTIVE', 'MTD_ONLY', {
    configurable: true,
  }),
  permission('analytics.economics.read', 'analytics', 'VIEW_ECONOMICS', 'ACTIVE', 'MTD_ONLY'),
  permission('bulk_imports.read', 'imports', 'VIEW_BULK', 'ACTIVE', 'MEDICARTE_POINT', {
    configurable: true,
  }),
  permission('bulk_imports.manage', 'imports', 'IMPORT_CONFIRM', 'ACTIVE', 'MEDICARTE_POINT'),
  permission('operational_scopes.read', 'scopes', 'VIEW', 'ACTIVE', 'MTD_ONLY', {
    structural: true,
  }),
  permission('operational_scopes.manage', 'scopes', 'ASSIGN', 'ACTIVE', 'MTD_ONLY', {
    structural: true,
  }),
  permission('reconciliation.read', 'reconciliation', 'VIEW', 'ACTIVE', 'MTD_ONLY'),
  permission('reconciliation.run', 'reconciliation', 'RUN', 'ACTIVE', 'MTD_ONLY', {
    structural: true,
  }),
  permission(
    'reconciliation_issues.read',
    'reconciliation-issues',
    'VIEW_ISSUES',
    'ACTIVE',
    'MTD_ONLY',
  ),
  permission(
    'reconciliation_issues.triage',
    'reconciliation-issues',
    'TRIAGE',
    'ACTIVE',
    'MTD_ONLY',
    {
      structural: true,
    },
  ),
  permission(
    'reconciliation_issues.comment',
    'reconciliation-issues',
    'COMMENT',
    'ACTIVE',
    'MTD_ONLY',
  ),
  permission(
    'reconciliation_operations.read',
    'reconciliation-operations',
    'VIEW',
    'ACTIVE',
    'MTD_ONLY',
  ),
  permission(
    'reconciliation_operations.manage',
    'reconciliation-operations',
    'CONFIGURE_RUN',
    'ACTIVE',
    'MTD_ONLY',
    { structural: true },
  ),
  permission(
    'reconciliation_notifications.read',
    'notifications',
    'VIEW_NOTIFICATIONS',
    'ACTIVE',
    'MTD_ONLY',
  ),
] as const;

export const ACCESS_RETIRED_PERMISSION_CODES = [
  'application_site.assign',
  'dispensing.register',
  'attachments.upload',
  'attachments.read',
  'notifications.manage',
  'view.notifications',
] as const;

type ModuleMetadata = Readonly<{
  label: string;
  description: string;
  route: string;
  section: string;
  icon: string;
  displayOrder: number;
}>;

const MODULE_METADATA: Readonly<Record<string, ModuleMetadata>> = {
  foundation: {
    label: 'Fundación',
    description: 'Capacidades técnicas de fundación',
    route: '/fundacion',
    section: 'Sistema',
    icon: 'shield',
    displayOrder: 10,
  },
  authorizations: {
    label: 'Autorizaciones',
    description: 'Consulta y operación de autorizaciones',
    route: '/autorizaciones',
    section: 'Operación',
    icon: 'file-check',
    displayOrder: 20,
  },
  imports: {
    label: 'Importaciones',
    description: 'Importación y confirmación de información',
    route: '/importaciones',
    section: 'Operación',
    icon: 'upload',
    displayOrder: 30,
  },
  applications: {
    label: 'Aplicaciones',
    description: 'Aplicaciones y sitios de dispensación',
    route: '/aplicaciones',
    section: 'Operación',
    icon: 'clipboard',
    displayOrder: 40,
  },
  'application-audits': {
    label: 'Auditorías de aplicaciones',
    description: 'Revisión y decisión de aplicaciones',
    route: '/auditorias-aplicaciones',
    section: 'Control',
    icon: 'search-check',
    displayOrder: 50,
  },
  exports: {
    label: 'Exportaciones',
    description: 'Exportaciones operativas y analíticas',
    route: '/exportaciones',
    section: 'Operación',
    icon: 'download',
    displayOrder: 60,
  },
  users: {
    label: 'Usuarios y acceso',
    description: 'Administración de usuarios y asignaciones',
    route: '/administracion/usuarios',
    section: 'Administración',
    icon: 'users',
    displayOrder: 70,
  },
  jobs: {
    label: 'Trabajos del sistema',
    description: 'Operaciones técnicas del sistema',
    route: '/administracion/trabajos',
    section: 'Administración',
    icon: 'settings',
    displayOrder: 80,
  },
  'bulk-updates': {
    label: 'Actualizaciones masivas',
    description: 'Actualizaciones legacy de operación',
    route: '/actualizaciones-masivas',
    section: 'Operación',
    icon: 'layers',
    displayOrder: 90,
  },
  'purchase-orders': {
    label: 'Órdenes de compra',
    description: 'Compra y revisión de proveedores',
    route: '/ordenes-compra',
    section: 'Abastecimiento',
    icon: 'shopping-cart',
    displayOrder: 100,
  },
  tariff: {
    label: 'Configuración tarifaria',
    description: 'Configuración de anexos tarifarios',
    route: '/configuracion/tarifas',
    section: 'Administración',
    icon: 'calculator',
    displayOrder: 110,
  },
  dashboard: {
    label: 'Dashboard',
    description: 'Indicadores y consolidado',
    route: '/dashboard',
    section: 'Consulta',
    icon: 'layout-dashboard',
    displayOrder: 120,
  },
  availability: {
    label: 'Disponibilidad',
    description: 'Disponibilidad operativa',
    route: '/disponibilidad',
    section: 'Operación',
    icon: 'circle-check',
    displayOrder: 130,
  },
  logistics: {
    label: 'Logística',
    description: 'Procesos logísticos',
    route: '/logistica',
    section: 'Abastecimiento',
    icon: 'truck',
    displayOrder: 140,
  },
  supports: {
    label: 'Soportes',
    description: 'Soportes operativos',
    route: '/soportes',
    section: 'Consulta',
    icon: 'life-buoy',
    displayOrder: 150,
  },
  'platform-failures': {
    label: 'Fallos de plataforma',
    description: 'Fallos y diagnósticos técnicos',
    route: '/fallos-plataforma',
    section: 'Sistema',
    icon: 'triangle-alert',
    displayOrder: 160,
  },
  planning: {
    label: 'Periodos de planeación',
    description: 'Planeación y sus transiciones',
    route: '/planeacion',
    section: 'Planeación',
    icon: 'calendar',
    displayOrder: 170,
  },
  scheduling: {
    label: 'Programación',
    description: 'Programación de aplicaciones',
    route: '/programacion',
    section: 'Operación',
    icon: 'calendar-clock',
    displayOrder: 180,
  },
  demand: {
    label: 'Demanda proyectada',
    description: 'Consolidación de demanda',
    route: '/demanda',
    section: 'Planeación',
    icon: 'chart-line',
    displayOrder: 190,
  },
  'supplier-deliveries': {
    label: 'Entregas de proveedores',
    description: 'Despachos y entregas OLP',
    route: '/entregas',
    section: 'Abastecimiento',
    icon: 'truck',
    displayOrder: 200,
  },
  'medicarte-receipts': {
    label: 'Recepciones',
    description: 'Recepciones de producto',
    route: '/recepciones',
    section: 'Operación',
    icon: 'package-check',
    displayOrder: 210,
  },
  inventory: {
    label: 'Inventario',
    description: 'Existencias y lotes',
    route: '/inventario',
    section: 'Operación',
    icon: 'boxes',
    displayOrder: 220,
  },
  'stock-transfers': {
    label: 'Traslados',
    description: 'Traslados entre puntos',
    route: '/inventario/traslados',
    section: 'Operación',
    icon: 'arrow-left-right',
    displayOrder: 230,
  },
  'patient-applications': {
    label: 'Aplicaciones de pacientes',
    description: 'Aplicación de productos a pacientes',
    route: '/aplicaciones-paciente',
    section: 'Operación',
    icon: 'syringe',
    displayOrder: 240,
  },
  outcomes: {
    label: 'Resultados operativos',
    description: 'Resultados de operación',
    route: '/resultados-operativos',
    section: 'Operación',
    icon: 'clipboard-check',
    displayOrder: 250,
  },
  analytics: {
    label: 'Analítica',
    description: 'Analítica operativa y económica',
    route: '/analitica',
    section: 'Consulta',
    icon: 'chart-no-axes-combined',
    displayOrder: 260,
  },
  scopes: {
    label: 'Alcances por punto',
    description: 'Asignación de scopes operativos',
    route: '/administracion/alcances',
    section: 'Administración',
    icon: 'map-pin',
    displayOrder: 270,
  },
  reconciliation: {
    label: 'Integridad operacional',
    description: 'Reconciliación de integridad operacional',
    route: '/integridad/reconciliacion',
    section: 'Control',
    icon: 'scan-search',
    displayOrder: 280,
  },
  'reconciliation-issues': {
    label: 'Hallazgos de integridad',
    description: 'Gestión de hallazgos de reconciliación',
    route: '/integridad/hallazgos',
    section: 'Control',
    icon: 'list-checks',
    displayOrder: 290,
  },
  'reconciliation-operations': {
    label: 'Operaciones de reconciliación',
    description: 'Programación y ejecución controlada',
    route: '/integridad/operaciones',
    section: 'Control',
    icon: 'workflow',
    displayOrder: 300,
  },
  notifications: {
    label: 'Notificaciones de integridad',
    description: 'Alertas operativas de integridad',
    route: '/integridad/notificaciones',
    section: 'Control',
    icon: 'bell',
    displayOrder: 310,
  },
};

function actionLabel(actionCode: string): string {
  return actionCode
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}

export const ACCESS_MODULE_REGISTRY: readonly AccessModuleDefinition[] = Object.entries(
  MODULE_METADATA,
)
  .map(([code, metadata]) => ({
    ...metadata,
    code,
    actions: ACCESS_PERMISSION_REGISTRY.filter((permission) => permission.moduleCode === code).map(
      (permission) => ({
        code: permission.actionCode,
        label: actionLabel(permission.actionCode),
        permissionCode: permission.permissionCode,
        lifecycle: permission.lifecycle,
        actorBoundary: permission.actorBoundary,
        configurable: permission.configurable,
        structural: permission.structural,
        systemAllowed: permission.systemAllowed,
      }),
    ),
  }))
  .sort((left, right) => left.displayOrder - right.displayOrder);

export const ACCESS_PERMISSION_CODES = ACCESS_PERMISSION_REGISTRY.map(
  (permission) => permission.permissionCode,
);

export const ACCESS_SYSTEM_ALLOWED_PERMISSION_CODES = ACCESS_PERMISSION_REGISTRY.filter(
  (permission) => permission.systemAllowed,
).map((permission) => permission.permissionCode);

export function getAccessPermissionDefinition(
  permissionCode: string,
): AccessPermissionDefinition | undefined {
  return ACCESS_PERMISSION_REGISTRY.find(
    (permission) => permission.permissionCode === permissionCode,
  );
}

export function isSystemAllowedPermission(permissionCode: string): boolean {
  return ACCESS_SYSTEM_ALLOWED_PERMISSION_CODES.includes(permissionCode);
}

export function validateAccessRegistry(): void {
  const permissionCodes = new Set<string>();
  const actionKeys = new Set<string>();
  const routes = new Set<string>();

  for (const permission of ACCESS_PERMISSION_REGISTRY) {
    if (permissionCodes.has(permission.permissionCode)) {
      throw new Error(`Duplicate access permission: ${permission.permissionCode}`);
    }
    permissionCodes.add(permission.permissionCode);

    if (!MODULE_METADATA[permission.moduleCode]) {
      throw new Error(`Permission references unknown module: ${permission.permissionCode}`);
    }

    const actionKey = `${permission.moduleCode}:${permission.actionCode}`;
    if (actionKeys.has(actionKey)) {
      throw new Error(`Duplicate module action: ${actionKey}`);
    }
    actionKeys.add(actionKey);
  }

  for (const module of ACCESS_MODULE_REGISTRY) {
    if (routes.has(module.route)) throw new Error(`Duplicate module route: ${module.route}`);
    routes.add(module.route);
  }

  if (permissionCodes.size !== 79) {
    throw new Error(`Expected 79 current permission mappings, got ${permissionCodes.size}`);
  }
}

validateAccessRegistry();
