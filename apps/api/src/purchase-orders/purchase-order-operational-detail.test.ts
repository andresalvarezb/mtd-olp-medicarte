import { describe, expect, it, vi } from 'vitest';

import type { Scope } from '../common/request-scope';
import { PurchaseOrderRepository } from './purchase-order.repository';

const PO_ID = '60000000-0000-4000-8000-000000000001';
const LINE_ID = '70000000-0000-4000-8000-000000000001';

function queryResult<T>(rows: T[]) {
  return { rows };
}

describe('PurchaseOrderRepository.operationalDetail authorization sources', () => {
  it('expone en cada línea solo sus vínculos de autorización activos', async () => {
    let queryNumber = 0;
    let sourceSql = '';
    const execute = vi.fn((query: unknown) => {
      const currentQuery = queryNumber++;

      if (currentQuery === 0) {
        return queryResult([{
          id: PO_ID,
          purchase_order_code: 'OC-1',
          order_type: 'STANDARD',
          status: 'ISSUED',
          version: 1,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          issued_at: null,
          olp_accepted_at: null,
          olp_committed_date: null,
          created_by_name: null,
          accepted_by_name: null,
        }]);
      }

      if (currentQuery === 2) {
        sourceSql = (
          query as { queryChunks: Array<string | { value?: string[] }> }
        ).queryChunks.map((chunk) =>
          typeof chunk === 'string' ? chunk : chunk.value?.join('') ?? '',
        ).join('');
        return queryResult([{
          purchase_order_line_id: LINE_ID,
          authorization_key: 'AUTO-ACTIVA',
          authorization_number: 'AUT-001',
          source_quantity_snapshot: 4,
        }]);
      }

      if (currentQuery === 1) {
        return queryResult([{
          id: LINE_ID,
          commercial_code: 'ABC',
          product_description: 'Producto ABC',
          presentation: null,
          dispensing_point_id: null,
          dispensing_point_code: null,
          dispensing_point_name: null,
          requested_quantity: 4,
          accepted_quantity: null,
          olp_managed_quantity: null,
          compensar_unit_rate_snapshot: null,
          supplier_unit_cost: null,
          dispatched_quantity: 0,
          received_quantity: 0,
          accepted_received_quantity: 0,
          receipt_outcome: null,
        }]);
      }

      return queryResult([]);
    });

    const repository = new PurchaseOrderRepository({
      db: { execute },
    } as never);
    const actor = {
      organizationId: '80000000-0000-4000-8000-000000000001',
      organizationCode: 'OLP',
      userId: '90000000-0000-4000-8000-000000000001',
      correlationId: 'test',
      readSensitive: false,
      isFoundationAdmin: false,
      canCrossOrganizationOperationalExport: false,
      pointAccessKind: 'unrestricted',
    } satisfies Scope;

    const detail = await repository.operationalDetail(PO_ID, actor);

    expect(detail?.lines[0]?.authorizationSources).toEqual([
      {
        authorizationKey: 'AUTO-ACTIVA',
        authorizationNumber: 'AUT-001',
        quantity: 4,
      },
    ]);
    expect(sourceSql).toContain('poas.released_at is null');
  });
});
