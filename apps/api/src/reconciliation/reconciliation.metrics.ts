import { Inject, Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry } from 'prom-client';

export class ReconciliationMetrics {
  readonly runsTotal: Counter;
  readonly findingsTotal: Counter;
  readonly ruleDuration: Histogram;
  readonly runDuration: Histogram;

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
  }
}

@Injectable()
export class ReconciliationMetricsProvider {
  readonly metrics: ReconciliationMetrics;
  constructor(@Inject(Registry) registry: Registry) {
    this.metrics = new ReconciliationMetrics(registry);
  }
}
