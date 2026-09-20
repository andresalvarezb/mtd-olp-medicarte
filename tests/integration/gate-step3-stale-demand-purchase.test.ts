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

const commercialCode = `W2B-STALE-${suffix}`;

const deliveryPointCode = `W2B-STALE-PT-${suffix}`;

const invimaRecord = `9${suffix.replace(/\D/g, '').padEnd(11, '6').slice(0, 11)}`;

const invimaPresentation = '1';

let adminToken = '';
let userId = '';
let batchId = '';
let periodId = '';
let authorizationId = '';
let demandLineId = '';
let deliveryPointId = '';

let todayBogota = '';
let futureAssignment = '';
let validExpiration = '';
let expiredDate = '';

async function api(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
      'x-organization-id': ORGANIZATION_IDS.MTD,
    },
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
        }),
  });
}

async function createOrder(label: string): Promise<Response> {
  return api('POST', '/purchase-orders', {
    planningPeriodId: periodId,
    orderType: 'STANDARD',
    purchaseOrderCode: `W2B-STALE-${label}-${suffix}`,
    lines: [
      {
        projectedDemandLineId: demandLineId,
        expectedDemandRevision: 1,
        requestedQuantity: 1,
        demandBucket: 'REGULAR',
      },
    ],
  });
}

async function expectStale(label: string): Promise<void> {
  const response = await createOrder(label);

  expect(response.status).toBe(409);

  const body = (await response.json()) as {
    code?: string;
  };

  expect(body.code).toBe('PURCHASE_ORDER_DEMAND_STALE');
}

async function deleteOrders(): Promise<void> {
  await database.query(
    `delete from purchase_order_authorization_sources
      where purchase_order_line_id in (
        select pol.id
        from purchase_order_lines pol
        join purchase_orders po
          on po.id =
             pol.purchase_order_id
        where po.planning_period_id =
              $1
      )`,
    [periodId],
  );

  await database.query(
    `delete from purchase_order_demand_allocations
      where purchase_order_line_id in (
        select pol.id
        from purchase_order_lines pol
        join purchase_orders po
          on po.id =
             pol.purchase_order_id
        where po.planning_period_id =
              $1
      )`,
    [periodId],
  );

  await database.query(
    `delete from purchase_order_lines
      where purchase_order_id in (
        select id
        from purchase_orders
        where planning_period_id =
              $1
      )`,
    [periodId],
  );

  await database.query(
    `delete from purchase_orders
      where planning_period_id =
            $1`,
    [periodId],
  );
}

describe('Wave 2B — stale authorization demand purchase boundary', () => {
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
      today_bogota: string;
      future_assignment: string;
      valid_expiration: string;
      expired_date: string;
      period_start: string;
      period_end: string;
    }>(
      `select
             to_char(
               now() at time zone
                 'America/Bogota',
               'YYYY-MM-DD'
             )
               as today_bogota,

             to_char(
               (
                 date_trunc(
                   'month',
                   now() at time zone
                     'America/Bogota'
                 )
                 + interval '1 month'
               )::date,
               'YYYY-MM-DD'
             )
               as future_assignment,

             to_char(
               (
                 now() at time zone
                   'America/Bogota'
               )::date
               + 45,
               'YYYY-MM-DD'
             )
               as valid_expiration,

             to_char(
               (
                 now() at time zone
                   'America/Bogota'
               )::date
               - 1,
               'YYYY-MM-DD'
             )
               as expired_date,

             to_char(
               base_date,
               'YYYY-MM-DD'
             )
               as period_start,

             to_char(
               base_date + 6,
               'YYYY-MM-DD'
             )
               as period_end

           from (
             select (
               greatest(
                 coalesce(
                   max(end_date),
                   current_date
                 ),
                 current_date
               ) + 90
             )::date
               as base_date
             from planning_periods
           ) x`,
    );

    const dateRow = dates.rows[0]!;

    todayBogota = dateRow.today_bogota;

    futureAssignment = dateRow.future_assignment;

    validExpiration = dateRow.valid_expiration;

    expiredDate = dateRow.expired_date;

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
        `w2b-stale-${suffix}.xlsx`,
        createHash('sha256').update(`w2b-stale-${suffix}`).digest('hex'),
      ],
    );

    await database.query(
      `insert into tariff_annex_products (
           codigo_producto,
           tarifa_unidad,
           tarifa_unidad_canonical,
           numero_expediente_invima,
           consecutivo_invima_presentacion,
           descripcion_generica,
           descripcion_comercial,
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
           'W2B stale product',
           'W2B stale product',
           'PBS',
           true,
           $4,
           $5,
           $5
         )`,
      [commercialCode, invimaRecord, invimaPresentation, ORGANIZATION_IDS.MTD, userId],
    );

    deliveryPointId = (
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
             'W2B stale Medicarte point',
             true,
             $3
           )
           returning id`,
        [ORGANIZATION_IDS.MEDICARTE, deliveryPointCode, userId],
      )
    ).rows[0]!.id;

    await database.query(
      `insert into product_delivery_point_mappings (
           invima_record_normalized,
           invima_presentation_normalized,
           source_cum_code,
           service_model,
           source_site_name,
           dispensing_point_id,
           created_by,
           updated_by
         )
         values (
           $1,
           $2,
           $3,
           'FIXTURE',
           'W2B stale Medicarte point',
           $4,
           $5,
           $5
         )`,
      [invimaRecord, invimaPresentation, `${invimaRecord}-01`, deliveryPointId, userId],
    );

    authorizationId = (
      await database.query<{
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
          `W2B-STALE-AUTO-${suffix}`,
          commercialCode,
          JSON.stringify({
            NUMERO_AUTORIZACION: `W2B-STALE-AUTO-${suffix}`,
            CODIGO_COMERCIAL: commercialCode,
            CANTIDAD: '2',
            FECHA_ASIGNACION: todayBogota,
            FECHA_FINAL_VIGENCIA: validExpiration,
            IDENTIFICACION_PACIENTE: `DOC-W2B-${suffix}`,
            NOMBRE_PACIENTE: 'Paciente W2B stale',
          }),
          batchId,
          userId,
        ],
      )
    ).rows[0]!.id;

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
             consolidated_at,
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
             now(),
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
         values (
           $1,
           $2,
           2,
           $3,
           null,
           $4,
           'ON_TIME',
           null,
           'REGULAR'
         )`,
      [demandLineId, authorizationId, periodId, commercialCode],
    );
  });

  afterAll(async () => {
    try {
      await deleteOrders();

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

      if (authorizationId) {
        await database.query(
          `delete from authorization_item_organizations
              where authorization_item_id=$1`,
          [authorizationId],
        );

        await database.query(
          `delete from authorization_items
              where id=$1`,
          [authorizationId],
        );
      }

      if (batchId) {
        await database.query(
          `delete from import_batches
              where id=$1`,
          [batchId],
        );
      }

      await database.query(
        `delete from product_delivery_point_mappings
            where dispensing_point_id=$1`,
        [deliveryPointId],
      );

      await database.query(
        `delete from tariff_annex_products
            where codigo_producto=$1`,
        [commercialCode],
      );

      await database.query(
        `delete from inventory_locations
            where legacy_dispensing_point_id=$1`,
        [deliveryPointId],
      );

      await database.query(
        `delete from dispensing_points
            where id=$1`,
        [deliveryPointId],
      );

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

  it('allows purchase while consolidated authorization provenance is still current', async () => {
    const response = await createOrder('VALID');

    expect(response.status).toBe(201);

    await deleteOrders();
  });

  it('blocks stale consolidated demand when AUTO source status is no longer 5', async () => {
    await database.query(
      `update authorization_items
              set source_status_normalized='4',
                  updated_at=now()
            where id=$1`,
      [authorizationId],
    );

    await expectStale('STATUS');

    await database.query(
      `update authorization_items
              set source_status_normalized='5',
                  updated_at=now()
            where id=$1`,
      [authorizationId],
    );
  });

  it('blocks stale consolidated demand when FECHA_ASIGNACION moved to a future month', async () => {
    await database.query(
      `update authorization_items
              set source_data =
                    jsonb_set(
                      source_data,
                      '{FECHA_ASIGNACION}',
                      to_jsonb($1::text),
                      true
                    ),
                  updated_at=now()
            where id=$2`,
      [futureAssignment, authorizationId],
    );

    await expectStale('FUTURE');

    await database.query(
      `update authorization_items
              set source_data =
                    jsonb_set(
                      source_data,
                      '{FECHA_ASIGNACION}',
                      to_jsonb($1::text),
                      true
                    ),
                  updated_at=now()
            where id=$2`,
      [todayBogota, authorizationId],
    );
  });

  it('blocks stale consolidated demand when authorization expired after consolidation', async () => {
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
      [expiredDate, authorizationId],
    );

    await expectStale('EXPIRED');

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
      [validExpiration, authorizationId],
    );
  });

  it('blocks stale consolidated demand when authorization quantity changed after consolidation', async () => {
    await database.query(
      `update authorization_items
              set source_data =
                    jsonb_set(
                      source_data,
                      '{CANTIDAD}',
                      to_jsonb('3'::text),
                      true
                    ),
                  updated_at=now()
            where id=$1`,
      [authorizationId],
    );

    await expectStale('QUANTITY');

    await database.query(
      `update authorization_items
              set source_data =
                    jsonb_set(
                      source_data,
                      '{CANTIDAD}',
                      to_jsonb('2'::text),
                      true
                    ),
                  updated_at=now()
            where id=$1`,
      [authorizationId],
    );
  });
});
