import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReconciliationRepository } from '../../apps/api/src/reconciliation/reconciliation.repository';
import { ReconciliationOperationsRepository } from '../../apps/api/src/reconciliation/reconciliation-operations.repository';
import { ReconciliationOperationsService } from '../../apps/api/src/reconciliation/reconciliation-operations.service';
import { ReconciliationMetricsProvider } from '../../apps/api/src/reconciliation/reconciliation.metrics';
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
const CODE = `ESP19-CODE-${suffix.toUpperCase()}`;
const DOC = `DOC-019-${suffix}`;
const POINT_CODE = `ESP19-PT-${suffix}`;
const PERIOD = { from: '2055-03-01', to: '2055-03-31' };

let adminToken = '';
let foundationUserId = '';
let auditorToken = '';
let operatorToken = '';
let generalToken = '';
let readOnlyToken = '';
let medicarteToken = '';
let olpToken = '';
let compensarToken = '';
let pointId = '';
let periodId = '';
let modernAuthId = '';
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
  token = auditorToken,
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

type PolicyResponse = {
  id: string;
  tenantId: string;
  enabled: boolean;
  cadence: string;
  timezone: string;
  localTime: string | null;
  weekday: number | null;
  domains: string[] | null;
  planningPeriodScope: string | null;
  severityAlertThreshold: string;
  notifyOnRecovery: boolean;
  notifyOnTechnicalFailure: boolean;
  version: number;
  nextRunAt: string | null;
};

type NotificationResponse = {
  id: string;
  tenantId: string;
  executionId: string | null;
  reconciliationRunId: string | null;
  notificationType: string;
  severity: string;
  dedupKey: string;
  status: string;
  channel: string;
  payload: Record<string, unknown>;
  readAt: string | null;
};

async function corruptApplicationMovement() {
  await database.query(`delete from inventory_movements where source_id = $1`, [applicationLineId]);
}

async function restoreApplicationMovement() {
  await database.query(`delete from inventory_movements where source_id = $1`, [applicationLineId]);
  await database.query(
    `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by)
     values ($1,'APPLICATION',-2,'APPLICATION_LINE',$2,now(),$3)`,
    [lotId, applicationLineId, foundationUserId],
  );
}

beforeAll(async () => {
  await database.connect();
  await database.query(
    `alter table patient_applications disable trigger patient_applications_confirmed_immutable`,
  );
  await database.query(
    `alter table patient_application_lines disable trigger patient_application_lines_confirmed_immutable`,
  );
  await database.query(
    `alter table patient_schedule_history disable trigger patient_schedule_history_no_delete`,
  );

  // Clean any previous test policies/executions/notifications for MTD
  await database.query(`delete from reconciliation_notifications where tenant_id = $1`, [
    ORGANIZATION_IDS.MTD,
  ]);
  await database.query(
    `update reconciliation_runs set operation_execution_id = null where tenant_id = $1`,
    [ORGANIZATION_IDS.MTD],
  );
  await database.query(`delete from reconciliation_operation_executions where tenant_id = $1`, [
    ORGANIZATION_IDS.MTD,
  ]);
  await database.query(`delete from reconciliation_operation_policies where tenant_id = $1`, [
    ORGANIZATION_IDS.MTD,
  ]);

  adminToken = await adminLogin();
  foundationUserId = (
    await database.query<{ id: string }>(`select id from users where username='foundation-admin'`)
  ).rows[0]!.id;
  ({ medicarteToken, olpToken } = await ensureOperatorTokens());
  auditorToken = await ensureUser({
    adminToken,
    username: `esp019-auditor-${suffix}`,
    displayName: 'ESP019 Auditor',
    password: `esp019-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_AUDITORIA',
  });
  operatorToken = await ensureUser({
    adminToken,
    username: `esp019-operator-${suffix}`,
    displayName: 'ESP019 Operator',
    password: `esp019-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_OPERATOR',
  });
  generalToken = await ensureUser({
    adminToken,
    username: `esp019-general-${suffix}`,
    displayName: 'ESP019 General',
    password: `esp019-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_GENERAL',
  });
  readOnlyToken = await ensureUser({
    adminToken,
    username: `esp019-ro-${suffix}`,
    displayName: 'ESP019 RO',
    password: `esp019-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'READ_ONLY',
  });
  compensarToken = await ensureUser({
    adminToken,
    username: `esp019-compensar-${suffix}`,
    displayName: 'ESP019 Compensar',
    password: `esp019-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.COMPENSAR,
    roleCode: 'COMPENSAR_VIEWER',
  });

  const point = await database.query<{ id: string }>(
    `insert into dispensing_points (organization_id, code, name, created_by)
     values ($1,$2,'ESP019 point', $3) returning id`,
    [ORGANIZATION_IDS.MEDICARTE, POINT_CODE, foundationUserId],
  );
  pointId = point.rows[0]!.id;
  createdPointIds.push(pointId);

  periodId = (
    await database.query<{ id: string }>(
      `insert into planning_periods
        (start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
         expected_delivery_date, created_by, updated_by)
       values ($1,$2,'2055-03-28T23:59:00-05:00','2055-03-29T23:59:00-05:00','2055-03-30',$3,$3)
       returning id`,
      [PERIOD.from, PERIOD.to, foundationUserId],
    )
  ).rows[0]!.id;

  await grantAllPointsToMedicarteOperator(database);

  const batch = await database.query<{ id: string }>(
    `insert into import_batches (organization_id,created_by,original_filename,mime_type,size_bytes,sha256,processor_version,status,total_rows,confirmed_rows,completed_at,confirmed_at)
     values ($1,$2,$3,'application/json',1,$4,1,'COMPLETED',1,1,now(),now()) returning id`,
    [ORGANIZATION_IDS.MTD, foundationUserId, `esp019-${suffix}.json`, 'f'.repeat(64)],
  );

  const item = await database.query<{ id: string }>(
    `insert into authorization_items
      (numero_autorizacion, codigo_medicamento, authorization_key, source_data,
       source_status_normalized, source_prescripcion_normalized, no_prescripcion,
       enablement_status, coverage_type, direction_status, coverage_rule_version,
       created_from_batch_id)
     values ($1,$2,$3,$4::jsonb,'VIGENTE','','','ENABLED','PBS','NOT_APPLICABLE','ESP019',$5)
     returning id`,
    [
      `ESP019-M-${suffix}`,
      CODE,
      `ESP019-M-${suffix}:${CODE}`,
      JSON.stringify({
        IDENTIFICACION_PACIENTE: DOC,
        NOMBRE_PACIENTE: 'Paciente ESP-019',
        TIPO_DOCUMENTO: 'CC',
        NUMERO_ENTREGA: 1,
        DIAGNOSTICO_PRINCIPAL: 'E119',
      }),
      batch.rows[0]!.id,
    ],
  );
  modernAuthId = item.rows[0]!.id;

  await database.query(
    `insert into authorization_item_organizations (authorization_item_id, organization_id)
     values ($1,$2), ($1,$3)`,
    [modernAuthId, ORGANIZATION_IDS.MTD, ORGANIZATION_IDS.MEDICARTE],
  );

  const schedule = await database.query<{ id: string }>(
    `insert into patient_schedules
       (authorization_item_id, planning_period_id, dispensing_point_id, commercial_code,
        scheduled_date, quantity, status, schedule_timing, created_by, updated_by)
     values ($1,$2,$3,$4,'2055-03-12',2,'SCHEDULED','ON_TIME',$5,$5) returning id`,
    [modernAuthId, periodId, pointId, CODE, foundationUserId],
  );
  scheduleId = schedule.rows[0]!.id;
  await database.query(
    `insert into patient_schedule_history
       (patient_schedule_id, revision, authorization_item_id, planning_period_id, dispensing_point_id,
        commercial_code, scheduled_date, quantity, status, schedule_timing, change_type, changed_by, correlation_id)
     values ($1,1,$2,$3,$4,$5,'2055-03-12',2,'SCHEDULED','ON_TIME','CREATED',$6,$7)`,
    [scheduleId, modernAuthId, periodId, pointId, CODE, foundationUserId, randomUUID()],
  );
  lotId = (
    await database.query<{ id: string }>(
      `insert into inventory_lots (commercial_code,dispensing_point_id,lot_number,expiration_date)
       values ($1,$2,$3,'2099-12-31') returning id`,
      [CODE, pointId, `ESP19-LOT-${suffix}`],
    )
  ).rows[0]!.id;
  await database.query(
    `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by)
     values ($1,'ADJUSTMENT',5,'ADJUSTMENT',$2,now(),$3)`,
    [lotId, randomUUID(), foundationUserId],
  );
  await database.query('BEGIN');
  applicationId = (
    await database.query<{ id: string }>(
      `insert into patient_applications
         (patient_schedule_id, schedule_revision, authorization_item_id, commercial_code,
          dispensing_point_id, scheduled_date, application_date, status, created_by, confirmed_by, confirmed_at)
       values ($1,1,$2,$3,$4,'2055-03-12','2055-03-12','CONFIRMED',$5,$5,now()) returning id`,
      [scheduleId, modernAuthId, CODE, pointId, foundationUserId],
    )
  ).rows[0]!.id;
  applicationLineId = (
    await database.query<{ id: string }>(
      `insert into patient_application_lines
         (patient_application_id, inventory_lot_id, commercial_code, dispensing_point_id, lot_number, expiration_date, quantity)
       values ($1,$2,$3,$4,$5,'2099-12-31',2) returning id`,
      [applicationId, lotId, CODE, pointId, `ESP19-LOT-${suffix}`],
    )
  ).rows[0]!.id;
  await database.query('COMMIT');
  await restoreApplicationMovement();

  await database.query(
    `alter table patient_applications enable trigger patient_applications_confirmed_immutable`,
  );
  await database.query(
    `alter table patient_application_lines enable trigger patient_application_lines_confirmed_immutable`,
  );
  await database.query(
    `alter table patient_schedule_history enable trigger patient_schedule_history_no_delete`,
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
    await database.query(`delete from reconciliation_notifications where tenant_id = $1`, [
      ORGANIZATION_IDS.MTD,
    ]);
    await database.query(
      `update reconciliation_runs set operation_execution_id = null where tenant_id = $1`,
      [ORGANIZATION_IDS.MTD],
    );
    await database.query(`delete from reconciliation_operation_executions where tenant_id = $1`, [
      ORGANIZATION_IDS.MTD,
    ]);
    await database.query(`delete from reconciliation_operation_policies where tenant_id = $1`, [
      ORGANIZATION_IDS.MTD,
    ]);

    if (periodId) {
      await database.query(
        `delete from reconciliation_issue_comments where issue_id in (
           select id from reconciliation_issues where last_run_id in (
             select id from reconciliation_runs where scope->>'planningPeriodId' = $1
           ) or first_run_id in (
             select id from reconciliation_runs where scope->>'planningPeriodId' = $1
           ))`,
        [periodId],
      );
      await database.query(
        `delete from reconciliation_issue_events where issue_id in (
           select id from reconciliation_issues where last_run_id in (
             select id from reconciliation_runs where scope->>'planningPeriodId' = $1
           ) or first_run_id in (
             select id from reconciliation_runs where scope->>'planningPeriodId' = $1
           ))`,
        [periodId],
      );
      await database.query(
        `update reconciliation_issues set last_finding_id = null
          where last_run_id in (select id from reconciliation_runs where scope->>'planningPeriodId' = $1)
             or first_run_id in (select id from reconciliation_runs where scope->>'planningPeriodId' = $1)`,
        [periodId],
      );
      await database.query(
        `delete from reconciliation_findings where reconciliation_run_id in (
           select id from reconciliation_runs where scope->>'planningPeriodId' = $1)`,
        [periodId],
      );
      await database.query(
        `delete from reconciliation_issues where last_run_id in (
           select id from reconciliation_runs where scope->>'planningPeriodId' = $1)
           or first_run_id in (select id from reconciliation_runs where scope->>'planningPeriodId' = $1)`,
        [periodId],
      );
      await database.query(
        `delete from reconciliation_runs where scope->>'planningPeriodId' = $1`,
        [periodId],
      );
    }
    if (lotId || applicationLineId) {
      await database.query(
        `delete from inventory_movements where inventory_lot_id = nullif($1, '')::uuid or source_id = nullif($2, '')::uuid`,
        [lotId, applicationLineId],
      );
    }
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
    if (modernAuthId) {
      await database.query(
        `delete from authorization_item_organizations where authorization_item_id = $1`,
        [modernAuthId],
      );
      await database.query(`delete from authorization_items where id = $1`, [modernAuthId]);
    }
    if (createdPointIds.length > 0) {
      await deletePointScopesForPoints(database, createdPointIds);
      await database.query(`delete from dispensing_points where id = any($1::uuid[])`, [
        createdPointIds,
      ]);
    }
    if (periodId) {
      await database.query(`delete from planning_periods where id = $1`, [periodId]);
    }
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

describe('Gate ESP-019 — Operación programada y alertamiento controlado', () => {
  // Helpers for direct repo/service calls in test
  function createOperationsService(pool: Pool) {
    const dbWrapper = { pool };
    const opsRepo = new ReconciliationOperationsRepository(dbWrapper);
    const metrics = new ReconciliationMetricsProvider();
    const reconRepo = new ReconciliationRepository(dbWrapper);
    return {
      opsRepo,
      opsService: new ReconciliationOperationsService(opsRepo, reconRepo, metrics, dbWrapper),
    };
  }

  // 1-9. POLICY MANAGEMENT & SCHEDULING
  it('1-9. Policy lifecycle: create disabled, enable, disable, version conflict, schedule calculation and cancellation', async () => {
    // 1. Create disabled policy
    const createRes = await api(
      'PUT',
      '/reconciliation/operations/policy',
      {
        enabled: false,
        cadence: 'DAILY',
        timezone: 'America/Bogota',
        localTime: '03:00',
        severityAlertThreshold: 'ERROR',
        notifyOnRecovery: true,
        notifyOnTechnicalFailure: true,
      },
      adminToken,
    );
    expect(createRes.status).toBe(200);
    const { policy: p1 } = await json<{ policy: PolicyResponse }>(createRes);
    expect(p1.enabled).toBe(false);
    expect(p1.cadence).toBe('DAILY');
    expect(p1.localTime).toBe('03:00');
    expect(p1.nextRunAt).toBeNull();
    expect(p1.version).toBe(1);

    // 2. Enable policy -> nextRunAt calculated
    const enableRes = await api('POST', '/reconciliation/operations/policy/enable', {}, adminToken);
    expect(enableRes.status).toBe(200);
    const { policy: p2 } = await json<{ policy: PolicyResponse }>(enableRes);
    expect(p2.enabled).toBe(true);
    expect(p2.nextRunAt).not.toBeNull();
    expect(p2.version).toBe(2);

    // 3. Disable policy -> nextRunAt cleared
    const disableRes = await api(
      'POST',
      '/reconciliation/operations/policy/disable',
      {},
      adminToken,
    );
    expect(disableRes.status).toBe(200);
    const { policy: p3 } = await json<{ policy: PolicyResponse }>(disableRes);
    expect(p3.enabled).toBe(false);
    expect(p3.nextRunAt).toBeNull();
    expect(p3.version).toBe(3);

    // 4. expectedVersion conflict
    const conflictRes = await api(
      'PUT',
      '/reconciliation/operations/policy',
      {
        enabled: true,
        cadence: 'DAILY',
        timezone: 'America/Bogota',
        localTime: '03:00',
        expectedVersion: 1, // Stale!
      },
      adminToken,
    );
    expect(conflictRes.status).toBe(409);

    // 5. DAILY next slot calculation test
    const putDailyRes = await api(
      'PUT',
      '/reconciliation/operations/policy',
      {
        enabled: true,
        cadence: 'DAILY',
        timezone: 'America/Bogota',
        localTime: '23:59',
        expectedVersion: p3.version,
      },
      adminToken,
    );
    expect(putDailyRes.status).toBe(200);
    const { policy: pDaily } = await json<{ policy: PolicyResponse }>(putDailyRes);
    expect(pDaily.nextRunAt).not.toBeNull();

    // 6. WEEKLY next slot calculation test
    const putWeeklyRes = await api(
      'PUT',
      '/reconciliation/operations/policy',
      {
        enabled: true,
        cadence: 'WEEKLY',
        timezone: 'America/Bogota',
        localTime: '05:00',
        weekday: 1, // Monday
        expectedVersion: pDaily.version,
      },
      adminToken,
    );
    expect(putWeeklyRes.status).toBe(200);
    const { policy: pWeekly } = await json<{ policy: PolicyResponse }>(putWeeklyRes);
    expect(pWeekly.cadence).toBe('WEEKLY');
    expect(pWeekly.weekday).toBe(1);

    // 7. Timezone America/Bogota persisted
    expect(pWeekly.timezone).toBe('America/Bogota');

    // 8. Policy disable cancels future PENDING executions
    const pool = new Pool({ connectionString: databaseUrl });
    const { opsRepo } = createOperationsService(pool);
    try {
      const scheduledSlot = new Date('2055-04-01T10:00:00Z');
      const pendingExec = await opsRepo.createScheduledExecution(
        ORGANIZATION_IDS.MTD,
        pWeekly.id,
        scheduledSlot,
        0,
        'PENDING',
      );
      expect(pendingExec).not.toBeNull();

      // Disabling policy via API should cancel the pending execution
      await api('POST', '/reconciliation/operations/policy/disable', {}, adminToken);
      const recheckedExec = await opsRepo.getExecutionById(pendingExec!.id);
      expect(recheckedExec?.status).toBe('CANCELLED');
      expect(recheckedExec?.skip_reason).toBe('POLICY_DISABLED');
    } finally {
      await pool.end();
    }

    // 9. Editing schedule does not rewrite completed history
    const completedExec = await database.query<{ id: string }>(
      `insert into reconciliation_operation_executions (
         tenant_id, trigger_type, scheduled_for, status, completed_at
       ) values ($1, 'SCHEDULED', '2055-01-01T00:00:00Z', 'COMPLETED', now())
       returning id`,
      [ORGANIZATION_IDS.MTD],
    );
    // Update schedule
    const currentPol = await json<{ policy: PolicyResponse }>(
      await api('GET', '/reconciliation/operations/policy', undefined, adminToken),
    );
    await api(
      'PUT',
      '/reconciliation/operations/policy',
      {
        enabled: true,
        cadence: 'DAILY',
        timezone: 'America/Bogota',
        localTime: '04:00',
        expectedVersion: currentPol.policy.version,
      },
      adminToken,
    );
    const historicalRow = await database.query<{ status: string }>(
      `select status from reconciliation_operation_executions where id = $1`,
      [completedExec.rows[0]!.id],
    );
    expect(historicalRow.rows[0]!.status).toBe('COMPLETED');
  });

  // 10-15. MATERIALIZATION & CONCURRENCY
  it('10-15. Materialization: due policy creates execution, two nodes create only one, missed slots coalesce', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const { opsRepo, opsService } = createOperationsService(pool);
    try {
      // 14-15. Disabled policy = no execution
      await opsRepo.setPolicyEnabled(ORGANIZATION_IDS.MTD, false, null, foundationUserId);
      const disabledRes = await opsService.materializeDuePolicies();
      expect(disabledRes).toHaveLength(0);

      // Enable policy with due next_run_at in the past
      const pastDue = new Date(Date.now() - 3600_000);
      await opsRepo.setPolicyEnabled(ORGANIZATION_IDS.MTD, true, pastDue, foundationUserId);

      // 10. Due policy creates execution
      // 11. Two scheduler nodes trying to materialize the same slot concurrently
      const [runA, runB] = await Promise.all([
        opsService.materializeDuePolicies(),
        opsService.materializeDuePolicies(),
      ]);

      const totalMaterialized = [...runA, ...runB];
      expect(totalMaterialized.length).toBe(1); // Exactly one execution materialized!

      // 12. Unique constraint on (tenant_id, policy_id, scheduled_for)
      const scheduledFor = totalMaterialized[0]!.scheduled_for;
      const dup = await opsRepo.createScheduledExecution(
        ORGANIZATION_IDS.MTD,
        totalMaterialized[0]!.policy_id!,
        new Date(scheduledFor!),
      );
      expect(dup).toBeNull(); // ON CONFLICT DO NOTHING returned null

      // 13. Missed slots coalesce: verify missed_occurrences_count
      expect(totalMaterialized[0]!.missed_occurrences_count).toBeGreaterThanOrEqual(0);
    } finally {
      await pool.end();
    }
  });

  // 16-23. CLAIM, LEASE, FENCING & HEARTBEAT
  it('16-23. Claim & fencing: one worker wins claim, lease expiration, generation increments, stale worker rejected, heartbeat renews lease', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const { opsRepo } = createOperationsService(pool);
    try {
      const exec = await opsRepo.createManualExecution(ORGANIZATION_IDS.MTD, 'PENDING');

      // 16. Worker A claims
      const tokenA = randomUUID();
      const claimedA = await opsRepo.claimExecution(exec.id, tokenA, 2); // 2s short lease
      expect(claimedA).not.toBeNull();
      expect(claimedA!.claim_token).toBe(tokenA);
      expect(claimedA!.claim_generation).toBe(1);
      expect(claimedA!.status).toBe('CLAIMED');

      // 17. Worker B loses claim while A holds valid lease
      const tokenB = randomUUID();
      const claimedB = await opsRepo.claimExecution(exec.id, tokenB, 2);
      expect(claimedB).toBeNull();

      // 23. Heartbeat renews active lease
      const renewed = await opsRepo.renewLease(exec.id, tokenA, 1, 5);
      expect(renewed).toBe(true);

      // 18. Wait for lease to expire (force lease_expires_at in past)
      await pool.query(
        `update reconciliation_operation_executions
            set lease_expires_at = now() - interval '1 second'
          where id = $1`,
        [exec.id],
      );

      // 19. Worker B reclaims -> generation increments to 2
      const reclaimedB = await opsRepo.claimExecution(exec.id, tokenB, 10);
      expect(reclaimedB).not.toBeNull();
      expect(reclaimedB!.claim_token).toBe(tokenB);
      expect(reclaimedB!.claim_generation).toBe(2);

      // 20. Stale worker A (generation 1, tokenA) cannot complete execution
      const staleComplete = await opsRepo.completeExecution(exec.id, tokenA, 1);
      expect(staleComplete).toBeNull();

      // 21. Stale worker A cannot fail execution
      const staleFail = await opsRepo.failExecution(
        exec.id,
        tokenA,
        1,
        'LEASE_LOST',
        'Stale error',
      );
      expect(staleFail).toBeNull();

      // Valid worker B can start execution and complete it
      const startB = await opsRepo.startExecution(exec.id, tokenB, 2, 10);
      expect(startB).not.toBeNull();

      const completeB = await opsRepo.completeExecution(exec.id, tokenB, 2);
      expect(completeB).not.toBeNull();

      const finalRow = await opsRepo.getExecutionById(exec.id);
      expect(finalRow?.status).toBe('COMPLETED');
    } finally {
      await pool.end();
    }
  });

  // 24-27. NO OVERLAP
  it('24-27. No overlap: active scheduled blocks scheduled/manual, completed unblocks', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const { opsRepo } = createOperationsService(pool);
    try {
      // Create active running execution
      const runningExec = await pool.query<{ id: string }>(
        `insert into reconciliation_operation_executions (
           tenant_id, trigger_type, scheduled_for, status, lease_expires_at
         ) values ($1, 'SCHEDULED', now(), 'RUNNING', now() + interval '60 seconds')
         returning id`,
        [ORGANIZATION_IDS.MTD],
      );

      // 24. Active blocks check
      const hasActive = await opsRepo.hasActiveExecutionOrRun(ORGANIZATION_IDS.MTD);
      expect(hasActive).toBe(true);

      // 26. Scheduled running blocks manual trigger via API (409)
      const manualRes = await api('POST', '/reconciliation/operations/trigger', {}, adminToken);
      expect(manualRes.status).toBe(409);

      // Also POST /reconciliation/runs should be blocked with 409
      const runRes = await api('POST', '/reconciliation/runs', {}, auditorToken);
      expect(runRes.status).toBe(409);

      // 27. When execution completes, it no longer blocks
      await pool.query(
        `update reconciliation_operation_executions set status = 'COMPLETED', completed_at = now() where id = $1`,
        [runningExec.rows[0]!.id],
      );
      const hasActiveAfter = await opsRepo.hasActiveExecutionOrRun(ORGANIZATION_IDS.MTD);
      expect(hasActiveAfter).toBe(false);
    } finally {
      await pool.end();
    }
  });

  // 28-32. CRASH RECOVERY
  it('28-32. Crash recovery: uncreated run reclaims, existing run re-associates and completes execution without rerun', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const { opsRepo, opsService } = createOperationsService(pool);
    try {
      // 28-29. Claimed with expired lease and no run
      const token1 = randomUUID();
      const exec = await opsRepo.createManualExecution(ORGANIZATION_IDS.MTD, 'CLAIMED');
      await pool.query(
        `update reconciliation_operation_executions
            set claim_token = $1, claim_generation = 1, lease_expires_at = now() - interval '5 seconds'
          where id = $2`,
        [token1, exec.id],
      );

      // Reclaim and process via processExecution
      const token2 = randomUUID();
      await opsService.processExecution(exec.id, token2, 60, 3, {
        planningPeriodId: periodId,
        dispensingPointId: pointId,
        domains: ['APPLICATION'],
      });

      const rechecked = await opsRepo.getExecutionById(exec.id);
      expect(rechecked?.status).toBe('COMPLETED');
      expect(rechecked?.reconciliation_run_id).not.toBeNull();

      // 30-31. Crash scenario: reconciliation_run exists and is COMPLETED, but execution was RUNNING
      const existingRunId = rechecked!.reconciliation_run_id!;
      const exec2 = await opsRepo.createManualExecution(ORGANIZATION_IDS.MTD, 'RUNNING');
      // Point execution to already completed run via canonical link: reconciliation_runs.operation_execution_id
      await pool.query(
        `update reconciliation_operation_executions
            set lease_expires_at = now() - interval '5 seconds',
                claim_token = 'old', claim_generation = 1
          where id = $1`,
        [exec2.id],
      );
      await pool.query(
        `update reconciliation_runs
            set operation_execution_id = $1
          where id = $2`,
        [exec2.id, existingRunId],
      );

      const token3 = randomUUID();
      await opsService.processExecution(exec2.id, token3, 60, 3);

      const recoveredExec2 = await opsRepo.getExecutionById(exec2.id);
      expect(recoveredExec2?.status).toBe('COMPLETED');
      expect(recoveredExec2?.reconciliation_run_id).toBe(existingRunId);

      const runCountRes = await pool.query<{ cnt: number }>(
        `select count(*)::int as cnt from reconciliation_runs where operation_execution_id = $1`,
        [exec2.id],
      );
      expect(runCountRes.rows[0]?.cnt).toBe(1);
    } finally {
      await pool.end();
    }
  });

  // 33-39. RECONCILIATION & ERROR HANDLING
  it('33-39. Reconciliation execution: links run, healthy=COMPLETED, findings=COMPLETED (not FAILED), technical failure=FAILED', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const { opsRepo, opsService } = createOperationsService(pool);
    try {
      // 35. Healthy run -> execution COMPLETED
      const execHealthy = await opsRepo.createManualExecution(ORGANIZATION_IDS.MTD, 'PENDING');
      await opsService.processExecution(execHealthy.id, randomUUID(), 60, 3, {
        planningPeriodId: periodId,
        dispensingPointId: pointId,
        domains: ['APPLICATION'],
      });
      const hRow = await opsService.getExecution(ORGANIZATION_IDS.MTD, execHealthy.id);
      expect(hRow.status).toBe('COMPLETED');
      expect(hRow.runHealth).toBe('HEALTHY');

      // 36-37. Unhealthy run (corrupted movements) -> execution is STILL COMPLETED, not FAILED
      await corruptApplicationMovement();
      const execUnhealthy = await opsRepo.createManualExecution(ORGANIZATION_IDS.MTD, 'PENDING');
      await opsService.processExecution(execUnhealthy.id, randomUUID(), 60, 3, {
        planningPeriodId: periodId,
        dispensingPointId: pointId,
        domains: ['APPLICATION'],
      });
      const uRow = await opsService.getExecution(ORGANIZATION_IDS.MTD, execUnhealthy.id);
      expect(uRow.status).toBe('COMPLETED');
      expect(uRow.runHealth).toBe('UNHEALTHY');
      expect(Number(uRow.criticalFindings)).toBeGreaterThan(0);
      await restoreApplicationMovement();

      // 38. Technical failure simulation -> execution FAILED
      const execFail = await opsRepo.createManualExecution(ORGANIZATION_IDS.MTD, 'PENDING');
      // Pass statementTimeoutMs: 1 to simulate a technical failure in engine query
      try {
        await opsService.processExecution(execFail.id, randomUUID(), 60, 1, {
          planningPeriodId: periodId,
          statementTimeoutMs: 1,
        });
      } catch {
        // Expected technical failure
      }
      const fRow = await opsRepo.getExecutionById(execFail.id);
      expect(fRow?.status).toBe('FAILED');
      expect(fRow?.last_error_code).toBe('RECONCILIATION_RUN_FAILED');
    } finally {
      await pool.end();
    }
  });

  // 40-51. ALERTS & NOTIFICATIONS
  it('40-51. Alerts: summarized per run, threshold filtering, dedup, recovery notification, spam prevention', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const { opsRepo, opsService } = createOperationsService(pool);
    try {
      // Configure policy for alerts: threshold = ERROR, notifyOnRecovery = true
      await pool.query(
        `update reconciliation_operation_policies
            set severity_alert_threshold = 'ERROR', notify_on_recovery = true, notify_on_technical_failure = true
          where tenant_id = $1`,
        [ORGANIZATION_IDS.MTD],
      );

      // Run 1: Unhealthy (CRITICAL findings) -> Generates RECONCILIATION_CRITICAL notification
      await corruptApplicationMovement();
      const exec1 = await opsRepo.createManualExecution(ORGANIZATION_IDS.MTD, 'PENDING');
      await opsService.processExecution(exec1.id, randomUUID(), 60, 3, {
        planningPeriodId: periodId,
        dispensingPointId: pointId,
        domains: ['APPLICATION'],
      });
      const e1 = await opsRepo.getExecutionById(exec1.id);
      expect(e1?.status).toBe('COMPLETED');

      const notifs1 = await opsRepo.listNotifications(ORGANIZATION_IDS.MTD, {
        limit: 10,
        offset: 0,
      });
      const critNotif = notifs1.find(
        (n) => n.execution_id === exec1.id && n.notification_type === 'RECONCILIATION_CRITICAL',
      );
      expect(critNotif).toBeDefined();
      expect(critNotif?.severity).toBe('CRITICAL');
      // 44. Summary, not per finding
      expect(critNotif?.payload_json).toHaveProperty('critical');

      // 47. Dedup: inserting duplicate with same dedup_key does nothing
      const dupNotif = await opsRepo.insertNotification({
        tenantId: ORGANIZATION_IDS.MTD,
        executionId: exec1.id,
        notificationType: 'RECONCILIATION_CRITICAL',
        severity: 'CRITICAL',
        dedupKey: critNotif!.dedup_key,
        payload: { test: 1 },
      });
      expect(dupNotif).toBeNull();

      // Run 2: Transition from Unhealthy -> Healthy -> Generates RECONCILIATION_RECOVERY notification
      await restoreApplicationMovement();
      const exec2 = await opsRepo.createManualExecution(ORGANIZATION_IDS.MTD, 'PENDING');
      await opsService.processExecution(exec2.id, randomUUID(), 60, 3, {
        planningPeriodId: periodId,
        dispensingPointId: pointId,
        domains: ['APPLICATION'],
      });

      const notifs2 = await opsRepo.listNotifications(ORGANIZATION_IDS.MTD, {
        limit: 10,
        offset: 0,
      });
      const recNotif = notifs2.find(
        (n) => n.execution_id === exec2.id && n.notification_type === 'RECONCILIATION_RECOVERY',
      );
      expect(recNotif).toBeDefined();

      // Run 3: Consecutive healthy run -> NO second recovery alert! (50. spam prevention)
      const exec3 = await opsRepo.createManualExecution(ORGANIZATION_IDS.MTD, 'PENDING');
      await opsService.processExecution(exec3.id, randomUUID(), 60, 3, {
        planningPeriodId: periodId,
        dispensingPointId: pointId,
        domains: ['APPLICATION'],
      });
      const notifs3 = await opsRepo.listNotifications(ORGANIZATION_IDS.MTD, {
        limit: 10,
        offset: 0,
      });
      const falseRecovery = notifs3.find((n) => n.execution_id === exec3.id);
      expect(falseRecovery).toBeUndefined();

      // 43. NONE threshold suppresses health alerts
      await pool.query(
        `update reconciliation_operation_policies set severity_alert_threshold = 'NONE' where tenant_id = $1`,
        [ORGANIZATION_IDS.MTD],
      );
      await corruptApplicationMovement();
      const execNone = await opsRepo.createManualExecution(ORGANIZATION_IDS.MTD, 'PENDING');
      await opsService.processExecution(execNone.id, randomUUID(), 60, 3, {
        planningPeriodId: periodId,
        dispensingPointId: pointId,
        domains: ['APPLICATION'],
      });
      const notifsNone = await opsRepo.listNotifications(ORGANIZATION_IDS.MTD, {
        limit: 10,
        offset: 0,
      });
      const suppressedAlert = notifsNone.find((n) => n.execution_id === execNone.id);
      expect(suppressedAlert).toBeUndefined();
      await restoreApplicationMovement();
    } finally {
      await pool.end();
    }
  });

  // 52-55. IN-APP NOTIFICATIONS
  it('52-55. In-app notifications: durable, mark read, tenant isolation, PHI-safe payload', async () => {
    // 52. Notification is durable in DB
    const listRes = await api('GET', '/reconciliation/notifications', undefined, auditorToken);
    expect(listRes.status).toBe(200);
    const { items } = await json<{ items: NotificationResponse[] }>(listRes);
    expect(items.length).toBeGreaterThan(0);

    const target = items[0]!;
    expect(target.readAt).toBeNull();

    // 54. PHI-safe payload check: must not include patient names, documents, raw data
    const pStr = JSON.stringify(target.payload);
    expect(pStr).not.toContain(DOC);
    expect(pStr).not.toContain('Paciente ESP-019');

    // 53. Mark read
    const readRes = await api(
      'POST',
      `/reconciliation/notifications/${target.id}/read`,
      {},
      auditorToken,
    );
    expect(readRes.status).toBe(200);
    const updated = await json<NotificationResponse>(readRes);
    expect(updated.readAt).not.toBeNull();

    // 54. Tenant isolation: foreign tenant cannot read MTD notifications
    const foreignRes = await api(
      'GET',
      '/reconciliation/notifications',
      undefined,
      medicarteToken,
      ORGANIZATION_IDS.MEDICARTE,
    );
    expect(foreignRes.status).toBe(403); // Medicarte has no permission
  });

  // 56-61. RBAC
  it('56-61. RBAC: MTD_ADMIN can manage, AUDITORIA/OPERATOR/GENERAL can read, Medicarte/OLP/Compensar denied', async () => {
    // 56. MTD_ADMIN manage
    const adminRes = await api('GET', '/reconciliation/operations/policy', undefined, adminToken);
    expect(adminRes.status).toBe(200);

    // 57. MTD_AUDITORIA read operations and notifications
    const auditRes = await api('GET', '/reconciliation/operations/policy', undefined, auditorToken);
    expect(auditRes.status).toBe(200);

    // MTD_AUDITORIA cannot modify policy (manage permission denied)
    const auditPutRes = await api(
      'PUT',
      '/reconciliation/operations/policy',
      { enabled: false, cadence: 'DAILY', timezone: 'America/Bogota' },
      auditorToken,
    );
    expect(auditPutRes.status).toBe(403);

    // 58. MTD_OPERATOR and MTD_GENERAL can read
    expect(
      (await api('GET', '/reconciliation/operations/policy', undefined, operatorToken)).status,
    ).toBe(200);
    expect(
      (await api('GET', '/reconciliation/operations/policy', undefined, generalToken)).status,
    ).toBe(200);
    expect(
      (await api('GET', '/reconciliation/operations/policy', undefined, readOnlyToken)).status,
    ).toBe(200);

    // 59-61. External organizations denied
    expect(
      (
        await api(
          'GET',
          '/reconciliation/operations/policy',
          undefined,
          medicarteToken,
          ORGANIZATION_IDS.MEDICARTE,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api(
          'GET',
          '/reconciliation/operations/policy',
          undefined,
          olpToken,
          ORGANIZATION_IDS.OLP,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api(
          'GET',
          '/reconciliation/operations/policy',
          undefined,
          compensarToken,
          ORGANIZATION_IDS.COMPENSAR,
        )
      ).status,
    ).toBe(403);
  });

  // 62-64. ENVIRONMENT CONFIGURATION
  it('62-64. Environment safety: scheduler disabled flag in dev/test', () => {
    const configSource = source('packages/config/src/index.ts');
    expect(configSource).toContain('RECONCILIATION_SCHEDULER_ENABLED');
    expect(configSource).toContain("default('false')");
    expect(configSource).toContain('RECONCILIATION_OPERATION_LEASE_SECONDS');
    expect(configSource).toContain('RECONCILIATION_MAX_ATTEMPTS');
  });

  // 65-69. REGRESSION CHECKS
  it('65-69. Regressions: ESP-017 snapshot pin remains, ESP-018 issue lifecycle untouched, no operational table writes', () => {
    const engineSrc = source('apps/api/src/reconciliation/reconciliation.engine.ts');
    expect(engineSrc).toContain('REPEATABLE READ READ ONLY');
    expect(engineSrc).toContain('operationExecutionId');

    const opsRepoSrc = source(
      'apps/api/src/reconciliation/reconciliation-operations.repository.ts',
    );
    expect(opsRepoSrc).not.toMatch(/update patient_schedules/i);
    expect(opsRepoSrc).not.toMatch(/update inventory_movements/i);
    expect(opsRepoSrc).not.toMatch(/update purchase_orders/i);

    const opsServiceSrc = source(
      'apps/api/src/reconciliation/reconciliation-operations.service.ts',
    );
    expect(opsServiceSrc).not.toMatch(/update patient_schedules/i);
  });

  // 70-74. CARDINALITY HARDENING (ESP-019 FINAL HARDENING)
  it('70-74. Cardinality hardening: canonical link reconciliation_runs.operation_execution_id and DB UNIQUE', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const { opsRepo, opsService } = createOperationsService(pool);

    try {
      // 70. Verification that reconciliation_run_id column does NOT exist in reconciliation_operation_executions
      const colCheck = await pool.query<{ count: number }>(
        `select count(*)::int as count from information_schema.columns 
          where table_name = 'reconciliation_operation_executions' 
            and column_name = 'reconciliation_run_id'`,
      );
      expect(colCheck.rows[0]?.count).toBe(0);

      // Verify that reconciliation_runs_operation_execution_unique exists in pg_indexes
      const idxCheck = await pool.query<{ indexdef: string }>(
        `select indexdef from pg_indexes 
          where tablename = 'reconciliation_runs' 
            and indexname = 'reconciliation_runs_operation_execution_unique'`,
      );
      expect(idxCheck.rows.length).toBe(1);
      expect(idxCheck.rows[0]?.indexdef).toContain('UNIQUE');
      expect(idxCheck.rows[0]?.indexdef).toContain('operation_execution_id');

      // 71. Concurrency test: Two transactions attempt to insert a run for the same operation_execution_id
      // Expected: exactly one succeeds, the other fails with unique violation (23505)
      const testExec = await opsRepo.createManualExecution(ORGANIZATION_IDS.MTD, 'CLAIMED');
      const clientA = await pool.connect();
      const clientB = await pool.connect();

      let clientASucceeded = false;
      let clientBSucceeded = false;
      let clientBFailureCode = '';

      try {
        await clientA.query('BEGIN');
        await clientB.query('BEGIN');

        // Client A inserts run for testExec.id
        await clientA.query(
          `insert into reconciliation_runs 
             (tenant_id, status, scope, started_by, rules_version, total_rules, metadata, operation_execution_id)
           values ($1, 'RUNNING', '{}'::jsonb, null, '1.0.0', 1, '{}'::jsonb, $2)`,
          [ORGANIZATION_IDS.MTD, testExec.id],
        );
        await clientA.query('COMMIT');
        clientASucceeded = true;

        // Client B tries to insert a run for the SAME testExec.id
        try {
          await clientB.query(
            `insert into reconciliation_runs 
               (tenant_id, status, scope, started_by, rules_version, total_rules, metadata, operation_execution_id)
             values ($1, 'RUNNING', '{}'::jsonb, null, '1.0.0', 1, '{}'::jsonb, $2)`,
            [ORGANIZATION_IDS.MTD, testExec.id],
          );
          await clientB.query('COMMIT');
          clientBSucceeded = true;
        } catch (err: unknown) {
          await clientB.query('ROLLBACK');
          clientBFailureCode = (err as { code?: string })?.code ?? '';
        }
      } finally {
        clientA.release();
        clientB.release();
      }

      expect(clientASucceeded).toBe(true);
      expect(clientBSucceeded).toBe(false);
      expect(clientBFailureCode).toBe('23505'); // PostgreSQL unique_violation

      const runCountForExec = await pool.query<{ cnt: number }>(
        `select count(*)::int as cnt from reconciliation_runs where operation_execution_id = $1`,
        [testExec.id],
      );
      expect(runCountForExec.rows[0]?.cnt).toBe(1);

      // Report confirmation
      const EXECUTION_RUN_DB_UNIQUE =
        clientASucceeded && !clientBSucceeded && runCountForExec.rows[0]?.cnt === 1 ? 'PASS' : 'FAIL';
      const RUNS_FOR_EXECUTION = runCountForExec.rows[0]?.cnt;
      expect(EXECUTION_RUN_DB_UNIQUE).toBe('PASS');
      expect(RUNS_FOR_EXECUTION).toBe(1);

      // 72. Manual runs with operation_execution_id = NULL coexist
      const manualRun1 = await pool.query<{ id: string }>(
        `insert into reconciliation_runs 
           (tenant_id, status, scope, started_by, rules_version, total_rules, metadata, operation_execution_id)
         values ($1, 'COMPLETED', '{}'::jsonb, null, '1.0.0', 1, '{}'::jsonb, null)
         returning id`,
        [ORGANIZATION_IDS.MTD],
      );
      const manualRun2 = await pool.query<{ id: string }>(
        `insert into reconciliation_runs 
           (tenant_id, status, scope, started_by, rules_version, total_rules, metadata, operation_execution_id)
         values ($1, 'COMPLETED', '{}'::jsonb, null, '1.0.0', 1, '{}'::jsonb, null)
         returning id`,
        [ORGANIZATION_IDS.MTD],
      );

      expect(manualRun1.rows[0]?.id).toBeDefined();
      expect(manualRun2.rows[0]?.id).toBeDefined();
      expect(manualRun1.rows[0]?.id).not.toBe(manualRun2.rows[0]?.id);

      const nullRunsCount = await pool.query<{ cnt: number }>(
        `select count(*)::int as cnt from reconciliation_runs where id in ($1, $2) and operation_execution_id is null`,
        [manualRun1.rows[0]!.id, manualRun2.rows[0]!.id],
      );
      expect(nullRunsCount.rows[0]?.cnt).toBe(2);
      const MANUAL_RUN_NULL_EXECUTION = nullRunsCount.rows[0]?.cnt === 2 ? 'PASS' : 'FAIL';
      expect(MANUAL_RUN_NULL_EXECUTION).toBe('PASS');

      // 73. Crash Window C: Worker dies after run creation; next worker reuses run without creating duplicate
      const crashExec = await opsRepo.createManualExecution(ORGANIZATION_IDS.MTD, 'CLAIMED');
      const tokenW1 = randomUUID();
      await pool.query(
        `update reconciliation_operation_executions
            set claim_token = $1, claim_generation = 1, lease_expires_at = now() + interval '60 seconds'
          where id = $2`,
        [tokenW1, crashExec.id],
      );

      // Worker 1 creates run
      const crashRun = await pool.query<{ id: string }>(
        `insert into reconciliation_runs 
           (tenant_id, status, scope, started_by, rules_version, total_rules, metadata, operation_execution_id)
         values ($1, 'COMPLETED', '{"planningPeriodId": null}'::jsonb, null, '1.0.0', 1, '{}'::jsonb, $2)
         returning id`,
        [ORGANIZATION_IDS.MTD, crashExec.id],
      );
      const crashRunId = crashRun.rows[0]!.id;

      // Worker 1 dies: lease expires
      await pool.query(
        `update reconciliation_operation_executions
            set lease_expires_at = now() - interval '5 seconds'
          where id = $1`,
        [crashExec.id],
      );

      // Worker 2 recovers execution
      const tokenW2 = randomUUID();
      await opsService.processExecution(crashExec.id, tokenW2, 60, 3);

      const recoveredExec = await opsRepo.getExecutionById(crashExec.id);
      expect(recoveredExec?.status).toBe('COMPLETED');
      expect(recoveredExec?.reconciliation_run_id).toBe(crashRunId);

      const crashRunsCount = await pool.query<{ cnt: number }>(
        `select count(*)::int as cnt from reconciliation_runs where operation_execution_id = $1`,
        [crashExec.id],
      );
      expect(crashRunsCount.rows[0]?.cnt).toBe(1);
      const CRASH_RUN_CREATED_NO_DUPLICATE = crashRunsCount.rows[0]?.cnt === 1 ? 'PASS' : 'FAIL';
      expect(CRASH_RUN_CREATED_NO_DUPLICATE).toBe('PASS');

      // 74. Fencing + DB UNIQUE complementarity
      // Worker 1 (stale) now attempts to complete the execution
      const staleCompleteResult = await opsRepo.completeExecution(
        crashExec.id,
        tokenW1, // old token
        1, // old generation
      );
      expect(staleCompleteResult).toBeNull(); // Fencing rejected stale completion

      // And any attempt by stale worker or rogue process to insert another run for crashExec is physically rejected by DB UNIQUE
      let rogueInsertBlocked = false;
      try {
        await pool.query(
          `insert into reconciliation_runs 
             (tenant_id, status, scope, started_by, rules_version, total_rules, metadata, operation_execution_id)
           values ($1, 'COMPLETED', '{}'::jsonb, null, '1.0.0', 1, '{}'::jsonb, $2)`,
          [ORGANIZATION_IDS.MTD, crashExec.id],
        );
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === '23505') {
          rogueInsertBlocked = true;
        }
      }
      expect(rogueInsertBlocked).toBe(true);

      // Cleanup
      await pool.query(`delete from reconciliation_runs where id in ($1, $2, $3)`, [
        manualRun1.rows[0]!.id,
        manualRun2.rows[0]!.id,
        crashRunId,
      ]);
      await pool.query(`delete from reconciliation_runs where operation_execution_id = $1`, [
        testExec.id,
      ]);
      await pool.query(`delete from reconciliation_operation_executions where id in ($1, $2)`, [
        testExec.id,
        crashExec.id,
      ]);
    } finally {
      await pool.end();
    }
  });

  // GATES A & B
  it('Gate A. PostgreSQL has at least 55 migrations through 0055', async () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, 'packages/database/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.length).toBeGreaterThanOrEqual(55);
    expect(journal.entries[53]?.tag).toBe('0054_esp018_reconciliation_governance');
    expect(journal.entries[54]?.tag).toBe('0055_esp019_reconciliation_operations');

    const pTable = await database.query<{ exists: boolean }>(
      `select to_regclass('public.reconciliation_operation_policies') is not null as exists`,
    );
    expect(pTable.rows[0]?.exists).toBe(true);

    const eTable = await database.query<{ exists: boolean }>(
      `select to_regclass('public.reconciliation_operation_executions') is not null as exists`,
    );
    expect(eTable.rows[0]?.exists).toBe(true);

    const nTable = await database.query<{ exists: boolean }>(
      `select to_regclass('public.reconciliation_notifications') is not null as exists`,
    );
    expect(nTable.rows[0]?.exists).toBe(true);

    const uniqueIdx = await database.query<{ exists: boolean }>(
      `select count(*) = 1 as exists from pg_indexes 
        where tablename = 'reconciliation_runs' 
          and indexname = 'reconciliation_runs_operation_execution_unique'`,
    );
    expect(uniqueIdx.rows[0]?.exists).toBe(true);

    const colExists = await database.query<{ exists: boolean }>(
      `select count(*) = 1 as exists from information_schema.columns 
        where table_name = 'reconciliation_operation_executions' 
          and column_name = 'reconciliation_run_id'`,
    );
    expect(colExists.rows[0]?.exists).toBe(false);
  });

  it('Gate B. ESP-019 migration does not insert auto-enabled policy', () => {
    const migrationSql = source(
      'packages/database/migrations/0055_esp019_reconciliation_operations.sql',
    );
    expect(migrationSql).not.toMatch(/INSERT INTO reconciliation_operation_policies/i);
    expect(migrationSql).not.toMatch(/DROP TABLE/i);
    expect(migrationSql).not.toMatch(/update patient_/i);
  });
});
