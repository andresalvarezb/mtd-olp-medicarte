import { createHash, randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ORGANIZATION_IDS, adminLogin } from './helpers/auth';

const database = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://authorization:authorization@localhost:15432/authorization_test_integration',
});

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

const suffix = randomUUID().slice(0, 8).toUpperCase();

const commercialCode = `W2B-${suffix}`;

const inventoryPointCode = `W2B-STOCK-${suffix}`;

let adminToken = '';
let userId = '';
let periodId = '';
let batchId = '';
let demandLineId = '';
let pointId = '';
let locationId = '';
let lotId = '';
let openOrderId = '';

let authorizationAId = '';
let authorizationBId = '';
let authorizationCId = '';

let assignmentDate = '';
let expirationA = '';
let expirationB = '';
let expirationC = '';

async function api(method: string, path: string): Promise<Response> {
  return fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
      'x-organization-id': ORGANIZATION_IDS.MTD,
    },
  });
}

async function projection() {
  const response = await api('GET', `/projected-demand/${demandLineId}/coverage-projection`);

  expect(response.status).toBe(200);

  return response.json() as Promise<{
    projectedDemandLineId: string;
    projectedDemandRevision: number;
    commercialCode: string;
    allocationPolicy: string;
    physicalReservation: boolean;
    fungiblePool: boolean;
    usableStockQuantity: number;
    openPurchaseCoverageQuantity: number;
    totalCoveragePoolQuantity: number;
    totalDemandQuantity: number;
    projectedCoveredQuantity: number;
    projectedUncoveredQuantity: number;
    unusedCoverageQuantity: number;
    items: Array<{
      authorizationItemId: string;
      authorizationNumber: string;
      patientDocument: string | null;
      patientName: string | null;
      demandBucket: string;
      demandQuantity: number;
      assignmentDate: string;
      expirationDate: string;
      projectedStockCoverage: number;
      projectedOpenPurchaseCoverage: number;
      projectedCoveredQuantity: number;
      projectedUncoveredQuantity: number;
      coverageStatus: string;
    }>;
  }>;
}

async function insertAuthorization(input: {
  number: string;
  quantity: number;
  expirationDate: string;
  patient: string;
}): Promise<string> {
  const result = await database.query<{
    id: string;
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
       values (
         $1::varchar(255),
         $2::varchar(255),
         (
           $1::varchar(255)
           || '|'
           || $2::varchar(255)
         )::varchar(511),
         $3::jsonb,
         '5',
         '',
         '',
         'ENABLED',
         'PBS',
         'NOT_APPLICABLE',
         'AUTHORIZATIONS_V1',
         'LISTED',
         now(),
         $4,
         $5,
         $4
       )
       returning id`,
    [
      input.number,
      commercialCode,
      JSON.stringify({
        NUMERO_AUTORIZACION: input.number,
        CODIGO_COMERCIAL: commercialCode,
        CANTIDAD: String(input.quantity),
        FECHA_ASIGNACION: assignmentDate,
        FECHA_FINAL_VIGENCIA: input.expirationDate,
        IDENTIFICACION_PACIENTE: `DOC-${input.patient}-${suffix}`,
        NOMBRE_PACIENTE: `Paciente ${input.patient}`,
      }),
      batchId,
      userId,
    ],
  );

  return result.rows[0]!.id;
}

describe('Wave 2B — fungible coverage projection by authorization', () => {
  beforeAll(async () => {
    await database.connect();

    adminToken = await adminLogin();

    userId = (
      await database.query<{
        id: string;
      }>(
        `select id
             from users
            where username =
                  'foundation-admin'`,
      )
    ).rows[0]!.id;

    const dates = await database.query<{
      period_start: string;
      period_end: string;
      assignment_date: string;
      expiration_a: string;
      expiration_b: string;
      expiration_c: string;
    }>(
      `select
             to_char(
               base_date,
               'YYYY-MM-DD'
             )
               as period_start,
             to_char(
               base_date + 6,
               'YYYY-MM-DD'
             )
               as period_end,
             to_char(
               base_date,
               'YYYY-MM-DD'
             )
               as assignment_date,
             to_char(
               base_date + 20,
               'YYYY-MM-DD'
             )
               as expiration_a,
             to_char(
               base_date + 30,
               'YYYY-MM-DD'
             )
               as expiration_b,
             to_char(
               base_date + 10,
               'YYYY-MM-DD'
             )
               as expiration_c
           from (
             select (
               greatest(
                 coalesce(
                   max(end_date),
                   current_date
                 ),
                 current_date
               ) + 60
             )::date
               as base_date
             from planning_periods
           ) x`,
    );

    const dateRow = dates.rows[0]!;

    assignmentDate = dateRow.assignment_date;

    expirationA = dateRow.expiration_a;

    expirationB = dateRow.expiration_b;

    expirationC = dateRow.expiration_c;

    periodId = (
      await database.query<{
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
             $1::date,
             $2::date,
             ($1::date - interval '10 days'),
             ($1::date - interval '5 days'),
             $1::date,
             'PURCHASING',
             $3,
             $3
           )
           returning id`,
        [dateRow.period_start, dateRow.period_end, userId],
      )
    ).rows[0]!.id;

    batchId = randomUUID();

    await database.query(
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
        `w2b-${suffix}.xlsx`,
        createHash('sha256').update(`w2b-${suffix}`).digest('hex'),
      ],
    );

    authorizationAId = await insertAuthorization({
      number: `W2B-A-${suffix}`,
      quantity: 4,
      expirationDate: expirationA,
      patient: 'A',
    });

    authorizationBId = await insertAuthorization({
      number: `W2B-B-${suffix}`,
      quantity: 5,
      expirationDate: expirationB,
      patient: 'B',
    });

    authorizationCId = await insertAuthorization({
      number: `W2B-C-${suffix}`,
      quantity: 3,
      expirationDate: expirationC,
      patient: 'C',
    });

    demandLineId = (
      await database.query<{
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
             12,
             9,
             3,
             'OPEN',
             1,
             $3,
             $3
           )
           returning id`,
        [periodId, commercialCode, userId],
      )
    ).rows[0]!.id;

    await database.query(
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
             4,
             $5,
             null,
             $6,
             'ON_TIME',
             null,
             'REGULAR'
           ),
           (
             $1,
             $3,
             5,
             $5,
             null,
             $6,
             'ON_TIME',
             null,
             'REGULAR'
           ),
           (
             $1,
             $4,
             3,
             $5,
             null,
             $6,
             'ON_TIME',
             null,
             'LATE'
           )`,
      [
        demandLineId,
        authorizationAId,
        authorizationBId,
        authorizationCId,
        periodId,
        commercialCode,
      ],
    );

    pointId = (
      await database.query<{
        id: string;
      }>(
        `insert into dispensing_points (
             organization_id,
             code,
             name,
             active,
             created_by
           )
           values (
             $1,
             $2,
             $2,
             true,
             $3
           )
           returning id`,
        [ORGANIZATION_IDS.MTD, inventoryPointCode, userId],
      )
    ).rows[0]!.id;

    locationId = (
      await database.query<{
        id: string;
      }>(
        `select id
             from inventory_locations
            where legacy_dispensing_point_id =
                  $1`,
        [pointId],
      )
    ).rows[0]!.id;

    lotId = (
      await database.query<{
        id: string;
      }>(
        `insert into inventory_lots (
             commercial_code,
             inventory_location_id,
             dispensing_point_id,
             lot_number,
             expiration_date
           )
           values (
             $1,
             $2,
             $3,
             $4,
             '2599-12-31'
           )
           returning id`,
        [commercialCode, locationId, pointId, `W2B-LOT-${suffix}`],
      )
    ).rows[0]!.id;

    await database.query(
      `insert into inventory_movements (
           inventory_lot_id,
           movement_type,
           quantity_delta,
           source_type,
           source_id,
           occurred_at,
           created_by
         )
         values (
           $1,
           'ADJUSTMENT',
           5,
           'W2B_FIXTURE',
           $2,
           now(),
           $3
         )`,
      [lotId, randomUUID(), userId],
    );

    openOrderId = (
      await database.query<{
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
        [`W2B-OPEN-${suffix}`, periodId, userId],
      )
    ).rows[0]!.id;

    await database.query(
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
           'W2B product',
           'W2B',
           null,
           4,
           null,
           null,
           '1.00',
           null,
           $3,
           1,
           'REGULAR'
         )`,
      [openOrderId, commercialCode, demandLineId],
    );
  });

  afterAll(async () => {
    try {
      if (openOrderId) {
        await database.query(
          `delete from purchase_order_authorization_sources
              where purchase_order_line_id in (
                select id
                from purchase_order_lines
                where purchase_order_id=$1
              )`,
          [openOrderId],
        );

        await database.query(
          `delete from purchase_order_demand_allocations
              where purchase_order_line_id in (
                select id
                from purchase_order_lines
                where purchase_order_id=$1
              )`,
          [openOrderId],
        );

        await database.query(
          `delete from purchase_order_lines
              where purchase_order_id=$1`,
          [openOrderId],
        );

        await database.query(
          `delete from purchase_orders
              where id=$1`,
          [openOrderId],
        );
      }

      if (lotId) {
        await database.query(
          `delete from inventory_movements
              where inventory_lot_id=$1`,
          [lotId],
        );

        await database.query(
          `delete from inventory_lots
              where id=$1`,
          [lotId],
        );
      }

      if (demandLineId) {
        await database.query(
          `delete from demand_sources
              where projected_demand_line_id=$1`,
          [demandLineId],
        );

        await database.query(
          `delete from projected_demand_lines
              where id=$1`,
          [demandLineId],
        );
      }

      const authorizationIds = [authorizationAId, authorizationBId, authorizationCId].filter(
        Boolean,
      );

      if (authorizationIds.length > 0) {
        await database.query(
          `delete from authorization_item_organizations
              where authorization_item_id =
                    any($1::uuid[])`,
          [authorizationIds],
        );

        await database.query(
          `delete from authorization_items
              where id =
                    any($1::uuid[])`,
          [authorizationIds],
        );
      }

      if (batchId) {
        await database.query(
          `delete from import_batches
              where id=$1`,
          [batchId],
        );
      }

      if (locationId) {
        await database.query(
          `delete from inventory_locations
              where id=$1`,
          [locationId],
        );
      }

      if (pointId) {
        await database.query(
          `delete from dispensing_points
              where id=$1`,
          [pointId],
        );
      }

      if (periodId) {
        await database.query(
          `delete from planning_periods
              where id=$1`,
          [periodId],
        );
      }
    } finally {
      await database.end();
    }
  });

  it('projects stock and open purchase coverage across AUTO without physical reservation', async () => {
    const result = await projection();

    expect(result).toMatchObject({
      projectedDemandLineId: demandLineId,
      projectedDemandRevision: 1,
      commercialCode,
      allocationPolicy: 'REGULAR_THEN_LATE_EARLIEST_EXPIRATION',
      physicalReservation: false,
      fungiblePool: true,
      usableStockQuantity: 5,
      openPurchaseCoverageQuantity: 4,
      totalCoveragePoolQuantity: 9,
      totalDemandQuantity: 12,
      projectedCoveredQuantity: 9,
      projectedUncoveredQuantity: 3,
      unusedCoverageQuantity: 0,
    });

    expect(
      result.items.map((item) => ({
        authorizationNumber: item.authorizationNumber,
        bucket: item.demandBucket,
        demand: item.demandQuantity,
        stock: item.projectedStockCoverage,
        openPurchase: item.projectedOpenPurchaseCoverage,
        covered: item.projectedCoveredQuantity,
        uncovered: item.projectedUncoveredQuantity,
        status: item.coverageStatus,
      })),
    ).toEqual([
      {
        authorizationNumber: `W2B-A-${suffix}`,
        bucket: 'REGULAR',
        demand: 4,
        stock: 4,
        openPurchase: 0,
        covered: 4,
        uncovered: 0,
        status: 'COVERED',
      },
      {
        authorizationNumber: `W2B-B-${suffix}`,
        bucket: 'REGULAR',
        demand: 5,
        stock: 1,
        openPurchase: 4,
        covered: 5,
        uncovered: 0,
        status: 'COVERED',
      },
      {
        authorizationNumber: `W2B-C-${suffix}`,
        bucket: 'LATE',
        demand: 3,
        stock: 0,
        openPurchase: 0,
        covered: 0,
        uncovered: 3,
        status: 'UNCOVERED',
      },
    ]);
  });

  it('does not create inventory movements or physical reservation state when projection is read', async () => {
    const before = await database.query<{
      count: number;
    }>(
      `select count(*)::int count
               from inventory_movements
              where inventory_lot_id=$1`,
      [lotId],
    );

    const result = await projection();

    const after = await database.query<{
      count: number;
    }>(
      `select count(*)::int count
               from inventory_movements
              where inventory_lot_id=$1`,
      [lotId],
    );

    expect(result.physicalReservation).toBe(false);

    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);

    const reservationTable = await database.query<{
      exists: boolean;
    }>(
      `select
               to_regclass(
                 'public.authorization_stock_reservations'
               ) is not null
                 as exists`,
    );

    expect(reservationTable.rows[0]?.exists).toBe(false);
  });

  it('recomputes the advisory projection when authorization priority changes', async () => {
    await database.query(
      `update authorization_items
              set source_data =
                    jsonb_set(
                      source_data,
                      '{FECHA_FINAL_VIGENCIA}',
                      to_jsonb($1::text),
                      true
                    ),
                  updated_at=now()
            where id=$2`,
      [expirationA, authorizationBId],
    );

    await database.query(
      `update authorization_items
              set source_data =
                    jsonb_set(
                      source_data,
                      '{FECHA_FINAL_VIGENCIA}',
                      to_jsonb($1::text),
                      true
                    ),
                  updated_at=now()
            where id=$2`,
      [expirationB, authorizationAId],
    );

    const result = await projection();

    expect(result.items.slice(0, 2).map((item) => item.authorizationNumber)).toEqual([
      `W2B-B-${suffix}`,
      `W2B-A-${suffix}`,
    ]);

    expect(result.items[0]).toMatchObject({
      authorizationItemId: authorizationBId,
      demandQuantity: 5,
      projectedStockCoverage: 5,
      projectedOpenPurchaseCoverage: 0,
      coverageStatus: 'COVERED',
    });

    expect(result.items[1]).toMatchObject({
      authorizationItemId: authorizationAId,
      demandQuantity: 4,
      projectedStockCoverage: 0,
      projectedOpenPurchaseCoverage: 4,
      coverageStatus: 'COVERED',
    });
  });
});
