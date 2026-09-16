import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { createDatabase } from '@authorization/database';
import type { ReconciliationFindingListQuery } from '@authorization/contracts';
import {
  reconciliationRunScopeSchema,
  reconciliationRunStatusSchema,
} from '@authorization/contracts';
import {
  decideIssueRecurrence,
  maxReconciliationSeverity,
  type ReconciliationIssueStatus,
  type ReconciliationSeverity,
} from '@authorization/domain';
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
  operation_execution_id: string | null;
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
  issue_id: string;
};

function asIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

type LockedIssueRow = {
  id: string;
  status: ReconciliationIssueStatus;
  current_severity: ReconciliationSeverity;
  max_severity_seen: ReconciliationSeverity;
  accepted_risk_severity: ReconciliationSeverity | null;
  accepted_risk_rule_version: string | null;
};

async function linkFindingToIssue(
  client: PoolClient,
  runId: string,
  tenantId: string,
  finding: PersistedFinding,
): Promise<void> {
  const existing = await client.query<{ id: string }>(
    `select id from reconciliation_findings
      where reconciliation_run_id = $1 and rule_code = $2 and fingerprint = $3`,
    [runId, finding.ruleCode, finding.fingerprint],
  );
  if (existing.rows[0]) return;

  const findingId = randomUUID();
  let locked: LockedIssueRow | undefined;
  let created = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const inserted = await client.query<{ id: string }>(
      `insert into reconciliation_issues (
         tenant_id, rule_code, fingerprint, domain, category, status,
         current_severity, max_severity_seen, first_seen_at, last_seen_at,
         occurrence_count, first_run_id, last_run_id, last_finding_id,
         first_rule_version, last_rule_version, version
       ) values ($1,$2,$3,$4,$5,'OPEN',$6,$6,now(),now(),1,$7,$7,$8,$9,$9,1)
       on conflict (tenant_id, rule_code, fingerprint) do nothing
       returning id`,
      [
        tenantId,
        finding.ruleCode,
        finding.fingerprint,
        finding.domain,
        finding.category,
        finding.severity,
        runId,
        findingId,
        finding.ruleVersion,
      ],
    );
    const issue = await client.query<LockedIssueRow>(
      `select id, status, current_severity, max_severity_seen,
              accepted_risk_severity, accepted_risk_rule_version
         from reconciliation_issues
        where tenant_id = $1 and rule_code = $2 and fingerprint = $3
        for update`,
      [tenantId, finding.ruleCode, finding.fingerprint],
    );
    locked = issue.rows[0];
    if (locked) {
      created = inserted.rows[0]?.id === locked.id;
      break;
    }
  }
  if (!locked) throw new Error('ISSUE_UPSERT_FAILED');

  if (created) {
    await client.query(
      `insert into reconciliation_issue_events
         (issue_id, tenant_id, event_type, to_status, reconciliation_run_id, finding_id, metadata_json)
       values ($1,$2,'ISSUE_CREATED','OPEN',$3,$4,'{"source":"ESP-017"}'::jsonb)`,
      [locked.id, tenantId, runId, findingId],
    );
  } else {
    const decision = decideIssueRecurrence(
      {
        status: locked.status,
        acceptedRiskSeverity: locked.accepted_risk_severity,
        acceptedRiskRuleVersion: locked.accepted_risk_rule_version,
      },
      { severity: finding.severity, ruleVersion: finding.ruleVersion },
    );
    const maxSeen = maxReconciliationSeverity(locked.max_severity_seen, finding.severity);
    await client.query(
      `update reconciliation_issues
          set occurrence_count = occurrence_count + 1,
              last_seen_at = now(),
              last_run_id = $2,
              last_finding_id = $3,
              current_severity = $4,
              max_severity_seen = $5,
              last_rule_version = $6,
              status = $7,
              resolved_at = case when $8 then null else resolved_at end,
              resolved_by = case when $8 then null else resolved_by end,
              resolution_code = case when $8 then null else resolution_code end,
              resolution_note = case when $8 then null else resolution_note end,
              accepted_risk_at = case when $9 then null else accepted_risk_at end,
              accepted_risk_by = case when $9 then null else accepted_risk_by end,
              accepted_risk_reason = case when $9 then null else accepted_risk_reason end,
              accepted_risk_severity = case when $9 then null else accepted_risk_severity end,
              accepted_risk_rule_version = case when $9 then null else accepted_risk_rule_version end,
              risk_review_at = case when $9 then null else risk_review_at end,
              version = version + 1,
              updated_at = now()
        where id = $1`,
      [
        locked.id,
        runId,
        findingId,
        finding.severity,
        maxSeen,
        finding.ruleVersion,
        decision.nextStatus,
        decision.clearResolution,
        decision.clearAcceptedRisk,
      ],
    );
    if (decision.eventType) {
      await client.query(
        `insert into reconciliation_issue_events
           (issue_id, tenant_id, event_type, from_status, to_status,
            reconciliation_run_id, finding_id, metadata_json)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          locked.id,
          tenantId,
          decision.eventType,
          locked.status,
          decision.nextStatus,
          runId,
          findingId,
          JSON.stringify({
            previousSeverity: locked.current_severity,
            nextSeverity: finding.severity,
            ruleVersion: finding.ruleVersion,
          }),
        ],
      );
    }
  }

  await client.query(
    `insert into reconciliation_findings (
       id, reconciliation_run_id, rule_code, rule_version, category, severity, domain,
       entity_type, entity_id, related_entity_type, related_entity_id,
       dispensing_point_id, planning_period_id, commercial_code, message,
       evidence_json, fingerprint, truncated, issue_id
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19)`,
    [
      findingId,
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
      locked.id,
    ],
  );
}

@Injectable()
export class ReconciliationRepository {
  constructor(@Inject(DATABASE) private readonly database: Pick<Database, 'pool'>) {}

  async createRun(input: {
    tenantId: string;
    startedBy: string | null;
    scope: ReconciliationRunScope;
    rulesVersion: string;
    totalRules: number;
    operationExecutionId?: string | null;
  }): Promise<string> {
    const result = await this.database.pool.query<{ id: string }>(
      `insert into reconciliation_runs
         (tenant_id, status, scope, started_by, rules_version, total_rules, metadata, operation_execution_id)
       values ($1,'PENDING',$2::jsonb,$3,$4,$5,'{}'::jsonb,$6)
       returning id`,
      [
        input.tenantId,
        JSON.stringify(input.scope),
        input.startedBy,
        input.rulesVersion,
        input.totalRules,
        input.operationExecutionId ?? null,
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

  async insertFindings(
    runId: string,
    tenantId: string,
    findings: readonly PersistedFinding[],
  ): Promise<void> {
    if (findings.length === 0) return;
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `set constraints reconciliation_issues_last_finding_fk, reconciliation_issue_events_finding_fk deferred`,
      );
      for (const finding of findings) {
        await linkFindingToIssue(client, runId, tenantId, finding);
      }
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw error;
    } finally {
      client.release();
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

  async listFindingsByIssue(
    tenantId: string,
    issueId: string,
    query: ReconciliationFindingListQuery,
  ): Promise<ReconciliationFindingRow[]> {
    const values: unknown[] = [tenantId, issueId];
    const filters = ['r.tenant_id = $1', 'f.issue_id = $2'];
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
    values.push(query.limit);
    const result = await this.database.pool.query<ReconciliationFindingRow>(
      `select f.*
         from reconciliation_findings f
         join reconciliation_runs r on r.id = f.reconciliation_run_id
        where ${filters.join(' and ')}
        order by f.detected_at desc, f.id desc
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
    operationExecutionId: row.operation_execution_id ?? null,
  };
}
