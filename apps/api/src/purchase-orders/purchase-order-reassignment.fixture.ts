import type { Scope } from '../common/request-scope';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';
const ADMIN_USER_ID = '10000000-0000-4000-8000-000000000002';
const NON_ADMIN_USER_ID = '10000000-0000-4000-8000-000000000004';

export const purchaseOrderReassignmentFixture = {
  organizationId: ORGANIZATION_ID,
  adminUserId: ADMIN_USER_ID,
  nonAdminUserId: NON_ADMIN_USER_ID,
  purchaseOrder: {
    id: '20000000-0000-4000-8000-000000000001',
    code: 'OC-200',
    status: 'ISSUED',
  },
  line: {
    id: '70000000-0000-4000-8000-000000000001',
    commercialCode: 'PROD-1',
    requestedQuantity: 2,
  },
  origin: {
    authorizationItemId: '30000000-0000-4000-8000-000000000002',
    authorizationKey: 'AUTO-ORIG',
    authorizationNumber: 'AUT-DUMMY-001',
    commercialCode: 'PROD-1',
    quantity: 2,
    releasedAt: null,
    consumedQuantity: 0,
  },
  destination: {
    authorizationItemId: '30000000-0000-4000-8000-000000000001',
    authorizationKey: 'AUTO-DEST',
    authorizationNumber: 'AUT-DUMMY-002',
    commercialCode: 'PROD-1',
    quantity: 2,
    releasedAt: null,
    consumedQuantity: 0,
  },
  headers: [
    'CLAVE_AUTORIZACION_ORIGEN',
    'CLAVE_AUTORIZACION_DESTINO',
    'OC',
    'CODIGO_PRODUCTO',
    'CANTIDAD',
  ] as const,
  row: [
    'AUTO-ORIG',
    'AUTO-DEST',
    'OC-200',
    'PROD-1',
    2,
  ] as const,
  adminScope: {
    organizationId: ORGANIZATION_ID,
    organizationCode: 'MTD',
    userId: ADMIN_USER_ID,
    correlationId: '10000000-0000-4000-8000-000000000003',
    readSensitive: true,
    isFoundationAdmin: true,
    canCrossOrganizationOperationalExport: true,
    pointAccessKind: 'unrestricted',
  } satisfies Scope,
  nonAdminScope: {
    organizationId: ORGANIZATION_ID,
    organizationCode: 'MTD',
    userId: NON_ADMIN_USER_ID,
    correlationId: '10000000-0000-4000-8000-000000000005',
    readSensitive: true,
    isFoundationAdmin: false,
    canCrossOrganizationOperationalExport: true,
    pointAccessKind: 'unrestricted',
  } satisfies Scope,
  adminProfile: {
    id: ADMIN_USER_ID,
    username: 'dummy-platform-admin',
    displayName: 'Administrador dummy de plataforma',
    mustChangePassword: false,
    organizations: [{
      id: ORGANIZATION_ID,
      code: 'MTD',
      name: 'MTD dummy',
      roles: ['MTD_ADMIN'],
      isSystemAdmin: true,
      permissions: ['purchase_orders.manage'],
      pointAccess: { kind: 'unrestricted', accessiblePointIds: [] },
    }],
  },
  nonAdminProfile: {
    id: NON_ADMIN_USER_ID,
    username: 'dummy-purchase-order-manager',
    displayName: 'Gestor dummy de órdenes de compra',
    mustChangePassword: false,
    organizations: [{
      id: ORGANIZATION_ID,
      code: 'MTD',
      name: 'MTD dummy',
      roles: ['MTD_OPERATOR'],
      isSystemAdmin: false,
      permissions: ['purchase_orders.manage'],
      pointAccess: { kind: 'unrestricted', accessiblePointIds: [] },
    }],
  },
};
