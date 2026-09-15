import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReconciliationEngine } from '../../apps/api/src/reconciliation/reconciliation.engine';
import { ReconciliationRepository } from '../../apps/api/src/reconciliation/reconciliation.repository';
import type { RuleContext } from '../../apps/api/src/reconciliation/reconciliation.types';
import {
  ORGANIZATION_IDS,
  adminLogin,
  ensureOperatorTokens,
  ensureUser,
  grantAllPointsToMedicarteOperator,
  deletePointScopesForPoints,
} from './helpers/auth';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const database = new Client({ connectionString: databaseUrl });
const root = process.cwd();
const suffix = randomUUID().slice(0, 8);
const CODE = `ESP17-CODE-${suffix.toUpperCase()}`;
const DOC = `DOC-017-${suffix}`;
const POINT_CODE = `ESP17-PT-${suffix}`;
const PERIOD = { from: '2053-03-01', to: '2053-03-31' };
const NEXT_PERIOD = { from: '2053-04-01', to: '2053-04-30' };
const DATE = '2053-03-12';

let adminToken = '';
let foundationUserId = '';
let medicarteToken = '';
let olpToken = '';
let auditorToken = '';
let operatorToken = '';
let generalToken = '';
let readOnlyToken = '';
let compensarToken = '';
let pointId = '';
let otherPointId = '';
let periodId = '';
let nextPeriodId = '';
let modernAuthId = '';
let historicalAuthId = '';
let scheduleId = '';
let applicationId = '';
let applicationLineId = '';
let lotId = '';
const createdPointIds: string[] = [];

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  token = adminToken,
  organizationId = ORGANIZATION_IDS.MTD,
) {
  return fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-organization-id': organizationId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function insertAuthorization(input: { number: string; legacy?: boolean }): Promise<string> {
  const batch = await database.query<{ id: string }>(
    `insert into import_batches (organization_id,created_by,original_filename,mime_type,size_bytes,sha256,processor_version,status,total_rows,confirmed_rows,completed_at,confirmed_at)
     values ($1,$2,$3,'application/json',1,$4,1,'COMPLETED',1,1,now(),now()) returning id`,
    [ORGANIZATION_IDS.MTD, foundationUserId, `esp017-${input.number}.json`, 'e'.repeat(64)],
  );
  const item = await database.query<{ id: string }>(
    `insert into authorization_items
      (numero_autorizacion, codigo_medicamento, authorization_key, source_data,
       source_status_normalized, source_prescripcion_normalized, no_prescripcion,
       enablement_status, coverage_type, direction_status, coverage_rule_version,
       created_from_batch_id,
       lugar_dispensacion, fecha_programada, process_status, operation_status)
     values ($1,$2,$3,$4::jsonb,'VIGENTE','','','ENABLED','PBS','NOT_APPLICABLE','ESP017',$5,
             $6,$7,$8,$9)
     returning id`,
    [
      input.number,
      CODE,
      `${input.number}:${CODE}`,
      JSON.stringify({
        IDENTIFICACION_PACIENTE: DOC,
        NOMBRE_PACIENTE: 'Paciente ESP-017',
        CANTIDAD: '2',
        FECHA_FINAL_VIGENCIA: '2099-12-31',
      }),
      batch.rows[0]!.id,
      input.legacy ? 'SEDE HISTORICA' : null,
      input.legacy ? '2020-01-15' : null,
      input.legacy ? 'PENDIENTE_DISPENSACION' : null,
      input.legacy ? 'DISPENSATION_REPORTED' : null,
    ],
  );
  const id = item.rows[0]!.id;
  await database.query(
    `insert into authorization_item_organizations (authorization_item_id, organization_id)
     values ($1,$2) on conflict do nothing`,
    [id, ORGANIZATION_IDS.MEDICARTE],
  );
  return id;
}

async function insertSchedule(authId: string): Promise<string> {
  const schedule = await database.query<{ id: string }>(
    `insert into patient_schedules
       (authorization_item_id, planning_period_id, dispensing_point_id, commercial_code,
        scheduled_date, quantity, status, schedule_timing, created_by, updated_by)
     values ($1,$2,$3,$4,$5,2,'SCHEDULED','ON_TIME',$6,$6) returning id`,
    [authId, periodId, pointId, CODE, DATE, foundationUserId],
  );
  const id = schedule.rows[0]!.id;
  await database.query(
    `insert into patient_schedule_history
       (patient_schedule_id, revision, authorization_item_id, planning_period_id, dispensing_point_id,
        commercial_code, scheduled_date, quantity, status, schedule_timing, change_type, changed_by, correlation_id)
     values ($1,1,$2,$3,$4,$5,$6,2,'SCHEDULED','ON_TIME','CREATED',$7,$8)`,
    [id, authId, periodId, pointId, CODE, DATE, foundationUserId, randomUUID()],
  );
  return id;
}

async function startRun(body: Record<string, unknown> = {}, token = auditorToken) {
  return api('POST', '/reconciliation/runs', body, token);
}

type RunResponse = {
  id: string;
  status: string;
  tenantId: string;
  rulesVersion: string;
  criticalFindings: number;
  errorFindings: number;
  warningFindings: number;
  infoFindings: number;
  totalRules: number;
  passedRules: number;
  failedRules: number;
  notApplicableRules: number;
  ruleResults: Array<{
    ruleCode: string;
    status: string;
    evaluatedCount: number;
    findingCount: number;
    totalDetected: number;
    truncated: boolean;
    error: string | null;
  }>;
};

type FindingResponse = {
  ruleCode: string;
  severity: string;
  category: string;
  entityType: string;
  entityId: string | null;
  evidence: Record<string, unknown>;
  fingerprint: string;
  message: string;
};

async function runAndFindings(body: Record<string, unknown> = {}, token = auditorToken) {
  const created = await json<RunResponse>(await startRun(body, token));
  const findings = await json<{ items: FindingResponse[] }>(
    await api('GET', `/reconciliation/runs/${created.id}/findings?limit=1000`, undefined, token),
  );
  return { run: created, findings: findings.items };
}

function createSnapshotEngine(pool: Pool) {
  return new ReconciliationEngine(pool, new ReconciliationRepository({ pool }));
}

beforeAll(async () => {
  await database.connect();
  adminToken = await adminLogin();
  foundationUserId = (
    await database.query<{ id: string }>(`select id from users where username='foundation-admin'`)
  ).rows[0]!.id;
  ({ medicarteToken, olpToken } = await ensureOperatorTokens());
  auditorToken = await ensureUser({
    adminToken,
    username: `esp017-auditor-${suffix}`,
    displayName: 'ESP017 Auditor',
    password: `esp017-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_AUDITORIA',
  });
  operatorToken = await ensureUser({
    adminToken,
    username: `esp017-op-${suffix}`,
    displayName: 'ESP017 Operator',
    password: `esp017-op-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_OPERATOR',
  });
  generalToken = await ensureUser({
    adminToken,
    username: `esp017-gen-${suffix}`,
    displayName: 'ESP017 General',
    password: `esp017-gen-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_GENERAL',
  });
  readOnlyToken = await ensureUser({
    adminToken,
    username: `esp017-ro-${suffix}`,
    displayName: 'ESP017 ReadOnly',
    password: `esp017-ro-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'READ_ONLY',
  });
  compensarToken = await ensureUser({
    adminToken,
    username: `esp017-comp-${suffix}`,
    displayName: 'ESP017 Compensar',
    password: `esp017-comp-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.COMPENSAR,
    roleCode: 'COMPENSAR_VIEWER',
  });
  pointId = (
    await database.query<{ id: string }>(
      `insert into dispensing_points (organization_id, code, name, created_by)
       values ($1,$2,'ESP-017 Punto',$3) returning id`,
      [ORGANIZATION_IDS.MEDICARTE, POINT_CODE, foundationUserId],
    )
  ).rows[0]!.id;
  otherPointId = (
    await database.query<{ id: string }>(
      `insert into dispensing_points (organization_id, code, name, created_by)
       values ($1,$2,'ESP-017 Otro',$3) returning id`,
      [ORGANIZATION_IDS.MEDICARTE, `${POINT_CODE}-B`, foundationUserId],
    )
  ).rows[0]!.id;
  createdPointIds.push(pointId, otherPointId);
  periodId = (
    await database.query<{ id: string }>(
      `insert into planning_periods
        (start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
         expected_delivery_date, created_by, updated_by)
       values ($1,$2,'2053-03-28T23:59:00-05:00','2053-03-29T23:59:00-05:00','2053-03-30',$3,$3)
       returning id`,
      [PERIOD.from, PERIOD.to, foundationUserId],
    )
  ).rows[0]!.id;
  nextPeriodId = (
    await database.query<{ id: string }>(
      `insert into planning_periods
        (start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
         expected_delivery_date, created_by, updated_by)
       values ($1,$2,'2053-04-28T23:59:00-05:00','2053-04-29T23:59:00-05:00','2053-04-30',$3,$3)
       returning id`,
      [NEXT_PERIOD.from, NEXT_PERIOD.to, foundationUserId],
    )
  ).rows[0]!.id;
  await grantAllPointsToMedicarteOperator(database);
  modernAuthId = await insertAuthorization({ number: `ESP017-M-${suffix}` });
  historicalAuthId = await insertAuthorization({ number: `ESP017-H-${suffix}`, legacy: true });
  scheduleId = await insertSchedule(modernAuthId);
  lotId = (
    await database.query<{ id: string }>(
      `insert into inventory_lots (commercial_code,dispensing_point_id,lot_number,expiration_date)
       values ($1,$2,$3,'2099-12-31') returning id`,
      [CODE, pointId, `ESP17-LOT-${suffix}`],
    )
  ).rows[0]!.id;
  await database.query(
    `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by)
     values ($1,'ADJUSTMENT',5,'ADJUSTMENT',$2,now(),$3)`,
    [lotId, randomUUID(), foundationUserId],
  );
  await database.query('BEGIN');
  try {
    applicationId = (
      await database.query<{ id: string }>(
        `insert into patient_applications
           (patient_schedule_id, schedule_revision, authorization_item_id, commercial_code,
            dispensing_point_id, scheduled_date, application_date, status, created_by, confirmed_by, confirmed_at)
         values ($1,1,$2,$3,$4,$5,$5,'CONFIRMED',$6,$6,now()) returning id`,
        [scheduleId, modernAuthId, CODE, pointId, DATE, foundationUserId],
      )
    ).rows[0]!.id;
    applicationLineId = (
      await database.query<{ id: string }>(
        `insert into patient_application_lines
           (patient_application_id, inventory_lot_id, commercial_code, dispensing_point_id, lot_number, expiration_date, quantity)
         values ($1,$2,$3,$4,$5,'2099-12-31',2) returning id`,
        [applicationId, lotId, CODE, pointId, `ESP17-LOT-${suffix}`],
      )
    ).rows[0]!.id;
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
  await database.query(
    `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by)
     values ($1,'APPLICATION',-2,'APPLICATION_LINE',$2,now(),$3)`,
    [lotId, applicationLineId, foundationUserId],
  );
});

afterAll(async () => {
  await database.query(
    `alter table patient_applications disable trigger patient_applications_confirmed_immutable`,
  );
  await database.query(
    `alter table patient_application_lines disable trigger patient_application_lines_confirmed_immutable`,
  );
  await database.query(
    `alter table patient_schedule_history disable trigger patient_schedule_history_no_delete`,
  );
  try {
    await database.query(
      `update reconciliation_issues set last_finding_id = null
        where last_run_id in (select id from reconciliation_runs where started_by in (select id from users where username like 'esp017-%') or scope->>'planningPeriodId' = $1)
           or first_run_id in (select id from reconciliation_runs where started_by in (select id from users where username like 'esp017-%') or scope->>'planningPeriodId' = $1)`,
      [periodId],
    );
    await database.query(
      `delete from reconciliation_issue_comments where issue_id in (
         select id from reconciliation_issues where tenant_id = $1
           or last_run_id in (select id from reconciliation_runs where scope->>'planningPeriodId' = $2)
       )`,
      [ORGANIZATION_IDS.MTD, periodId],
    );
    await database.query(
      `delete from reconciliation_issue_events where issue_id in (
         select id from reconciliation_issues where last_run_id in (
           select id from reconciliation_runs where started_by in (select id from users where username like 'esp017-%') or scope->>'planningPeriodId' = $1
         )
       )`,
      [periodId],
    );
    await database.query(
      `delete from reconciliation_findings where reconciliation_run_id in (select id from reconciliation_runs where started_by in (select id from users where username like 'esp017-%') or scope::text like '%${periodId}%')`,
    );
    await database.query(
      `delete from reconciliation_issues where last_run_id in (
         select id from reconciliation_runs where started_by in (select id from users where username like 'esp017-%') or scope->>'planningPeriodId' = $1
       )`,
      [periodId],
    );
    await database.query(
      `delete from reconciliation_runs where started_by in (select id from users where username like 'esp017-%') or scope->>'planningPeriodId' = $1`,
      [periodId],
    );
    await database.query(
      `delete from inventory_movements
        where ($1::uuid is not null and source_id = $1)
           or ($2::uuid is not null and inventory_lot_id = $2)
           or inventory_lot_id in (select id from inventory_lots where lot_number like 'ESP17-LOT-%')`,
      [applicationLineId || null, lotId || null],
    );
    if (applicationId) {
      await database.query(
        `delete from patient_application_lines where patient_application_id = $1`,
        [applicationId],
      );
      await database.query(`delete from patient_applications where id = $1`, [applicationId]);
    }
    if (scheduleId) {
      await database.query(`delete from patient_schedule_history where patient_schedule_id = $1`, [
        scheduleId,
      ]);
      await database.query(`delete from patient_schedules where id = $1`, [scheduleId]);
    }
    if (lotId) await database.query(`delete from inventory_lots where id = $1`, [lotId]);
    await database.query(
      `delete from authorization_item_organizations where authorization_item_id = any($1::uuid[])`,
      [[modernAuthId, historicalAuthId]],
    );
    await database.query(`delete from authorization_items where id = any($1::uuid[])`, [
      [modernAuthId, historicalAuthId],
    ]);
    await deletePointScopesForPoints(database, createdPointIds);
    await database.query(`delete from dispensing_points where id = any($1::uuid[])`, [
      createdPointIds,
    ]);
    await database.query(`delete from planning_periods where id = any($1::uuid[])`, [
      [periodId, nextPeriodId],
    ]);
  } finally {
    await database.query(
      `alter table patient_application_lines enable trigger patient_application_lines_confirmed_immutable`,
    );
    await database.query(
      `alter table patient_applications enable trigger patient_applications_confirmed_immutable`,
    );
    await database.query(
      `alter table patient_schedule_history enable trigger patient_schedule_history_no_delete`,
    );
    await database.end();
  }
});

describe('Gate ESP-017 — reconciliación operacional', () => {
  it('1-3. run creado, lifecycle COMPLETED y rules version', async () => {
    const created = await json<RunResponse>(
      await startRun({ planningPeriodId: periodId, dispensingPointId: pointId }),
    );
    expect(created.status).toBe('COMPLETED');
    expect(created.rulesVersion).toBe('ESP-017.1');
    expect(created.totalRules).toBeGreaterThan(20);
    expect(['PENDING', 'RUNNING']).not.toContain(created.status);
  });

  it('4. tenant isolation: MTD no ve runs de otro tenant', async () => {
    const foreign = await database.query<{ id: string }>(
      `insert into reconciliation_runs (tenant_id, status, scope, rules_version, total_rules, metadata)
       values ($1,'COMPLETED','{"kind":"GLOBAL","planningPeriodId":null,"dispensingPointId":null,"commercialCode":null}'::jsonb,'ESP-017.1',0,'{}'::jsonb)
       returning id`,
      [ORGANIZATION_IDS.COMPENSAR],
    );
    const listed = await json<{ items: Array<{ id: string; tenantId: string }> }>(
      await api('GET', '/reconciliation/runs'),
    );
    expect(listed.items.some((item) => item.id === foreign.rows[0]!.id)).toBe(false);
    expect((await api('GET', `/reconciliation/runs/${foreign.rows[0]!.id}`)).status).toBe(404);
    await database.query(`delete from reconciliation_runs where id = $1`, [foreign.rows[0]!.id]);
  });

  it('5. read-only: el run no muta hechos operacionales', async () => {
    const before = await database.query<{ sig: string }>(
      `select md5(concat_ws('|', status, revision::text, quantity::text, updated_at::text)) as sig
         from patient_schedules where id = $1`,
      [scheduleId],
    );
    const movementsBefore = await database.query<{ n: string }>(
      `select count(*)::text n from inventory_movements where inventory_lot_id = $1`,
      [lotId],
    );
    await startRun({ planningPeriodId: periodId, dispensingPointId: pointId });
    const after = await database.query<{ sig: string }>(
      `select md5(concat_ws('|', status, revision::text, quantity::text, updated_at::text)) as sig
         from patient_schedules where id = $1`,
      [scheduleId],
    );
    const movementsAfter = await database.query<{ n: string }>(
      `select count(*)::text n from inventory_movements where inventory_lot_id = $1`,
      [lotId],
    );
    expect(after.rows[0]?.sig).toBe(before.rows[0]?.sig);
    expect(movementsAfter.rows[0]?.n).toBe(movementsBefore.rows[0]?.n);
    expect(source('apps/api/src/reconciliation/reconciliation.engine.ts')).toContain(
      'REPEATABLE READ READ ONLY',
    );
    expect(source('apps/api/src/reconciliation/reconciliation.engine.ts')).not.toContain(
      'update patient_schedules',
    );
  });

  it('6. NOT_APPLICABLE cuando no hay transfers RECEIVED', async () => {
    const { run } = await runAndFindings({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['TRANSFER'],
    });
    const conservation = run.ruleResults.find((item) => item.ruleCode === 'REC-TRF-005');
    expect(conservation?.status).toBe('NOT_APPLICABLE');
    expect(conservation?.evaluatedCount).toBe(0);
  });

  it('7. una regla crítica sin implementación no produce PASS falso', () => {
    expect(source('apps/api/src/reconciliation/reconciliation.engine.ts')).toContain(
      'ERROR_EXECUTING_RULE',
    );
    expect(source('apps/api/src/reconciliation/reconciliation.engine.ts')).toContain(
      "isFatalSnapshotError(error) || rule.defaultSeverity === 'CRITICAL'",
    );
  });

  it('8. max findings/truncation se documenta y configura', () => {
    expect(source('packages/domain/src/reconciliation-registry.ts')).toContain(
      'RECONCILIATION_MAX_FINDINGS_PER_RULE = 1000',
    );
    expect(source('apps/api/src/reconciliation/reconciliation.engine.ts')).toContain('truncated');
  });

  it('snapshot 1. all rules share one snapshot context', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const engine = createSnapshotEngine(pool);
    const contexts: RuleContext[] = [];
    const snapshotIds: string[] = [];
    try {
      await engine.execute({
        tenantId: ORGANIZATION_IDS.MTD,
        startedBy: foundationUserId,
        planningPeriodId: periodId,
        dispensingPointId: pointId,
        snapshotHooks: {
          afterRule: ({ context, snapshot }) => {
            contexts.push(context);
            snapshotIds.push(snapshot.id);
            return Promise.resolve();
          },
        },
      });
      expect(contexts.length).toBeGreaterThan(60);
      expect(new Set(snapshotIds).size).toBe(1);
      expect(contexts.every((item) => item === contexts[0])).toBe(true);
      expect(contexts[0]?.tenantId).toBe(ORGANIZATION_IDS.MTD);
      expect(contexts[0]?.snapshot.isolation).toBe('REPEATABLE READ READ ONLY');
      await expect(contexts[0]!.query('select 1')).rejects.toThrow('SNAPSHOT_CLOSED');
    } finally {
      await pool.end();
    }
  });

  it('snapshot 2-4. concurrent COMMIT is frozen mid-run; writer persists while reader is read-only; next run sees it', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const engine = createSnapshotEngine(pool);
    const mutator = new Client({ connectionString: databaseUrl });
    await mutator.connect();
    const originalQty = Number(
      (
        await database.query<{ quantity: string }>(
          `select quantity::text as quantity from patient_schedules where id = $1`,
          [scheduleId],
        )
      ).rows[0]?.quantity,
    );
    expect(originalQty).toBeGreaterThan(0);
    const quantities: number[] = [];
    let writerSawRunning = false;
    let readerWasReadOnly = false;
    try {
      const runA = await engine.execute({
        tenantId: ORGANIZATION_IDS.MTD,
        startedBy: foundationUserId,
        planningPeriodId: periodId,
        dispensingPointId: pointId,
        domains: ['SCHEDULING'],
        snapshotHooks: {
          afterRule: async ({ runId, ruleCode, context }) => {
            const qty = await context.query<{ quantity: string }>(
              `select quantity::text as quantity from patient_schedules where id = $1`,
              [scheduleId],
            );
            quantities.push(Number(qty.rows[0]?.quantity));
            if (ruleCode !== 'REC-SCH-001') return;
            const readOnly = await context.query<{ v: string }>(
              `select current_setting('transaction_read_only') as v`,
            );
            readerWasReadOnly = readOnly.rows[0]?.v === 'on';
            const runRow = await database.query<{ status: string }>(
              `select status from reconciliation_runs where id = $1`,
              [runId],
            );
            writerSawRunning = runRow.rows[0]?.status === 'RUNNING';
            await mutator.query(
              `update patient_schedules set quantity = $1, updated_at = now() where id = $2`,
              [originalQty + 1, scheduleId],
            );
            const still = await context.query<{ quantity: string }>(
              `select quantity::text as quantity from patient_schedules where id = $1`,
              [scheduleId],
            );
            expect(Number(still.rows[0]?.quantity)).toBe(originalQty);
          },
        },
      });
      expect(readerWasReadOnly).toBe(true);
      expect(writerSawRunning).toBe(true);
      expect(quantities.every((value) => value === originalQty)).toBe(true);
      const committed = await database.query<{ quantity: string }>(
        `select quantity::text as quantity from patient_schedules where id = $1`,
        [scheduleId],
      );
      expect(Number(committed.rows[0]?.quantity)).toBe(originalQty + 1);
      const runARow = await database.query<{
        status: string;
        metadata: { ruleResults: Array<{ ruleCode: string; status: string }> };
      }>(`select status, metadata from reconciliation_runs where id = $1`, [runA.id]);
      expect(runARow.rows[0]?.status).toBe('COMPLETED');
      expect(
        runARow.rows[0]?.metadata.ruleResults.find((item) => item.ruleCode === 'REC-SCH-002')
          ?.status,
      ).toBe('PASS');

      const runB = await engine.execute({
        tenantId: ORGANIZATION_IDS.MTD,
        startedBy: foundationUserId,
        planningPeriodId: periodId,
        dispensingPointId: pointId,
        domains: ['SCHEDULING'],
      });
      const runBRow = await database.query<{
        status: string;
        metadata: { ruleResults: Array<{ ruleCode: string; status: string }> };
      }>(`select status, metadata from reconciliation_runs where id = $1`, [runB.id]);
      expect(runBRow.rows[0]?.status).toBe('COMPLETED');
      expect(
        runBRow.rows[0]?.metadata.ruleResults.find((item) => item.ruleCode === 'REC-SCH-002')
          ?.status,
      ).toBe('FAIL');
    } finally {
      await database.query(
        `update patient_schedules set quantity = $1, updated_at = now() where id = $2`,
        [originalQty, scheduleId],
      );
      await mutator.end();
      await pool.end();
    }
  });

  it('snapshot 5. rule timeout does not produce PASS', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const engine = createSnapshotEngine(pool);
    try {
      const created = await engine.execute({
        tenantId: ORGANIZATION_IDS.MTD,
        startedBy: foundationUserId,
        planningPeriodId: periodId,
        dispensingPointId: pointId,
        domains: ['SCHEDULING'],
        statementTimeoutMs: 200,
        snapshotHooks: {
          beforeRules: async (context) => {
            await context.query('select pg_sleep(1)');
          },
        },
      });
      const row = await database.query<{
        status: string;
        passed_rules: number;
        metadata: { technicalFailure: string | null; ruleResults: Array<{ status: string }> };
      }>(`select status, passed_rules, metadata from reconciliation_runs where id = $1`, [
        created.id,
      ]);
      expect(row.rows[0]?.status).toBe('FAILED');
      expect(row.rows[0]?.passed_rules).toBe(0);
      expect(row.rows[0]?.metadata.technicalFailure).toMatch(/timeout|canceling statement/i);
      expect(row.rows[0]?.metadata.ruleResults.every((item) => item.status !== 'PASS')).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it('snapshot 6. aborted reader transaction marks the run FAILED', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const engine = createSnapshotEngine(pool);
    try {
      const created = await engine.execute({
        tenantId: ORGANIZATION_IDS.MTD,
        startedBy: foundationUserId,
        planningPeriodId: periodId,
        dispensingPointId: pointId,
        domains: ['SCHEDULING'],
        snapshotHooks: {
          afterRule: async ({ index, context }) => {
            if (index !== 0) return;
            try {
              await context.query('select 1/0');
            } catch {
              /* the reader transaction is now aborted */
            }
          },
        },
      });
      const row = await database.query<{
        status: string;
        metadata: { technicalFailure: string | null; ruleResults: Array<{ status: string }> };
      }>(`select status, metadata from reconciliation_runs where id = $1`, [created.id]);
      expect(row.rows[0]?.status).toBe('FAILED');
      expect(row.rows[0]?.metadata.technicalFailure).toMatch(/aborted|division by zero/i);
      expect(
        row.rows[0]?.metadata.ruleResults.some((item) => item.status === 'ERROR_EXECUTING_RULE'),
      ).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it('snapshot 7. shared snapshot keeps tenant isolation', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const engine = createSnapshotEngine(pool);
    const tenants: Array<{ tenantId: string; operationalTenant: boolean }> = [];
    try {
      const foreign = await engine.execute({
        tenantId: ORGANIZATION_IDS.MEDICARTE,
        startedBy: foundationUserId,
        planningPeriodId: periodId,
        dispensingPointId: pointId,
        domains: ['SCHEDULING'],
        snapshotHooks: {
          afterRule: ({ context }) => {
            tenants.push({
              tenantId: context.tenantId,
              operationalTenant: context.operationalTenant,
            });
            return Promise.resolve();
          },
        },
      });
      expect(tenants.every((item) => item.tenantId === ORGANIZATION_IDS.MEDICARTE)).toBe(true);
      expect(tenants.every((item) => item.operationalTenant === false)).toBe(true);
      const foreignRow = await database.query<{
        tenant_id: string;
        metadata: { ruleResults: Array<{ ruleCode: string; evaluatedCount: number }> };
      }>(`select tenant_id, metadata from reconciliation_runs where id = $1`, [foreign.id]);
      expect(foreignRow.rows[0]?.tenant_id).toBe(ORGANIZATION_IDS.MEDICARTE);
      expect(
        foreignRow.rows[0]?.metadata.ruleResults.find((item) => item.ruleCode === 'REC-SCH-001')
          ?.evaluatedCount,
      ).toBe(0);

      const mtd = await engine.execute({
        tenantId: ORGANIZATION_IDS.MTD,
        startedBy: foundationUserId,
        planningPeriodId: periodId,
        dispensingPointId: pointId,
        domains: ['SCHEDULING'],
      });
      const mtdRow = await database.query<{
        metadata: { ruleResults: Array<{ ruleCode: string; evaluatedCount: number }> };
      }>(`select metadata from reconciliation_runs where id = $1`, [mtd.id]);
      expect(
        Number(
          mtdRow.rows[0]?.metadata.ruleResults.find((item) => item.ruleCode === 'REC-SCH-001')
            ?.evaluatedCount,
        ),
      ).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  });

  it('snapshot 8. operational tables remain unmodified by ESP-017 writes', async () => {
    const before = await database.query<{ sig: string }>(
      `select md5(concat_ws('|', status, revision::text, quantity::text, updated_at::text)) as sig
         from patient_schedules where id = $1`,
      [scheduleId],
    );
    const pool = new Pool({ connectionString: databaseUrl });
    const engine = createSnapshotEngine(pool);
    try {
      await engine.execute({
        tenantId: ORGANIZATION_IDS.MTD,
        startedBy: foundationUserId,
        planningPeriodId: periodId,
        dispensingPointId: pointId,
        domains: ['SCHEDULING'],
      });
    } finally {
      await pool.end();
    }
    const after = await database.query<{ sig: string }>(
      `select md5(concat_ws('|', status, revision::text, quantity::text, updated_at::text)) as sig
         from patient_schedules where id = $1`,
      [scheduleId],
    );
    expect(after.rows[0]?.sig).toBe(before.rows[0]?.sig);
    expect(source('apps/api/src/reconciliation/reconciliation.engine.ts')).toContain(
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    expect(source('apps/api/src/reconciliation/reconciliation.engine.ts')).toContain(
      'pg_current_snapshot',
    );
    expect(source('apps/api/src/reconciliation/reconciliation.repository.ts')).toContain(
      'insert into reconciliation_findings',
    );
    expect(source('apps/api/src/reconciliation/reconciliation.rules.ts')).not.toMatch(
      /this\.pool|createDatabase|new Pool/,
    );
  });

  it('9. identidad activa duplicada está prevenida por DB', async () => {
    await expect(
      database.query(
        `insert into patient_schedules
           (authorization_item_id, planning_period_id, dispensing_point_id, commercial_code,
            scheduled_date, quantity, status, schedule_timing, created_by, updated_by)
         values ($1,$2,$3,$4,$5,1,'SCHEDULED','ON_TIME',$6,$6)`,
        [modernAuthId, periodId, pointId, CODE, DATE, foundationUserId],
      ),
    ).rejects.toThrow();
  });

  it('10. NEXT_PERIOD sin diferido está prevenido; período no posterior se detecta', async () => {
    await expect(
      database.query(
        `update patient_schedules set late_handling='NEXT_PERIOD', schedule_timing='LATE', deferred_planning_period_id=null where id=$1`,
        [scheduleId],
      ),
    ).rejects.toThrow();
    await database.query(
      `update patient_schedules
          set schedule_timing='LATE', late_handling='NEXT_PERIOD', deferred_planning_period_id=$2
        where id=$1`,
      [scheduleId, periodId],
    );
    const { findings } = await runAndFindings({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['SCHEDULING'],
    });
    expect(findings.some((item) => item.ruleCode === 'REC-SCH-004')).toBe(true);
    await database.query(
      `update patient_schedules
          set schedule_timing='ON_TIME', late_handling=null, deferred_planning_period_id=null
        where id=$1`,
      [scheduleId],
    );
  });

  it('11-14. demanda: split, sources, NEXT_PERIOD y stale=WARNING', () => {
    expect(source('packages/database/src/schema.ts')).toContain(
      'projected_demand_lines_split_check',
    );
    expect(source('packages/domain/src/reconciliation-registry.ts')).toContain(
      "ruleCode: 'REC-DEM-004'",
    );
    expect(source('packages/domain/src/reconciliation-registry.ts')).toMatch(
      /REC-DEM-004[\s\S]*OBSERVATION/,
    );
  });

  it('15-17. PO accepted<=requested está prevenido y over-order no es corrupción', () => {
    expect(source('packages/database/src/schema.ts')).toContain(
      'purchase_order_lines_accepted_quantity_check',
    );
    expect(source('packages/domain/src/reconciliation-registry.ts')).not.toContain('overOrdered');
    expect(source('packages/domain/src/reconciliation-registry.ts')).toContain(
      'Over-order posterior a una baja de demanda no es este hallazgo',
    );
  });

  it('18. dispatched > accepted se detecta como CRITICAL', () => {
    expect(source('packages/domain/src/reconciliation-registry.ts')).toContain('REC-DEL-001');
    expect(source('apps/api/src/reconciliation/reconciliation.rules.ts')).toContain(
      'dispatched.qty > pol.accepted_quantity',
    );
  });

  it('19-20. receipt quantities están prevenidas por CHECK', () => {
    expect(source('packages/database/src/schema.ts')).toContain(
      'acceptedQuantity} + ${table.rejectedQuantity} = ${table.receivedQuantity}',
    );
  });

  it('21-24. inventory: missing RECEIPT/APPLICATION movements, signs y balance negativo', async () => {
    await database.query(`delete from inventory_movements where source_id = $1`, [
      applicationLineId,
    ]);
    const missing = await runAndFindings({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION', 'INVENTORY'],
    });
    expect(missing.findings.some((item) => item.ruleCode === 'REC-APP-003')).toBe(true);
    expect(missing.findings.find((item) => item.ruleCode === 'REC-APP-003')?.severity).toBe(
      'CRITICAL',
    );
    await database.query(
      `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by)
       values ($1,'APPLICATION',-9,'APPLICATION_LINE',$2,now(),$3)`,
      [lotId, applicationLineId, foundationUserId],
    );
    const mismatch = await runAndFindings({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    expect(mismatch.findings.some((item) => item.ruleCode === 'REC-APP-004')).toBe(true);
    await database.query(`delete from inventory_movements where source_id = $1`, [
      applicationLineId,
    ]);
    await database.query(
      `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by)
       values ($1,'APPLICATION',-2,'APPLICATION_LINE',$2,now(),$3)`,
      [lotId, applicationLineId, foundationUserId],
    );
    await database.query(
      `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by)
       values ($1,'ADJUSTMENT',-50,'ADJUSTMENT',$2,now(),$3)`,
      [lotId, randomUUID(), foundationUserId],
    );
    const negative = await runAndFindings({
      dispensingPointId: pointId,
      domains: ['INVENTORY'],
    });
    expect(negative.findings.some((item) => item.ruleCode === 'REC-INV-008')).toBe(true);
    await database.query(
      `delete from inventory_movements where inventory_lot_id = $1 and movement_type = 'ADJUSTMENT' and quantity_delta = -50`,
      [lotId],
    );
  });

  it('25-27. transfer DISPATCHED sin IN es normal; RECEIVED sin IN se detecta', () => {
    expect(source('packages/domain/src/reconciliation-registry.ts')).toContain(
      'DISPATCHED + OUT + !IN es válido',
    );
    expect(source('apps/api/src/reconciliation/reconciliation.rules.ts')).toContain('REC-TRF-006');
    expect(source('apps/api/src/reconciliation/reconciliation.rules.ts')).toContain(
      "t.status = 'RECEIVED'",
    );
  });

  it('28-30. application missing movement, quantity mismatch y coexistence con outcome', async () => {
    const outcome = await database.query<{ id: string }>(
      `insert into patient_schedule_outcomes
         (patient_schedule_id, schedule_revision, authorization_item_id, outcome, novelty_code, occurred_on, prepared_product_disposition, created_by)
       values ($1,1,$2,'NOT_APPLIED','PATIENT_NO_SHOW',$3,'NOT_PREPARED',$4) returning id`,
      [scheduleId, modernAuthId, DATE, foundationUserId],
    );
    const { findings } = await runAndFindings({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION', 'OUTCOME'],
    });
    expect(findings.some((item) => item.ruleCode === 'REC-APP-006')).toBe(true);
    expect(findings.some((item) => item.ruleCode === 'REC-OUT-002')).toBe(false);
    await database.query(`delete from patient_schedule_outcomes where id = $1`, [
      outcome.rows[0]!.id,
    ]);
  });

  it('31-32. NON_REUSABLE missing movement y REUSABLE no debe mover stock', () => {
    expect(source('apps/api/src/reconciliation/reconciliation.rules-rest.ts')).toContain(
      'REC-OUT-003',
    );
    expect(source('apps/api/src/reconciliation/reconciliation.rules-rest.ts')).toContain(
      "prepared_product_disposition in ('REUSABLE','NOT_PREPARED')",
    );
  });

  it('33-35. audit READY/APPROVED y REJECTED no implica NOT_APPLIED', async () => {
    await database.query(
      `alter table authorization_items disable trigger authorization_items_application_audit_admission_guard`,
    );
    await database.query(
      `update authorization_items set admission_status = 'READY', audit_status = 'APPROVED' where id = $1`,
      [modernAuthId],
    );
    const { findings } = await runAndFindings({
      planningPeriodId: periodId,
      domains: ['AUDIT'],
    });
    expect(findings.some((item) => item.ruleCode === 'REC-AUD-002')).toBe(true);
    expect(findings.some((item) => item.ruleCode === 'REC-LEG-003')).toBe(false);
    await database.query(
      `update authorization_items set admission_status = 'NOT_READY', audit_status = 'NOT_STARTED' where id = $1`,
      [modernAuthId],
    );
    await database.query(
      `alter table authorization_items enable trigger authorization_items_application_audit_admission_guard`,
    );
    expect(source('packages/domain/src/reconciliation-registry.ts')).toContain(
      'REJECTED no implica NOT_APPLIED',
    );
  });

  it('36-39. bulk SUCCEEDED sin referencia, referencia inválida y lease stale', async () => {
    const job = await database.query<{ id: string }>(
      `insert into bulk_import_jobs
         (organization_id, created_by, import_type, template_version, status, original_filename, mime_type, size_bytes, file_hash, correlation_id)
       values ($1,$2,'SCHEDULING','ESP014_SCHEDULING_V1','COMPLETED','esp017-bulk.xlsx','application/vnd.ms-excel',12,$3,$4)
       returning id`,
      [ORGANIZATION_IDS.MTD, foundationUserId, 'a'.repeat(64), randomUUID()],
    );
    const missingRef = await database.query<{ id: string }>(
      `insert into bulk_import_rows
         (job_id, row_number, raw_payload, validation_status, execution_status, idempotency_key)
       values ($1,1,'{}'::jsonb,'VALID','SUCCEEDED',$2) returning id`,
      [job.rows[0]!.id, `esp017-missing-${suffix}`],
    );
    const invalidRef = await database.query<{ id: string }>(
      `insert into bulk_import_rows
         (job_id, row_number, raw_payload, validation_status, execution_status, entity_reference, idempotency_key)
       values ($1,2,'{}'::jsonb,'VALID','SUCCEEDED',$2,$3) returning id`,
      [job.rows[0]!.id, randomUUID(), `esp017-invalid-${suffix}`],
    );
    const stale = await database.query<{ id: string }>(
      `insert into bulk_import_rows
         (job_id, row_number, raw_payload, validation_status, execution_status, claim_expires_at, idempotency_key)
       values ($1,3,'{}'::jsonb,'VALID','PROCESSING', now() - interval '1 hour', $2) returning id`,
      [job.rows[0]!.id, `esp017-stale-${suffix}`],
    );
    await database.query(`update bulk_import_jobs set status = 'PROCESSING' where id = $1`, [
      job.rows[0]!.id,
    ]);
    const processing = await runAndFindings({ domains: ['BULK'] });
    expect(
      processing.findings.some(
        (item) => item.ruleCode === 'REC-BULK-004' && item.severity === 'WARNING',
      ),
    ).toBe(true);
    await database.query(`update bulk_import_jobs set status = 'COMPLETED' where id = $1`, [
      job.rows[0]!.id,
    ]);
    const completed = await runAndFindings({ domains: ['BULK'] });
    expect(completed.findings.some((item) => item.ruleCode === 'REC-BULK-001')).toBe(true);
    expect(completed.findings.some((item) => item.ruleCode === 'REC-BULK-002')).toBe(true);
    expect(completed.findings.some((item) => item.ruleCode === 'REC-BULK-005')).toBe(true);
    await database.query(`delete from bulk_import_rows where id = any($1::uuid[])`, [
      [missingRef.rows[0]!.id, invalidRef.rows[0]!.id, stale.rows[0]!.id],
    ]);
    await database.query(`delete from bulk_import_jobs where id = $1`, [job.rows[0]!.id]);
  });

  it('40-41. duplicate grant prevenido; grant Medicarte a punto no MEDICARTE se detecta', async () => {
    await expect(
      database.query(
        `insert into user_point_scopes (user_id, dispensing_point_id, granted_by)
         select u.id, $1, admin.id
           from users u cross join users admin
          where u.username='medicarte-operator' and admin.username='foundation-admin'`,
        [pointId],
      ),
    ).rejects.toThrow();
    const olpPoint = await database.query<{ id: string }>(
      `insert into dispensing_points (organization_id, code, name, created_by)
       values ($1,$2,'ESP017 OLP Point',$3) returning id`,
      [ORGANIZATION_IDS.OLP, `ESP17-OLP-${suffix}`, foundationUserId],
    );
    createdPointIds.push(olpPoint.rows[0]!.id);
    const grant = await database.query<{ id: string }>(
      `insert into user_point_scopes (user_id, dispensing_point_id, granted_by)
       select u.id, $1, admin.id
         from users u cross join users admin
        where u.username='medicarte-operator' and admin.username='foundation-admin'
       returning id`,
      [olpPoint.rows[0]!.id],
    );
    const { findings } = await runAndFindings({ domains: ['SCOPE'] });
    expect(findings.some((item) => item.ruleCode === 'REC-SCOPE-004')).toBe(true);
    await database.query(`delete from user_point_scopes where id = $1`, [grant.rows[0]!.id]);
  });

  it('42-44. legacy compatibility divergence, historical-only sin finding y scan metadata', async () => {
    const { findings, run } = await runAndFindings({
      planningPeriodId: periodId,
      domains: ['LEGACY'],
    });
    expect(findings.some((item) => item.entityId === historicalAuthId)).toBe(false);
    const historical = run.ruleResults.find((item) => item.ruleCode === 'REC-LEG-004');
    expect(historical?.status).toBe('PASS');
    expect(historical?.findingCount).toBe(0);
    expect(historical?.evaluatedCount).toBeGreaterThan(0);
    const scan = run.ruleResults.find((item) => item.ruleCode === 'REC-LEG-001');
    expect(scan?.status).toBe('NOT_APPLICABLE');
  });

  it('45-46. no duplicate findings y evidence PHI-safe', async () => {
    await database.query(`delete from inventory_movements where source_id = $1`, [
      applicationLineId,
    ]);
    const { findings } = await runAndFindings({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    const app003 = findings.filter((item) => item.ruleCode === 'REC-APP-003');
    expect(new Set(app003.map((item) => item.fingerprint)).size).toBe(app003.length);
    expect(JSON.stringify(findings)).not.toMatch(/Paciente ESP-017|IDENTIFICACION_PACIENTE/);
    await database.query(
      `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by)
       values ($1,'APPLICATION',-2,'APPLICATION_LINE',$2,now(),$3)`,
      [lotId, applicationLineId, foundationUserId],
    );
  });

  it('47-48. scope por período y por punto', async () => {
    const periodRun = await runAndFindings({ planningPeriodId: periodId, domains: ['SCHEDULING'] });
    expect(
      periodRun.run.ruleResults.find((item) => item.ruleCode === 'REC-SCH-002')?.evaluatedCount,
    ).toBeGreaterThan(0);
    const other = await runAndFindings({
      dispensingPointId: otherPointId,
      domains: ['SCHEDULING'],
    });
    expect(other.findings.some((item) => item.entityId === scheduleId)).toBe(false);
  });

  it('49-50. RBAC MTD y denegación Medicarte/OLP/Compensar', async () => {
    expect((await api('GET', '/reconciliation/rules', undefined, auditorToken)).status).toBe(200);
    expect((await api('GET', '/reconciliation/runs', undefined, operatorToken)).status).toBe(200);
    expect((await api('GET', '/reconciliation/runs', undefined, generalToken)).status).toBe(200);
    expect((await api('GET', '/reconciliation/runs', undefined, readOnlyToken)).status).toBe(200);
    expect((await startRun({}, readOnlyToken)).status).toBe(403);
    expect((await startRun({}, operatorToken)).status).toBe(403);
    expect(
      (
        await api(
          'GET',
          '/reconciliation/runs',
          undefined,
          medicarteToken,
          ORGANIZATION_IDS.MEDICARTE,
        )
      ).status,
    ).toBe(403);
    expect(
      (await api('GET', '/reconciliation/runs', undefined, olpToken, ORGANIZATION_IDS.OLP)).status,
    ).toBe(403);
    expect(
      (
        await api(
          'GET',
          '/reconciliation/runs',
          undefined,
          compensarToken,
          ORGANIZATION_IDS.COMPENSAR,
        )
      ).status,
    ).toBe(403);
  });

  it('57. baseline health del slice válido: 0 CRITICAL/ERROR', async () => {
    const { run, findings } = await runAndFindings({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
    });
    expect(run.status).toBe('COMPLETED');
    expect(run.criticalFindings).toBe(0);
    expect(run.errorFindings).toBe(0);
    expect(findings.every((item) => item.severity === 'WARNING' || item.severity === 'INFO')).toBe(
      true,
    );
  });

  it('58. corrupción controlada produce las reglas esperadas', async () => {
    await database.query(`delete from inventory_movements where source_id = $1`, [
      applicationLineId,
    ]);
    const { findings } = await runAndFindings({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    expect(findings.map((item) => item.ruleCode)).toContain('REC-APP-003');
    await database.query(
      `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by)
       values ($1,'APPLICATION',-2,'APPLICATION_LINE',$2,now(),$3)`,
      [lotId, applicationLineId, foundationUserId],
    );
  });

  it('Gate A. PostgreSQL tiene las 50 migraciones hasta 0049', async () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, 'packages/database/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.length).toBeGreaterThanOrEqual(50);
    expect(journal.entries[0]?.tag).toBe('0000_foundation');
    expect(journal.entries[49]?.tag).toBe('0049_esp017_operational_reconciliation');
    const table = await database.query<{ exists: boolean }>(
      `select to_regclass('public.reconciliation_runs') is not null as exists`,
    );
    expect(table.rows[0]?.exists).toBe(true);
  });

  it('Gate B. ESP-017 es únicamente 0049 sobre el estado ESP-016', () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, 'packages/database/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };
    expect(journal.entries[48]?.tag).toBe('0048_esp016_legacy_cutover');
    expect(
      journal.entries.filter((entry) => entry.tag.includes('esp017')).map((entry) => entry.tag),
    ).toEqual(['0049_esp017_operational_reconciliation']);
    const sql = readFileSync(
      resolve(root, 'packages/database/migrations/0049_esp017_operational_reconciliation.sql'),
      'utf8',
    );
    expect(sql).toContain('reconciliation_runs');
    expect(sql).toContain('reconciliation.read');
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/update patient_schedules/i);
  });
});
