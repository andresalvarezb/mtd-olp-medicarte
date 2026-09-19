import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ORGANIZATION_IDS,
  adminLogin,
  deletePointScopesForPointCodeLike,
  ensureOperatorTokens,
  ensureUser,
  grantAllPointsToMedicarteOperator,
} from './helpers/auth';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization_test_integration';

const apiUrl = process.env.API_URL ?? 'http://localhost:3004';

const database = new Client({ connectionString: databaseUrl });

const suffix = randomUUID().slice(0, 8).toUpperCase();

const CODE_A = `ESP4-A-${suffix}`;
const CODE_B = `ESP4-B-${suffix}`;
const CODE_D = `ESP4-D-${suffix}`;
const CODE_BLOCKED = `ESP4-BLOCK-${suffix}`;
const CODE_NO_PBS = `ESP4-NOPBS-${suffix}`;
const CODE_EXPIRED = `ESP4-EXP-${suffix}`;
const CODE_NO_TARIFF = `ESP4-NOTARIFF-${suffix}`;

const POINT_CODE = `ESP4-PT-${suffix}`;

const READ_ONLY_USERNAME = `esp004-readonly-${suffix}`;
const MTD_GENERAL_USERNAME = `esp004-general-${suffix}`;

const PERIOD_WINDOW = {
  from: '2036-01-01',
  to: '2036-12-31',
};

const TARIFF_PRODUCTS = [
  { code: CODE_A, tipoInclusion: 'PBS' },
  { code: CODE_B, tipoInclusion: 'PBS' },
  { code: CODE_D, tipoInclusion: 'PBS' },
  { code: CODE_BLOCKED, tipoInclusion: 'PBS' },
  { code: CODE_NO_PBS, tipoInclusion: 'NO_PBS' },
  { code: CODE_EXPIRED, tipoInclusion: 'PBS' },
] as const;

let adminToken = '';
let medicarteToken = '';
let olpToken = '';
let readOnlyToken = '';
let mtdGeneralToken = '';

let foundationUserId = '';

let periodPrimaryId = '';
let periodOtherId = '';
let pointId = '';

let itemA1Id = '';
let itemA2Id = '';
let itemBId = '';
let blockedId = '';
let noPbsId = '';
let expiredId = '';
let noTariffId = '';

const provenanceBatchIds: string[] = [];
const authorizationIds: string[] = [];
const scheduleIds: string[] = [];

function expirationInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function apiCall(
  method: string,
  path: string,
  body: unknown = undefined,
  token: string = adminToken,
  organizationId: string | undefined = ORGANIZATION_IDS.MTD,
): Promise<Response> {
  return fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(organizationId ? { 'x-organization-id': organizationId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function consolidatePeriod(periodId: string, token: string = adminToken): Promise<Response> {
  return apiCall('POST', `/planning-periods/${periodId}/consolidate`, {}, token);
}

async function insertAuthorizationItem(input: {
  label: string;
  commercialCode: string;
  quantity: number;
  enablementStatus?: 'ENABLED' | 'BLOCKED_SOURCE_STATUS';
  coverageType?: 'PBS' | 'NO_PBS';
  expirationDate?: string;
}): Promise<string> {
  const authorizationNumber = `ESP004-${input.label}-${suffix}`;

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
        1,
        1,
        now(),
        now()
      )
     returning id`,
    [
      ORGANIZATION_IDS.MTD,
      foundationUserId,
      `esp004-${input.label}-${suffix}.xlsx`,
      randomUUID().replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
    ],
  );

  const batchId = batch.rows[0]!.id;
  provenanceBatchIds.push(batchId);

  const item = await database.query<{ id: string }>(
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
        'ESP004-M3A',
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

        // Intencionalmente fuera del período 2036:
        // la compra no depende de FECHA_ASIGNACION.
        FECHA_ASIGNACION: '2000-01-01',

        FECHA_FINAL_VIGENCIA: input.expirationDate ?? expirationInDays(30),

        IDENTIFICACION_PACIENTE: `DOC-${input.label}-${suffix}`,

        NOMBRE_PACIENTE: `Paciente ${input.label}`,
      }),
      input.enablementStatus === 'BLOCKED_SOURCE_STATUS' ? 'CANCELADA' : 'VIGENTE',
      input.enablementStatus ?? 'ENABLED',
      input.coverageType ?? 'PBS',
      batchId,
    ],
  );

  const itemId = item.rows[0]!.id;

  authorizationIds.push(itemId);

  await database.query(
    `insert into authorization_item_organizations
      (
        authorization_item_id,
        organization_id
      )
     values ($1, $2)
     on conflict do nothing`,
    [itemId, ORGANIZATION_IDS.MEDICARTE],
  );

  return itemId;
}

async function updateAuthorizationQuantity(
  authorizationItemId: string,
  quantity: string,
): Promise<void> {
  await database.query(
    `update authorization_items
        set source_data =
              jsonb_set(
                source_data,
                '{CANTIDAD}',
                to_jsonb($2::text),
                true
              )
      where id = $1`,
    [authorizationItemId, quantity],
  );
}

async function createIgnoredSchedule(input: {
  authorizationItemId: string;
  commercialCode: string;
  quantity: number;
}): Promise<{
  id: string;
  revision: number;
}> {
  const response = await apiCall(
    'POST',
    '/patient-schedules',
    {
      authorizationItemId: input.authorizationItemId,
      commercialCode: input.commercialCode,
      dispensingPointId: pointId,
      scheduledDate: '2036-01-06',
      quantity: input.quantity,
    },
    medicarteToken,
    ORGANIZATION_IDS.MEDICARTE,
  );

  expect(response.status).toBe(201);

  const schedule = (await response.json()) as {
    id: string;
    revision: number;
  };

  scheduleIds.push(schedule.id);

  return schedule;
}

async function getLiveLineByCode(
  periodId: string,
  commercialCode: string,
): Promise<
  | {
      id: string;
      commercialCode: string;
      dispensingPointId: string | null;
      regularQuantity: number;
      lateQuantity: number;
      projectedQuantity: number;
      sourceCount: number;
      revision: number;
    }
  | undefined
> {
  const response = await apiCall(
    'GET',
    `/projected-demand?planningPeriodId=${periodId}` + `&commercialCode=${commercialCode}`,
  );

  expect(response.status).toBe(200);

  const body = (await response.json()) as {
    items: Array<{
      id: string;
      commercialCode: string;
      dispensingPointId: string | null;
      regularQuantity: number;
      lateQuantity: number;
      projectedQuantity: number;
      sourceCount: number;
      revision: number;
    }>;
  };

  return body.items[0];
}

async function cleanupTestData(): Promise<void> {
  await database.query(
    `delete from demand_sources
      where projected_demand_line_id in (
        select pdl.id
          from projected_demand_lines pdl
          join planning_periods pp
            on pp.id = pdl.planning_period_id
         where pp.start_date between $1 and $2
      )
      or authorization_item_id in (
        select id
          from authorization_items
         where numero_autorizacion like 'ESP004-%'
      )
      or patient_schedule_id in (
        select ps.id
          from patient_schedules ps
          join authorization_items ai
            on ai.id = ps.authorization_item_id
         where ai.numero_autorizacion like 'ESP004-%'
      )`,
    [PERIOD_WINDOW.from, PERIOD_WINDOW.to],
  );

  await database.query(
    `delete from projected_demand_lines
      where planning_period_id in (
        select id
          from planning_periods
         where start_date between $1 and $2
      )`,
    [PERIOD_WINDOW.from, PERIOD_WINDOW.to],
  );

  await database.query(
    `alter table patient_schedule_history
       disable trigger patient_schedule_history_no_delete`,
  );

  await database.query(
    `delete from patient_schedule_history
      where patient_schedule_id in (
        select ps.id
          from patient_schedules ps
          join authorization_items ai
            on ai.id = ps.authorization_item_id
         where ai.numero_autorizacion like 'ESP004-%'
      )`,
  );

  await database.query(
    `delete from patient_schedules
      where authorization_item_id in (
        select id
          from authorization_items
         where numero_autorizacion like 'ESP004-%'
      )`,
  );

  await database.query(
    `alter table patient_schedule_history
       enable trigger patient_schedule_history_no_delete`,
  );

  await database.query(
    `delete from authorization_item_organizations
      where authorization_item_id in (
        select id
          from authorization_items
         where numero_autorizacion like 'ESP004-%'
      )`,
  );

  await database.query(
    `delete from authorization_items
      where numero_autorizacion like 'ESP004-%'`,
  );

  await database.query(
    `delete from import_batches
      where original_filename like 'esp004-%'`,
  );

  await database.query(
    `delete from tariff_annex_products
      where codigo_producto like 'ESP4-%'`,
  );

  await deletePointScopesForPointCodeLike(database, 'ESP4-%');

  await database.query(
    `delete from dispensing_points
      where code like 'ESP4-%'`,
  );

  await database.query(
    `delete from planning_periods
      where start_date between $1 and $2`,
    [PERIOD_WINDOW.from, PERIOD_WINDOW.to],
  );
}

beforeAll(async () => {
  await database.connect();

  await cleanupTestData();

  const admin = await database.query<{
    id: string;
  }>(
    `select id
       from users
      where username = 'foundation-admin'`,
  );

  foundationUserId = admin.rows[0]?.id ?? '';

  if (!foundationUserId) {
    throw new Error('FOUNDATION_ADMIN_NOT_FOUND');
  }

  adminToken = await adminLogin();

  ({ medicarteToken, olpToken } = await ensureOperatorTokens());

  readOnlyToken = await ensureUser({
    adminToken,
    username: READ_ONLY_USERNAME,
    displayName: 'ESP-004 Read Only',
    password: 'esp004-readonly-pw',
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'READ_ONLY',
  });

  mtdGeneralToken = await ensureUser({
    adminToken,
    username: MTD_GENERAL_USERNAME,
    displayName: 'ESP-004 MTD General',
    password: 'esp004-general-pw',
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_GENERAL',
  });

  const primary = await database.query<{ id: string }>(
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
          '2036-01-04',
          '2036-01-10',
          '2036-01-05T23:59:00-05:00',
          '2036-01-06T23:59:00-05:00',
          '2036-01-11',
          $1,
          $1
        )
       returning id`,
    [foundationUserId],
  );

  periodPrimaryId = primary.rows[0]!.id;

  const other = await database.query<{ id: string }>(
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
          '2036-02-01',
          '2036-02-07',
          '2036-02-02T23:59:00-05:00',
          '2036-02-03T23:59:00-05:00',
          '2036-02-08',
          $1,
          $1
        )
       returning id`,
    [foundationUserId],
  );

  periodOtherId = other.rows[0]!.id;

  const point = await database.query<{ id: string }>(
    `insert into dispensing_points
        (
          organization_id,
          code,
          name,
          created_by
        )
       values
        (
          $1,
          $2,
          'ESP-004 historical point',
          $3
        )
       returning id`,
    [ORGANIZATION_IDS.MTD, POINT_CODE, foundationUserId],
  );

  pointId = point.rows[0]!.id;

  await grantAllPointsToMedicarteOperator(database);

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
          'Producto ESP004',
          'Producto ESP004',
          $2,
          true,
          $3,
          $4,
          $4
        )`,
      [product.code, product.tipoInclusion, ORGANIZATION_IDS.MTD, foundationUserId],
    );
  }

  itemA1Id = await insertAuthorizationItem({
    label: 'A1',
    commercialCode: CODE_A,
    quantity: 3,
  });

  itemA2Id = await insertAuthorizationItem({
    label: 'A2',
    commercialCode: CODE_A,
    quantity: 2,
  });

  itemBId = await insertAuthorizationItem({
    label: 'B1',
    commercialCode: CODE_B,
    quantity: 4,
  });

  blockedId = await insertAuthorizationItem({
    label: 'BLOCKED',
    commercialCode: CODE_BLOCKED,
    quantity: 7,
    enablementStatus: 'BLOCKED_SOURCE_STATUS',
  });

  // Snapshot dice PBS, pero el AT activo dice NO_PBS:
  // el AT es la autoridad y debe excluirla.
  noPbsId = await insertAuthorizationItem({
    label: 'NO-PBS',
    commercialCode: CODE_NO_PBS,
    quantity: 8,
    coverageType: 'PBS',
  });

  expiredId = await insertAuthorizationItem({
    label: 'EXPIRED',
    commercialCode: CODE_EXPIRED,
    quantity: 9,
    expirationDate: '2000-01-01',
  });

  noTariffId = await insertAuthorizationItem({
    label: 'NO-TARIFF',
    commercialCode: CODE_NO_TARIFF,
    quantity: 10,
  });
});

afterAll(async () => {
  try {
    await cleanupTestData();

    await database.query(
      `delete from user_organization_roles
        where user_id in (
          select id
            from users
           where username = any($1::text[])
        )`,
      [[MTD_GENERAL_USERNAME, READ_ONLY_USERNAME]],
    );

    await database.query(
      `delete from users
        where username = any($1::text[])`,
      [[MTD_GENERAL_USERNAME, READ_ONLY_USERNAME]],
    );
  } finally {
    await database.end();
  }
});

describe('Gate ESP-004 — demanda de compra basada en autorizaciones', () => {
  it('1. consolida por período + código comercial, sin punto ni fecha MEDICARTE', async () => {
    const response = await consolidatePeriod(periodPrimaryId);

    expect(response.status).toBe(200);

    const summary = (await response.json()) as {
      lineCount: number;
      sourceCount: number;
      regularQuantity: number;
      lateQuantity: number;
      projectedQuantity: number;
    };

    expect(summary).toMatchObject({
      lineCount: 2,
      sourceCount: 3,
      regularQuantity: 9,
      lateQuantity: 0,
      projectedQuantity: 9,
    });

    const lines = await database.query<{
      commercial_code: string;
      dispensing_point_id: string | null;
      projected_quantity: number;
    }>(
      `select
               commercial_code,
               dispensing_point_id,
               projected_quantity
             from projected_demand_lines
            where planning_period_id = $1
              and dispensing_point_id is null
            order by commercial_code`,
      [periodPrimaryId],
    );

    expect(lines.rows).toHaveLength(2);

    expect(lines.rows).toEqual([
      {
        commercial_code: CODE_A,
        dispensing_point_id: null,
        projected_quantity: 5,
      },
      {
        commercial_code: CODE_B,
        dispensing_point_id: null,
        projected_quantity: 4,
      },
    ]);
  });

  it('2. API y lineage usan authorization_item directamente', async () => {
    const response = await apiCall('GET', `/projected-demand?planningPeriodId=${periodPrimaryId}`);

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      items: Array<{
        id: string;
        commercialCode: string;
        dispensingPointId: string | null;
        projectedQuantity: number;
        sourceCount: number;
      }>;
    };

    expect(body.items).toHaveLength(2);

    expect(body.items.every((line) => line.dispensingPointId === null)).toBe(true);

    expect(body.items.find((line) => line.commercialCode === CODE_A)).toMatchObject({
      projectedQuantity: 5,
      sourceCount: 2,
    });

    expect(body.items.find((line) => line.commercialCode === CODE_B)).toMatchObject({
      projectedQuantity: 4,
      sourceCount: 1,
    });

    const lineage = await database.query<{
      authorization_item_id: string;
      patient_schedule_id: string | null;
    }>(
      `select
               ds.authorization_item_id,
               ds.patient_schedule_id
              from demand_sources ds
              join projected_demand_lines pdl
                on pdl.id =
                   ds.projected_demand_line_id
             where pdl.planning_period_id = $1
               and pdl.dispensing_point_id is null
             order by ds.authorization_item_id`,
      [periodPrimaryId],
    );

    expect(lineage.rows).toHaveLength(3);

    expect(lineage.rows.every((row) => row.patient_schedule_id === null)).toBe(true);

    expect(lineage.rows.map((row) => row.authorization_item_id).sort()).toEqual(
      [itemA1Id, itemA2Id, itemBId].sort(),
    );
  });

  it('3. excluye autorización bloqueada, vencida, sin AT o AT NO_PBS', async () => {
    const excludedIds = [blockedId, noPbsId, expiredId, noTariffId];

    const sources = await database.query<{
      count: number;
    }>(
      `select count(*)::int as count
               from demand_sources
              where authorization_item_id =
                    any($1::uuid[])`,
      [excludedIds],
    );

    expect(sources.rows[0]?.count).toBe(0);

    const excludedCodes = await database.query<{
      count: number;
    }>(
      `select count(*)::int as count
               from projected_demand_lines
              where planning_period_id = $1
                and dispensing_point_id is null
                and commercial_code =
                    any($2::text[])`,
      [periodPrimaryId, [CODE_BLOCKED, CODE_NO_PBS, CODE_EXPIRED, CODE_NO_TARIFF]],
    );

    expect(excludedCodes.rows[0]?.count).toBe(0);
  });

  it('4. idempotencia: repetir consolidación no cambia estado lógico ni revisión', async () => {
    const before = await database.query<{
      id: string;
      commercial_code: string;
      revision: number;
      projected_quantity: number;
      updated_at: string;
    }>(
      `select
               id,
               commercial_code,
               revision,
               projected_quantity,
               to_char(
                 updated_at at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
               ) as updated_at
              from projected_demand_lines
             where planning_period_id = $1
               and dispensing_point_id is null
             order by commercial_code`,
      [periodPrimaryId],
    );

    const sourcesBefore = await database.query<{
      count: number;
    }>(
      `select count(*)::int as count
               from demand_sources ds
               join projected_demand_lines pdl
                 on pdl.id =
                    ds.projected_demand_line_id
              where pdl.planning_period_id = $1
                and pdl.dispensing_point_id is null`,
      [periodPrimaryId],
    );

    const response = await consolidatePeriod(periodPrimaryId);

    expect(response.status).toBe(200);

    const after = await database.query<{
      id: string;
      commercial_code: string;
      revision: number;
      projected_quantity: number;
      updated_at: string;
    }>(
      `select
               id,
               commercial_code,
               revision,
               projected_quantity,
               to_char(
                 updated_at at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
               ) as updated_at
              from projected_demand_lines
             where planning_period_id = $1
               and dispensing_point_id is null
             order by commercial_code`,
      [periodPrimaryId],
    );

    const sourcesAfter = await database.query<{
      count: number;
    }>(
      `select count(*)::int as count
               from demand_sources ds
               join projected_demand_lines pdl
                 on pdl.id =
                    ds.projected_demand_line_id
              where pdl.planning_period_id = $1
                and pdl.dispensing_point_id is null`,
      [periodPrimaryId],
    );

    expect(after.rows).toEqual(before.rows);

    expect(sourcesAfter.rows[0]?.count).toBe(sourcesBefore.rows[0]?.count);
  });

  it('5. patient_schedule no altera compra y una línea histórica con punto se preserva', async () => {
    const schedule = await createIgnoredSchedule({
      authorizationItemId: itemA1Id,
      commercialCode: CODE_A,
      quantity: 99,
    });

    const legacyLine = await database.query<{
      id: string;
    }>(
      `insert into projected_demand_lines
              (
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
             values
              (
                $1,
                $2,
                $3,
                99,
                99,
                0,
                'OPEN',
                1,
                now(),
                $4,
                $4
              )
             returning id`,
      [periodPrimaryId, pointId, CODE_A, foundationUserId],
    );

    const legacyLineId = legacyLine.rows[0]!.id;

    await database.query(
      `insert into demand_sources
            (
              projected_demand_line_id,
              patient_schedule_id,
              schedule_revision,
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
              $3,
              99,
              $4,
              $5,
              $6,
              'ON_TIME',
              null,
              'REGULAR'
            )`,
      [legacyLineId, schedule.id, schedule.revision, periodPrimaryId, pointId, CODE_A],
    );

    const response = await consolidatePeriod(periodPrimaryId);

    expect(response.status).toBe(200);

    const summary = (await response.json()) as {
      lineCount: number;
      sourceCount: number;
      projectedQuantity: number;
    };

    // Solo cuenta la proyección viva authorization-based.
    expect(summary).toMatchObject({
      lineCount: 2,
      sourceCount: 3,
      projectedQuantity: 9,
    });

    const liveA = await getLiveLineByCode(periodPrimaryId, CODE_A);

    expect(liveA).toMatchObject({
      dispensingPointId: null,
      projectedQuantity: 5,
      sourceCount: 2,
    });

    const historical = await database.query<{
      projected_quantity: number;
      dispensing_point_id: string;
    }>(
      `select
               projected_quantity,
               dispensing_point_id
              from projected_demand_lines
             where id = $1`,
      [legacyLineId],
    );

    expect(historical.rows[0]).toMatchObject({
      projected_quantity: 99,
      dispensing_point_id: pointId,
    });

    const historicalSource = await database.query<{
      patient_schedule_id: string;
      quantity: number;
    }>(
      `select
               patient_schedule_id,
               quantity
              from demand_sources
             where projected_demand_line_id = $1`,
      [legacyLineId],
    );

    expect(historicalSource.rows[0]).toMatchObject({
      patient_schedule_id: schedule.id,
      quantity: 99,
    });

    const defaultList = await apiCall(
      'GET',
      `/projected-demand?planningPeriodId=${periodPrimaryId}`,
    );

    const defaultItems = (await defaultList.json()) as {
      items: Array<{
        dispensingPointId: string | null;
      }>;
    };

    expect(defaultItems.items).toHaveLength(2);

    expect(defaultItems.items.every((item) => item.dispensingPointId === null)).toBe(true);

    const historicalList = await apiCall(
      'GET',
      `/projected-demand?planningPeriodId=${periodPrimaryId}` +
        `&dispensingPointId=${pointId}` +
        `&commercialCode=${CODE_A}`,
    );

    const historicalItems = (await historicalList.json()) as {
      items: Array<{
        projectedQuantity: number;
        dispensingPointId: string | null;
      }>;
    };

    expect(historicalItems.items).toEqual([
      expect.objectContaining({
        projectedQuantity: 99,
        dispensingPointId: pointId,
      }),
    ]);
  });

  it('6. versionado semántico: composición o cantidad cambian revisión; repetición no', async () => {
    const d1 = await insertAuthorizationItem({
      label: 'D1',
      commercialCode: CODE_D,
      quantity: 1,
    });

    const d2 = await insertAuthorizationItem({
      label: 'D2',
      commercialCode: CODE_D,
      quantity: 1,
    });

    let response = await consolidatePeriod(periodPrimaryId);

    expect(response.status).toBe(200);

    let line = await getLiveLineByCode(periodPrimaryId, CODE_D);

    expect(line).toMatchObject({
      projectedQuantity: 2,
      regularQuantity: 2,
      lateQuantity: 0,
      sourceCount: 2,
      revision: 1,
    });

    // Mismo total (2), pero cambia la composición:
    // D1 1→2 y D2 deja de ser cantidad válida.
    await updateAuthorizationQuantity(d1, '2');

    await updateAuthorizationQuantity(d2, 'INVALID');

    response = await consolidatePeriod(periodPrimaryId);

    expect(response.status).toBe(200);

    line = await getLiveLineByCode(periodPrimaryId, CODE_D);

    expect(line).toMatchObject({
      projectedQuantity: 2,
      sourceCount: 1,
      revision: 2,
    });

    // Idempotencia de la composición actual.
    response = await consolidatePeriod(periodPrimaryId);

    expect(response.status).toBe(200);

    line = await getLiveLineByCode(periodPrimaryId, CODE_D);

    expect(line?.revision).toBe(2);

    // Cambio real de cantidad.
    await updateAuthorizationQuantity(d1, '5');

    response = await consolidatePeriod(periodPrimaryId);

    expect(response.status).toBe(200);

    line = await getLiveLineByCode(periodPrimaryId, CODE_D);

    expect(line).toMatchObject({
      projectedQuantity: 5,
      sourceCount: 1,
      revision: 3,
    });
  });

  it('7. FK impide que una fuente declare período/código distinto de su línea', async () => {
    const line = await database.query<{
      id: string;
      commercial_code: string;
    }>(
      `select
               id,
               commercial_code
              from projected_demand_lines
             where planning_period_id = $1
               and dispensing_point_id is null
               and commercial_code = $2
             limit 1`,
      [periodPrimaryId, CODE_A],
    );

    expect(line.rows).toHaveLength(1);

    await expect(
      database.query(
        `insert into demand_sources
              (
                projected_demand_line_id,
                authorization_item_id,
                quantity,
                planning_period_id,
                commercial_code,
                schedule_timing,
                demand_bucket
              )
             values
              (
                $1,
                $2,
                1,
                $3,
                $4,
                'ON_TIME',
                'REGULAR'
              )`,
        [line.rows[0]!.id, noTariffId, periodOtherId, line.rows[0]!.commercial_code],
      ),
    ).rejects.toThrow(/demand_sources_line_identity_fk/);
  });

  it('8. concurrencia: dos consolidaciones simultáneas no duplican identidad viva', async () => {
    const [first, second] = await Promise.all([
      consolidatePeriod(periodPrimaryId),
      consolidatePeriod(periodPrimaryId),
    ]);

    expect(first.status).toBe(200);

    expect(second.status).toBe(200);

    const duplicates = await database.query<{
      count: number;
    }>(
      `select count(*)::int as count
               from (
                 select
                   planning_period_id,
                   commercial_code
                 from projected_demand_lines
                where planning_period_id = $1
                  and dispensing_point_id is null
                group by
                  planning_period_id,
                  commercial_code
               having count(*) > 1
               ) duplicated`,
      [periodPrimaryId],
    );

    expect(duplicates.rows[0]?.count).toBe(0);

    const liveLines = await database.query<{
      count: number;
    }>(
      `select count(*)::int as count
               from projected_demand_lines
              where planning_period_id = $1
                and dispensing_point_id is null`,
      [periodPrimaryId],
    );

    // A, B y D.
    expect(liveLines.rows[0]?.count).toBe(3);
  });

  it('9. RBAC conserva lectura MTD y restringe consolidación/no-MTD', async () => {
    const read = await apiCall(
      'GET',
      `/projected-demand?planningPeriodId=${periodPrimaryId}`,
      undefined,
      mtdGeneralToken,
    );

    expect(read.status).toBe(200);

    const manage = await apiCall(
      'POST',
      `/planning-periods/${periodPrimaryId}/consolidate`,
      {},
      mtdGeneralToken,
    );

    expect(manage.status).toBe(403);

    expect(
      (await manage.json()) as {
        code: string;
      },
    ).toMatchObject({
      code: 'PERMISSION_DENIED',
    });

    const readOnlyRead = await apiCall(
      'GET',
      `/projected-demand?planningPeriodId=${periodPrimaryId}`,
      undefined,
      readOnlyToken,
    );

    expect(readOnlyRead.status).toBe(200);

    const medicarteRead = await apiCall(
      'GET',
      `/projected-demand?planningPeriodId=${periodPrimaryId}`,
      undefined,
      medicarteToken,
      ORGANIZATION_IDS.MEDICARTE,
    );

    expect(medicarteRead.status).toBe(403);

    const olpRead = await apiCall(
      'GET',
      `/projected-demand?planningPeriodId=${periodPrimaryId}`,
      undefined,
      olpToken,
      ORGANIZATION_IDS.OLP,
    );

    expect(olpRead.status).toBe(403);

    const medicarteManage = await apiCall(
      'POST',
      `/planning-periods/${periodPrimaryId}/consolidate`,
      {},
      medicarteToken,
      ORGANIZATION_IDS.MEDICARTE,
    );

    expect(medicarteManage.status).toBe(403);
  });

  it('10. consolidación no altera AUTO, programación, OC ni inventario y genera auditoría', async () => {
    const authorizationBefore = await database.query<Record<string, unknown>>(
      `select
               enablement_status,
               operation_status,
               orden_compra,
               operational_version,
               source_data,
               to_char(
                 updated_at,
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
               ) as updated_at
              from authorization_items
             where id = $1`,
      [itemA1Id],
    );

    const schedulesBefore = await database.query<Record<string, unknown>>(
      `select
               id,
               authorization_item_id,
               quantity,
               status,
               revision,
               to_char(
                 updated_at,
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
               ) as updated_at
              from patient_schedules
             where id = any($1::uuid[])
             order by id`,
      [scheduleIds],
    );

    const logisticsBefore = await database.query<{
      purchase_orders: number;
      purchase_order_lines: number;
      inventory_lots: number;
      inventory_movements: number;
    }>(
      `select
               (
                 select count(*)::int
                   from purchase_orders
               ) as purchase_orders,
               (
                 select count(*)::int
                   from purchase_order_lines
               ) as purchase_order_lines,
               (
                 select count(*)::int
                   from inventory_lots
               ) as inventory_lots,
               (
                 select count(*)::int
                   from inventory_movements
               ) as inventory_movements`,
    );

    const response = await consolidatePeriod(periodPrimaryId);

    expect(response.status).toBe(200);

    const authorizationAfter = await database.query<Record<string, unknown>>(
      `select
               enablement_status,
               operation_status,
               orden_compra,
               operational_version,
               source_data,
               to_char(
                 updated_at,
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
               ) as updated_at
              from authorization_items
             where id = $1`,
      [itemA1Id],
    );

    const schedulesAfter = await database.query<Record<string, unknown>>(
      `select
               id,
               authorization_item_id,
               quantity,
               status,
               revision,
               to_char(
                 updated_at,
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
               ) as updated_at
              from patient_schedules
             where id = any($1::uuid[])
             order by id`,
      [scheduleIds],
    );

    const logisticsAfter = await database.query<{
      purchase_orders: number;
      purchase_order_lines: number;
      inventory_lots: number;
      inventory_movements: number;
    }>(
      `select
               (
                 select count(*)::int
                   from purchase_orders
               ) as purchase_orders,
               (
                 select count(*)::int
                   from purchase_order_lines
               ) as purchase_order_lines,
               (
                 select count(*)::int
                   from inventory_lots
               ) as inventory_lots,
               (
                 select count(*)::int
                   from inventory_movements
               ) as inventory_movements`,
    );

    expect(authorizationAfter.rows).toEqual(authorizationBefore.rows);

    expect(schedulesAfter.rows).toEqual(schedulesBefore.rows);

    expect(logisticsAfter.rows).toEqual(logisticsBefore.rows);

    const audits = await database.query<{
      count: number;
    }>(
      `select count(*)::int as count
               from audit_events
              where resource_type =
                    'planning_period'
                and resource_id = $1
                and action =
                    'PROJECTED_DEMAND_CONSOLIDATED'`,
      [periodPrimaryId],
    );

    expect(audits.rows[0]?.count ?? 0).toBeGreaterThan(0);
  });
});
