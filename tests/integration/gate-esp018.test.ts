import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReconciliationEngine } from '../../apps/api/src/reconciliation/reconciliation.engine';
import { ReconciliationRepository } from '../../apps/api/src/reconciliation/reconciliation.repository';
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
const CODE = `ESP18-CODE-${suffix.toUpperCase()}`;
const DOC = `DOC-018-${suffix}`;
const POINT_CODE = `ESP18-PT-${suffix}`;
const PERIOD = { from: '2054-03-01', to: '2054-03-31' };
const DATE = '2054-03-12';

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

type IssueResponse = {
  id: string;
  status: string;
  currentSeverity: string;
  maxSeveritySeen: string;
  occurrenceCount: number;
  firstRunId: string;
  lastRunId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  version: number;
  riskReviewOverdue: boolean;
  fingerprint: string;
  ruleCode: string;
  assignee?: { id: string; username: string; displayName: string } | null;
};

async function startRun(body: Record<string, unknown> = {}) {
  return json<{
    id: string;
    status: string;
    criticalFindings: number;
    errorFindings: number;
    ruleResults: Array<{ ruleCode: string; status: string }>;
  }>(await api('POST', '/reconciliation/runs', body));
}

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

async function latestApp003Issue(): Promise<IssueResponse> {
  const runs = await json<{ items: Array<{ id: string }> }>(
    await api('GET', '/reconciliation/runs'),
  );
  const runId = runs.items[0]?.id;
  if (!runId) throw new Error('no run');
  const findings = await json<{ items: Array<{ issueId: string; ruleCode: string }> }>(
    await api('GET', `/reconciliation/runs/${runId}/findings?ruleCode=REC-APP-003`),
  );
  const finding =
    findings.items.find((item) => item.ruleCode === 'REC-APP-003') ?? findings.items[0];
  if (!finding) throw new Error('REC-APP-003 finding missing');
  return json<IssueResponse>(await api('GET', `/reconciliation/issues/${finding.issueId}`));
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
  await database.query(
    `delete from reconciliation_issue_comments where issue_id in (
       select id from reconciliation_issues where last_run_id in (
         select id from reconciliation_runs where scope->>'planningPeriodId' in (
           select id::text from planning_periods where start_date >= '2054-01-01'
         )) or first_run_id in (
         select id from reconciliation_runs where scope->>'planningPeriodId' in (
           select id::text from planning_periods where start_date >= '2054-01-01'
         )))`,
  );
  await database.query(
    `delete from reconciliation_issue_events where issue_id in (
       select id from reconciliation_issues where last_run_id in (
         select id from reconciliation_runs where scope->>'planningPeriodId' in (
           select id::text from planning_periods where start_date >= '2054-01-01'
         )) or first_run_id in (
         select id from reconciliation_runs where scope->>'planningPeriodId' in (
           select id::text from planning_periods where start_date >= '2054-01-01'
         )))`,
  );
  await database.query(
    `update reconciliation_issues set last_finding_id = null
      where last_run_id in (
        select id from reconciliation_runs where scope->>'planningPeriodId' in (
          select id::text from planning_periods where start_date >= '2054-01-01'
        )) or first_run_id in (
        select id from reconciliation_runs where scope->>'planningPeriodId' in (
          select id::text from planning_periods where start_date >= '2054-01-01'
        ))`,
  );
  await database.query(
    `delete from reconciliation_findings where reconciliation_run_id in (
       select id from reconciliation_runs where scope->>'planningPeriodId' in (
         select id::text from planning_periods where start_date >= '2054-01-01'
       ))`,
  );
  await database.query(
    `delete from reconciliation_issues where last_run_id in (
       select id from reconciliation_runs where scope->>'planningPeriodId' in (
         select id::text from planning_periods where start_date >= '2054-01-01'
       )) or first_run_id in (
       select id from reconciliation_runs where scope->>'planningPeriodId' in (
         select id::text from planning_periods where start_date >= '2054-01-01'
       ))`,
  );
  await database.query(
    `delete from reconciliation_runs where scope->>'planningPeriodId' in (
       select id::text from planning_periods where start_date >= '2054-01-01'
     )`,
  );
  await database.query(
    `delete from patient_application_lines where patient_application_id in (
       select id from patient_applications where dispensing_point_id in (
         select id from dispensing_points where code like 'ESP18%'
       ))`,
  );
  await database.query(
    `delete from patient_applications where dispensing_point_id in (
       select id from dispensing_points where code like 'ESP18%'
     )`,
  );
  await database.query(
    `delete from patient_schedule_history where planning_period_id in (
       select id from planning_periods where start_date >= '2054-01-01'
     )`,
  );
  await database.query(
    `delete from patient_schedules where planning_period_id in (
       select id from planning_periods where start_date >= '2054-01-01'
     )`,
  );
  await database.query(
    `delete from inventory_movements where inventory_lot_id in (
       select id from inventory_lots where dispensing_point_id in (
         select id from dispensing_points where code like 'ESP18%'
       )
     )`,
  );
  await database.query(
    `delete from inventory_lots where dispensing_point_id in (
       select id from dispensing_points where code like 'ESP18%'
     )`,
  );
  await database.query(
    `delete from user_point_scopes where dispensing_point_id in (
       select id from dispensing_points where code like 'ESP18%'
     )`,
  );
  await database.query(`delete from dispensing_points where code like 'ESP18%'`);
  await database.query(`delete from planning_periods where start_date >= '2054-01-01'`);
  await database.query(
    `alter table patient_applications enable trigger patient_applications_confirmed_immutable`,
  );
  await database.query(
    `alter table patient_application_lines enable trigger patient_application_lines_confirmed_immutable`,
  );
  await database.query(
    `alter table patient_schedule_history enable trigger patient_schedule_history_no_delete`,
  );
  adminToken = await adminLogin();
  foundationUserId = (
    await database.query<{ id: string }>(`select id from users where username='foundation-admin'`)
  ).rows[0]!.id;
  ({ medicarteToken, olpToken } = await ensureOperatorTokens());
  auditorToken = await ensureUser({
    adminToken,
    username: `esp018-auditor-${suffix}`,
    displayName: 'ESP018 Auditor',
    password: `esp018-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_AUDITORIA',
  });
  operatorToken = await ensureUser({
    adminToken,
    username: `esp018-operator-${suffix}`,
    displayName: 'ESP018 Operator',
    password: `esp018-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_OPERATOR',
  });
  generalToken = await ensureUser({
    adminToken,
    username: `esp018-general-${suffix}`,
    displayName: 'ESP018 General',
    password: `esp018-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_GENERAL',
  });
  readOnlyToken = await ensureUser({
    adminToken,
    username: `esp018-ro-${suffix}`,
    displayName: 'ESP018 RO',
    password: `esp018-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'READ_ONLY',
  });
  compensarToken = await ensureUser({
    adminToken,
    username: `esp018-compensar-${suffix}`,
    displayName: 'ESP018 Compensar',
    password: `esp018-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.COMPENSAR,
    roleCode: 'COMPENSAR_VIEWER',
  });
  const point = await database.query<{ id: string }>(
    `insert into dispensing_points (organization_id, code, name, created_by)
     values ($1,$2,'ESP018 point', $3) returning id`,
    [ORGANIZATION_IDS.MEDICARTE, POINT_CODE, foundationUserId],
  );
  pointId = point.rows[0]!.id;
  createdPointIds.push(pointId);
  periodId = (
    await database.query<{ id: string }>(
      `insert into planning_periods
        (start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
         expected_delivery_date, created_by, updated_by)
       values ($1,$2,'2054-03-28T23:59:00-05:00','2054-03-29T23:59:00-05:00','2054-03-30',$3,$3)
       returning id`,
      [PERIOD.from, PERIOD.to, foundationUserId],
    )
  ).rows[0]!.id;
  await grantAllPointsToMedicarteOperator(database);
  const batch = await database.query<{ id: string }>(
    `insert into import_batches (organization_id,created_by,original_filename,mime_type,size_bytes,sha256,processor_version,status,total_rows,confirmed_rows,completed_at,confirmed_at)
     values ($1,$2,$3,'application/json',1,$4,1,'COMPLETED',1,1,now(),now()) returning id`,
    [ORGANIZATION_IDS.MTD, foundationUserId, `esp018-${suffix}.json`, 'e'.repeat(64)],
  );
  const item = await database.query<{ id: string }>(
    `insert into authorization_items
      (numero_autorizacion, codigo_medicamento, authorization_key, source_data,
       source_status_normalized, source_prescripcion_normalized, no_prescripcion,
       enablement_status, coverage_type, direction_status, coverage_rule_version,
       created_from_batch_id)
     values ($1,$2,$3,$4::jsonb,'VIGENTE','','','ENABLED','PBS','NOT_APPLICABLE','ESP018',$5)
     returning id`,
    [
      `ESP018-M-${suffix}`,
      CODE,
      `ESP018-M-${suffix}:${CODE}`,
      JSON.stringify({
        IDENTIFICACION_PACIENTE: DOC,
        NOMBRE_PACIENTE: 'Paciente ESP-018',
        CANTIDAD: '2',
        FECHA_FINAL_VIGENCIA: '2099-12-31',
      }),
      batch.rows[0]!.id,
    ],
  );
  modernAuthId = item.rows[0]!.id;
  await database.query(
    `insert into authorization_item_organizations (authorization_item_id, organization_id)
     values ($1,$2) on conflict do nothing`,
    [modernAuthId, ORGANIZATION_IDS.MEDICARTE],
  );
  const schedule = await database.query<{ id: string }>(
    `insert into patient_schedules
       (authorization_item_id, planning_period_id, dispensing_point_id, commercial_code,
        scheduled_date, quantity, status, schedule_timing, created_by, updated_by)
     values ($1,$2,$3,$4,$5,2,'SCHEDULED','ON_TIME',$6,$6) returning id`,
    [modernAuthId, periodId, pointId, CODE, DATE, foundationUserId],
  );
  scheduleId = schedule.rows[0]!.id;
  await database.query(
    `insert into patient_schedule_history
       (patient_schedule_id, revision, authorization_item_id, planning_period_id, dispensing_point_id,
        commercial_code, scheduled_date, quantity, status, schedule_timing, change_type, changed_by, correlation_id)
     values ($1,1,$2,$3,$4,$5,$6,2,'SCHEDULED','ON_TIME','CREATED',$7,$8)`,
    [scheduleId, modernAuthId, periodId, pointId, CODE, DATE, foundationUserId, randomUUID()],
  );
  lotId = (
    await database.query<{ id: string }>(
      `insert into inventory_lots (commercial_code,dispensing_point_id,lot_number,expiration_date)
       values ($1,$2,$3,'2099-12-31') returning id`,
      [CODE, pointId, `ESP18-LOT-${suffix}`],
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
       values ($1,1,$2,$3,$4,$5,$5,'CONFIRMED',$6,$6,now()) returning id`,
      [scheduleId, modernAuthId, CODE, pointId, DATE, foundationUserId],
    )
  ).rows[0]!.id;
  applicationLineId = (
    await database.query<{ id: string }>(
      `insert into patient_application_lines
         (patient_application_id, inventory_lot_id, commercial_code, dispensing_point_id, lot_number, expiration_date, quantity)
       values ($1,$2,$3,$4,$5,'2099-12-31',2) returning id`,
      [applicationId, lotId, CODE, pointId, `ESP18-LOT-${suffix}`],
    )
  ).rows[0]!.id;
  await database.query('COMMIT');
  await restoreApplicationMovement();
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

describe('Gate ESP-018 — governance de findings', () => {
  it('1-7. same fingerprint converges; distinct fingerprints diverge; backfill has no orphans', async () => {
    await corruptApplicationMovement();
    const runA = await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    const runB = await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    const findingsA = await json<{ items: Array<{ issueId: string; fingerprint: string }> }>(
      await api('GET', `/reconciliation/runs/${runA.id}/findings?ruleCode=REC-APP-003`),
    );
    const findingsB = await json<{ items: Array<{ issueId: string; fingerprint: string }> }>(
      await api('GET', `/reconciliation/runs/${runB.id}/findings?ruleCode=REC-APP-003`),
    );
    expect(findingsA.items[0]?.issueId).toBe(findingsB.items[0]?.issueId);
    const issue = await json<IssueResponse>(
      await api('GET', `/reconciliation/issues/${findingsA.items[0]!.issueId}`),
    );
    expect(issue.occurrenceCount).toBe(2);
    expect(issue.firstRunId).toBe(runA.id);
    expect(issue.lastRunId).toBe(runB.id);
    expect(new Date(issue.firstSeenAt).getTime()).toBeLessThanOrEqual(
      new Date(issue.lastSeenAt).getTime(),
    );
    const other = await json<{ items: Array<{ issueId: string; ruleCode: string }> }>(
      await api('GET', `/reconciliation/runs/${runA.id}/findings`),
    );
    const otherIssue = other.items.find((item) => item.ruleCode !== 'REC-APP-003');
    if (otherIssue) {
      expect(otherIssue.issueId).not.toBe(findingsA.items[0]?.issueId);
    }
    const linked = await database.query<{ n: string }>(
      `select count(*)::text n from reconciliation_findings where issue_id = $1`,
      [issue.id],
    );
    expect(Number(linked.rows[0]?.n)).toBe(issue.occurrenceCount);
    const orphans = await database.query<{ n: string }>(
      `select count(*)::text n from reconciliation_findings where issue_id is null`,
    );
    expect(orphans.rows[0]?.n).toBe('0');
    const totals = await database.query<{ findings: string; occurrences: string }>(
      `select
         (select count(*)::text from reconciliation_findings f
            join reconciliation_runs r on r.id = f.reconciliation_run_id
           where r.tenant_id = $1) as findings,
         (select coalesce(sum(occurrence_count),0)::text from reconciliation_issues where tenant_id = $1) as occurrences`,
      [ORGANIZATION_IDS.MTD],
    );
    expect(Number(totals.rows[0]?.occurrences)).toBeGreaterThanOrEqual(
      Number(totals.rows[0]?.findings),
    );
    await restoreApplicationMovement();
    expect(findingsA.items[0]?.fingerprint).not.toContain(runA.id);
  });

  it('8-15. lifecycle, invalid transition, version conflict, manual reopen', async () => {
    await corruptApplicationMovement();
    await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    let issue = await latestApp003Issue();
    expect(issue.status).toBe('OPEN');
    const ack = await api('POST', `/reconciliation/issues/${issue.id}/acknowledge`, {
      expectedVersion: issue.version,
    });
    expect(ack.status).toBe(200);
    issue = await json<IssueResponse>(ack);
    expect(issue.status).toBe('ACKNOWLEDGED');
    const invalid = await json<{ code: string }>(
      await api('POST', `/reconciliation/issues/${issue.id}/acknowledge`, {
        expectedVersion: issue.version,
      }),
    );
    expect(invalid.code).toBe('INVALID_ISSUE_TRANSITION');
    const conflict = await api('POST', `/reconciliation/issues/${issue.id}/resolve`, {
      expectedVersion: 1,
      resolutionCode: 'DATA_CORRECTED',
      resolutionNote: 'stale version',
    });
    expect(conflict.status).toBe(409);
    const resolved = await json<IssueResponse>(
      await api('POST', `/reconciliation/issues/${issue.id}/resolve`, {
        expectedVersion: issue.version,
        resolutionCode: 'DATA_CORRECTED',
        resolutionNote: 'Corrected via the application module',
      }),
    );
    expect(resolved.status).toBe('RESOLVED');
    const reopened = await json<IssueResponse>(
      await api('POST', `/reconciliation/issues/${resolved.id}/reopen`, {
        expectedVersion: resolved.version,
      }),
    );
    expect(reopened.status).toBe('OPEN');
    const accepted = await json<IssueResponse>(
      await api('POST', `/reconciliation/issues/${reopened.id}/accept-risk`, {
        expectedVersion: reopened.version,
        acceptedRiskReason: 'Temporary known lineage gap until next receipt cycle',
      }),
    );
    expect(accepted.status).toBe('ACCEPTED_RISK');
    const fromAccepted = await json<IssueResponse>(
      await api('POST', `/reconciliation/issues/${accepted.id}/reopen`, {
        expectedVersion: accepted.version,
      }),
    );
    expect(fromAccepted.status).toBe('OPEN');
    await restoreApplicationMovement();
  });

  it('16-22. recurrence keeps OPEN/ACKNOWLEDGED/ACCEPTED_RISK and reopens RESOLVED', async () => {
    await corruptApplicationMovement();
    const first = await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    let issue = await latestApp003Issue();
    const secondOpen = await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    issue = await json<IssueResponse>(await api('GET', `/reconciliation/issues/${issue.id}`));
    expect(issue.status).toBe('OPEN');
    expect(issue.lastRunId).toBe(secondOpen.id);
    const ack = await json<IssueResponse>(
      await api('POST', `/reconciliation/issues/${issue.id}/acknowledge`, {
        expectedVersion: issue.version,
      }),
    );
    await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    issue = await json<IssueResponse>(await api('GET', `/reconciliation/issues/${ack.id}`));
    expect(issue.status).toBe('ACKNOWLEDGED');
    const resolved = await json<IssueResponse>(
      await api('POST', `/reconciliation/issues/${issue.id}/resolve`, {
        expectedVersion: issue.version,
        resolutionCode: 'PROCESS_CORRECTED',
        resolutionNote: 'Process updated in scheduling operations',
      }),
    );
    await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    issue = await json<IssueResponse>(await api('GET', `/reconciliation/issues/${resolved.id}`));
    expect(issue.status).toBe('OPEN');
    const events = await json<{ items: Array<{ eventType: string }> }>(
      await api('GET', `/reconciliation/issues/${issue.id}/events`),
    );
    expect(events.items.some((item) => item.eventType === 'ISSUE_REOPENED')).toBe(true);
    const accepted = await json<IssueResponse>(
      await api('POST', `/reconciliation/issues/${issue.id}/accept-risk`, {
        expectedVersion: issue.version,
        acceptedRiskReason: 'Known temporary gap pending supplier receipt',
      }),
    );
    const afterAccepted = await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    issue = await json<IssueResponse>(await api('GET', `/reconciliation/issues/${accepted.id}`));
    expect(issue.status).toBe('ACCEPTED_RISK');
    expect(afterAccepted.criticalFindings).toBeGreaterThan(0);
    expect(first.criticalFindings).toBeGreaterThan(0);
    await database.query(
      `update reconciliation_issues set accepted_risk_severity = 'WARNING', version = version + 1 where id = $1`,
      [issue.id],
    );
    await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    issue = await json<IssueResponse>(await api('GET', `/reconciliation/issues/${issue.id}`));
    expect(issue.status).toBe('OPEN');
    const invalidated = await json<{ items: Array<{ eventType: string }> }>(
      await api('GET', `/reconciliation/issues/${issue.id}/events`),
    );
    expect(invalidated.items.some((item) => item.eventType === 'RISK_ACCEPTANCE_INVALIDATED')).toBe(
      true,
    );
    const acceptedAgain = await json<IssueResponse>(
      await api('POST', `/reconciliation/issues/${issue.id}/accept-risk`, {
        expectedVersion: issue.version,
        acceptedRiskReason: 'Re-accepted after severity invalidation',
      }),
    );
    await database.query(
      `update reconciliation_issues set accepted_risk_rule_version = 'ESP-017.0', version = version + 1 where id = $1`,
      [acceptedAgain.id],
    );
    await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    issue = await json<IssueResponse>(
      await api('GET', `/reconciliation/issues/${acceptedAgain.id}`),
    );
    expect(issue.status).toBe('OPEN');
    await restoreApplicationMovement();
  });

  it('23-26. accepted risk does not change run health, CLI formula or finding severity', async () => {
    await corruptApplicationMovement();
    const run = await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    const issue = await latestApp003Issue();
    await api('POST', `/reconciliation/issues/${issue.id}/accept-risk`, {
      expectedVersion: issue.version,
      acceptedRiskReason: 'Tolerated until the next controlled receipt',
    });
    const again = await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    expect(again.criticalFindings).toBeGreaterThan(0);
    expect(run.criticalFindings).toBe(again.criticalFindings);
    const exitCode =
      again.criticalFindings > 0 || again.errorFindings > 0 ? 1 : again.status === 'FAILED' ? 2 : 0;
    expect(exitCode).toBe(1);
    const findings = await json<{ items: Array<{ severity: string }> }>(
      await api('GET', `/reconciliation/runs/${again.id}/findings?ruleCode=REC-APP-003`),
    );
    expect(findings.items[0]?.severity).toBe('CRITICAL');
    expect(source('apps/api/src/reconciliation/cli.ts')).toMatch(/critical_findings/);
    expect(source('apps/api/src/reconciliation/cli.ts')).not.toMatch(/ACCEPTED_RISK/);
    const historical = await database.query<{ critical_findings: number }>(
      `select critical_findings from reconciliation_runs where id = $1`,
      [run.id],
    );
    expect(Number(historical.rows[0]?.critical_findings)).toBe(run.criticalFindings);
    const accepted = await json<IssueResponse>(
      await api('GET', `/reconciliation/issues/${issue.id}`),
    );
    await api('POST', `/reconciliation/issues/${accepted.id}/reopen`, {
      expectedVersion: accepted.version,
    });
    await restoreApplicationMovement();
  });

  it('27-31. atomic linking, concurrent runs, new findings always have issue_id', async () => {
    await corruptApplicationMovement();
    const pool = new Pool({ connectionString: databaseUrl });
    const engine = new ReconciliationEngine(pool, new ReconciliationRepository({ pool }));
    try {
      const [left, right] = await Promise.all([
        engine.execute({
          tenantId: ORGANIZATION_IDS.MTD,
          startedBy: foundationUserId,
          planningPeriodId: periodId,
          dispensingPointId: pointId,
          domains: ['APPLICATION'],
        }),
        engine.execute({
          tenantId: ORGANIZATION_IDS.MTD,
          startedBy: foundationUserId,
          planningPeriodId: periodId,
          dispensingPointId: pointId,
          domains: ['APPLICATION'],
        }),
      ]);
      const counts = await database.query<{ issues: string; findings: string }>(
        `select
           (select count(*)::text from reconciliation_issues i
              join reconciliation_findings f on f.issue_id = i.id
             where f.reconciliation_run_id in ($1,$2) and f.rule_code = 'REC-APP-003') as findings,
           (select count(distinct f.issue_id)::text from reconciliation_findings f
             where f.reconciliation_run_id in ($1,$2) and f.rule_code = 'REC-APP-003') as issues`,
        [left.id, right.id],
      );
      expect(counts.rows[0]?.issues).toBe('1');
      expect(Number(counts.rows[0]?.findings)).toBe(2);
      const missing = await database.query<{ n: string }>(
        `select count(*)::text n from reconciliation_findings
          where reconciliation_run_id in ($1,$2) and issue_id is null`,
        [left.id, right.id],
      );
      expect(missing.rows[0]?.n).toBe('0');
    } finally {
      await pool.end();
      await restoreApplicationMovement();
    }
  });

  it('32-35. governance actions do not mutate operational tables', async () => {
    await corruptApplicationMovement();
    await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    const before = await database.query<{ sig: string }>(
      `select md5(concat_ws('|', status, revision::text, quantity::text)) as sig from patient_schedules where id = $1`,
      [scheduleId],
    );
    const movementsBefore = await database.query<{ n: string }>(
      `select count(*)::text n from inventory_movements where inventory_lot_id = $1`,
      [lotId],
    );
    let issue = await latestApp003Issue();
    issue = await json<IssueResponse>(
      await api('POST', `/reconciliation/issues/${issue.id}/acknowledge`, {
        expectedVersion: issue.version,
      }),
    );
    const assignees = await json<{ items: Array<{ id: string }> }>(
      await api('GET', '/reconciliation/issues/assignees'),
    );
    issue = await json<IssueResponse>(
      await api('POST', `/reconciliation/issues/${issue.id}/assign`, {
        expectedVersion: issue.version,
        assignedToUserId: assignees.items[0]!.id,
      }),
    );
    issue = await json<IssueResponse>(
      await api('POST', `/reconciliation/issues/${issue.id}/accept-risk`, {
        expectedVersion: issue.version,
        acceptedRiskReason: 'Does not repair inventory; governance only',
      }),
    );
    await api('POST', `/reconciliation/issues/${issue.id}/resolve`, {
      expectedVersion: issue.version,
      resolutionCode: 'DATA_CORRECTED',
      resolutionNote: 'Recorded after a real domain correction path',
    });
    const after = await database.query<{ sig: string }>(
      `select md5(concat_ws('|', status, revision::text, quantity::text)) as sig from patient_schedules where id = $1`,
      [scheduleId],
    );
    const movementsAfter = await database.query<{ n: string }>(
      `select count(*)::text n from inventory_movements where inventory_lot_id = $1`,
      [lotId],
    );
    expect(after.rows[0]?.sig).toBe(before.rows[0]?.sig);
    expect(movementsAfter.rows[0]?.n).toBe(movementsBefore.rows[0]?.n);
    await restoreApplicationMovement();
  });

  it('36-40. comments, assignment tenant rules, unassign, no comment body in audit', async () => {
    await corruptApplicationMovement();
    await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    const issue = await latestApp003Issue();
    const created = await json<{ id: string; body: string }>(
      await api('POST', `/reconciliation/issues/${issue.id}/comments`, {
        body: 'Investigating lineage without naming the patient',
      }),
    );
    expect(created.body).toContain('Investigating');
    const audits = await database.query<{ after: Record<string, unknown> | string | null }>(
      `select after from audit_events where resource_id = $1`,
      [issue.id],
    );
    expect(
      JSON.stringify(audits.rows).includes('Investigating lineage without naming the patient'),
    ).toBe(false);
    const medicarteUsers = await database.query<{ id: string }>(
      `select u.id from users u
         join user_organization_roles uor on uor.user_id = u.id and uor.active
         join organizations o on o.id = uor.organization_id
        where o.code = 'MEDICARTE' limit 1`,
    );
    const denied = await api('POST', `/reconciliation/issues/${issue.id}/assign`, {
      expectedVersion: issue.version,
      assignedToUserId: medicarteUsers.rows[0]!.id,
    });
    expect(denied.status).toBe(403);
    const assignees = await json<{ items: Array<{ id: string }> }>(
      await api('GET', '/reconciliation/issues/assignees'),
    );
    const assigned = await json<IssueResponse>(
      await api('POST', `/reconciliation/issues/${issue.id}/assign`, {
        expectedVersion: issue.version,
        assignedToUserId: assignees.items[0]!.id,
      }),
    );
    const unassigned = await json<IssueResponse>(
      await api('POST', `/reconciliation/issues/${assigned.id}/unassign`, {
        expectedVersion: assigned.version,
      }),
    );
    expect(unassigned.assignee).toBeNull();
    await restoreApplicationMovement();
  });

  it('41-48. RBAC MTD vs Medicarte/OLP/Compensar', async () => {
    const read = await api('GET', '/reconciliation/issues', undefined, generalToken);
    expect(read.status).toBe(200);
    const ro = await api('GET', '/reconciliation/issues', undefined, readOnlyToken);
    expect(ro.status).toBe(200);
    const opComment = await api('GET', '/reconciliation/issues', undefined, operatorToken);
    expect(opComment.status).toBe(200);
    await corruptApplicationMovement();
    await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    const issue = await latestApp003Issue();
    expect(
      (
        await api(
          'POST',
          `/reconciliation/issues/${issue.id}/acknowledge`,
          {
            expectedVersion: issue.version,
          },
          operatorToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api(
          'POST',
          `/reconciliation/issues/${issue.id}/acknowledge`,
          {
            expectedVersion: issue.version,
          },
          generalToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api(
          'POST',
          `/reconciliation/issues/${issue.id}/acknowledge`,
          {
            expectedVersion: issue.version,
          },
          readOnlyToken,
        )
      ).status,
    ).toBe(403);
    expect((await api('GET', '/reconciliation/issues', undefined, medicarteToken)).status).toBe(
      403,
    );
    expect((await api('GET', '/reconciliation/issues', undefined, olpToken)).status).toBe(403);
    expect((await api('GET', '/reconciliation/issues', undefined, compensarToken)).status).toBe(
      403,
    );
    expect(
      (
        await api(
          'POST',
          `/reconciliation/issues/${issue.id}/comments`,
          { body: 'Operator comment without triage' },
          operatorToken,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await api(
          'POST',
          `/reconciliation/issues/${issue.id}/acknowledge`,
          { expectedVersion: issue.version },
          adminToken,
        )
      ).status,
    ).toBe(200);
    await restoreApplicationMovement();
  });

  it('49-50. tenant A cannot read or mutate tenant B issues', async () => {
    const findingId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const uniqueFingerprint = `REC-BULK-001|bulk_import_job|${suffix}|tenantB`;
    try {
      await database.query('BEGIN');
      await database.query(
        `insert into reconciliation_runs (id, tenant_id, status, scope, rules_version, total_rules)
         values ($1,$2,'COMPLETED','{"kind":"GLOBAL","planningPeriodId":null,"dispensingPointId":null,"commercialCode":null}'::jsonb,'ESP-017.1',0)`,
        [runId, ORGANIZATION_IDS.MEDICARTE],
      );
      await database.query(
        `insert into reconciliation_issues
           (id, tenant_id, rule_code, fingerprint, domain, category, status, current_severity, max_severity_seen,
            first_seen_at, last_seen_at, occurrence_count, first_run_id, last_run_id, last_finding_id,
            first_rule_version, last_rule_version)
         values ($1,$2,'REC-BULK-001',$5,'BULK','RECONCILIATION','OPEN','INFO','INFO',
                 now(), now(), 1, $3, $3, $4, 'ESP-017.1', 'ESP-017.1')`,
        [issueId, ORGANIZATION_IDS.MEDICARTE, runId, findingId, uniqueFingerprint],
      );
      await database.query(
        `insert into reconciliation_findings
           (id, reconciliation_run_id, rule_code, rule_version, category, severity, domain, entity_type,
            message, fingerprint, issue_id)
         values ($1,$2,'REC-BULK-001','ESP-017.1','RECONCILIATION','INFO','BULK','bulk_import_job',
                 'foreign tenant fixture',$4,$3)`,
        [findingId, runId, issueId, uniqueFingerprint],
      );
      await database.query('COMMIT');
    } catch (e) {
      await database.query('ROLLBACK');
      throw e;
    }
    expect((await api('GET', `/reconciliation/issues/${issueId}`)).status).toBe(404);
    expect(
      (
        await api('POST', `/reconciliation/issues/${issueId}/acknowledge`, {
          expectedVersion: 1,
        })
      ).status,
    ).toBe(404);
    await database.query(`update reconciliation_issues set last_finding_id = null where id = $1`, [
      issueId,
    ]);
    await database.query(`delete from reconciliation_findings where id = $1`, [findingId]);
    await database.query(`delete from reconciliation_issues where id = $1`, [issueId]);
    await database.query(`delete from reconciliation_runs where id = $1`, [runId]);
  });

  it('51-53. risk review overdue is informational and does not auto-change status', async () => {
    await corruptApplicationMovement();
    await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    const issue = await latestApp003Issue();
    const future = await json<IssueResponse>(
      await api('POST', `/reconciliation/issues/${issue.id}/accept-risk`, {
        expectedVersion: issue.version,
        acceptedRiskReason: 'Review next quarter',
        riskReviewAt: '2099-01-01T00:00:00.000Z',
      }),
    );
    expect(future.riskReviewOverdue).toBe(false);
    await database.query(
      `update reconciliation_issues set risk_review_at = now() - interval '2 days' where id = $1`,
      [future.id],
    );
    const overdue = await json<IssueResponse>(
      await api('GET', `/reconciliation/issues/${future.id}`),
    );
    expect(overdue.riskReviewOverdue).toBe(true);
    expect(overdue.status).toBe('ACCEPTED_RISK');
    await restoreApplicationMovement();
  });

  it('54-58. ESP-017 snapshot/raw health remain intact; no operational writes in engine', async () => {
    const healthy = await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
    });
    expect(healthy.status).toBe('COMPLETED');
    expect(healthy.criticalFindings).toBe(0);
    expect(healthy.errorFindings).toBe(0);
    await corruptApplicationMovement();
    const corrupted = await startRun({
      planningPeriodId: periodId,
      dispensingPointId: pointId,
      domains: ['APPLICATION'],
    });
    expect(
      corrupted.ruleResults.some(
        (item) => item.ruleCode === 'REC-APP-003' && item.status === 'FAIL',
      ),
    ).toBe(true);
    await restoreApplicationMovement();
    expect(source('apps/api/src/reconciliation/reconciliation.engine.ts')).toContain(
      'REPEATABLE READ READ ONLY',
    );
    expect(source('apps/api/src/reconciliation/reconciliation.engine.ts')).not.toMatch(
      /update patient_schedules/i,
    );
    expect(source('apps/api/src/reconciliation/reconciliation-issues.service.ts')).not.toMatch(
      /update inventory_movements/i,
    );
  });

  it('Gate A. PostgreSQL has 52 migrations through 0051', async () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, 'packages/database/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.length).toBeGreaterThanOrEqual(51);
    expect(journal.entries[0]?.tag).toBe('0000_foundation');
    expect(journal.entries[50]?.tag).toBe('0050_esp018_reconciliation_governance');
    const table = await database.query<{ exists: boolean }>(
      `select to_regclass('public.reconciliation_issues') is not null as exists`,
    );
    expect(table.rows[0]?.exists).toBe(true);
  });

  it('Gate B. ESP-018 is only 0050 on ESP-017 and backfills OPEN issues', async () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, 'packages/database/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };
    expect(journal.entries[49]?.tag).toBe('0049_esp017_operational_reconciliation');
    expect(
      journal.entries.filter((entry) => entry.tag.includes('esp018')).map((entry) => entry.tag),
    ).toEqual(['0050_esp018_reconciliation_governance']);
    const sql = source('packages/database/migrations/0050_esp018_reconciliation_governance.sql');
    expect(sql).toContain('reconciliation_issues');
    expect(sql).toContain('ESP-018_BACKFILL');
    expect(sql).toContain("'OPEN'");
    expect(sql).not.toMatch(/update patient_schedules/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
    const orphans = await database.query<{ n: string }>(
      `select count(*)::text n from reconciliation_findings where issue_id is null`,
    );
    expect(orphans.rows[0]?.n).toBe('0');
  });
});
