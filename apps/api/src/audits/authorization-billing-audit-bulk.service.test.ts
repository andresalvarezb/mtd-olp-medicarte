import { describe, expect, it } from 'vitest';

import {
  isBillingAuditBulkEligibleStatus,
  resolveBillingAuditBulkOperationalStatus,
} from './authorization-billing-audit-bulk.service';

type Input = Parameters<typeof resolveBillingAuditBulkOperationalStatus>[0];
function sample(overrides: Partial<Input> = {}): Input {
  return {
    id: '00000000-0000-4000-8000-000000000001', authorization_key: 'AUTO:MED',
    quantity: '10', assignment_date: '2026-10-01', validity_end_date: '2026-10-31',
    enablement_status: 'ENABLED', tariff_membership_status: 'LISTED', coverage_type: 'PBS',
    direction_status: 'NOT_APPLICABLE', mipres_manual_decision: 'MANUALLY_ENABLED',
    minimum_quantity: 1, fulfillment_quantity: 0, application_quantity: 0, consumed_quantity: 0,
    remaining_assigned_quantity: 4,
    ...overrides,
  };
}

describe('reglas de elegibilidad operativa de auditoría bulk', () => {
  const today = '2026-10-09';
  it('permite asignación parcial', () => {
    expect(resolveBillingAuditBulkOperationalStatus(sample(), today)).toBe('PARTIALLY_ASSIGNED');
  });
  it('permite CLOSED aunque la autorización ya no esté operativamente vigente', () => {
    expect(resolveBillingAuditBulkOperationalStatus(sample({ fulfillment_quantity: 10,
      validity_end_date: '2026-09-01' }), today)).toBe('CLOSED');
  });
  it('excluye ASSIGNED', () => {
    expect(resolveBillingAuditBulkOperationalStatus(sample({ remaining_assigned_quantity: 10 }), today)).toBe('ASSIGNED');
  });
  it('excluye UNASSIGNED', () => {
    expect(resolveBillingAuditBulkOperationalStatus(sample({ remaining_assigned_quantity: 0 }), today)).toBe('UNASSIGNED');
  });
  it('excluye OUT_OF_OPERATION cuando el producto no está habilitado', () => {
    expect(resolveBillingAuditBulkOperationalStatus(sample({ enablement_status: 'BLOCKED_SOURCE_STATUS' }), today))
      .toBe('OUT_OF_OPERATION');
  });
  it('considera la máxima evidencia de cumplimiento, sin duplicar canales', () => {
    expect(resolveBillingAuditBulkOperationalStatus(sample({ fulfillment_quantity: 10,
      application_quantity: 10, consumed_quantity: 10 }), today)).toBe('CLOSED');
  });
});


describe('ESP-AUD-BULK-001 - elegibilidad por cumplimiento', () => {
  it('permite parcial 4/10 con asignación parcial', () => {
    const auth = sample({ fulfillment_quantity: 4, remaining_assigned_quantity: 2 });
    expect(resolveBillingAuditBulkOperationalStatus(auth, '2026-10-09')).toBe('PARTIALLY_ASSIGNED');
    expect(isBillingAuditBulkEligibleStatus(auth)).toBe(true);
  });
  it('rechaza parcial asignada sin entrega/aplicación', () => {
    expect(isBillingAuditBulkEligibleStatus(sample({ remaining_assigned_quantity: 6 }))).toBe(false);
  });
  it('permite 4/10 con reserva completa, parcial o agotada', () => {
    for (const n of [0, 2, 6]) {
      expect(isBillingAuditBulkEligibleStatus(sample({ fulfillment_quantity: 4, remaining_assigned_quantity: n }))).toBe(true);
    }
  });
  it('permite cerrada 10/10 y no duplica evidencias', () => {
    expect(isBillingAuditBulkEligibleStatus(sample({ fulfillment_quantity: 10, application_quantity: 10, consumed_quantity: 10 }))).toBe(true);
  });
});
