import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGANIZATION_IDS, adminLogin } from './helpers/auth';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization_test_integration';

const apiUrl = process.env.API_URL ?? 'http://localhost:3004';

const database = new Client({ connectionString: databaseUrl });

const suffix = randomUUID().slice(0, 8).toUpperCase();

function bogotaDateForGate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function plusDays(
  value: string,
  days: number,
): string {
  const date =
    new Date(
      `${value}T00:00:00Z`,
    );

  date.setUTCDate(
    date.getUTCDate() +
      days,
  );

  return date
    .toISOString()
    .slice(
      0,
      10,
    );
}

const TODAY_BOGOTA = bogotaDateForGate();
const CURRENT_MONTH_ASSIGNMENT = `${TODAY_BOGOTA.slice(0, 7)}-01`;
const OUTSIDE_HORIZON_ASSIGNMENT = plusDays(
  TODAY_BOGOTA,
  31,
);

const CODE_A = `M3A-A-${suffix}`;
const CODE_B = `M3A-B-${suffix}`;
const CODE_BLOCKED = `M3A-BLOCK-${suffix}`;
const CODE_STALE_COVERAGE = `M3A-STALE-${suffix}`;
const CODE_NO_PBS = `M3A-NOPBS-${suffix}`;
const CODE_EXPIRED = `M3A-EXP-${suffix}`;
const CODE_NO_TARIFF = `M3A-NOTARIFF-${suffix}`;

const TARIFF_PRODUCTS = [
  { code: CODE_A, tipoInclusion: 'PBS' },
  { code: CODE_B, tipoInclusion: 'PBS' },
  { code: CODE_BLOCKED, tipoInclusion: 'PBS' },
  { code: CODE_STALE_COVERAGE, tipoInclusion: ' pbs ' },
  { code: CODE_NO_PBS, tipoInclusion: ' no pbs ' },
  { code: CODE_EXPIRED, tipoInclusion: 'PBS' },
] as const;

const TARIFF_CODES = TARIFF_PRODUCTS.map((product) => product.code);

let adminToken = '';
let foundationUserId = '';
let periodId = '';
let periodStart = '';
let periodEnd = '';
let validExpiration = '';
let batchId = '';
let pointId = '';
let ignoredScheduleId = '';

let authA1Id = '';
let authA2Id = '';
let authBId = '';
let futureId = '';
let blockedId = '';
let staleCoverageId = '';
let noPbsId = '';
let expiredId = '';
let noTariffId = '';

async function apiCall(method: string, path: string, body: unknown = undefined): Promise<Response> {
  return fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
      'x-organization-id': ORGANIZATION_IDS.MTD,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function insertAuthorization(input: {
  label: string;
  commercialCode: string;
  quantity: number;
  enablementStatus?: 'ENABLED' | 'BLOCKED_SOURCE_STATUS';
  coverageType?: 'PBS' | 'NO_PBS';
  expirationDate?: string;
  assignmentDate?: string;
}): Promise<string> {
  const authorizationNumber = `M3A-${suffix}-${input.label}`;

  const result = await database.query<{ id: string }>(
    `insert into authorization_items
      (
        numero_autorizacion,
        codigo_medicamento,
        authorization_key,
        source_data,
        source_status_normalized,
        enablement_status,
        coverage_type,
        direction_status,
        coverage_rule_version,
        tariff_membership_status,
        tariff_membership_evaluated_at,
        created_from_batch_id
      )
     values
      (
        $1,
        $2,
        $3,
        $4::jsonb,
        $5,
        $6,
        $7,
        'NOT_APPLICABLE',
        'MACRO3A',
        'LISTED',
        now(),
        $8
      )
     returning id`,
    [
      authorizationNumber,
      input.commercialCode,
      `${authorizationNumber}:${input.commercialCode}`,
      JSON.stringify({
        NUMERO_AUTORIZACION: authorizationNumber,
        CODIGO_COMERCIAL: input.commercialCode,
        CANTIDAD: String(input.quantity),
        FECHA_ASIGNACION: input.assignmentDate ?? CURRENT_MONTH_ASSIGNMENT,
        FECHA_FINAL_VIGENCIA: input.expirationDate ?? validExpiration,
        IDENTIFICACION_PACIENTE: `DOC-${input.label}-${suffix}`,
        NOMBRE_PACIENTE: `Paciente ${input.label}`,
      }),
      input.enablementStatus === 'BLOCKED_SOURCE_STATUS' ? '4' : '5',
      input.enablementStatus ?? 'ENABLED',
      input.coverageType ?? 'PBS',
      batchId,
    ],
  );

  return result.rows[0]!.id;
}

async function consolidate(): Promise<Response> {
  return apiCall('POST', `/planning-periods/${periodId}/consolidate`, {});
}

beforeAll(async () => {
  await database.connect();

  const admin = await database.query<{ id: string }>(
    `select id from users where username = 'foundation-admin'`,
  );

  foundationUserId = admin.rows[0]?.id ?? '';

  if (!foundationUserId) {
    throw new Error('FOUNDATION_ADMIN_NOT_FOUND');
  }

  adminToken = await adminLogin();

  const freeRange = await database.query<{
    start_date: string;
    end_date: string;
    expiration_date: string;
  }>(
    `select
       to_char(base_date, 'YYYY-MM-DD') as start_date,
       to_char(base_date + 6, 'YYYY-MM-DD') as end_date,
       to_char(base_date + 365, 'YYYY-MM-DD') as expiration_date
     from (
       select (
         greatest(coalesce(max(end_date), current_date), current_date) + 30
       )::date as base_date
       from planning_periods
     ) x`,
  );

  periodStart = freeRange.rows[0]!.start_date;
  periodEnd = freeRange.rows[0]!.end_date;
  validExpiration = freeRange.rows[0]!.expiration_date;

  const period = await database.query<{ id: string }>(
    `insert into planning_periods
      (
        start_date,
        end_date,
        scheduling_cutoff_at,
        purchase_order_deadline_at,
        expected_delivery_date,
        created_by,
        updated_by
      )
     values
      (
        $1::date,
        $2::date,
        ($1::date + time '08:00') at time zone 'America/Bogota',
        (($1::date + 1) + time '17:00') at time zone 'America/Bogota',
        ($2::date + 1),
        $3,
        $3
      )
     returning id`,
    [periodStart, periodEnd, foundationUserId],
  );

  periodId = period.rows[0]!.id;

  const sha256 = randomUUID().replaceAll('-', '').padEnd(64, 'a').slice(0, 64);

  const batch = await database.query<{ id: string }>(
    `insert into import_batches
      (
        organization_id,
        created_by,
        original_filename,
        mime_type,
        size_bytes,
        sha256,
        processor_version,
        status,
        total_rows,
        confirmed_rows,
        completed_at,
        confirmed_at
      )
     values
      (
        $1,
        $2,
        $3,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        1,
        $4,
        1,
        'COMPLETED',
        7,
        7,
        now(),
        now()
      )
     returning id`,
    [ORGANIZATION_IDS.MTD, foundationUserId, `macro3a-${suffix}.xlsx`, sha256],
  );

  batchId = batch.rows[0]!.id;

  for (const product of TARIFF_PRODUCTS) {
    await database.query(
      `insert into tariff_annex_products
        (
          codigo_producto,
          tarifa_unidad,
          tarifa_unidad_canonical,
          descripcion_generica,
          descripcion_comercial,
          tipo_inclusion,
          active,
          organization_id,
          created_by,
          updated_by
        )
       values
        (
          $1,
          '100.00',
          100.0000,
          'Producto Macro 3A',
          'Producto Macro 3A',
          $4,
          true,
          $2,
          $3,
          $3
        )`,
      [product.code, ORGANIZATION_IDS.MTD, foundationUserId, product.tipoInclusion],
    );
  }

  authA1Id = await insertAuthorization({
    label: 'A1',
    commercialCode: CODE_A,
    quantity: 2,
  });

  authA2Id = await insertAuthorization({
    label: 'A2',
    commercialCode: CODE_A,
    quantity: 3,
  });

  // Debe persistir como AUTO habilitada, pero no participar en demanda
  // mientras FECHA_ASIGNACION supere el horizonte HOY + 30.
  futureId = await insertAuthorization({
    label: 'FUTURE',
    commercialCode: CODE_A,
    quantity: 13,
    assignmentDate: OUTSIDE_HORIZON_ASSIGNMENT,
  });

  // La asignación ocurrió en un mes anterior y la AUTO continúa
  // vigente: Macro 3A debe incluirla igualmente en la demanda de compra.
  authBId = await insertAuthorization({
    label: 'B1',
    commercialCode: CODE_B,
    quantity: 4,
    assignmentDate: '2000-01-01',
  });

  blockedId = await insertAuthorization({
    label: 'BLOCKED',
    commercialCode: CODE_BLOCKED,
    quantity: 7,
    enablementStatus: 'BLOCKED_SOURCE_STATUS',
  });

  // coverage_type es un snapshot materializado. Si quedó stale en NO_PBS
  // pero el AT activo dice PBS, el AT vigente es la autoridad y la AUTO
  // debe participar en demanda.
  staleCoverageId = await insertAuthorization({
    label: 'STALE-COVERAGE',
    commercialCode: CODE_STALE_COVERAGE,
    quantity: 8,
    coverageType: 'NO_PBS',
  });

  // Caso inverso: aunque el snapshot diga PBS, un AT activo NO_PBS debe
  // excluir la autorización de la demanda de compra.
  noPbsId = await insertAuthorization({
    label: 'AT-NO-PBS',
    commercialCode: CODE_NO_PBS,
    quantity: 11,
    coverageType: 'PBS',
  });

  expiredId = await insertAuthorization({
    label: 'EXPIRED',
    commercialCode: CODE_EXPIRED,
    quantity: 9,
    expirationDate: '2000-01-01',
  });

  noTariffId = await insertAuthorization({
    label: 'NO-TARIFF',
    commercialCode: CODE_NO_TARIFF,
    quantity: 10,
  });

  const point = await database.query<{ id: string }>(
    `insert into dispensing_points
      (organization_id, code, name, created_by)
     values
      ($1, $2, 'Macro 3A ignored schedule point', $3)
     returning id`,
    [ORGANIZATION_IDS.MTD, `M3A-POINT-${suffix}`, foundationUserId],
  );

  pointId = point.rows[0]!.id;

  const schedule = await database.query<{ id: string }>(
    `insert into patient_schedules
      (
        authorization_item_id,
        planning_period_id,
        dispensing_point_id,
        commercial_code,
        scheduled_date,
        quantity,
        status,
        schedule_timing,
        late_handling,
        revision,
        created_by,
        updated_by
      )
     values
      (
        $1,
        $2,
        $3,
        $4,
        $5::date,
        99,
        'SCHEDULED',
        'ON_TIME',
        null,
        1,
        $6,
        $6
      )
     returning id`,
    [authA1Id, periodId, pointId, CODE_A, periodStart, foundationUserId],
  );

  ignoredScheduleId = schedule.rows[0]!.id;
});

afterAll(async () => {
  try {
    if (periodId) {
      await database.query(
        `delete from demand_sources
         where projected_demand_line_id in (
           select id
           from projected_demand_lines
           where planning_period_id = $1
         )`,
        [periodId],
      );

      await database.query(
        `delete from projected_demand_lines
         where planning_period_id = $1`,
        [periodId],
      );
    }

    if (ignoredScheduleId) {
      await database.query(`delete from patient_schedules where id = $1`, [ignoredScheduleId]);
    }

    const authorizationIds = [
      authA1Id,
      authA2Id,
      authBId,
      futureId,
      blockedId,
      staleCoverageId,
      noPbsId,
      expiredId,
      noTariffId,
    ].filter(Boolean);

    if (authorizationIds.length > 0) {
      await database.query(
        `delete from authorization_item_organizations
         where authorization_item_id = any($1::uuid[])`,
        [authorizationIds],
      );

      await database.query(
        `delete from authorization_items
         where id = any($1::uuid[])`,
        [authorizationIds],
      );
    }

    if (pointId) {
      await database.query(`delete from dispensing_points where id = $1`, [pointId]);
    }

    if (batchId) {
      await database.query(`delete from import_batches where id = $1`, [batchId]);
    }

    await database.query(
      `delete from tariff_annex_products
       where codigo_producto = any($1::text[])`,
      [TARIFF_CODES],
    );

    if (periodId) {
      await database.query(`delete from planning_periods where id = $1`, [periodId]);
    }
  } finally {
    await database.end();
  }
});

describe('Macro 3A — authorization-driven purchase demand', () => {
  it('builds purchase demand only from current eligible authorizations', async () => {
    const response = await consolidate();

    expect(response.status).toBe(200);

    const summary = (await response.json()) as {
      lineCount: number;
      sourceCount: number;
      regularQuantity: number;
      lateQuantity: number;
      projectedQuantity: number;
    };

    expect(summary).toMatchObject({
      lineCount: 3,
      sourceCount: 4,
      regularQuantity: 17,
      lateQuantity: 0,
      projectedQuantity: 17,
    });

    const lines = await database.query<{
      id: string;
      commercial_code: string;
      dispensing_point_id: string | null;
      regular_quantity: number;
      late_quantity: number;
      projected_quantity: number;
    }>(
      `select
         id,
         commercial_code,
         dispensing_point_id,
         regular_quantity,
         late_quantity,
         projected_quantity
       from projected_demand_lines
       where planning_period_id = $1
       order by commercial_code`,
      [periodId],
    );

    expect(lines.rows).toHaveLength(3);

    expect(lines.rows).toEqual([
      expect.objectContaining({
        commercial_code: CODE_A,
        dispensing_point_id: null,
        regular_quantity: 5,
        late_quantity: 0,
        projected_quantity: 5,
      }),
      expect.objectContaining({
        commercial_code: CODE_B,
        dispensing_point_id: null,
        regular_quantity: 4,
        late_quantity: 0,
        projected_quantity: 4,
      }),
      expect.objectContaining({
        commercial_code: CODE_STALE_COVERAGE,
        dispensing_point_id: null,
        regular_quantity: 8,
        late_quantity: 0,
        projected_quantity: 8,
      }),
    ]);

    const sources = await database.query<{
      authorization_item_id: string | null;
      patient_schedule_id: string | null;
      quantity: number;
      commercial_code: string;
    }>(
      `select
         ds.authorization_item_id,
         ds.patient_schedule_id,
         ds.quantity,
         ds.commercial_code
       from demand_sources ds
       join projected_demand_lines pdl
         on pdl.id = ds.projected_demand_line_id
       where pdl.planning_period_id = $1
       order by ds.commercial_code, ds.authorization_item_id`,
      [periodId],
    );

    expect(sources.rows).toHaveLength(4);

    expect(sources.rows.every((source) => source.patient_schedule_id === null)).toBe(true);

    expect(sources.rows.map((source) => source.authorization_item_id).sort()).toEqual(
      [authA1Id, authA2Id, authBId, staleCoverageId].sort(),
    );

    expect(
      sources.rows
        .filter((source) => source.commercial_code === CODE_A)
        .reduce((sum, source) => sum + source.quantity, 0),
    ).toBe(5);

    // AT activo PBS prevalece sobre un coverage_type materializado stale.
    expect(
      sources.rows.some(
        (source) => source.authorization_item_id === staleCoverageId && source.quantity === 8,
      ),
    ).toBe(true);

    // AT activo NO_PBS prevalece incluso si coverage_type materializado dice PBS.
    const excluded = new Set([futureId, blockedId, noPbsId, expiredId, noTariffId]);

    expect(
      sources.rows.some(
        (source) =>
          source.authorization_item_id !== null && excluded.has(source.authorization_item_id),
      ),
    ).toBe(false);

    const scheduleSources = await database.query<{ count: number }>(
      `select count(*)::int as count
       from demand_sources
       where patient_schedule_id = $1`,
      [ignoredScheduleId],
    );

    expect(scheduleSources.rows[0]?.count).toBe(0);
  });

  it('keeps an AUTO outside HOY+30 persisted but outside purchase demand', async () => {
    const authorization = await database.query<{
      enablement_status: string;
      assignment_date: string;
    }>(
      `select
         enablement_status,
         source_data->>'FECHA_ASIGNACION' as assignment_date
       from authorization_items
       where id = $1`,
      [futureId],
    );

    expect(authorization.rows).toEqual([
      {
        enablement_status: 'ENABLED',
        assignment_date: OUTSIDE_HORIZON_ASSIGNMENT,
      },
    ]);

    const source = await database.query<{ count: number }>(
      `select count(*)::int as count
       from demand_sources
       where authorization_item_id = $1`,
      [futureId],
    );

    expect(source.rows[0]?.count).toBe(0);
  });

  it('is idempotent when eligible authorizations have not changed', async () => {
    const beforeLines = await database.query<{
      id: string;
      commercial_code: string;
      revision: number;
      regular_quantity: number;
      projected_quantity: number;
      updated_at: string;
    }>(
      `select
         id,
         commercial_code,
         revision,
         regular_quantity,
         projected_quantity,
         to_char(
           updated_at at time zone 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
         ) as updated_at
       from projected_demand_lines
       where planning_period_id = $1
       order by commercial_code`,
      [periodId],
    );

    const beforeSources = await database.query<{
      authorization_item_id: string | null;
      quantity: number;
    }>(
      `select
         ds.authorization_item_id,
         ds.quantity
       from demand_sources ds
       join projected_demand_lines pdl
         on pdl.id = ds.projected_demand_line_id
       where pdl.planning_period_id = $1
       order by ds.authorization_item_id`,
      [periodId],
    );

    const response = await consolidate();

    expect(response.status).toBe(200);

    const afterLines = await database.query<{
      id: string;
      commercial_code: string;
      revision: number;
      regular_quantity: number;
      projected_quantity: number;
      updated_at: string;
    }>(
      `select
         id,
         commercial_code,
         revision,
         regular_quantity,
         projected_quantity,
         to_char(
           updated_at at time zone 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
         ) as updated_at
       from projected_demand_lines
       where planning_period_id = $1
       order by commercial_code`,
      [periodId],
    );

    const afterSources = await database.query<{
      authorization_item_id: string | null;
      quantity: number;
    }>(
      `select
         ds.authorization_item_id,
         ds.quantity
       from demand_sources ds
       join projected_demand_lines pdl
         on pdl.id = ds.projected_demand_line_id
       where pdl.planning_period_id = $1
       order by ds.authorization_item_id`,
      [periodId],
    );

    expect(afterLines.rows).toEqual(beforeLines.rows);
    expect(afterSources.rows).toEqual(beforeSources.rows);
  });

  it('reconciles demand when an AUTO moves outside HOY+30 and restores it when eligible again', async () => {
    await database.query(
      `update authorization_items
       set source_data = jsonb_set(
             source_data,
             '{FECHA_ASIGNACION}',
             to_jsonb($2::text),
             true
           ),
           version = version + 1,
           updated_at = now()
       where id = $1`,
      [authA2Id, OUTSIDE_HORIZON_ASSIGNMENT],
    );

    const futureResponse = await consolidate();

    expect(futureResponse.status).toBe(200);

    const futureLine = await database.query<{
      regular_quantity: number;
      projected_quantity: number;
    }>(
      `select regular_quantity, projected_quantity
       from projected_demand_lines
       where planning_period_id = $1
         and commercial_code = $2`,
      [periodId, CODE_A],
    );

    expect(futureLine.rows).toEqual([
      {
        regular_quantity: 2,
        projected_quantity: 2,
      },
    ]);

    const futureSource = await database.query<{ count: number }>(
      `select count(*)::int as count
       from demand_sources
       where authorization_item_id = $1`,
      [authA2Id],
    );

    expect(futureSource.rows[0]?.count).toBe(0);

    await database.query(
      `update authorization_items
       set source_data = jsonb_set(
             source_data,
             '{FECHA_ASIGNACION}',
             to_jsonb($2::text),
             true
           ),
           version = version + 1,
           updated_at = now()
       where id = $1`,
      [authA2Id, CURRENT_MONTH_ASSIGNMENT],
    );

    const restoredResponse = await consolidate();

    expect(restoredResponse.status).toBe(200);

    const restoredLine = await database.query<{
      regular_quantity: number;
      projected_quantity: number;
    }>(
      `select regular_quantity, projected_quantity
       from projected_demand_lines
       where planning_period_id = $1
         and commercial_code = $2`,
      [periodId, CODE_A],
    );

    expect(restoredLine.rows).toEqual([
      {
        regular_quantity: 5,
        projected_quantity: 5,
      },
    ]);

    const restoredSource = await database.query<{ count: number }>(
      `select count(*)::int as count
       from demand_sources
       where authorization_item_id = $1`,
      [authA2Id],
    );

    expect(restoredSource.rows[0]?.count).toBe(1);
  });
});
