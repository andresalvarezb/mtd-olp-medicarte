import { afterEach, describe, expect, it, vi } from 'vitest';
import { PurchaseOrderRepository } from './purchase-order.repository';

describe('creación de OC desde demanda consolidada', () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ['2026-11-01', true],
    ['2026-10-31', false],
    ['fecha-invalida', false],
  ] as const)('revalida la fecha final %s antes de crear la OC', async (expirationDate, accepted) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));

    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ consolidated_at: '2026-11-01' }] })
      .mockResolvedValueOnce({ rows: [{
        authorization_item_id: 'AUTO-1',
        quantity: 2,
        demand_bucket: 'REGULAR',
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'AUTO-1',
        commercial_code: 'PROD-1',
        source_status_normalized: '5',
        enablement_status: 'ENABLED',
        coverage_type: 'PBS',
        direction_status: 'NOT_APPLICABLE',
        mipres_manual_decision: 'PENDING_MANUAL_ENABLEMENT',
        source_quantity: '2',
        assignment_date: '2026-10-01',
        expiration_date: expirationDate,
      }] });

    const repository = new PurchaseOrderRepository({} as never);
    const validate = Reflect.get(repository, 'assertModernDemandIsCurrent') as (
      tx: unknown,
      demand: { id: string; commercialCode: string; regularQuantity: number; lateQuantity: number },
    ) => Promise<void>;
    const operation = validate.call(repository, { execute }, {
      id: 'DEMAND-1',
      commercialCode: 'PROD-1',
      regularQuantity: 2,
      lateQuantity: 0,
    });

    if (accepted) {
      await expect(operation).resolves.toBeUndefined();
    } else {
      await expect(operation).rejects.toThrow('PURCHASE_ORDER_DEMAND_STALE');
    }
    expect(execute).toHaveBeenCalledTimes(3);
  });
});
