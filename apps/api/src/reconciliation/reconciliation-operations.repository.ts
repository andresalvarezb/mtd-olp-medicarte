import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;

export type OperationPolicyRow = {
  id: string;
  tenant_id: string;
  enabled: boolean;
  cadence: string;
  timezone: string;
  local_time: string | null;
  weekday: number | null;
  domains: unknown;
  planning_period_scope: string | null;
  severity_alert_threshold: string;
  notify_on_recovery: boolean;
  notify_on_technical_failure: boolean;
  next_run_at: Date | string | null;
  created_by: string;
  updated_by: string;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

export type OperationExecutionRow = {
  id: string;
  tenant_id: string;
  policy_id: string | null;
  trigger_type: string;
  scheduled_for: Date | string | null;
  claimed_at: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  status: string;
  reconciliation_run_id: string | null;
  attempt_count: number;
  claim_token: string | null;
  claim_generation: number;
  lease_expires_at: Date | string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  missed_occurrences_count: number;
  skip_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  critical_findings?: number | null;
  error_findings?: number | null;
  warning_findings?: number | null;
};

export type NotificationRow = {
  id: string;
  tenant_id: string;
  execution_id: string | null;
  reconciliation_run_id: string | null;
  notification_type: string;
  severity: string;
  dedup_key: string;
  status: string;
  channel: string;
  payload_json: Record<string, unknown>;
  attempt_count: number;
  read_at: Date | string | null;
  sent_at: Date | string | null;
  last_error_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function asIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

@Injectable()
export class ReconciliationOperationsRepository {
  constructor(@Inject(DATABASE) private readonly database: Pick<Database, 'pool'>) {}

  async getPolicy(tenantId: string): Promise<OperationPolicyRow | null> {
    const result = await this.database.pool.query<OperationPolicyRow>(
      `SELECT * FROM reconciliation_operation_policies WHERE tenant_id = $1`,
      [tenantId],
    );
    return result.rows[0] ?? null;
  }

  async upsertPolicy(input: {
    tenantId: string;
    enabled: boolean;
    cadence: string;
    timezone: string;
    localTime: string | null;
    weekday: number | null;
    domains: unknown;
    planningPeriodScope: string | null;
    severityAlertThreshold: string;
    notifyOnRecovery: boolean;
    notifyOnTechnicalFailure: boolean;
    nextRunAt: Date | null;
    userId: string;
    expectedVersion?: number | undefined;
  }): Promise<{ policy: OperationPolicyRow; isNew: boolean }> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<OperationPolicyRow>(
        `SELECT * FROM reconciliation_operation_policies WHERE tenant_id = $1 FOR UPDATE`,
        [input.tenantId],
      );
      const current = existing.rows[0];

      if (current) {
        if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
          throw new Error('VERSION_CONFLICT');
        }

        const updateResult = await client.query<OperationPolicyRow>(
          `UPDATE reconciliation_operation_policies
              SET enabled = $2,
                  cadence = $3,
                  timezone = $4,
                  local_time = $5,
                  weekday = $6,
                  domains = $7::jsonb,
                  planning_period_scope = $8,
                  severity_alert_threshold = $9,
                  notify_on_recovery = $10,
                  notify_on_technical_failure = $11,
                  next_run_at = $12,
                  updated_by = $13,
                  version = version + 1,
                  updated_at = now()
            WHERE id = $1
            RETURNING *`,
          [
            current.id,
            input.enabled,
            input.cadence,
            input.timezone,
            input.localTime,
            input.weekday,
            input.domains ? JSON.stringify(input.domains) : null,
            input.planningPeriodScope,
            input.severityAlertThreshold,
            input.notifyOnRecovery,
            input.notifyOnTechnicalFailure,
            input.nextRunAt ? input.nextRunAt.toISOString() : null,
            input.userId,
          ],
        );
        await client.query('COMMIT');
        return { policy: updateResult.rows[0]!, isNew: false };
      }

      const insertResult = await client.query<OperationPolicyRow>(
        `INSERT INTO reconciliation_operation_policies (
           tenant_id, enabled, cadence, timezone, local_time, weekday,
           domains, planning_period_scope, severity_alert_threshold,
           notify_on_recovery, notify_on_technical_failure, next_run_at,
           created_by, updated_by, version
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $13, 1)
         RETURNING *`,
        [
          input.tenantId,
          input.enabled,
          input.cadence,
          input.timezone,
          input.localTime,
          input.weekday,
          input.domains ? JSON.stringify(input.domains) : null,
          input.planningPeriodScope,
          input.severityAlertThreshold,
          input.notifyOnRecovery,
          input.notifyOnTechnicalFailure,
          input.nextRunAt ? input.nextRunAt.toISOString() : null,
          input.userId,
        ],
      );
      await client.query('COMMIT');
      return { policy: insertResult.rows[0]!, isNew: true };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async setPolicyEnabled(
    tenantId: string,
    enabled: boolean,
    nextRunAt: Date | null,
    userId: string,
  ): Promise<OperationPolicyRow | null> {
    const result = await this.database.pool.query<OperationPolicyRow>(
      `UPDATE reconciliation_operation_policies
          SET enabled = $2,
              next_run_at = $3,
              updated_by = $4,
              version = version + 1,
              updated_at = now()
        WHERE tenant_id = $1
        RETURNING *`,
      [tenantId, enabled, nextRunAt ? nextRunAt.toISOString() : null, userId],
    );
    return result.rows[0] ?? null;
  }

  async findDuePolicies(client?: PoolClient): Promise<OperationPolicyRow[]> {
    const q = client ?? this.database.pool;
    const result = await q.query<OperationPolicyRow>(
      `SELECT * FROM reconciliation_operation_policies
        WHERE enabled = true
          AND next_run_at IS NOT NULL
          AND next_run_at <= now()
        FOR UPDATE SKIP LOCKED`,
    );
    return result.rows;
  }

  async advancePolicyNextRun(
    policyId: string,
    nextRunAt: Date | null,
    client?: PoolClient,
  ): Promise<void> {
    const q = client ?? this.database.pool;
    await q.query(
      `UPDATE reconciliation_operation_policies
          SET next_run_at = $2,
              version = version + 1,
              updated_at = now()
        WHERE id = $1`,
      [policyId, nextRunAt ? nextRunAt.toISOString() : null],
    );
  }

  async hasActiveExecutionOrRun(tenantId: string): Promise<boolean> {
    const activeExec = await this.database.pool.query<{ id: string }>(
      `SELECT id FROM reconciliation_operation_executions
        WHERE tenant_id = $1
          AND status IN ('CLAIMED', 'RUNNING')
          AND (lease_expires_at IS NULL OR lease_expires_at > now())
        LIMIT 1`,
      [tenantId],
    );
    if (activeExec.rows.length > 0) return true;

    const activeRun = await this.database.pool.query<{ id: string }>(
      `SELECT id FROM reconciliation_runs
        WHERE tenant_id = $1
          AND status IN ('PENDING', 'RUNNING')
        LIMIT 1`,
      [tenantId],
    );
    return activeRun.rows.length > 0;
  }

  async createScheduledExecution(
    tenantId: string,
    policyId: string,
    scheduledFor: Date,
    missedCount: number = 0,
    initialStatus: 'PENDING' | 'SKIPPED' = 'PENDING',
    skipReason: string | null = null,
    client?: PoolClient,
  ): Promise<OperationExecutionRow | null> {
    const q = client ?? this.database.pool;
    const result = await q.query<OperationExecutionRow>(
      `INSERT INTO reconciliation_operation_executions (
         tenant_id, policy_id, trigger_type, scheduled_for, status,
         missed_occurrences_count, skip_reason
       ) VALUES ($1, $2, 'SCHEDULED', $3, $4, $5, $6)
       ON CONFLICT (tenant_id, policy_id, scheduled_for) DO NOTHING
       RETURNING *`,
      [tenantId, policyId, scheduledFor.toISOString(), initialStatus, missedCount, skipReason],
    );
    return result.rows[0] ?? null;
  }

  async createManualExecution(
    tenantId: string,
    initialStatus: 'PENDING' | 'SKIPPED' = 'PENDING',
    skipReason: string | null = null,
  ): Promise<OperationExecutionRow> {
    const result = await this.database.pool.query<OperationExecutionRow>(
      `INSERT INTO reconciliation_operation_executions (
         tenant_id, trigger_type, scheduled_for, status, skip_reason
       ) VALUES ($1, 'MANUAL', now(), $2, $3)
       RETURNING *`,
      [tenantId, initialStatus, skipReason],
    );
    return result.rows[0]!;
  }

  async getExecution(tenantId: string, id: string): Promise<OperationExecutionRow | null> {
    const result = await this.database.pool.query<OperationExecutionRow>(
      `SELECT e.*, r.id AS reconciliation_run_id, r.critical_findings, r.error_findings, r.warning_findings
         FROM reconciliation_operation_executions e
         LEFT JOIN reconciliation_runs r ON r.operation_execution_id = e.id
        WHERE e.tenant_id = $1 AND e.id = $2`,
      [tenantId, id],
    );
    return result.rows[0] ?? null;
  }

  async getExecutionById(id: string): Promise<OperationExecutionRow | null> {
    const result = await this.database.pool.query<OperationExecutionRow>(
      `SELECT e.*, r.id AS reconciliation_run_id, r.critical_findings, r.error_findings, r.warning_findings
         FROM reconciliation_operation_executions e
         LEFT JOIN reconciliation_runs r ON r.operation_execution_id = e.id
        WHERE e.id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listExecutions(
    tenantId: string,
    query: {
      status?: string | undefined;
      triggerType?: string | undefined;
      limit: number;
      offset: number;
    },
  ): Promise<OperationExecutionRow[]> {
    const conditions = ['e.tenant_id = $1'];
    const values: unknown[] = [tenantId];

    if (query.status) {
      values.push(query.status);
      conditions.push(`e.status = $${values.length}`);
    }
    if (query.triggerType) {
      values.push(query.triggerType);
      conditions.push(`e.trigger_type = $${values.length}`);
    }
    values.push(query.limit);
    values.push(query.offset);

    const result = await this.database.pool.query<OperationExecutionRow>(
      `SELECT e.*, r.id AS reconciliation_run_id, r.critical_findings, r.error_findings, r.warning_findings
         FROM reconciliation_operation_executions e
         LEFT JOIN reconciliation_runs r ON r.operation_execution_id = e.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY coalesce(e.scheduled_for, e.created_at) DESC, e.id DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows;
  }

  async claimExecution(
    executionId: string,
    claimToken: string,
    leaseSeconds: number,
  ): Promise<OperationExecutionRow | null> {
    const result = await this.database.pool.query<OperationExecutionRow>(
      `UPDATE reconciliation_operation_executions
          SET status = 'CLAIMED',
              claimed_at = now(),
              claim_token = $2,
              claim_generation = claim_generation + 1,
              lease_expires_at = now() + ($3 || ' seconds')::interval,
              attempt_count = attempt_count + 1,
              updated_at = now()
        WHERE id = $1
          AND (
            status = 'PENDING'
            OR (status IN ('CLAIMED', 'RUNNING') AND lease_expires_at < now())
          )
        RETURNING *`,
      [executionId, claimToken, leaseSeconds],
    );
    return result.rows[0] ?? null;
  }

  async startExecution(
    executionId: string,
    claimToken: string,
    claimGeneration: number,
    leaseSeconds: number,
  ): Promise<OperationExecutionRow | null> {
    const result = await this.database.pool.query<OperationExecutionRow>(
      `UPDATE reconciliation_operation_executions
          SET status = 'RUNNING',
              started_at = coalesce(started_at, now()),
              lease_expires_at = now() + ($4 || ' seconds')::interval,
              updated_at = now()
        WHERE id = $1
          AND claim_token = $2
          AND claim_generation = $3
        RETURNING *`,
      [executionId, claimToken, claimGeneration, leaseSeconds],
    );
    return result.rows[0] ?? null;
  }

  async renewLease(
    executionId: string,
    claimToken: string,
    claimGeneration: number,
    leaseSeconds: number,
  ): Promise<boolean> {
    const result = await this.database.pool.query<{ id: string }>(
      `UPDATE reconciliation_operation_executions
          SET lease_expires_at = now() + ($4 || ' seconds')::interval,
              updated_at = now()
        WHERE id = $1
          AND claim_token = $2
          AND claim_generation = $3
        RETURNING id`,
      [executionId, claimToken, claimGeneration, leaseSeconds],
    );
    return result.rows.length > 0;
  }

  async completeExecution(
    executionId: string,
    claimToken: string,
    claimGeneration: number,
  ): Promise<OperationExecutionRow | null> {
    const result = await this.database.pool.query<OperationExecutionRow>(
      `UPDATE reconciliation_operation_executions
          SET status = 'COMPLETED',
              completed_at = now(),
              updated_at = now()
        WHERE id = $1
          AND claim_token = $2
          AND claim_generation = $3
        RETURNING *`,
      [executionId, claimToken, claimGeneration],
    );
    return result.rows[0] ?? null;
  }

  async failExecution(
    executionId: string,
    claimToken: string,
    claimGeneration: number,
    errorCode: string,
    errorMessage: string,
  ): Promise<OperationExecutionRow | null> {
    const result = await this.database.pool.query<OperationExecutionRow>(
      `UPDATE reconciliation_operation_executions
          SET status = 'FAILED',
              completed_at = now(),
              last_error_code = $4,
              last_error_message = $5,
              updated_at = now()
        WHERE id = $1
          AND claim_token = $2
          AND claim_generation = $3
        RETURNING *`,
      [executionId, claimToken, claimGeneration, errorCode, errorMessage],
    );
    return result.rows[0] ?? null;
  }

  async cancelPendingExecution(
    tenantId: string,
    executionId: string,
  ): Promise<{ cancelled: boolean; currentStatus?: string }> {
    const row = await this.database.pool.query<{ status: string }>(
      `SELECT status FROM reconciliation_operation_executions
        WHERE id = $1 AND tenant_id = $2`,
      [executionId, tenantId],
    );
    if (!row.rows[0]) return { cancelled: false };
    if (row.rows[0].status !== 'PENDING') {
      return { cancelled: false, currentStatus: row.rows[0].status };
    }

    const updated = await this.database.pool.query<{ id: string }>(
      `UPDATE reconciliation_operation_executions
          SET status = 'CANCELLED',
              skip_reason = 'USER_CANCELLED',
              completed_at = now(),
              updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND status = 'PENDING'
        RETURNING id`,
      [executionId, tenantId],
    );
    return { cancelled: updated.rows.length > 0 };
  }

  async cancelPendingExecutionsByPolicy(policyId: string, reason: string): Promise<number> {
    const result = await this.database.pool.query<{ id: string }>(
      `UPDATE reconciliation_operation_executions
          SET status = 'CANCELLED',
              skip_reason = $2,
              completed_at = now(),
              updated_at = now()
        WHERE policy_id = $1 AND status = 'PENDING'
        RETURNING id`,
      [policyId, reason],
    );
    return result.rows.length;
  }

  async findRunByOperationExecutionId(executionId: string): Promise<{
    id: string;
    status: string;
    critical_findings: number;
    error_findings: number;
    scope: unknown;
  } | null> {
    const result = await this.database.pool.query<{
      id: string;
      status: string;
      critical_findings: number;
      error_findings: number;
      scope: unknown;
    }>(
      `SELECT id, status, critical_findings, error_findings, scope
         FROM reconciliation_runs
        WHERE operation_execution_id = $1
        LIMIT 1`,
      [executionId],
    );
    return result.rows[0] ?? null;
  }

  async findPreviousComparableRun(
    tenantId: string,
    currentRunId: string,
  ): Promise<{
    id: string;
    status: string;
    critical_findings: number;
    error_findings: number;
    scope: unknown;
  } | null> {
    const result = await this.database.pool.query<{
      id: string;
      status: string;
      critical_findings: number;
      error_findings: number;
      scope: unknown;
    }>(
      `SELECT id, status, critical_findings, error_findings, scope
         FROM reconciliation_runs
        WHERE tenant_id = $1
          AND id != $2
          AND status = 'COMPLETED'
        ORDER BY completed_at DESC, started_at DESC
        LIMIT 10`,
      [tenantId, currentRunId],
    );
    return result.rows[0] ?? null;
  }

  async getRunStatsForSummary(
    tenantId: string,
    runId: string,
  ): Promise<{
    newIssuesCount: number;
    reopenedIssuesCount: number;
    acceptedRiskIssuesCount: number;
    overdueAcceptedRiskCount: number;
  }> {
    const newIssuesRes = await this.database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM reconciliation_issues
        WHERE tenant_id = $1 AND first_run_id = $2`,
      [tenantId, runId],
    );
    const reopenedRes = await this.database.pool.query<{ count: string }>(
      `SELECT count(distinct issue_id)::text AS count FROM reconciliation_issue_events
        WHERE tenant_id = $1 AND reconciliation_run_id = $2 AND event_type = 'REOPENED'`,
      [tenantId, runId],
    );
    const acceptedRiskRes = await this.database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM reconciliation_issues
        WHERE tenant_id = $1 AND last_run_id = $2 AND status = 'ACCEPTED_RISK'`,
      [tenantId, runId],
    );
    const overdueRes = await this.database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM reconciliation_issues
        WHERE tenant_id = $1 AND status = 'ACCEPTED_RISK'
          AND risk_review_at IS NOT NULL AND risk_review_at < now()`,
      [tenantId],
    );

    return {
      newIssuesCount: parseInt(newIssuesRes.rows[0]?.count ?? '0', 10),
      reopenedIssuesCount: parseInt(reopenedRes.rows[0]?.count ?? '0', 10),
      acceptedRiskIssuesCount: parseInt(acceptedRiskRes.rows[0]?.count ?? '0', 10),
      overdueAcceptedRiskCount: parseInt(overdueRes.rows[0]?.count ?? '0', 10),
    };
  }

  async insertNotification(data: {
    tenantId: string;
    executionId?: string | null | undefined;
    reconciliationRunId?: string | null | undefined;
    notificationType: string;
    severity: string;
    dedupKey: string;
    status?: string | undefined;
    channel?: string | undefined;
    payload: Record<string, unknown>;
  }): Promise<NotificationRow | null> {
    const result = await this.database.pool.query<NotificationRow>(
      `INSERT INTO reconciliation_notifications (
         tenant_id, execution_id, reconciliation_run_id, notification_type,
         severity, dedup_key, status, channel, payload_json, sent_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
       ON CONFLICT (dedup_key) DO NOTHING
       RETURNING *`,
      [
        data.tenantId,
        data.executionId ?? null,
        data.reconciliationRunId ?? null,
        data.notificationType,
        data.severity,
        data.dedupKey,
        data.status ?? 'SENT',
        data.channel ?? 'IN_APP',
        JSON.stringify(data.payload),
      ],
    );
    return result.rows[0] ?? null;
  }

  async listNotifications(
    tenantId: string,
    query: {
      unreadOnly?: boolean | undefined;
      status?: string | undefined;
      severity?: string | undefined;
      limit: number;
      offset: number;
    },
  ): Promise<NotificationRow[]> {
    const conditions = ['tenant_id = $1'];
    const values: unknown[] = [tenantId];

    if (query.unreadOnly) {
      conditions.push('read_at IS NULL');
    }
    if (query.status) {
      values.push(query.status);
      conditions.push(`status = $${values.length}`);
    }
    if (query.severity) {
      values.push(query.severity);
      conditions.push(`severity = $${values.length}`);
    }
    values.push(query.limit);
    values.push(query.offset);

    const result = await this.database.pool.query<NotificationRow>(
      `SELECT * FROM reconciliation_notifications
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows;
  }

  async markNotificationRead(
    tenantId: string,
    notificationId: string,
  ): Promise<NotificationRow | null> {
    const result = await this.database.pool.query<NotificationRow>(
      `UPDATE reconciliation_notifications
          SET read_at = coalesce(read_at, now()),
              updated_at = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [notificationId, tenantId],
    );
    return result.rows[0] ?? null;
  }

  async markAllNotificationsRead(tenantId: string): Promise<number> {
    const result = await this.database.pool.query<{ count: string }>(
      `WITH updated AS (
         UPDATE reconciliation_notifications
            SET read_at = coalesce(read_at, now()),
                updated_at = now()
          WHERE tenant_id = $1 AND read_at IS NULL
          RETURNING id
       )
       SELECT count(*)::text AS count FROM updated`,
      [tenantId],
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  async insertAudit(input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    after: Record<string, unknown>;
    correlationId: string;
  }): Promise<void> {
    await this.database.pool.query(
      `INSERT INTO audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
       VALUES ('USER', $1, $2, $3, $4, $5, $6::jsonb, $7::uuid, $8, 'SUCCESS')`,
      [
        input.actorUserId,
        input.tenantId,
        input.action,
        input.resourceType,
        input.resourceId,
        JSON.stringify(input.after),
        input.correlationId,
        input.correlationId,
      ],
    );
  }
}

export function mapPolicyRow(row: OperationPolicyRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    enabled: row.enabled,
    cadence: row.cadence,
    timezone: row.timezone,
    localTime: row.local_time,
    weekday: row.weekday,
    domains: Array.isArray(row.domains) ? row.domains : null,
    planningPeriodScope: row.planning_period_scope,
    severityAlertThreshold: row.severity_alert_threshold,
    notifyOnRecovery: row.notify_on_recovery,
    notifyOnTechnicalFailure: row.notify_on_technical_failure,
    nextRunAt: asIso(row.next_run_at),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    version: row.version,
    createdAt: asIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: asIso(row.updated_at) ?? new Date().toISOString(),
  };
}

export function mapExecutionRow(row: OperationExecutionRow) {
  let runHealth: 'HEALTHY' | 'UNHEALTHY' | null = null;
  if (row.critical_findings != null && row.error_findings != null) {
    runHealth = row.critical_findings === 0 && row.error_findings === 0 ? 'HEALTHY' : 'UNHEALTHY';
  }

  return {
    id: row.id,
    tenantId: row.tenant_id,
    policyId: row.policy_id,
    triggerType: row.trigger_type,
    scheduledFor: asIso(row.scheduled_for),
    claimedAt: asIso(row.claimed_at),
    startedAt: asIso(row.started_at),
    completedAt: asIso(row.completed_at),
    status: row.status,
    reconciliationRunId: row.reconciliation_run_id,
    attemptCount: row.attempt_count,
    claimToken: row.claim_token,
    claimGeneration: row.claim_generation,
    leaseExpiresAt: asIso(row.lease_expires_at),
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    missedOccurrencesCount: row.missed_occurrences_count,
    skipReason: row.skip_reason,
    createdAt: asIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: asIso(row.updated_at) ?? new Date().toISOString(),
    runHealth,
    criticalFindings: row.critical_findings == null ? null : Number(row.critical_findings),
    errorFindings: row.error_findings == null ? null : Number(row.error_findings),
    warningFindings: row.warning_findings == null ? null : Number(row.warning_findings),
  };
}

export function mapNotificationRow(row: NotificationRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    executionId: row.execution_id,
    reconciliationRunId: row.reconciliation_run_id,
    notificationType: row.notification_type,
    severity: row.severity,
    dedupKey: row.dedup_key,
    status: row.status,
    channel: row.channel,
    payload: row.payload_json ?? {},
    attemptCount: row.attempt_count,
    readAt: asIso(row.read_at),
    sentAt: asIso(row.sent_at),
    lastErrorCode: row.last_error_code,
    createdAt: asIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: asIso(row.updated_at) ?? new Date().toISOString(),
  };
}
