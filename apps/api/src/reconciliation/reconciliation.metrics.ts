import { Inject, Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export class ReconciliationMetrics {
  readonly runsTotal: Counter;
  readonly findingsTotal: Counter;
  readonly ruleDuration: Histogram;
  readonly runDuration: Histogram;
  readonly issueTransitions: Counter;
  readonly openIssues: Gauge;
  readonly scheduledExecutionsTotal: Counter;
  readonly schedulerLagSeconds: Histogram;
  readonly executionDurationSeconds: Histogram;
  readonly notificationsTotal: Counter;
  readonly activeExecutions: Gauge;

  constructor(registry: Registry) {
    this.runsTotal = new Counter({
      name: 'reconciliation_runs_total',
      help: 'Operational reconciliation runs',
      labelNames: ['status'],
      registers: [registry],
    });
    this.findingsTotal = new Counter({
      name: 'reconciliation_findings_total',
      help: 'Operational reconciliation findings',
      labelNames: ['severity', 'domain'],
      registers: [registry],
    });
    this.ruleDuration = new Histogram({
      name: 'reconciliation_rule_duration',
      help: 'Reconciliation rule duration in seconds',
      labelNames: ['rule_code'],
      registers: [registry],
    });
    this.runDuration = new Histogram({
      name: 'reconciliation_run_duration',
      help: 'Reconciliation run duration in seconds',
      registers: [registry],
    });
    this.issueTransitions = new Counter({
      name: 'reconciliation_issue_transitions_total',
      help: 'Reconciliation issue governance transitions',
      labelNames: ['event_type'],
      registers: [registry],
    });
    this.openIssues = new Gauge({
      name: 'reconciliation_open_issues',
      help: 'Persistent reconciliation issues by status and current severity',
      labelNames: ['status', 'severity'],
      registers: [registry],
    });
    this.scheduledExecutionsTotal = new Counter({
      name: 'reconciliation_scheduled_executions_total',
      help: 'Operational reconciliation executions by status and trigger',
      labelNames: ['status', 'trigger_type'],
      registers: [registry],
    });
    this.schedulerLagSeconds = new Histogram({
      name: 'reconciliation_scheduler_lag_seconds',
      help: 'Scheduler delay in seconds between scheduled_for and started_at',
      registers: [registry],
    });
    this.executionDurationSeconds = new Histogram({
      name: 'reconciliation_execution_duration_seconds',
      help: 'Total duration of operational reconciliation execution in seconds',
      registers: [registry],
    });
    this.notificationsTotal = new Counter({
      name: 'reconciliation_notification_total',
      help: 'Reconciliation operational notifications generated',
      labelNames: ['type', 'status', 'channel'],
      registers: [registry],
    });
    this.activeExecutions = new Gauge({
      name: 'reconciliation_active_execution',
      help: 'Number of currently running reconciliation executions',
      registers: [registry],
    });
  }

  setOpenIssueCounts(rows: ReadonlyArray<{ status: string; severity: string; n: number }>): void {
    this.openIssues.reset();
    for (const row of rows) {
      this.openIssues.set({ status: row.status, severity: row.severity }, row.n);
    }
  }
}

@Injectable()
export class ReconciliationMetricsProvider {
  readonly metrics: ReconciliationMetrics;
  constructor(@Inject(Registry) registry: Registry = new Registry()) {
    this.metrics = new ReconciliationMetrics(registry);
  }
}
