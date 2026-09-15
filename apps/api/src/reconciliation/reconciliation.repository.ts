import { Inject, Injectable } from '@nestjs/common';
import type { createDatabase } from '@authorization/database';
import type { ReconciliationFindingListQuery } from '@authorization/contracts';
import {
  reconciliationRunScopeSchema,
  reconciliationRunStatusSchema,
} from '@authorization/contracts';
import { DATABASE } from '../tokens';
import type { PersistedFinding, ReconciliationRunScope } from './reconciliation.types';
import type { EngineRuleResult } from './reconciliation.types';

type Database = ReturnType<typeof createDatabase>;

type ReconciliationRunRow = {
  id: string;
  tenant_id: string;
  status: string;
  scope: unknown;
  started_at: Date | string;
  completed_at: Date | string | null;
  started_by: string | null;
  rules_version: string;
  total_rules: number;
  passed_rules: number;
  failed_rules: number;
  not_applicable_rules: number;
  critical_findings: number;
  error_findings: number;
  warning_findings: number;
  info_findings: number;
  generated_at: Date | string | null;
  duration_ms: number | null;
  metadata: { ruleResults?: EngineRuleResult[] } | null;
};

type ReconciliationFindingRow = {
  id: string;
  reconciliation_run_id: string;
  rule_code: string;
  rule_version: string;
  category: string;
  severity: string;
  domain: string;
  entity_type: string;
  entity_id: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  dispensing_point_id: string | null;
  planning_period_id: string | null;
  commercial_code: string | null;
  message: string;
  evidence_json: Record<string, unknown> | null;
  fingerprint: string;
  truncated: boolean;
  detected_at: Date | string;
};

function asIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const FINDING_BATCH = 200;

@Injectable()
export class ReconciliationRepository {
  constructor(@Inject(DATABASE) private readonly database: Pick<Database, 'pool'>) {}

  async createRun(input: {
    tenantId: string;
    startedBy: string | null;
    scope: ReconciliationRunScope;
    rulesVersion: string;
    totalRules: number;
  }): Promise<string> {
    const result = await this.database.pool.query<{ id: string }>(
      `insert into reconciliation_runs
         (tenant_id, status, scope, started_by, rules_version, total_rules, metadata)
       values ($1,'PENDING',$2::jsonb,$3,$4,$5,'{}'::jsonb)
       returning id`,
      [
        input.tenantId,
        JSON.stringify(input.scope),
        input.startedBy,
        input.rulesVersion,
        input.totalRules,
      ],
    );
    return result.rows[0]!.id;
  }

  async markRunning(id: string): Promise<void> {
    await this.database.pool.query(
      `update reconciliation_runs set status = 'RUNNING' where id = $1`,
      [id],
    );
  }

  async insertFindings(runId: string, findings: readonly PersistedFinding[]): Promise<void> {
    if (findings.length === 0) return;
    for (let index = 0; index < findings.length; index += FINDING_BATCH) {
      const batch = findings.slice(index, index + FINDING_BATCH);
      const values: unknown[] = [];
      const tuples = batch.map((finding) => {
        const base = values.length;
        values.push(
          runId,
          finding.ruleCode,
          finding.ruleVersion,
          finding.category,
          finding.severity,
          finding.domain,
          finding.entityType,
          finding.entityId,
          finding.relatedEntityType,
          finding.relatedEntityId,
          finding.dispensingPointId,
          finding.planningPeriodId,
          finding.commercialCode,
          finding.message,
          JSON.stringify(finding.evidence),
          finding.fingerprint,
          finding.truncated,
        );
        const slots = Array.from({ length: 17 }, (_, slot) => `$${base + slot + 1}`);
        return `(${slots.join(',')})`;
      });
      await this.database.pool.query(
        `insert into reconciliation_findings (
           reconciliation_run_id, rule_code, rule_version, category, severity, domain,
           entity_type, entity_id, related_entity_type, related_entity_id,
           dispensing_point_id, planning_period_id, commercial_code, message,
           evidence_json, fingerprint, truncated
         ) values ${tuples.join(',')}
         on conflict (reconciliation_run_id, rule_code, fingerprint) do nothing`,
        values,
      );
    }
  }

  async completeRun(
    id: string,
    input: {
      status: 'COMPLETED' | 'FAILED';
      passedRules: number;
      failedRules: number;
      notApplicableRules: number;
      criticalFindings: number;
      errorFindings: number;
      warningFindings: number;
      infoFindings: number;
      durationMs: number;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.database.pool.query(
      `update reconciliation_runs
          set status = $2,
              completed_at = now(),
              generated_at = now(),
              passed_rules = $3,
              failed_rules = $4,
              not_applicable_rules = $5,
              critical_findings = $6,
              error_findings = $7,
              warning_findings = $8,
              info_findings = $9,
              duration_ms = $10,
              metadata = $11::jsonb
        where id = $1`,
      [
        id,
        input.status,
        input.passedRules,
        input.failedRules,
        input.notApplicableRules,
        input.criticalFindings,
        input.errorFindings,
        input.warningFindings,
        input.infoFindings,
        input.durationMs,
        JSON.stringify(input.metadata),
      ],
    );
  }

  async listRuns(tenantId: string): Promise<ReconciliationRunRow[]> {
    const result = await this.database.pool.query<ReconciliationRunRow>(
      `select * from reconciliation_runs
        where tenant_id = $1
        order by started_at desc, id desc
        limit 100`,
      [tenantId],
    );
    return result.rows;
  }

  async getRun(tenantId: string, id: string): Promise<ReconciliationRunRow | null> {
    const result = await this.database.pool.query<ReconciliationRunRow>(
      `select * from reconciliation_runs where tenant_id = $1 and id = $2`,
      [tenantId, id],
    );
    return result.rows[0] ?? null;
  }

  async listFindings(
    tenantId: string,
    runId: string,
    query: ReconciliationFindingListQuery,
  ): Promise<ReconciliationFindingRow[]> {
    const values: unknown[] = [tenantId, runId];
    const filters = ['r.tenant_id = $1', 'f.reconciliation_run_id = $2'];
    if (query.severity) {
      values.push(query.severity);
      filters.push(`f.severity = $${values.length}`);
    }
    if (query.domain) {
      values.push(query.domain);
      filters.push(`f.domain = $${values.length}`);
    }
    if (query.ruleCode) {
      values.push(query.ruleCode);
      filters.push(`f.rule_code = $${values.length}`);
    }
    if (query.dispensingPointId) {
      values.push(query.dispensingPointId);
      filters.push(`f.dispensing_point_id = $${values.length}`);
    }
    if (query.commercialCode) {
      values.push(query.commercialCode);
      filters.push(`f.commercial_code = $${values.length}`);
    }
    if (query.planningPeriodId) {
      values.push(query.planningPeriodId);
      filters.push(`f.planning_period_id = $${values.length}`);
    }
    values.push(query.limit);
    const result = await this.database.pool.query<ReconciliationFindingRow>(
      `select f.*
         from reconciliation_findings f
         join reconciliation_runs r on r.id = f.reconciliation_run_id
        where ${filters.join(' and ')}
        order by
          case f.severity when 'CRITICAL' then 0 when 'ERROR' then 1 when 'WARNING' then 2 else 3 end,
          f.rule_code, f.detected_at, f.id
        limit $${values.length}`,
      values,
    );
    return result.rows;
  }
}

export function mapRunRow(row: ReconciliationRunRow, ruleResults: EngineRuleResult[] = []) {
  const metadata = row.metadata ?? {};
  return {
    id: row.id,
    tenantId: row.tenant_id,
    status: reconciliationRunStatusSchema.parse(row.status),
    scope: reconciliationRunScopeSchema.parse(
      typeof row.scope === 'string' ? JSON.parse(row.scope) : row.scope,
    ),
    startedAt: asIso(row.started_at) ?? new Date().toISOString(),
    completedAt: asIso(row.completed_at),
    startedBy: row.started_by,
    rulesVersion: row.rules_version,
    totalRules: Number(row.total_rules),
    passedRules: Number(row.passed_rules),
    failedRules: Number(row.failed_rules),
    notApplicableRules: Number(row.not_applicable_rules),
    criticalFindings: Number(row.critical_findings),
    errorFindings: Number(row.error_findings),
    warningFindings: Number(row.warning_findings),
    infoFindings: Number(row.info_findings),
    generatedAt: asIso(row.generated_at),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    ruleResults: ruleResults.length > 0 ? ruleResults : (metadata.ruleResults ?? []),
  };
}
