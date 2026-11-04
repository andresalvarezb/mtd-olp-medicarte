import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  runInventoryExpirationReleaseSweep,
} from './inventory-expiration-release';


const AUTHORIZATION_ID =
  '10000000-0000-4000-8000-000000000001';

const ALLOCATION_ID =
  '20000000-0000-4000-8000-000000000001';

const PURCHASE_ORDER_LINE_ID =
  '30000000-0000-4000-8000-000000000001';

const SOURCE_ID =
  '35000000-0000-4000-8000-000000000001';

const ORGANIZATION_ID =
  '40000000-0000-4000-8000-000000000001';


function result<Row extends Record<string, unknown>>(
  rows: Row[],
) {
  return {
    rows,
    rowCount: rows.length,
  };
}


function databaseFor(
  expirationRaw: string,
  options: { contendOnce?: boolean } = {},
) {
  const calls: Array<{
    sql: string;
    values: unknown[] | undefined;
  }> = [];
  let contended = false;

  const client = {
    query: vi.fn(
      // eslint-disable-next-line @typescript-eslint/require-await
      async (sql: string, values?: unknown[]) => {
        const normalized =
          sql.replace(/\s+/g, ' ').trim().toLowerCase();

        calls.push({
          sql: normalized,
          values,
        });

        if (
          ['begin', 'commit', 'rollback'].includes(normalized)
        ) {
          return result([]);
        }

        if (
          normalized.includes('pg_try_advisory_xact_lock')
        ) {
          return result([{ locked: true }]);
        }

        if (
          normalized.includes('with linked_authorizations as')
        ) {
          return result([{
            id: AUTHORIZATION_ID,
            expiration_raw: expirationRaw,
          }]);
        }

        if (
          normalized.startsWith('select po.id')
          && normalized.includes('from purchase_orders po')
        ) {
          if (options.contendOnce && !contended) {
            contended = true;
            throw Object.assign(new Error('lock unavailable'), { code: '55P03' });
          }
          return result([]);
        }

        if (
          normalized.includes('from authorization_items')
          && normalized.includes('for update')
        ) {
          return result([{
            id: AUTHORIZATION_ID,
            expiration_raw: expirationRaw,
          }]);
        }

        if (
          normalized.startsWith('select')
          && normalized.includes('from inventory_authorization_allocations')
        ) {
          return result([{
            id: ALLOCATION_ID,
            organization_id: ORGANIZATION_ID,
            allocated_quantity: 5,
            consumed_quantity: 2,
            released_quantity: 1,
            status: 'PARTIALLY_CONSUMED',
          }]);
        }

        if (
          normalized.startsWith('select')
          && normalized.includes('from purchase_order_authorization_sources')
        ) {
          return result([{
            id: SOURCE_ID,
            purchase_order_line_id: PURCHASE_ORDER_LINE_ID,
            source_quantity_snapshot: 5,
          }]);
        }

        if (
          normalized.startsWith('update inventory_authorization_allocations')
        ) {
          return result([{ id: ALLOCATION_ID }]);
        }

        if (
          normalized.startsWith('update purchase_order_authorization_sources')
        ) {
          return result([{
            id: SOURCE_ID,
            released_at: '2026-11-04 00:00:00+00',
          }]);
        }

        if (
          normalized.includes('from authorization_item_organizations aio')
        ) {
          return result([{
            organization_id: ORGANIZATION_ID,
          }]);
        }

        if (
          normalized.startsWith('insert into audit_events')
          || normalized.startsWith('insert into outbox_events')
        ) {
          return result([]);
        }

        throw new Error(
          'UNEXPECTED_QUERY: ' + normalized,
        );
      },
    ),
    release: vi.fn(),
  };

  return {
    database: {
      pool: {
        connect: vi.fn(() => Promise.resolve(client)),
      },
    } as never,
    calls,
    client,
  };
}


describe(
  'runInventoryExpirationReleaseSweep',
  () => {
    it(
      'libera desde el día 6, conserva consumo e historial y audita como SYSTEM',
      async () => {
        const fixture =
          databaseFor(
            '20261028',
          );

        const outcome =
          await runInventoryExpirationReleaseSweep(
            fixture.database,
            '2026-11-03',
          );

        expect(
          outcome,
        ).toMatchObject({
          expiredAuthorizations: 1,
          releasedAllocations: 1,
          releasedQuantity: 2,
          releasedPurchaseOrderSources: 1,
          releasedPurchaseSourceSnapshotQuantity: 5,
          clearedAuthorizations: 1,
        });

        const candidates =
          fixture.calls.find(
            (call) =>
              call.sql.includes(
                'with linked_authorizations as',
              ),
          );

        expect(
          candidates?.values,
        ).toEqual([
          '2026-10-29',
        ]);

        const allocationUpdate =
          fixture.calls.find(
            (call) =>
              call.sql.startsWith(
                'update inventory_authorization_allocations',
              ),
          );

        expect(
          allocationUpdate?.sql,
        ).toContain(
          'released_quantity = allocated_quantity - consumed_quantity',
        );

        const sourceUpdate =
          fixture.calls.find(
            (call) =>
              call.sql.startsWith(
                'update purchase_order_authorization_sources',
              ),
          );

        expect(
          sourceUpdate?.sql,
        ).toContain(
          "released_by_type = 'system'",
        );
        expect(sourceUpdate?.values).toEqual([[SOURCE_ID]]);
        expect(fixture.calls.filter((call) => call.sql === 'begin')).toHaveLength(3);
        expect(fixture.calls.filter((call) => call.sql === 'commit')).toHaveLength(3);
        expect(fixture.calls.some((call) => call.sql.includes('for update nowait'))).toBe(true);

        const auditInsert =
          fixture.calls.find(
            (call) =>
              call.sql.startsWith(
                'insert into audit_events',
              ),
          );

        expect(
          auditInsert?.sql,
        ).toContain(
          "'system'",
        );
        expect(
          String(auditInsert?.values?.[3]),
        ).toContain(
          '"releasedThisRun":2',
        );

        expect(
          fixture.client.release,
        ).toHaveBeenCalledOnce();
      },
    );

    it(
      'conserva los compromisos el quinto día de gracia',
      async () => {
        const fixture =
          databaseFor(
            '20261029',
          );

        const outcome =
          await runInventoryExpirationReleaseSweep(
            fixture.database,
            '2026-11-03',
          );

        expect(
          outcome,
        ).toMatchObject({
          expiredAuthorizations: 0,
          releasedAllocations: 0,
          releasedQuantity: 0,
          releasedPurchaseOrderSources: 0,
          releasedPurchaseSourceSnapshotQuantity: 0,
          clearedAuthorizations: 0,
        });

        expect(
          fixture.calls.some(
            (call) =>
              call.sql.startsWith(
                'update inventory_authorization_allocations',
              )
              ||
              call.sql.startsWith(
                'update purchase_order_authorization_sources',
              ),
          ),
        ).toBe(false);
      },
    );

    it('cede ante un lock ocupado y reintenta en el siguiente barrido', async () => {
      const fixture = databaseFor('20261028', { contendOnce: true });
      const first = await runInventoryExpirationReleaseSweep(fixture.database, '2026-11-03');
      expect(first.releasedAllocations).toBe(0);
      expect(first.releasedPurchaseOrderSources).toBe(0);
      expect(fixture.calls.some((call) => call.sql === 'rollback')).toBe(true);

      const retry = await runInventoryExpirationReleaseSweep(fixture.database, '2026-11-03');
      expect(retry.releasedAllocations).toBe(1);
      expect(retry.releasedPurchaseOrderSources).toBe(1);
    });
  },
);
