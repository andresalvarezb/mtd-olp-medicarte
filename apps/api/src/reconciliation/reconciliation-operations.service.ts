import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ListReconciliationNotificationsQuery,
  ListReconciliationOperationExecutionsQuery,
  TriggerManualOperationExecutionRequest,
  UpsertReconciliationOperationPolicyRequest,
} from '@authorization/contracts';
import {
  calculateNextSlot,
  countMissedSlots,
  evaluateHealthAlert,
  shouldEmitRecovery,
  type PolicyScheduleConfig,
  type ReconciliationCadence,
  type ReconciliationDomain,
  type ReconciliationSeverityAlertThreshold,
} from '@authorization/domain';
import { ReconciliationEngine } from './reconciliation.engine';
import { ReconciliationMetricsProvider } from './reconciliation.metrics';
import {
  mapExecutionRow,
  mapNotificationRow,
  mapPolicyRow,
  ReconciliationOperationsRepository,
  type OperationExecutionRow,
  type OperationPolicyRow,
} from './reconciliation-operations.repository';
import { ReconciliationRepository } from './reconciliation.repository';
import { DATABASE } from '../tokens';
import type { createDatabase } from '@authorization/database';

type Database = ReturnType<typeof createDatabase>;

@Injectable()
export class ReconciliationOperationsService {
  private readonly engine: ReconciliationEngine;

  constructor(
    private readonly repository: ReconciliationOperationsRepository,
    private readonly reconciliationRepo: ReconciliationRepository,
    private readonly metrics: ReconciliationMetricsProvider,
    @Inject(DATABASE) private readonly database: Pick<Database, 'pool'>,
  ) {
    this.engine = new ReconciliationEngine(database.pool, reconciliationRepo, metrics.metrics);
  }

  async getPolicy(tenantId: string) {
    const row = await this.repository.getPolicy(tenantId);
    return row ? mapPolicyRow(row) : null;
  }

  async upsertPolicy(
    tenantId: string,
    userId: string,
    body: UpsertReconciliationOperationPolicyRequest,
    correlationId: string = randomUUID(),
  ) {
    const scheduleConfig: PolicyScheduleConfig = {
      cadence: body.cadence,
      timezone: body.timezone,
      localTime: body.localTime ?? null,
      weekday: body.weekday ?? null,
    };

    let nextRunAt: Date | null = null;
    if (body.enabled) {
      nextRunAt = calculateNextSlot(scheduleConfig, new Date());
    }

    try {
      const { policy, isNew } = await this.repository.upsertPolicy({
        tenantId,
        enabled: body.enabled,
        cadence: body.cadence,
        timezone: body.timezone ?? 'America/Bogota',
        localTime: body.localTime ?? null,
        weekday: body.weekday ?? null,
        domains: body.domains ?? null,
        planningPeriodScope: body.planningPeriodScope ?? null,
        severityAlertThreshold: body.severityAlertThreshold ?? 'ERROR',
        notifyOnRecovery: body.notifyOnRecovery ?? true,
        notifyOnTechnicalFailure: body.notifyOnTechnicalFailure ?? true,
        nextRunAt,
        userId,
        expectedVersion: body.expectedVersion,
      });

      // If updating an enabled policy and schedule changed, cancel pending future runs
      if (!isNew && body.enabled) {
        await this.repository.cancelPendingExecutionsByPolicy(policy.id, 'POLICY_SCHEDULE_CHANGED');
      }

      await this.repository.insertAudit({
        tenantId,
        actorUserId: userId,
        action: isNew ? 'RECONCILIATION_POLICY_CREATED' : 'RECONCILIATION_POLICY_UPDATED',
        resourceType: 'reconciliation_operation_policy',
        resourceId: policy.id,
        after: mapPolicyRow(policy),
        correlationId,
      });

      return mapPolicyRow(policy);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'VERSION_CONFLICT') {
        throw new ConflictException({
          code: 'VERSION_CONFLICT',
          message: 'The policy has been modified by another user.',
        });
      }
      throw err;
    }
  }

  async enablePolicy(tenantId: string, userId: string, correlationId: string = randomUUID()) {
    const existing = await this.repository.getPolicy(tenantId);
    if (!existing) {
      throw new NotFoundException({
        code: 'RECONCILIATION_POLICY_NOT_FOUND',
        message: 'Policy not found for tenant',
      });
    }

    const scheduleConfig: PolicyScheduleConfig = {
      cadence: existing.cadence as ReconciliationCadence,
      timezone: existing.timezone,
      localTime: existing.local_time,
      weekday: existing.weekday,
    };
    const nextRunAt = calculateNextSlot(scheduleConfig, new Date());

    const updated = await this.repository.setPolicyEnabled(tenantId, true, nextRunAt, userId);
    if (!updated) {
      throw new NotFoundException({
        code: 'RECONCILIATION_POLICY_NOT_FOUND',
        message: 'Policy not found',
      });
    }

    await this.repository.insertAudit({
      tenantId,
      actorUserId: userId,
      action: 'RECONCILIATION_POLICY_ENABLED',
      resourceType: 'reconciliation_operation_policy',
      resourceId: updated.id,
      after: mapPolicyRow(updated),
      correlationId,
    });

    return mapPolicyRow(updated);
  }

  async disablePolicy(tenantId: string, userId: string, correlationId: string = randomUUID()) {
    const existing = await this.repository.getPolicy(tenantId);
    if (!existing) {
      throw new NotFoundException({
        code: 'RECONCILIATION_POLICY_NOT_FOUND',
        message: 'Policy not found for tenant',
      });
    }

    await this.repository.cancelPendingExecutionsByPolicy(existing.id, 'POLICY_DISABLED');
    const updated = await this.repository.setPolicyEnabled(tenantId, false, null, userId);
    if (!updated) {
      throw new NotFoundException({
        code: 'RECONCILIATION_POLICY_NOT_FOUND',
        message: 'Policy not found',
      });
    }

    await this.repository.insertAudit({
      tenantId,
      actorUserId: userId,
      action: 'RECONCILIATION_POLICY_DISABLED',
      resourceType: 'reconciliation_operation_policy',
      resourceId: updated.id,
      after: mapPolicyRow(updated),
      correlationId,
    });

    return mapPolicyRow(updated);
  }

  async listExecutions(tenantId: string, query: ListReconciliationOperationExecutionsQuery) {
    const rows = await this.repository.listExecutions(tenantId, query);
    return { items: rows.map((r) => mapExecutionRow(r)) };
  }

  async getExecution(tenantId: string, id: string) {
    const row = await this.repository.getExecution(tenantId, id);
    if (!row) {
      throw new NotFoundException({
        code: 'RECONCILIATION_EXECUTION_NOT_FOUND',
        message: 'Execution not found',
      });
    }
    return mapExecutionRow(row);
  }

  async cancelExecution(
    tenantId: string,
    id: string,
    userId: string,
    correlationId: string = randomUUID(),
  ) {
    const result = await this.repository.cancelPendingExecution(tenantId, id);
    if (result.currentStatus && result.currentStatus !== 'PENDING') {
      throw new ConflictException({
        code: 'CANNOT_CANCEL_ACTIVE_EXECUTION',
        message: 'Cannot cancel an execution that is not pending',
      });
    }
    if (!result.cancelled) {
      throw new NotFoundException({
        code: 'RECONCILIATION_EXECUTION_NOT_FOUND',
        message: 'Execution not found or not in pending status',
      });
    }

    await this.repository.insertAudit({
      tenantId,
      actorUserId: userId,
      action: 'RECONCILIATION_EXECUTION_CANCELLED',
      resourceType: 'reconciliation_operation_execution',
      resourceId: id,
      after: { id, status: 'CANCELLED' },
      correlationId,
    });

    return this.getExecution(tenantId, id);
  }

  async triggerManual(
    tenantId: string,
    userId: string,
    params: TriggerManualOperationExecutionRequest = {},
    correlationId: string = randomUUID(),
  ) {
    // Exclusion of overlapping runs
    const isRunning = await this.repository.hasActiveExecutionOrRun(tenantId);
    if (isRunning) {
      throw new ConflictException({
        code: 'RECONCILIATION_ALREADY_RUNNING',
        message: 'Ya existe una reconciliación en ejecución para esta organización.',
      });
    }

    const execution = await this.repository.createManualExecution(tenantId, 'PENDING');

    await this.repository.insertAudit({
      tenantId,
      actorUserId: userId,
      action: 'RECONCILIATION_MANUAL_RUN_TRIGGERED',
      resourceType: 'reconciliation_operation_execution',
      resourceId: execution.id,
      after: mapExecutionRow(execution),
      correlationId,
    });

    // Run execution immediately
    const claimToken = randomUUID();
    const overrideScope = {
      ...(params.domains ? { domains: params.domains } : {}),
      ...(params.planningPeriodId ? { planningPeriodId: params.planningPeriodId } : {}),
      ...(params.dispensingPointId ? { dispensingPointId: params.dispensingPointId } : {}),
      ...(params.commercialCode ? { commercialCode: params.commercialCode } : {}),
    };
    await this.processExecution(execution.id, claimToken, 120, 3, overrideScope);

    return this.getExecution(tenantId, execution.id);
  }

  async materializeDuePolicies(): Promise<OperationExecutionRow[]> {
    const duePolicies = await this.repository.findDuePolicies();
    const materialized: OperationExecutionRow[] = [];

    for (const policy of duePolicies) {
      const scheduledFor = policy.next_run_at ? new Date(policy.next_run_at) : new Date();
      const now = new Date();

      const scheduleConfig: PolicyScheduleConfig = {
        cadence: policy.cadence as ReconciliationCadence,
        timezone: policy.timezone,
        localTime: policy.local_time,
        weekday: policy.weekday,
      };

      const missedCount = countMissedSlots(scheduleConfig, scheduledFor, now);
      const nextFutureSlot = calculateNextSlot(scheduleConfig, now);

      await this.repository.advancePolicyNextRun(policy.id, nextFutureSlot);

      // Check if another execution is currently active for this tenant
      const hasActive = await this.repository.hasActiveExecutionOrRun(policy.tenant_id);
      const initialStatus = hasActive ? 'SKIPPED' : 'PENDING';
      const skipReason = hasActive ? 'PREVIOUS_EXECUTION_RUNNING' : null;

      const created = await this.repository.createScheduledExecution(
        policy.tenant_id,
        policy.id,
        scheduledFor,
        missedCount,
        initialStatus,
        skipReason,
      );

      if (created) {
        materialized.push(created);
        this.metrics.metrics.scheduledExecutionsTotal.inc({
          status: created.status,
          trigger_type: created.trigger_type,
        });
      }
    }

    return materialized;
  }

  async tickScheduler(
    leaseSeconds: number = 120,
    maxAttempts: number = 3,
  ): Promise<{
    materialized: OperationExecutionRow[];
    processed: string[];
  }> {
    const materialized = await this.materializeDuePolicies();
    const processed: string[] = [];

    const pendingRows = await this.database.pool.query<OperationExecutionRow>(
      `SELECT * FROM reconciliation_operation_executions
        WHERE status = 'PENDING'
           OR (status IN ('CLAIMED', 'RUNNING') AND lease_expires_at < now())
        ORDER BY coalesce(scheduled_for, created_at) ASC`,
    );

    for (const exec of pendingRows.rows) {
      const claimToken = randomUUID();
      try {
        await this.processExecution(exec.id, claimToken, leaseSeconds, maxAttempts);
        processed.push(exec.id);
      } catch {
        // Handled inside processExecution
      }
    }

    return { materialized, processed };
  }

  async processExecution(
    executionId: string,
    claimToken: string,
    leaseSeconds: number = 120,
    maxAttempts: number = 3,
    overrideScope?: {
      domains?: readonly ReconciliationDomain[];
      planningPeriodId?: string;
      dispensingPointId?: string;
      commercialCode?: string;
      statementTimeoutMs?: number;
    },
  ): Promise<void> {
    const claimed = await this.repository.claimExecution(executionId, claimToken, leaseSeconds);
    if (!claimed) return; // Lost claim to another worker

    const generation = claimed.claim_generation;
    const started = await this.repository.startExecution(
      executionId,
      claimToken,
      generation,
      leaseSeconds,
    );
    if (!started) return; // Lost fencing

    if (claimed.scheduled_for) {
      const lag = (Date.now() - new Date(claimed.scheduled_for).getTime()) / 1000;
      this.metrics.metrics.schedulerLagSeconds.observe(Math.max(0, lag));
    }
    this.metrics.metrics.activeExecutions.inc();

    let heartbeatTimer: NodeJS.Timeout | null = null;
    let leaseLost = false;

    // Renew lease every leaseSeconds / 3
    const heartbeatIntervalMs = Math.max(5000, Math.floor((leaseSeconds * 1000) / 3));
    heartbeatTimer = setInterval(() => {
      void (async () => {
        try {
          const renewed = await this.repository.renewLease(
            executionId,
            claimToken,
            generation,
            leaseSeconds,
          );
          if (!renewed) {
            leaseLost = true;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
          }
        } catch {
          leaseLost = true;
        }
      })();
    }, heartbeatIntervalMs);

    const execBegan = Date.now();
    try {
      // Crash recovery: check if run already exists for this operation_execution_id
      const existingRun = await this.repository.findRunByOperationExecutionId(executionId);
      let runId: string;

      if (existingRun) {
        if (existingRun.status === 'COMPLETED') {
          runId = existingRun.id;
        } else if (existingRun.status === 'FAILED') {
          throw new Error('RECONCILIATION_RUN_FAILED');
        } else {
          // If still running/pending from crash, fail
          throw new Error('STALE_RUN_IN_PROGRESS');
        }
      } else {
        // Execute reconciliation engine
        const policy = claimed.policy_id
          ? await this.repository.getPolicy(claimed.tenant_id)
          : null;

        const domains: readonly ReconciliationDomain[] | undefined =
          overrideScope?.domains ??
          (Array.isArray(policy?.domains) ? (policy.domains as ReconciliationDomain[]) : undefined);

        const result = await this.engine.execute({
          tenantId: claimed.tenant_id,
          startedBy: null,
          ...(domains ? { domains } : {}),
          ...(overrideScope?.planningPeriodId
            ? { planningPeriodId: overrideScope.planningPeriodId }
            : {}),
          ...(overrideScope?.dispensingPointId
            ? { dispensingPointId: overrideScope.dispensingPointId }
            : {}),
          ...(overrideScope?.commercialCode
            ? { commercialCode: overrideScope.commercialCode }
            : {}),
          ...(overrideScope?.statementTimeoutMs
            ? { statementTimeoutMs: overrideScope.statementTimeoutMs }
            : {}),
          operationExecutionId: executionId,
        });
        runId = result.id;

        const createdRun = await this.repository.findRunByOperationExecutionId(executionId);
        if (createdRun?.status === 'FAILED') {
          throw new Error('RECONCILIATION_RUN_FAILED');
        }
      }

      if (heartbeatTimer) clearInterval(heartbeatTimer);

      if (leaseLost) {
        throw new Error('LEASE_LOST');
      }

      // Fencing check on complete
      const completed = await this.repository.completeExecution(
        executionId,
        claimToken,
        generation,
      );

      if (!completed) {
        throw new Error('LEASE_LOST');
      }

      this.metrics.metrics.scheduledExecutionsTotal.inc({
        status: 'COMPLETED',
        trigger_type: claimed.trigger_type,
      });
      this.metrics.metrics.executionDurationSeconds.observe((Date.now() - execBegan) / 1000);

      // Evaluate and emit alerts
      const policy = await this.repository.getPolicy(claimed.tenant_id);
      await this.evaluateAlertsForRun(claimed.tenant_id, executionId, runId, policy);
    } catch (err: unknown) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);

      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage === 'LEASE_LOST') {
        // Another worker took over with a higher generation; abort silently
        return;
      }

      // If attempts exceeded or non-retryable failure, mark FAILED
      if (claimed.attempt_count >= maxAttempts) {
        await this.repository.failExecution(
          executionId,
          claimToken,
          generation,
          'RECONCILIATION_RUN_FAILED',
          errorMessage,
        );
        this.metrics.metrics.scheduledExecutionsTotal.inc({
          status: 'FAILED',
          trigger_type: claimed.trigger_type,
        });

        // Notify technical failure if policy enables it
        const policy = await this.repository.getPolicy(claimed.tenant_id);
        if (policy?.notify_on_technical_failure) {
          const dedupKey = `TECHNICAL_FAILURE:${executionId}:${claimed.attempt_count}`;
          await this.repository.insertNotification({
            tenantId: claimed.tenant_id,
            executionId,
            reconciliationRunId: null,
            notificationType: 'RECONCILIATION_TECHNICAL_FAILURE',
            severity: 'ERROR',
            dedupKey,
            status: 'SENT',
            channel: 'IN_APP',
            payload: {
              executionId,
              errorCode: 'RECONCILIATION_RUN_FAILED',
              errorMessage,
              attemptCount: claimed.attempt_count,
            },
          });
          this.metrics.metrics.notificationsTotal.inc({
            type: 'RECONCILIATION_TECHNICAL_FAILURE',
            status: 'SENT',
            channel: 'IN_APP',
          });
        }
      }
      throw err;
    } finally {
      this.metrics.metrics.activeExecutions.dec();
    }
  }

  async evaluateAlertsForRun(
    tenantId: string,
    executionId: string | null,
    runId: string,
    policy: OperationPolicyRow | null,
  ): Promise<void> {
    try {
      const runRow = await this.reconciliationRepo.getRun(tenantId, runId);
      if (!runRow) return;

      const stats = await this.repository.getRunStatsForSummary(tenantId, runId);
      const threshold = (policy?.severity_alert_threshold ??
        'ERROR') as ReconciliationSeverityAlertThreshold;

      const payload = {
        runId,
        executionId,
        critical: Number(runRow.critical_findings),
        error: Number(runRow.error_findings),
        warning: Number(runRow.warning_findings),
        info: Number(runRow.info_findings),
        newIssuesCount: stats.newIssuesCount,
        reopenedIssuesCount: stats.reopenedIssuesCount,
        acceptedRiskIssuesCount: stats.acceptedRiskIssuesCount,
        overdueAcceptedRiskCount: stats.overdueAcceptedRiskCount,
      };

      // 1. Health Alert based on threshold
      const healthAlert = evaluateHealthAlert({
        threshold,
        criticalFindings: Number(runRow.critical_findings),
        errorFindings: Number(runRow.error_findings),
        warningFindings: Number(runRow.warning_findings),
      });

      if (healthAlert.shouldAlert && healthAlert.notificationType && healthAlert.severity) {
        const dedupKey = `RUN_HEALTH:${runId}`;
        const inserted = await this.repository.insertNotification({
          tenantId,
          executionId,
          reconciliationRunId: runId,
          notificationType: healthAlert.notificationType,
          severity: healthAlert.severity,
          dedupKey,
          status: 'SENT',
          channel: 'IN_APP',
          payload,
        });
        if (inserted) {
          this.metrics.metrics.notificationsTotal.inc({
            type: healthAlert.notificationType,
            status: 'SENT',
            channel: 'IN_APP',
          });
        }
      }

      // 2. Recovery Notification
      if (policy?.notify_on_recovery) {
        const prevRun = await this.repository.findPreviousComparableRun(tenantId, runId);
        if (
          prevRun &&
          shouldEmitRecovery(
            { notifyOnRecovery: true },
            {
              criticalFindings: Number(prevRun.critical_findings),
              errorFindings: Number(prevRun.error_findings),
              scope: (prevRun.scope as Record<string, unknown> | null) ?? null,
            },
            {
              criticalFindings: Number(runRow.critical_findings),
              errorFindings: Number(runRow.error_findings),
              scope: (runRow.scope as Record<string, unknown> | null) ?? null,
            },
          )
        ) {
          const dedupKey = `RECOVERY:${runId}`;
          const inserted = await this.repository.insertNotification({
            tenantId,
            executionId,
            reconciliationRunId: runId,
            notificationType: 'RECONCILIATION_RECOVERY',
            severity: 'INFO',
            dedupKey,
            status: 'SENT',
            channel: 'IN_APP',
            payload,
          });
          if (inserted) {
            this.metrics.metrics.notificationsTotal.inc({
              type: 'RECONCILIATION_RECOVERY',
              status: 'SENT',
              channel: 'IN_APP',
            });
          }
        }
      }

      // 3. Overdue Accepted Risk
      if (stats.overdueAcceptedRiskCount > 0) {
        const dedupKey = `RISK_OVERDUE:${executionId ?? runId}`;
        const inserted = await this.repository.insertNotification({
          tenantId,
          executionId,
          reconciliationRunId: runId,
          notificationType: 'RISK_REVIEW_OVERDUE',
          severity: 'WARNING',
          dedupKey,
          status: 'SENT',
          channel: 'IN_APP',
          payload,
        });
        if (inserted) {
          this.metrics.metrics.notificationsTotal.inc({
            type: 'RISK_REVIEW_OVERDUE',
            status: 'SENT',
            channel: 'IN_APP',
          });
        }
      }
    } catch {
      // Alert failure must not fail or roll back the reconciliation execution/run!
    }
  }

  async listNotifications(tenantId: string, query: ListReconciliationNotificationsQuery) {
    const rows = await this.repository.listNotifications(tenantId, query);
    return { items: rows.map((r) => mapNotificationRow(r)) };
  }

  async markNotificationRead(tenantId: string, notificationId: string) {
    const row = await this.repository.markNotificationRead(tenantId, notificationId);
    if (!row) {
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification not found',
      });
    }
    return mapNotificationRow(row);
  }

  async markAllNotificationsRead(tenantId: string) {
    const count = await this.repository.markAllNotificationsRead(tenantId);
    return { markedReadCount: count };
  }
}
