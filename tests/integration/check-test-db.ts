import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AuthorizationModeratorFeeService } from '../../apps/api/src/moderator-fee/authorization-moderator-fee.service';
import { createDatabase } from '../../packages/database/src';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, 'DATABASE_URL is required');

  const expectedDataDirectory = process.env.TEST_DB_DATA_DIR?.replaceAll('\\', '/') ?? '';
  assert.ok(expectedDataDirectory, 'TEST_DB_DATA_DIR is required');
  const database = createDatabase(databaseUrl);
  try {
    const identity = await database.pool.query<{
      database_name: string;
      host: string;
      port: number;
      data_directory: string;
    }>(`
    select current_database() as database_name,
           host(inet_server_addr()) as host,
           inet_server_port() as port,
           current_setting('data_directory') as data_directory
  `);
    assert.deepEqual(identity.rows[0], {
      database_name: 'mtd_olp_medicarte_test',
      host: '127.0.0.1',
      port: 55439,
      data_directory: expectedDataDirectory,
    });

    const invalidForeignKey = await database.pool.query(`
    do $$
    begin
      begin
        insert into authorization_item_organizations (authorization_item_id, organization_id)
        values (gen_random_uuid(), gen_random_uuid());
        raise exception 'TEST_EXPECTED_FK_VIOLATION_NOT_RAISED';
      exception when foreign_key_violation then
        raise notice 'FK_INTEGRITY_PASS';
      end;
    end $$
  `);
    assert.equal(invalidForeignKey.command, 'DO');

    const unvalidatedForeignKeys = await database.pool.query<{ count: string }>(`
    select count(*)::text as count
    from pg_constraint
    where contype = 'f' and not convalidated
  `);
    assert.equal(unvalidatedForeignKeys.rows[0]?.count, '0');

    const mtd = await database.pool.query<{ id: string }>(`
    select id from organizations where code = 'MTD'
  `);
    const actor = await database.pool.query<{ id: string }>(`
    select id from users where username = 'test-mtd-admin'
  `);
    const target = await database.pool.query<{ id: string }>(`
    select id from authorization_items
    where numero_autorizacion = 'TEST-AUTH-RESERVED-001'
      and codigo_medicamento = 'TEST-MED-001'
  `);
    assert.equal(mtd.rowCount, 1);
    assert.equal(actor.rowCount, 1);
    assert.equal(target.rowCount, 1);

    const service = new AuthorizationModeratorFeeService(
      database as never,
      {
        GOOGLE_SHEETS_MODERATOR_FEE_ID: '',
        GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE: '',
      } as never,
      {
        appendRow: () => Promise.resolve(),
        getInvoiceUrl: () => Promise.resolve(null),
      } as never,
    );
    const scope = {
      organizationId: mtd.rows[0]!.id,
      organizationCode: 'MTD',
      userId: actor.rows[0]!.id,
      correlationId: randomUUID(),
      pointAccessKind: 'explicit',
    } as never;
    const collectedAt = new Date(Date.now() - 1_000).toISOString();
    const requests = [
      {
        status: 'COLLECTED' as const,
        collectedAt,
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
      },
      {
        status: 'COLLECTED' as const,
        collectedAt,
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
      },
    ];
    const logisticsSnapshot = async (authorizationItemId: string) => {
      const result = await database.pool.query<{ snapshot: string }>(
        `
        select jsonb_build_object(
          'movements', (select count(*) from inventory_movements),
          'allocations', (select jsonb_agg(jsonb_build_array(id, allocated_quantity, consumed_quantity, released_quantity, status) order by id)
            from inventory_authorization_allocations where authorization_item_id = $1),
          'fulfillments', (select jsonb_agg(jsonb_build_array(id, quantity) order by id)
            from authorization_fulfillments where authorization_item_id = $1)
        )::text as snapshot
      `,
        [authorizationItemId],
      );
      return result.rows[0]?.snapshot;
    };

    const transient = [
      {
        id: randomUUID(),
        number: `TEST-AUTH-CONCURRENCY-${randomUUID()}`,
        fulfillment: false,
        annulled: false,
        reserved: true,
      },
      {
        id: randomUUID(),
        number: `TEST-AUTH-ANNULLED-${randomUUID()}`,
        fulfillment: true,
        annulled: true,
        reserved: false,
      },
      {
        id: randomUUID(),
        number: `TEST-AUTH-NO-RESERVATION-${randomUUID()}`,
        fulfillment: false,
        annulled: false,
        reserved: false,
      },
      {
        id: randomUUID(),
        number: `TEST-AUTH-PARTIAL-${randomUUID()}`,
        fulfillment: true,
        annulled: false,
        reserved: false,
      },
      {
        id: randomUUID(),
        number: `TEST-AUTH-COMPLETE-${randomUUID()}`,
        fulfillment: true,
        annulled: false,
        reserved: false,
      },
    ];
    for (const [index, item] of transient.entries()) {
      await database.pool.query(
        `insert into authorization_items (
             id, numero_autorizacion, codigo_medicamento, authorization_key, source_data,
             source_status_normalized, enablement_status, coverage_type, direction_status,
             coverage_rule_version, created_from_batch_id, annulled_at, annulled_by, annulment_reason
           ) values ($1::uuid, $2::varchar, 'TEST-MED-001', $2::text || '|TEST-MED-001',
             jsonb_build_object('CODIGO_COMERCIAL','TEST-MED-001','VALOR_CUOTA_MODERADORA','12500'),
             'AUTHORIZED','ENABLED','NO_PBS','NOT_APPLICABLE','TEST-RULE-1',
             'd0000000-0000-4000-8000-000000000001',
             case when $3::boolean then now() else null end,
             case when $3::boolean then 'a0000000-0000-4000-8000-000000000001'::uuid else null end,
             case when $3::boolean then 'fixture sintetico de anulacion' else null end)`,
        [item.id, item.number, item.annulled],
      );
      await database.pool.query(
        `insert into authorization_item_organizations (authorization_item_id, organization_id)
           select $1, id from organizations where code in ('MTD','MEDICARTE')`,
        [item.id],
      );
      if (item.reserved) {
        const allocationId = randomUUID();
        await database.pool.query(
          `insert into inventory_authorization_allocations (
              id, batch_id, organization_id, authorization_item_id, purchase_order_id,
              commercial_code, dispensing_point_id, allocated_quantity, consumed_quantity,
              status, authorization_version, created_by, updated_by
            ) select $1, 'f0000000-0000-4000-8000-000000000101', o.id, $2,
              'f0000000-0000-4000-8000-000000000001', 'TEST-MED-001',
              'b0000000-0000-4000-8000-000000000001', 2, 0, 'ALLOCATED', 1,
              'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'
            from organizations o where o.code = 'MTD'`,
          [allocationId, item.id],
        );
      }
      if (item.fulfillment) {
        const fulfillmentId = randomUUID();
        await database.pool.query(
          `insert into authorization_fulfillments (
              id, organization_id, authorization_item_id, fulfillment_type, effective_date,
              quantity, source, confirmed_by
            ) select $1, o.id, $2, 'DELIVERY', current_date - 1,
              case when $3 = 3 then 1 else 10 end, 'UI', 'a0000000-0000-4000-8000-000000000003'
            from organizations o where o.code = 'MEDICARTE'`,
          [fulfillmentId, item.id, index],
        );
      }
    }

    const concurrentTarget = transient[0]!;
    const concurrentBefore = await logisticsSnapshot(concurrentTarget.id);
    const attempts = await Promise.allSettled(
      requests.map((request) => service.register(concurrentTarget.id, request, scope)),
    );
    const successful = attempts
      .map((result, index) => ({ result, request: requests[index]! }))
      .filter(({ result }) => result.status === 'fulfilled');
    const rejected = attempts.filter((result) => result.status === 'rejected');
    assert.equal(successful.length, 1, 'exactly one concurrent collection must commit');
    assert.equal(rejected.length, 1, 'the competing collection must be rejected');
    const error = (rejected[0] as PromiseRejectedResult).reason as {
      response?: { code?: string };
    };
    assert.equal(error.response?.code, 'MODERATOR_FEE_ALREADY_COLLECTED');
    const winningRequest = successful[0]!.request;
    const winnerResult = successful[0]!.result;
    assert.equal(winnerResult.status, 'fulfilled');
    await service.register(concurrentTarget.id, winningRequest, scope);
    assert.equal(
      await logisticsSnapshot(concurrentTarget.id),
      concurrentBefore,
      'concurrent fee writes must not mutate logistics',
    );

    const created = await database.pool.query<{ id: string; authorization_item_id: string }>(
      `select id, authorization_item_id from authorization_moderator_fee_events
         where authorization_item_id = any($1::uuid[])`,
      [transient.map((item) => item.id)],
    );
    assert.equal(created.rowCount, 1, 'one event must exist for the concurrency fixture');

    const assertCollection = async (
      item: (typeof transient)[number],
      laterFulfillmentQuantity?: number,
    ) => {
      const beforePayment = await logisticsSnapshot(item.id);
      const request = { ...requests[0]!, idempotencyKey: randomUUID() };
      const result = await service.register(item.id, request, scope);
      assert.equal(result.status, 'COLLECTED');
      assert.equal(result.amountCop, '12500.00');
      assert.equal(
        await logisticsSnapshot(item.id),
        beforePayment,
        'fee write must not mutate logistics',
      );
      const eventCountBeforeLaterFulfillment = await database.pool.query<{ count: string }>(
        `select count(*)::text as count from authorization_moderator_fee_events where authorization_item_id = $1`,
        [item.id],
      );
      if (laterFulfillmentQuantity !== undefined) {
        const later = await database.pool.query(
          `insert into authorization_fulfillments (
               id, organization_id, authorization_item_id, fulfillment_type, effective_date,
               quantity, source, confirmed_by
             ) select $1, o.id, $2, 'DELIVERY', current_date,
               $3, 'UI', 'a0000000-0000-4000-8000-000000000003'
             from organizations o where o.code = 'MEDICARTE'`,
          [randomUUID(), item.id, laterFulfillmentQuantity],
        );
        assert.equal(later.rowCount, 1);
      }
      await assert.rejects(
        service.register(item.id, { ...request, idempotencyKey: randomUUID() }, scope),
        (cause: { response?: { code?: string } }) =>
          cause.response?.code === 'MODERATOR_FEE_ALREADY_COLLECTED',
      );
      const eventCountAfterLaterFulfillment = await database.pool.query<{ count: string }>(
        `select count(*)::text as count from authorization_moderator_fee_events where authorization_item_id = $1`,
        [item.id],
      );
      assert.equal(
        eventCountAfterLaterFulfillment.rows[0]?.count,
        eventCountBeforeLaterFulfillment.rows[0]?.count,
      );
    };

    await assertCollection(transient[3]!, 9);
    await assertCollection(transient[4]!);

    await assert.rejects(
      service.register(transient[1]!.id, { ...requests[0]!, idempotencyKey: randomUUID() }, scope),
      (cause: { response?: { code?: string } }) =>
        cause.response?.code === 'MODERATOR_FEE_AUTHORIZATION_CANCELLED',
    );
    await assert.rejects(
      service.register(transient[2]!.id, { ...requests[0]!, idempotencyKey: randomUUID() }, scope),
      (cause: { response?: { code?: string } }) =>
        cause.response?.code === 'MODERATOR_FEE_NOT_ELIGIBLE',
    );

    const noReservation = await database.pool.query<{ id: string }>(`
    select id from authorization_items
    where numero_autorizacion = 'TEST-AUTH-NO-RESERVATION-001'
  `);
    await assert.rejects(
      service.register(
        noReservation.rows[0]!.id,
        { ...requests[0]!, idempotencyKey: randomUUID() },
        scope,
      ),
      (cause: { response?: { code?: string } }) =>
        cause.response?.code === 'MODERATOR_FEE_NOT_ELIGIBLE',
    );

    const multiProduct = await database.pool.query<{ id: string }>(`
    select id from authorization_items
    where numero_autorizacion = 'TEST-AUTH-MULTI-001'
      and codigo_medicamento = 'TEST-MED-001'
  `);
    await assert.rejects(
      service.register(
        multiProduct.rows[0]!.id,
        { ...requests[0]!, idempotencyKey: randomUUID() },
        scope,
      ),
      (cause: { response?: { code?: string } }) =>
        cause.response?.code === 'MODERATOR_FEE_AUTHORIZATION_IDENTITY_AMBIGUOUS',
    );

    const summary = await database.pool.query<{
      fee_events: string;
      fee_audits: string;
    }>(
      `
    select
      (select count(*) from authorization_moderator_fee_events
        where authorization_item_id = any($1::uuid[]))::text as fee_events,
      (select count(*) from audit_events
        where action = 'AUTHORIZATION_MODERATOR_FEE_REGISTERED'
          and resource_id = any($1::text[]))::text as fee_audits
  `,
      [transient.map((item) => item.id)],
    );
    assert.equal(summary.rows[0]?.fee_events, '3');
    assert.equal(summary.rows[0]?.fee_audits, '3');

    console.log(
      JSON.stringify({
        result: 'PASS',
        database: identity.rows[0]?.database_name,
        concurrency: { committed: 1, rejected: 1, mode: 'new-simultaneous-requests' },
        retryIdempotency: 'PASS',
        partialAndCompleteFulfillment: 'PASS',
        laterFulfillmentsNoDuplicate: 'PASS',
        annulledRejection: 'PASS',
        noReservationRejection: 'PASS',
        multiProductRejection: 'PASS',
        foreignKeyEnforcement: 'PASS',
        feeLeavesInventoryReservationsAndFulfillmentsUnchanged: 'PASS',
        feeEvents: summary.rows[0]?.fee_events,
        feeAuditEvents: summary.rows[0]?.fee_audits,
      }),
    );
  } finally {
    await database.pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
