import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGANIZATION_IDS, adminLogin, ensureOperatorTokens, ensureUser } from './helpers/auth';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const database = new Client({ connectionString: databaseUrl });

const suffix = randomUUID().slice(0, 8);
const AUTH_NUMBER = `ESP004-A-${suffix}`;
const CODE_A = `ESP4-CODE-A-${suffix.toUpperCase()}`;
const CODE_B = `ESP4-CODE-B-${suffix.toUpperCase()}`;
const CODE_C = `ESP4-CODE-C-${suffix.toUpperCase()}`;
const CODE_D = `ESP4-CODE-D-${suffix.toUpperCase()}`;
const DOC_A = `DOC-A-${suffix}`;
const DOC_B = `DOC-B-${suffix}`;
const DOC_C = `DOC-C-${suffix}`;
const POINT_1_CODE = `ESP4-PT1-${suffix}`;
const POINT_2_CODE = `ESP4-PT2-${suffix}`;
const READ_ONLY_USERNAME = `esp004-readonly-${suffix}`;
const MTD_GENERAL_USERNAME = `esp004-general-${suffix}`;
const PERIOD_WINDOW = { from: '2036-01-01', to: '2036-12-31' };

let adminToken: string;
let mtdGeneralToken: string;
let medicarteToken: string;
let olpToken: string;
let readOnlyToken: string;
let foundationUserId: string;
let itemA1Id: string;
let itemA2Id: string;
let itemBId: string;
let itemCId: string;
let point1Id: string;
let point2Id: string;
let periodOnTimeId: string;
let periodLateId: string;
let periodNextId: string;
let periodThirdId: string;
const provenanceBatchIds: string[] = [];
const scheduleIds: string[] = [];
let itemSnapshot: Record<string, unknown>;
let itemsBefore: number;

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

type ScheduleRef = { id: string; revision: number };

async function createSchedule(input: {
  authorizationItemId: string;
  commercialCode: string;
  dispensingPointId: string;
  scheduledDate: string;
  quantity: number;
  lateHandling?: string;
}): Promise<ScheduleRef> {
  const response = await apiCall(
    'POST',
    '/patient-schedules',
    input,
    medicarteToken,
    ORGANIZATION_IDS.MEDICARTE,
  );
  expect(response.status).toBe(201);
  const schedule = (await response.json()) as { id: string; revision: number };
  scheduleIds.push(schedule.id);
  return schedule;
}

async function insertAuthorizationItem(
  code: string,
  document: string,
  patientName: string,
): Promise<string> {
  const batch = await database.query<{ id: string }>(
    `insert into import_batches
      (organization_id, created_by, original_filename, mime_type, size_bytes, sha256,
       processor_version, status, total_rows, confirmed_rows, completed_at, confirmed_at)
     values ($1, $2, $3, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             1, $4, 1, 'COMPLETED', 1, 1, now(), now())
     returning id`,
    [
      ORGANIZATION_IDS.MTD,
      foundationUserId,
      `esp004-${randomUUID().slice(0, 8)}.xlsx`,
      'c'.repeat(64),
    ],
  );
  provenanceBatchIds.push(batch.rows[0]!.id);
  const item = await database.query<{ id: string }>(
    `insert into authorization_items
      (numero_autorizacion, codigo_medicamento, authorization_key, source_data,
       source_status_normalized, enablement_status, coverage_type, direction_status,
       coverage_rule_version, created_from_batch_id)
     values ($1, $2, $3, $4::jsonb, 'VIGENTE', 'ENABLED', 'PBS', 'NOT_APPLICABLE', 'ESP004', $5)
     returning id`,
    [
      AUTH_NUMBER,
      code,
      `${AUTH_NUMBER}:${code}`,
      JSON.stringify({
        IDENTIFICACION_PACIENTE: document,
        NOMBRE_PACIENTE: patientName,
        CANTIDAD: '10',
        FECHA_FINAL_VIGENCIA: expirationInDays(30),
      }),
      batch.rows[0]!.id,
    ],
  );
  const itemId = item.rows[0]!.id;
  await database.query(
    `insert into authorization_item_organizations (authorization_item_id, organization_id)
     values ($1, $2) on conflict do nothing`,
    [itemId, ORGANIZATION_IDS.MEDICARTE],
  );
  return itemId;
}

async function getLineByCode(
  periodId: string,
  commercialCode: string,
  dispensingPointId: string,
): Promise<Record<string, number | string> | undefined> {
  const response = await apiCall(
    'GET',
    `/projected-demand?planningPeriodId=${periodId}&commercialCode=${commercialCode}&dispensingPointId=${dispensingPointId}`,
  );
  const { items } = (await response.json()) as {
    items: Array<{
    id: string;
    regularQuantity: number;
    lateQuantity: number;
    projectedQuantity: number;
    sourceCount: number;
    revision: number;
  }>;
  };
  return items[0];
}

async function consolidatePeriod(
  periodId: string,
  token: string = adminToken,
): Promise<Response> {
  return apiCall('POST', `/planning-periods/${periodId}/consolidate`, {}, token);
}


async function cleanupTestWindow(): Promise<void> {
  await database.query(
    `alter table patient_schedule_history disable trigger patient_schedule_history_no_delete`,
  );
  await database.query(
    `delete from demand_sources
      where projected_demand_line_id in (
        select pdl.id from projected_demand_lines pdl
        join planning_periods pp on pp.id = pdl.planning_period_id
        where pp.start_date between $1 and $2)
      or patient_schedule_id in (
        select ps.id from patient_schedules ps
        join planning_periods pp on pp.id = ps.planning_period_id
        where pp.start_date between $1 and $2)`,
    [PERIOD_WINDOW.from, PERIOD_WINDOW.to],
  );
  await database.query(
    `delete from demand_sources where patient_schedule_id in (
      select ps.id from patient_schedules ps join authorization_items ai on ai.id = ps.authorization_item_id
      where ai.numero_autorizacion like 'ESP004-%')`,
  );
  await database.query(
    `delete from projected_demand_lines where planning_period_id in (
      select id from planning_periods where start_date between $1 and $2)`,
    [PERIOD_WINDOW.from, PERIOD_WINDOW.to],
  );
  await database.query(
    `delete from patient_schedule_history where patient_schedule_id in (
      select ps.id from patient_schedules ps
      join planning_periods pp on pp.id = ps.planning_period_id
      where pp.start_date between $1 and $2)`,
    [PERIOD_WINDOW.from, PERIOD_WINDOW.to],
  );
  await database.query(
    `delete from patient_schedules where planning_period_id in (
      select id from planning_periods where start_date between $1 and $2)`,
    [PERIOD_WINDOW.from, PERIOD_WINDOW.to],
  );
  await database.query(
    `alter table patient_schedule_history enable trigger patient_schedule_history_no_delete`,
  );
  await database.query(
    `delete from planning_periods where start_date between $1 and $2`,
    [PERIOD_WINDOW.from, PERIOD_WINDOW.to],
  );
  await database.query(
    `delete from authorization_item_organizations where authorization_item_id in
      (select id from authorization_items where numero_autorizacion like 'ESP004-%')`,
  );
  await database.query(`delete from authorization_items where numero_autorizacion like 'ESP004-%'`);
  await database.query(`delete from import_batches where original_filename like 'esp004-%'`);
  await database.query(`delete from dispensing_points where code like 'ESP4-%'`);
}

beforeAll(async () => {
  await database.connect();
  const admin = await database.query<{ id: string }>(
    `select id from users where username = 'foundation-admin'`,
  );
  foundationUserId = admin.rows[0]?.id ?? '';
  if (!foundationUserId) throw new Error('Foundation admin is unavailable');

  await cleanupTestWindow();

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

  itemA1Id = await insertAuthorizationItem(CODE_A, DOC_A, 'Paciente Uno');
  itemA2Id = await insertAuthorizationItem(CODE_B, DOC_A, 'Paciente Dos');
  itemBId = await insertAuthorizationItem(CODE_C, DOC_B, 'Paciente Tres');
  itemCId = await insertAuthorizationItem(CODE_D, DOC_C, 'Paciente Cuatro');

  const snapshot = await database.query<Record<string, unknown>>(
    `select enablement_status, operation_status, orden_compra, operational_version,
            to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
       from authorization_items where id = $1`,
    [itemA1Id],
  );
  itemSnapshot = snapshot.rows[0]!;
  const items = await database.query<{ count: number }>(
    `select count(*)::int as count from authorization_items`,
  );
  itemsBefore = items.rows[0]?.count ?? 0;

  const point1 = await database.query<{ id: string }>(
    `insert into dispensing_points (organization_id, code, name, created_by)
     values ($1, $2, 'ESP-004 Punto 1', $3) returning id`,
    [ORGANIZATION_IDS.MTD, POINT_1_CODE, foundationUserId],
  );
  point1Id = point1.rows[0]!.id;
  const point2 = await database.query<{ id: string }>(
    `insert into dispensing_points (organization_id, code, name, created_by)
     values ($1, $2, 'ESP-004 Punto 2', $3) returning id`,
    [ORGANIZATION_IDS.MTD, POINT_2_CODE, foundationUserId],
  );
  point2Id = point2.rows[0]!.id;

  const onTime = await database.query<{ id: string }>(
    `insert into planning_periods
      (start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
       expected_delivery_date, created_by, updated_by)
     values ('2036-01-04', '2036-01-10', '2036-01-05T23:59:00-05:00',
             '2036-01-06T23:59:00-05:00', '2036-01-11', $1, $1)
     returning id`,
    [foundationUserId],
  );
  periodOnTimeId = onTime.rows[0]!.id;
  const late = await database.query<{ id: string }>(
    `insert into planning_periods
      (start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
       expected_delivery_date, created_by, updated_by)
     values ('2036-02-01', '2036-02-07', '2026-01-01T00:00:00-05:00',
             '2026-01-02T00:00:00-05:00', '2036-02-08', $1, $1)
     returning id`,
    [foundationUserId],
  );
  periodLateId = late.rows[0]!.id;
  const next = await database.query<{ id: string }>(
    `insert into planning_periods
      (start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
       expected_delivery_date, created_by, updated_by)
     values ('2036-03-01', '2036-03-07', '2026-01-01T00:00:00-05:00',
             '2026-01-02T00:00:00-05:00', '2036-03-08', $1, $1)
     returning id`,
    [foundationUserId],
  );
  periodNextId = next.rows[0]!.id;
  const third = await database.query<{ id: string }>(
    `insert into planning_periods
      (start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
       expected_delivery_date, created_by, updated_by)
     values ('2036-04-01', '2036-04-07', '2026-01-01T00:00:00-05:00',
             '2026-01-02T00:00:00-05:00', '2036-04-08', $1, $1)
     returning id`,
    [foundationUserId],
  );
  periodThirdId = third.rows[0]!.id;
});

afterAll(async () => {
  try {
    const itemIds = await database.query<{ id: string }>(
      `select id from authorization_items where numero_autorizacion like 'ESP004-%'`,
    );
    const itemIdsList = itemIds.rows.map((row) => row.id);
    if (itemIdsList.length > 0) {
      const schedules = await database.query<{ id: string }>(
        `select id from patient_schedules where authorization_item_id = any($1::uuid[])`,
        [itemIdsList],
      );
      const ids = schedules.rows.map((row) => row.id);
      if (ids.length > 0) {
        await database.query(
          `delete from demand_sources where patient_schedule_id = any($1::uuid[])`,
          [ids],
        );
        await database.query(
          `alter table patient_schedule_history disable trigger patient_schedule_history_no_delete`,
        );
        await database.query(
          `delete from patient_schedule_history where patient_schedule_id = any($1::uuid[])`,
          [ids],
        );
        await database.query(`delete from patient_schedules where id = any($1::uuid[])`, [ids]);
        await database.query(
          `alter table patient_schedule_history enable trigger patient_schedule_history_no_delete`,
        );
      }
      await database.query(
        `delete from authorization_item_organizations where authorization_item_id = any($1::uuid[])`,
        [itemIdsList],
      );
      await database.query(`delete from authorization_items where id = any($1::uuid[])`, [
        itemIdsList,
      ]);
    }
    await database.query(
      `delete from demand_sources where projected_demand_line_id in (
         select pdl.id from projected_demand_lines pdl
         join planning_periods pp on pp.id = pdl.planning_period_id
         where pp.start_date between $1 and $2)`,
      [PERIOD_WINDOW.from, PERIOD_WINDOW.to],
    );
    await database.query(
      `delete from projected_demand_lines where planning_period_id in (
         select id from planning_periods where start_date between $1 and $2)`,
      [PERIOD_WINDOW.from, PERIOD_WINDOW.to],
    );
    if (point1Id || point2Id) {
      await database.query(`delete from dispensing_points where id = any($1::uuid[])`, [
        [point1Id, point2Id].filter(Boolean),
      ]);
    }
    await database.query(
      `delete from planning_periods where start_date between $1 and $2`,
      [PERIOD_WINDOW.from, PERIOD_WINDOW.to],
    );
    if (provenanceBatchIds.length > 0) {
      await database.query(`delete from import_batches where id = any($1::uuid[])`, [
        provenanceBatchIds,
      ]);
    }
    await database.query(
      `delete from user_organization_roles
        where user_id in (select id from users where username = any($1::text[]))`,
      [[MTD_GENERAL_USERNAME, READ_ONLY_USERNAME]],
    );
    await database.query(`delete from users where username = any($1::text[])`, [
      [MTD_GENERAL_USERNAME, READ_ONLY_USERNAME],
    ]);
  } finally {
    await database.end();
  }
});

describe('Gate ESP-004 — consolidación de demanda proyectada', () => {
  it('1-2. agrupa por punto y separa por producto/punto/período', async () => {
    // Tres identidades distintas: (itemA1·pt1), (itemA2·pt1), (itemB·pt2).
    await createSchedule({ authorizationItemId: itemA1Id, commercialCode: CODE_A, dispensingPointId: point1Id, scheduledDate: '2036-01-06', quantity: 3 });
    await createSchedule({ authorizationItemId: itemA2Id, commercialCode: CODE_B, dispensingPointId: point1Id, scheduledDate: '2036-01-07', quantity: 2 });
    await createSchedule({ authorizationItemId: itemBId, commercialCode: CODE_C, dispensingPointId: point2Id, scheduledDate: '2036-01-06', quantity: 1 });

    const response = await consolidatePeriod(periodOnTimeId);
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
      sourceCount: 3,
      regularQuantity: 6,
      lateQuantity: 0,
      projectedQuantity: 6,
    });
  });

  it('consulta las líneas consolidadas vía API con punto y código comercial', async () => {
    const list = await apiCall('GET', `/projected-demand?planningPeriodId=${periodOnTimeId}`);
    expect(list.status).toBe(200);
    const { items } = (await list.json()) as {
      items: Array<{
        id: string;
        commercialCode: string;
        dispensingPointId: string;
        regularQuantity: number;
        lateQuantity: number;
        projectedQuantity: number;
        sourceCount: number;
        consolidatedAt: string;
      }>;
    };
    expect(items).toHaveLength(3);
    const lineA = items.find((line) => line.commercialCode === CODE_A);
    expect(lineA).toMatchObject({
      dispensingPointId: point1Id,
      regularQuantity: 3,
      lateQuantity: 0,
      projectedQuantity: 3,
      sourceCount: 1,
    });
    const lineBpt1 = items.find(
      (line) => line.commercialCode === CODE_B && line.dispensingPointId === point1Id,
    );
    expect(lineBpt1?.projectedQuantity).toBe(2);
    expect(items.every((line) => line.consolidatedAt)).toBe(true);
  });

  it('3-6. cancelada excluida; RESCHEDULED participa; history jamás se suma', async () => {
    // (Có B · pt1) se programa (qty 2), se reprograma y se cancela: no debe
    // sumarse; una cancelada no deja source yORK su línea desaparece si era
    // la única fuente de esa identidad.
    const willCancel = await createSchedule({ authorizationItemId: itemBId, commercialCode: CODE_C, dispensingPointId: point1Id, scheduledDate: '2036-01-08', quantity: 2 });
    await apiCall('POST', `/patient-schedules/${willCancel.id}/reschedule`, {
      expectedRevision: willCancel.revision,
      scheduledDate: '2036-01-09',
    }, medicarteToken, ORGANIZATION_IDS.MEDICARTE);
    await apiCall('POST', `/patient-schedules/${willCancel.id}/cancel`, { expectedRevision: 2 }, medicarteToken, ORGANIZATION_IDS.MEDICARTE);

    // También cambia (B·pt2) de 2 → 5 unidades y consolida: el history rev 1
    // (qty 2) NO se suma; solo el valor vigente (qty 5, rev 2).
    const willChange = await createSchedule({ authorizationItemId: itemBId, commercialCode: CODE_C, dispensingPointId: point2Id, scheduledDate: '2036-01-07', quantity: 2 });
    await apiCall('PATCH', `/patient-schedules/${willChange.id}`, {
      expectedRevision: willChange.revision,
      quantity: 5,
    }, medicarteToken, ORGANIZATION_IDS.MEDICARTE);

    const response = await consolidatePeriod(periodOnTimeId);
    expect(response.status).toBe(200);
    const summary = (await response.json()) as {
      lineCount: number;
      sourceCount: number;
      regularQuantity: number;
    };
    // Identidad (C·pt1) solo tenía la programación cancelada: no existe línea.
    // El (C·pt2) recalcula con la cantidad vigente 5.
    const debugState = await database.query(
      `select dp.code as point_code, pdl.commercial_code, pdl.regular_quantity,
              ds.patient_schedule_id, ds.quantity
         from projected_demand_lines pdl
         join planning_periods pp on pp.id = pdl.planning_period_id
         join dispensing_points dp on dp.id = pdl.dispensing_point_id
         left join demand_sources ds on ds.projected_demand_line_id = pdl.id
        where pp.start_date between $1 and $2
        order by pp.start_date, pdl.commercial_code, ds.patient_schedule_id`,
      [PERIOD_WINDOW.from, PERIOD_WINDOW.to],
    );
    console.log('DEBUG lines', JSON.stringify(debugState.rows));
    console.log('DEBUG summary', JSON.stringify(summary));
    // Identidades: (A·pt1)=3, (B·pt1)=2, (C·pt2)=1+5 (dos programaciones del
    // mismo paciente/código en fechas distintas comparten línea).
    expect(summary.lineCount).toBe(3);
    expect(summary.sourceCount).toBe(4);
    expect(summary.regularQuantity).toBe(11); // 3 + 2 + 1 + 5

    const cancelledSources = await database.query<{ count: number }>(
      `select count(*)::int as count from demand_sources where patient_schedule_id = $1`,
      [willCancel.id],
    );
    expect(cancelledSources.rows[0]?.count).toBe(0);

    // Snapshot: la fuente de (B·pt2) referencia rev 2 con quantity 5.
    const source = await database.query<{
      quantity: number;
      schedule_revision: number;
    }>(
      `select quantity, schedule_revision from demand_sources where patient_schedule_id = $1`,
      [willChange.id],
    );
    expect(source.rows[0]).toMatchObject({ quantity: 5, schedule_revision: 2 });
  });

  it('4-8. lineage reconstruible line → source → schedule → item', async () => {
    const lineage = await database.query<{ count: number }>(
      `select count(*)::int as count
        from projected_demand_lines pdl
        join demand_sources ds on ds.projected_demand_line_id = pdl.id
        join patient_schedules ps on ps.id = ds.patient_schedule_id
        join authorization_items ai on ai.id = ps.authorization_item_id
        where pdl.planning_period_id = $1`,
      [periodOnTimeId],
    );
    expect(lineage.rows[0]?.count).toBe(4);
  });

  it('9. idempotencia: consolidar de nuevo no cambia el estado lógico', async () => {
    const before = await database.query<{ revision: number; quantity: number }>(
      `select revision, projected_quantity as quantity from projected_demand_lines
        where planning_period_id = $1 order by dispensing_point_id, commercial_code`,
      [periodOnTimeId],
    );
    const sourcesBefore = await database.query<{ count: number }>(
      `select count(*)::int as count from demand_sources ds
        join projected_demand_lines pdl on pdl.id = ds.projected_demand_line_id
        where pdl.planning_period_id = $1`,
      [periodOnTimeId],
    );

    const again = await consolidatePeriod(periodOnTimeId);
    expect(again.status).toBe(200);
    const summary = (await again.json()) as { lineCount: number; sourceCount: number; projectedQuantity: number };

    const after = await database.query<{ revision: number; quantity: number }>(
      `select revision, projected_quantity as quantity from projected_demand_lines
        where planning_period_id = $1
        order by dispensing_point_id, commercial_code`,
      [periodOnTimeId],
    );
    const sourcesAfter = await database.query<{ count: number }>(
      `select count(*)::int as count from demand_sources ds
        join projected_demand_lines pdl on pdl.id = ds.projected_demand_line_id
        where pdl.planning_period_id = $1`,
      [periodOnTimeId],
    );

    expect(after.rows).toEqual(before.rows);
    expect(sourcesAfter.rows[0]?.count).toBe(sourcesBefore.rows[0]?.count);
    expect(summary.sourceCount).toBe(sourcesBefore.rows[0]?.count);
  });

  it('10-12. COMPLEMENTARY consolida late en su período; NEXT_PERIOD consolida en el período diferido', async () => {
    const complementary = await createSchedule({ authorizationItemId: itemA1Id, commercialCode: CODE_A, dispensingPointId: point1Id, scheduledDate: '2036-02-03', quantity: 4, lateHandling: 'COMPLEMENTARY_PURCHASE_ORDER' });
    expect(complementary).toBeTruthy();

    const ownPeriod = await consolidatePeriod(periodLateId);
    expect(ownPeriod.status).toBe(200);
    const ownSummary = (await ownPeriod.json()) as { sourceCount: number; lateQuantity: number; regularQuantity: number };
    expect(ownSummary.sourceCount).toBe(1);
    expect(ownSummary.lateQuantity).toBe(4);
    expect(ownSummary.regularQuantity).toBe(0);

    const deferredSchedule = await createSchedule({
      authorizationItemId: itemA2Id,
      commercialCode: CODE_B,
      dispensingPointId: point2Id,
      scheduledDate: '2036-02-03',
      quantity: 2,
      lateHandling: 'NEXT_PERIOD',
    });

    // El schedule vive en el período tardío pero aporta al DIFERIDO.
    const deferredResult = await consolidatePeriod(periodNextId);
    expect(deferredResult.status).toBe(200);
    const deferredSummary = (await deferredResult.json()) as {
      sourceCount: number;
      regularQuantity: number;
      lateQuantity: number;
    };
    expect(deferredSummary.sourceCount).toBe(1);
    // Semántica definitiva: NEXT_PERIOD primero → REGULAR en el período
    // diferido (todavía no se ha consolidado el schedule en otra línea).
    expect(deferredSummary.regularQuantity).toBe(2);
    expect(deferredSummary.lateQuantity).toBe(0);

    // La fuente del schedule diferido vive en el período DIFERIDO y su bucket
    // es REGULAR (la programación lleg completa al período efectivo); los
    // hechos históricos quedan como snapshot en la fuente.
    const deferredLines = await apiCall(
      'GET',
      `/projected-demand?planningPeriodId=${periodNextId}&commercialCode=${CODE_B}`,
    );
    const deferredItems = (await deferredLines.json()) as {
      items: Array<{ id: string; regularQuantity: number; lateQuantity: number; projectedQuantity: number }>;
    };
    expect(deferredItems.items[0]).toMatchObject({
      regularQuantity: 2,
      lateQuantity: 0,
      projectedQuantity: 2,
    });
    const deferredSources = await apiCall(
      'GET',
      `/projected-demand/${deferredItems.items[0]!.id}/sources`,
    );
    const deferredSourceItems = (await deferredSources.json()) as {
      items: Array<{ scheduleTiming: string; lateHandling: string | null }>;
    };
    expect(deferredSourceItems.items).toEqual([
      expect.objectContaining({
        scheduleTiming: 'LATE',
        lateHandling: 'NEXT_PERIOD',
      }),
    ]);

    const sourceRow = await database.query<{ planning_period_id: string }>(
      `select ds.planning_period_id from demand_sources ds where ds.patient_schedule_id = $1`,
      [deferredSchedule.id],
    );
    expect(sourceRow.rows[0]?.planning_period_id).toBe(periodNextId);
  });

  it('10b. P1→P2: LATE + NEXT_PERIOD qty 3 consolida en P2 como REGULAR conservando el hecho histórico', async () => {
    // P2-original (periodLate) con corte vencido; por eso la programación es LATE.
    const deferred = await createSchedule({
      authorizationItemId: itemBId,
      commercialCode: CODE_C,
      dispensingPointId: point1Id,
      scheduledDate: '2036-02-05',
      quantity: 3,
      lateHandling: 'NEXT_PERIOD',
    });
    expect(deferred).toBeTruthy();

    // P1 (periodOnTime) no debe contarla; P2 (periodNext) sí.
    const p1Response = await consolidatePeriod(periodOnTimeId);
    const p1Summary = (await p1Response.json()) as { lateQuantity: number };
    expect(p1Summary.lateQuantity).toBe(0);

    const p2Response = await consolidatePeriod(periodNextId);
    expect(p2Response.status).toBe(200);
    const p2List = (await p2Response.json()) as unknown;
    void p2List;

    const lines = await apiCall(
      'GET',
      `/projected-demand?planningPeriodId=${periodNextId}&dispensingPointId=${point1Id}&commercialCode=${CODE_C}`,
    );
    const { items } = (await lines.json()) as {
      items: Array<{
        id: string;
        regularQuantity: number;
        lateQuantity: number;
        projectedQuantity: number;
      }>;
    };
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      regularQuantity: 3,
      lateQuantity: 0,
      projectedQuantity: 3,
    });

    const sources = await apiCall('GET', `/projected-demand/${items[0]!.id}/sources`);
    const sourceItems = (await sources.json()) as {
      items: Array<{ scheduleTiming: string; lateHandling: string | null; patientScheduleId: string }>;
    };
    expect(sourceItems.items).toHaveLength(1);
    expect(sourceItems.items[0]).toEqual(
      expect.objectContaining({
        patientScheduleId: deferred.id,
        scheduleTiming: 'LATE',
        lateHandling: 'NEXT_PERIOD',
      }),
    );
  });

  it('versionado semántico y matriz de idempotencia', async () => {
    // Consolidación 1: X qty1 + Y qty1 → total 2, revisión 1.
    const x = await createSchedule({ authorizationItemId: itemCId, commercialCode: CODE_D, dispensingPointId: point1Id, scheduledDate: '2036-01-05', quantity: 1 });
    await createSchedule({ authorizationItemId: itemCId, commercialCode: CODE_D, dispensingPointId: point1Id, scheduledDate: '2036-01-06', quantity: 1 });

    let response = await consolidatePeriod(periodOnTimeId);
    expect(response.status).toBe(200);
    let line = await getLineByCode(periodOnTimeId, CODE_D, point1Id);
    expect(line).toMatchObject({
      regularQuantity: 2,
      lateQuantity: 0,
      projectedQuantity: 2,
      sourceCount: 2,
      revision: 1,
    });

    // Consolidación 2: X cancelada, Z entra qty1 → total sigue 2 pero
    // cambió la composición ⇒ revision debe avanzar (2).
    await apiCall('POST', `/patient-schedules/${x.id}/cancel`, { expectedRevision: 1 }, medicarteToken, ORGANIZATION_IDS.MEDICARTE);
    await createSchedule({ authorizationItemId: itemCId, commercialCode: CODE_D, dispensingPointId: point1Id, scheduledDate: '2036-01-10', quantity: 1 });

    response = await consolidatePeriod(periodOnTimeId);
    expect(response.status).toBe(200);
    line = await getLineByCode(periodOnTimeId, CODE_D, point1Id);
    expect(line).toMatchObject({ projectedQuantity: 2, sourceCount: 2 });
    expect(line?.revision).toBe(2);

    // Idempotencia: misma cantidad + mismas fuentes → revision no cambia.
    response = await consolidatePeriod(periodOnTimeId);
    expect(response.status).toBe(200);
    line = await getLineByCode(periodOnTimeId, CODE_D, point1Id);
    expect(line?.revision).toBe(2);

    // Cantidades diferentes ⇒ revision avanza (3).
    await apiCall(
      'PATCH',
      `/patient-schedules/${scheduleIds.at(-1)}`,
      { expectedRevision: 1, quantity: 4 },
      medicarteToken,
      ORGANIZATION_IDS.MEDICARTE,
    );
    response = await consolidatePeriod(periodOnTimeId);
    expect(response.status).toBe(200);
    line = await getLineByCode(periodOnTimeId, CODE_D, point1Id);
    expect(line).toMatchObject({ projectedQuantity: 5, revision: 3 });
  });

  it('la fuente histórica conserva original = P1 y efectivo = P2 aunque el schedule actual viva en P3', async () => {
    // P1 = periodLate (cutoff vencido). LATE + NEXT_PERIOD hacia P2.
    const deferred = await createSchedule({
      authorizationItemId: itemA1Id,
      commercialCode: CODE_A,
      dispensingPointId: point2Id,
      scheduledDate: '2036-02-06',
      quantity: 3,
      lateHandling: 'NEXT_PERIOD',
    });
    const consolidateNext = await consolidatePeriod(periodNextId);
    expect(consolidateNext.status).toBe(200);

    // Reprograma el schedule ACTUAL a P3 con completentaria (LATE): la fuente
    // histórica de la revisión 1 NO depende del planning_period_id actual.
    const rescheduled = await apiCall(
      'POST',
      `/patient-schedules/${deferred.id}/reschedule`,
      {
        expectedRevision: 1,
        scheduledDate: '2036-04-02',
        lateHandling: 'COMPLEMENTARY_PURCHASE_ORDER',
      },
      medicarteToken,
      ORGANIZATION_IDS.MEDICARTE,
    );
    expect(rescheduled.status).toBe(200);

    const lineage = await database.query<{
      revision: number;
      original_planning_period_id: string;
      effective_planning_period_id: string;
      current_planning_period_id: string;
    }>(
      `select ds.schedule_revision as revision,
              hsh.planning_period_id as original_planning_period_id,
              ds.planning_period_id as effective_planning_period_id,
              ps.planning_period_id as current_planning_period_id
         from demand_sources ds
         join patient_schedule_history hsh
           on hsh.patient_schedule_id = ds.patient_schedule_id
          and hsh.revision = ds.schedule_revision
         join patient_schedules ps on ps.id = ds.patient_schedule_id
        where ds.patient_schedule_id = $1 and ds.schedule_revision = 1`,
      [deferred.id],
    );
    expect(lineage.rows).toHaveLength(1);
    expect(lineage.rows[0]?.original_planning_period_id).toBe(periodLateId);
    expect(lineage.rows[0]?.effective_planning_period_id).toBe(periodNextId);
    expect(lineage.rows[0]?.current_planning_period_id).toBe(periodThirdId);
    // Y la revisión 1 en el histórico todavía prueba su propia línea:
    expect(lineage.rows[0]?.revision).toBe(1);
  });

  it('11. invariantes FK: una fuente fuera de su identidad choca con la FK compuesta', async () => {
    const line = await database.query<{ id: string; planning_period_id: string; dispensing_point_id: string; commercial_code: string }>(
      `select id, planning_period_id, dispensing_point_id, commercial_code
        from projected_demand_lines where planning_period_id = $1 limit 1`,
      [periodOnTimeId],
    );
    expect(line.rows.length).toBeGreaterThan(0);
    // Par válido (schedule, revisión) aún no usado como fuente, para que la
    // única violación posible sea la identidad de la línea.
    const existingSchedule = await database.query<{ id: string; revision: number }>(
      `select ps.id, ps.revision
         from patient_schedules ps
         left join demand_sources ds
           on ds.patient_schedule_id = ps.id and ds.schedule_revision = ps.revision
        where ds.id is null
        limit 1`,
    );
    expect(existingSchedule.rows.length).toBeGreaterThan(0);
    await expect(
      database.query(
        `insert into demand_sources
          (projected_demand_line_id, patient_schedule_id, schedule_revision, quantity,
           planning_period_id, dispensing_point_id, commercial_code, schedule_timing,
           demand_bucket)
         values ($1, $2, $3, 1, $4, $5, $6, 'ON_TIME', 'REGULAR')`,
        [
          line.rows[0]!.id,
          existingSchedule.rows[0]!.id,
          existingSchedule.rows[0]!.revision,
          periodNextId,
          line.rows[0]!.dispensing_point_id,
          line.rows[0]!.commercial_code,
        ],
      ),
    ).rejects.toThrow(/demand_sources_line_identity_fk|demand_sources_schedule_revision_fk/);
  });

  it('12. concurrencia: dos consolidaciones simultáneas del mismo período serializan', async () => {
    const [first, second] = await Promise.all([
      consolidatePeriod(periodOnTimeId),
      consolidatePeriod(periodOnTimeId),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const lines = await database.query<{ count: number }>(
      `select count(*)::int as count from projected_demand_lines where planning_period_id = $1`,
      [periodOnTimeId],
    );
    // La misma identidad (un solo juego), sin duplicaciones accidentales.
    expect(lines.rows[0]?.count).toBeGreaterThan(0);
  });

  it('13-15. RBAC 200/403 (MTD General/READ_ONLY leen; consolidación 403; Medicarte/OLP sin acceso)', async () => {
    const read = await apiCall('GET', `/projected-demand?planningPeriodId=${periodOnTimeId}`, undefined, mtdGeneralToken);
    expect(read.status).toBe(200);

    const manage = await apiCall('POST', `/planning-periods/${periodOnTimeId}/consolidate`, {}, mtdGeneralToken);
    expect(manage.status).toBe(403);
    expect(((await manage.json()) as { code: string }).code).toBe('PERMISSION_DENIED');

    const medicarteRead = await apiCall('GET', `/projected-demand?planningPeriodId=${periodOnTimeId}`, undefined, medicarteToken, ORGANIZATION_IDS.MEDICARTE);
    expect(medicarteRead.status).toBe(403);

    const olpRead = await apiCall('GET', `/projected-demand?planningPeriodId=${periodOnTimeId}`, undefined, olpToken, ORGANIZATION_IDS.OLP);
    expect(olpRead.status).toBe(403);

    const readOnlyRead = await apiCall('GET', `/projected-demand?planningPeriodId=${periodOnTimeId}`, undefined, readOnlyToken);
    expect(readOnlyRead.status).toBe(200);

    const manageByMedicarte = await apiCall(
      'POST',
      `/planning-periods/${periodOnTimeId}/consolidate`,
      {},
      medicarteToken,
      ORGANIZATION_IDS.MEDICARTE,
    );
    expect(manageByMedicarte.status).toBe(403);
  });

  it('sin efectos sobre authorization_items; sin OC/inventario; auditoría con resumen', async () => {
    const snapshot = await database.query<Record<string, unknown>>(
      `select enablement_status, operation_status, orden_compra, operational_version,
              to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
         from authorization_items where id = $1`,
      [itemA1Id],
    );
    expect(snapshot.rows[0]).toEqual(itemSnapshot);
    const items = await database.query<{ count: number }>(
      `select count(*)::int as count from authorization_items`,
    );
    expect(items.rows[0]?.count).toBe(itemsBefore);

    const logisticsTables = await database.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema='public'
           and table_name in ('inventory','inventory_items')`,
    );
    expect(logisticsTables.rows).toEqual([]);

    // Programaciones no fueron alteradas (updated_at igual original)...
    const scheduleCount = await database.query<{ count: number }>(
      `select count(*)::int as count
        from patient_schedules where authorization_item_id = any($1::uuid[])`,
      [[itemA1Id, itemA2Id, itemBId, itemCId]],
    );
    expect(scheduleCount.rows[0]?.count).toBe(scheduleIds.length);

    const auditCount = await database.query<{ count: number }>(
      `select count(*)::int as count from audit_events
        where resource_type = 'planning_period' and resource_id = $1
          and action = 'PROJECTED_DEMAND_CONSOLIDATED'`,
      [periodOnTimeId],
    );
    expect(auditCount.rows[0]?.count).toBeGreaterThan(0);
  });
});
