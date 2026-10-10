import { describe, expect, it } from 'vitest';
import { isBillingAuditFulfillmentEligible as eligible } from './authorization-billing-audit-eligibility';
const row = (fulfilled_quantity: number, authorized_quantity: string | null = '10') =>
  ({ fulfilled_quantity, authorized_quantity });
describe('auditoría: progreso, no reserva', () => {
  it('rechaza 0/10', () => expect(eligible(row(0))).toBe(false));
  it('permite 4/10 con reserva parcial', () => expect(eligible(row(4))).toBe(true));
  it('permite 10/10 cerrada', () => expect(eligible(row(10))).toBe(true));
  it('rechaza cantidad autorizada inválida', () => {
    expect(eligible(row(4, null))).toBe(false);
    expect(eligible(row(4, '0'))).toBe(false);
    expect(eligible(row(4, 'error'))).toBe(false);
  });
});
