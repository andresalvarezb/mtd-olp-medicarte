import { createHash, randomUUID } from 'node:crypto';

import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../packages/database/src/index.js';
import { TariffAnnexRepository } from '../../apps/api/src/tariff-annex/tariff-annex.repository';
import { ORGANIZATION_IDS, adminLogin } from './helpers/auth';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization_test_integration';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

const database = createDatabase(databaseUrl);

const suffix = randomUUID().slice(0, 8).toUpperCase();

const commercialCode = `M4A-${suffix}`;

const freeAuthorizationNumber = `M4A-FREE-${suffix}`;

const committedAuthorizationNumber = `M4A-COMMITTED-${suffix}`;

let adminToken = '';
let userId = '';
let batchId = '';
let freeAuthorizationId = '';
let committedAuthorizationId = '';
let planningPeriodId = '';
let demandLineId = '';
let existingPurchaseOrderId = '';
let existingPurchaseOrderLineId = '';

const headers = [
  'CODIGO_PRODUCTO',
  'TARIFA_UNIDAD',
  'NUMERO_EXPEDIENTE_INVIMA',
  'CONSECUTIVO_INVIMA_PRESENTACION',
  'DESCRIPCION_GENERICA_MEDICAMENTO',
  'DESCRIPCION_COMERCIAL_MEDICAMENTO',
  'LABORATORIO_MEDICAMENTO',
  'TIPO_INCLUSION_MEDICAMENTO',
];

function tariffWorkbook(inclusion: string): Buffer {
  const workbook = XLSX.utils.book_new();

  const sheet = XLSX.utils.aoa_to_sheet([
    headers,
    [
      commercialCode,
      '100.00',
      `EXP-${suffix}`,
      `PRES-${suffix}`,
      'Macro 4A Generic',
      'Macro 4A Commercial',
      'Macro 4A Lab',
      inclusion,
    ],
  ]);

  XLSX.utils.book_append_sheet(workbook, sheet, 'AT');

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
}

async function createTariffImport(content: Buffer): Promise<string> {
  const id = randomUUID();

  const hash = createHash('sha256').update(content).update(randomUUID()).digest('hex');

  await database.pool.query(
    `insert into tariff_annex_imports (
       id,
       organization_id,
       created_by,
       original_filename,
       mime_type,
       size_bytes,
       sha256,
       status,
       correlation_id,
       idempotency_key
     )
     values (
       $1,
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       'UPLOADED',
       $8,
       $9
     )`,
    [
      id,
      ORGANIZATION_IDS.MTD,
      userId,
      `m4a-${id}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content.length,
      hash,
      randomUUID(),
      `m4a:${id}`,
    ],
  );

  await database.pool.query(
    `insert into tariff_annex_import_source_files (
       import_id,
       original_filename,
       mime_type,
       size_bytes,
       sha256,
       content
     )
     values (
       $1,
       $2,
       $3,
       $4,
       $5,
       $6
     )`,
    [
      id,
      `m4a-${id}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content.length,
      hash,
      content,
    ],
  );

  return id;
}

async function api(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${adminToken}`,
      'x-organization-id': ORGANIZATION_IDS.MTD,
      ...(body === undefined
        ? {}
        : {
            'content-type': 'application/json',
          }),
    },
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
        }),
  });
}

describe.sequential('Macro 4A — tariff revalidation with immutable purchase commitment', () => {
  beforeAll(async () => {
    adminToken = await adminLogin();

    userId = (
      await database.pool.query<{
        id: string;
      }>(
        `select id
             from users
             where username=
                   'foundation-admin'`,
      )
    ).rows[0]!.id;

    await database.pool.query(
      `insert into tariff_annex_products (
           codigo_producto,
           tarifa_unidad,
           tarifa_unidad_canonical,
           numero_expediente_invima,
           consecutivo_invima_presentacion,
           descripcion_generica,
           descripcion_comercial,
           laboratorio,
           tipo_inclusion,
           active,
           organization_id,
           created_by,
           updated_by
         )
         values (
           $1,
           '100.00',
           100.0000,
           $2,
           $3,
           'Macro 4A Generic',
           'Macro 4A Commercial',
           'Macro 4A Lab',
           'PBS',
           true,
           $4,
           $5,
           $5
         )`,
      [commercialCode, `EXP-${suffix}`, `PRES-${suffix}`, ORGANIZATION_IDS.MTD, userId],
    );

    batchId = randomUUID();

    await database.pool.query(
      `insert into import_batches (
           id,
           organization_id,
           created_by,
           original_filename,
           mime_type,
           size_bytes,
           sha256,
           processor_version,
           status
         )
         values (
           $1,
           $2,
           $3,
           $4,
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           1,
           $5,
           1,
           'COMPLETED'
         )`,
      [
        batchId,
        ORGANIZATION_IDS.MTD,
        userId,
        `m4a-auth-${suffix}.xlsx`,
        createHash('sha256').update(`m4a-auth-${suffix}`).digest('hex'),
      ],
    );

    const authRows = await database.pool.query<{
      id: string;
      numero_autorizacion: string;
    }>(
      `insert into authorization_items (
             numero_autorizacion,
             codigo_medicamento,
             authorization_key,
             source_data,
             source_status_normalized,
             source_prescripcion_normalized,
             no_prescripcion,
             enablement_status,
             coverage_type,
             direction_status,
             coverage_rule_version,
             tariff_membership_status,
             tariff_membership_evaluated_at,
             created_from_batch_id,
             updated_by,
             last_load_id
           )
           values
             (
               $1::varchar,
               $3::varchar,
               $1::varchar || '|' || $3::varchar,
               $4::jsonb,
               'VIGENTE',
               '',
               '',
               'ENABLED',
               'PBS',
               'NOT_APPLICABLE',
               'AUTHORIZATIONS_V1',
               'LISTED',
               now(),
               $5::uuid,
               $6::uuid,
               $5::uuid
             ),
             (
               $2::varchar,
               $3::varchar,
               $2::varchar || '|' || $3::varchar,
               $4::jsonb,
               'VIGENTE',
               '',
               '',
               'ENABLED',
               'PBS',
               'NOT_APPLICABLE',
               'AUTHORIZATIONS_V1',
               'LISTED',
               now(),
               $5::uuid,
               $6::uuid,
               $5::uuid
             )
           returning
             id,
             numero_autorizacion`,
      [
        freeAuthorizationNumber,
        committedAuthorizationNumber,
        commercialCode,
        JSON.stringify({
          CANTIDAD: '1',
          FECHA_FINAL_VIGENCIA: '2599-12-31',
        }),
        batchId,
        userId,
      ],
    );

    freeAuthorizationId = authRows.rows.find(
      (row) => row.numero_autorizacion === freeAuthorizationNumber,
    )!.id;

    committedAuthorizationId = authRows.rows.find(
      (row) => row.numero_autorizacion === committedAuthorizationNumber,
    )!.id;

    planningPeriodId = (
      await database.pool.query<{
        id: string;
      }>(
        `insert into planning_periods (
               start_date,
               end_date,
               scheduling_cutoff_at,
               purchase_order_deadline_at,
               expected_delivery_date,
               status,
               created_by,
               updated_by
             )
             values (
               '2599-07-01',
               '2599-07-07',
               '2599-06-20T08:00:00Z',
               '2599-06-25T08:00:00Z',
               '2599-07-01',
               'PURCHASING',
               $1,
               $1
             )
             returning id`,
        [userId],
      )
    ).rows[0]!.id;

    demandLineId = (
      await database.pool.query<{
        id: string;
      }>(
        `insert into projected_demand_lines (
               planning_period_id,
               dispensing_point_id,
               commercial_code,
               projected_quantity,
               regular_quantity,
               late_quantity,
               status,
               revision,
               created_by,
               updated_by
             )
             values (
               $1,
               null,
               $2,
               2,
               2,
               0,
               'OPEN',
               1,
               $3,
               $3
             )
             returning id`,
        [planningPeriodId, commercialCode, userId],
      )
    ).rows[0]!.id;

    await database.pool.query(
      `insert into demand_sources (
           projected_demand_line_id,
           authorization_item_id,
           quantity,
           planning_period_id,
           dispensing_point_id,
           commercial_code,
           schedule_timing,
           late_handling,
           demand_bucket
         )
         values
           (
             $1,
             $2,
             1,
             $4,
             null,
             $5,
             'ON_TIME',
             null,
             'REGULAR'
           ),
           (
             $1,
             $3,
             1,
             $4,
             null,
             $5,
             'ON_TIME',
             null,
             'REGULAR'
           )`,
      [
        demandLineId,
        freeAuthorizationId,
        committedAuthorizationId,
        planningPeriodId,
        commercialCode,
      ],
    );

    existingPurchaseOrderId = (
      await database.pool.query<{
        id: string;
      }>(
        `insert into purchase_orders (
               purchase_order_code,
               planning_period_id,
               order_type,
               status,
               created_by,
               updated_by
             )
             values (
               $1,
               $2,
               'STANDARD',
               'DRAFT',
               $3,
               $3
             )
             returning id`,
        [`M4A-PO-${suffix}`, planningPeriodId, userId],
      )
    ).rows[0]!.id;

    existingPurchaseOrderLineId = (
      await database.pool.query<{
        id: string;
      }>(
        `insert into purchase_order_lines (
               purchase_order_id,
               commercial_code,
               product_description,
               presentation,
               dispensing_point_id,
               requested_quantity,
               accepted_quantity,
               requested_delivery_date,
               compensar_unit_rate_snapshot,
               supplier_unit_cost,
               projected_demand_line_id,
               projected_demand_revision,
               demand_bucket
             )
             values (
               $1,
               $2,
               'Macro 4A',
               'Macro 4A',
               null,
               1,
               null,
               null,
               '100.00',
               null,
               $3,
               1,
               'REGULAR'
             )
             returning id`,
        [existingPurchaseOrderId, commercialCode, demandLineId],
      )
    ).rows[0]!.id;

    await database.pool.query(
      `insert into purchase_order_demand_allocations (
           purchase_order_line_id,
           projected_demand_line_id,
           projected_demand_revision,
           demand_bucket,
           allocated_quantity
         )
         values (
           $1,
           $2,
           1,
           'REGULAR',
           1
         )`,
      [existingPurchaseOrderLineId, demandLineId],
    );

    await database.pool.query(
      `insert into purchase_order_authorization_sources (
           purchase_order_line_id,
           authorization_item_id,
           projected_demand_line_id,
           projected_demand_revision,
           source_quantity_snapshot
         )
         values (
           $1,
           $2,
           $3,
           1,
           1
         )`,
      [existingPurchaseOrderLineId, committedAuthorizationId, demandLineId],
    );
  });

  afterAll(async () => {
    await database.pool.query(
      `delete from purchase_order_authorization_sources source
       using purchase_order_lines pol, purchase_orders po
       where source.purchase_order_line_id = pol.id
         and pol.purchase_order_id = po.id
         and po.planning_period_id = $1`,
      [planningPeriodId],
    );

    await database.pool.query(
      `delete from purchase_order_demand_allocations allocation
       using purchase_order_lines pol, purchase_orders po
       where allocation.purchase_order_line_id = pol.id
         and pol.purchase_order_id = po.id
         and po.planning_period_id = $1`,
      [planningPeriodId],
    );

    await database.pool.query(
      `delete from purchase_order_lines
       where purchase_order_id in (
         select id
         from purchase_orders
         where planning_period_id = $1
       )`,
      [planningPeriodId],
    );

    await database.pool.query(
      `delete from purchase_orders
       where planning_period_id = $1`,
      [planningPeriodId],
    );

    await database.pool.query(
      `delete from demand_sources
       where projected_demand_line_id = $1`,
      [demandLineId],
    );

    await database.pool.query(
      `delete from projected_demand_lines
       where id = $1`,
      [demandLineId],
    );

    await database.pool.query(
      `delete from planning_periods
       where id = $1`,
      [planningPeriodId],
    );

    await database.pool.query(
      `delete from authorization_items
       where id in ($1, $2)`,
      [freeAuthorizationId, committedAuthorizationId],
    );

    await database.pool.end();
  });

  it('revalidates only the free authorization and freezes new purchase eligibility', async () => {
    const repository = new TariffAnnexRepository(database);

    const content = tariffWorkbook('NO PBS');

    const importId = await createTariffImport(content);

    const prepared = await repository.prepareImport({
      importId,
      actor: {
        userId,
        organizationId: ORGANIZATION_IDS.MTD,
        correlationId: randomUUID(),
      },
    });

    expect(prepared.outcome).toBe('prepared');

    const confirmed = await repository.confirmImport({
      importId,
      actor: {
        userId,
        organizationId: ORGANIZATION_IDS.MTD,
        correlationId: randomUUID(),
      },
    });

    expect(confirmed).toMatchObject({
      outcome: 'completed',
      updated: 1,
    });

    const authorizations = await database.pool.query<{
      id: string;
      coverage_type: string;
      direction_status: string;
      version: number;
    }>(
      `select
               id,
               coverage_type,
               direction_status,
               version
             from authorization_items
             where id in ($1,$2)
             order by id`,
      [freeAuthorizationId, committedAuthorizationId],
    );

    const free = authorizations.rows.find((row) => row.id === freeAuthorizationId);

    const committed = authorizations.rows.find((row) => row.id === committedAuthorizationId);

    expect(free).toMatchObject({
      coverage_type: 'NO_PBS',
      direction_status: 'PENDING',
    });

    expect(committed).toMatchObject({
      coverage_type: 'PBS',
      direction_status: 'NOT_APPLICABLE',
    });

    const immutableSource = await database.pool.query<{
      authorization_item_id: string;
      source_quantity_snapshot: number;
    }>(
      `select
               authorization_item_id,
               source_quantity_snapshot
             from purchase_order_authorization_sources
             where purchase_order_line_id=$1`,
      [existingPurchaseOrderLineId],
    );

    expect(immutableSource.rows).toEqual([
      {
        authorization_item_id: committedAuthorizationId,
        source_quantity_snapshot: 1,
      },
    ]);

    const available = await api(
      'GET',
      `/purchase-demand/available?planningPeriodId=${planningPeriodId}`,
    );

    expect(available.status).toBe(200);

    const availablePayload = (await available.json()) as {
      items: Array<{
        commercialCode: string;
      }>;
    };

    expect(availablePayload.items.some((item) => item.commercialCode === commercialCode)).toBe(
      false,
    );

    const stalePurchase = await api('POST', '/purchase-orders', {
      planningPeriodId,
      orderType: 'STANDARD',
      purchaseOrderCode: `M4A-STALE-${suffix}`,
      lines: [
        {
          projectedDemandLineId: demandLineId,
          expectedDemandRevision: 1,
          requestedQuantity: 1,
          demandBucket: 'REGULAR',
        },
      ],
    });

    expect(stalePurchase.status).toBe(409);

    const error = (await stalePurchase.json()) as {
      code?: string;
    };

    expect(error.code).toBe('PURCHASE_ORDER_TARIFF_NOT_PBS');

    const staleOrderCount = await database.pool.query<{
      count: number;
    }>(
      `select count(*)::int count
             from purchase_orders
             where purchase_order_code=$1`,
      [`M4A-STALE-${suffix}`],
    );

    expect(staleOrderCount.rows[0]?.count).toBe(0);

    const audit = await database.pool.query<{
      count: number;
    }>(
      `select count(*)::int count
             from audit_events
             where action=
                   'AUTHORIZATION_TARIFF_REVALIDATED'
               and resource_id=$1`,
      [freeAuthorizationId],
    );

    expect(audit.rows[0]?.count).toBe(1);

    const committedAudit = await database.pool.query<{
      count: number;
    }>(
      `select count(*)::int count
             from audit_events
             where action=
                   'AUTHORIZATION_TARIFF_REVALIDATED'
               and resource_id=$1`,
      [committedAuthorizationId],
    );

    expect(committedAudit.rows[0]?.count).toBe(0);
  });

  it('Macro 4B — released purchase commitment allows tariff revalidation again', async () => {
    const repository = new TariffAnnexRepository(database);

    const purchaseOrder = await database.pool.query<{
      id: string;
    }>(
      `select po.id
       from purchase_order_authorization_sources source
       join purchase_order_lines pol
         on pol.id = source.purchase_order_line_id
       join purchase_orders po
         on po.id = pol.purchase_order_id
       where source.authorization_item_id = $1
       limit 1`,
      [committedAuthorizationId],
    );

    const purchaseOrderId = purchaseOrder.rows[0]?.id;

    expect(purchaseOrderId).toBeTruthy();

    if (!purchaseOrderId) {
      throw new Error('M4B_PURCHASE_ORDER_NOT_FOUND');
    }

    const applyInclusion = async (inclusion: 'PBS' | 'NO PBS') => {
      const importId = await createTariffImport(tariffWorkbook(inclusion));

      const actor = {
        userId,
        organizationId: ORGANIZATION_IDS.MTD,
        correlationId: randomUUID(),
      };

      const prepared = await repository.prepareImport({
        importId,
        actor,
      });

      expect(prepared.outcome).toBe('prepared');

      const confirmed = await repository.confirmImport({
        importId,
        actor,
      });

      expect(confirmed).toMatchObject({
        outcome: 'completed',
        updated: 1,
      });
    };

    const readCommittedAuthorization = async () => {
      const result = await database.pool.query<{
        coverage_type: string;
        direction_status: string;
      }>(
        `select
           coverage_type,
           direction_status
         from authorization_items
         where id = $1`,
        [committedAuthorizationId],
      );

      return result.rows[0];
    };

    expect(await readCommittedAuthorization()).toMatchObject({
      coverage_type: 'PBS',
      direction_status: 'NOT_APPLICABLE',
    });

    await database.pool.query(
      `update purchase_orders
       set status = 'REJECTED',
           version = version + 1,
           updated_at = now()
       where id = $1`,
      [purchaseOrderId],
    );

    await applyInclusion('PBS');
    await applyInclusion('NO PBS');

    expect(await readCommittedAuthorization()).toMatchObject({
      coverage_type: 'NO_PBS',
      direction_status: 'PENDING',
    });

    await database.pool.query(
      `update purchase_orders
       set status = 'ISSUED',
           version = version + 1,
           updated_at = now()
       where id = $1`,
      [purchaseOrderId],
    );

    await applyInclusion('PBS');

    expect(await readCommittedAuthorization()).toMatchObject({
      coverage_type: 'NO_PBS',
      direction_status: 'PENDING',
    });

    await applyInclusion('NO PBS');

    expect(await readCommittedAuthorization()).toMatchObject({
      coverage_type: 'NO_PBS',
      direction_status: 'PENDING',
    });

    await database.pool.query(
      `update purchase_orders
       set status = 'CANCELLED',
           version = version + 1,
           updated_at = now()
       where id = $1`,
      [purchaseOrderId],
    );

    await applyInclusion('PBS');

    expect(await readCommittedAuthorization()).toMatchObject({
      coverage_type: 'PBS',
      direction_status: 'NOT_APPLICABLE',
    });
  });
});
