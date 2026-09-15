import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  RECONCILIATION_MAX_FINDINGS_PER_RULE,
  RECONCILIATION_RULES,
  RECONCILIATION_RULES_VERSION,
  RECONCILIATION_STATEMENT_TIMEOUT_MS,
  reconciliationFindingFingerprint,
  type ReconciliationDomain,
  type ReconciliationSeverity,
} from '@authorization/domain';
import { RECONCILIATION_RULE_IMPLEMENTATIONS } from './reconciliation.rules';
import { RECONCILIATION_RULE_IMPLEMENTATIONS_REST } from './reconciliation.rules-rest';
import type { ReconciliationRepository } from './reconciliation.repository';
import type { ReconciliationMetrics } from './reconciliation.metrics';
import {
  bindSnapshotQuery,
  classifyRuleStatus,
  phiSafeEvidence,
  resolveRunScope,
  type EngineRuleResult,
  type EngineSnapshotHooks,
  type LegacyScanInput,
  type PersistedFinding,
  type ReconciliationScopeInput,
  type ReconciliationSnapshot,
  type RuleContext,
} from './reconciliation.types';

const IMPLEMENTATIONS = [
  ...RECONCILIATION_RULE_IMPLEMENTATIONS,
  ...RECONCILIATION_RULE_IMPLEMENTATIONS_REST,
];

const IMPLEMENTATION_BY_CODE = new Map(
  IMPLEMENTATIONS.map((rule) => [rule.definition.ruleCode, rule]),
);

export type EngineRunInput = ReconciliationScopeInput &
  Readonly<{
    tenantId: string;
    startedBy: string | null;
    maxFindings?: number;
    statementTimeoutMs?: number;
    legacyScan?: LegacyScanInput | null;
    domains?: readonly ReconciliationDomain[];
    severities?: readonly ReconciliationSeverity[];
    snapshotHooks?: EngineSnapshotHooks;
  }>;

function isFatalSnapshotError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /statement timeout/i.test(message) ||
    /canceling statement/i.test(message) ||
    /current transaction is aborted/i.test(message) ||
    /connection terminated/i.test(message) ||
    /Client was closed/i.test(message) ||
    /SNAPSHOT_CLOSED/i.test(message)
  );
}

export class ReconciliationEngine {
  constructor(
    private readonly pool: Pool,
    private readonly repository: ReconciliationRepository,
    private readonly metrics: ReconciliationMetrics | null = null,
  ) {}

  async execute(input: EngineRunInput): Promise<{ id: string }> {
    const scope = resolveRunScope(input);
    const maxFindings = input.maxFindings ?? RECONCILIATION_MAX_FINDINGS_PER_RULE;
    const statementTimeoutMs = input.statementTimeoutMs ?? RECONCILIATION_STATEMENT_TIMEOUT_MS;
    const selected = RECONCILIATION_RULES.filter((rule) => {
      if (input.domains && !input.domains.includes(rule.domain)) return false;
      if (input.severities && !input.severities.includes(rule.defaultSeverity)) return false;
      return true;
    });
    const runId = await this.repository.createRun({
      tenantId: input.tenantId,
      startedBy: input.startedBy,
      scope,
      rulesVersion: RECONCILIATION_RULES_VERSION,
      totalRules: selected.length,
    });
    const started = Date.now();
    await this.repository.markRunning(runId);
    const ruleResults: EngineRuleResult[] = [];
    const findings: PersistedFinding[] = [];
    let technicalFailure: string | null = null;
    let snapshot: ReconciliationSnapshot | null = null;
    const read = await this.pool.connect();
    const snapshotGate = { closed: false };
    try {
      await read.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await read.query(`SET LOCAL statement_timeout = ${Number(statementTimeoutMs)}`);
      const pin = await read.query<{ postgres_snapshot: string }>(
        'select pg_current_snapshot()::text as postgres_snapshot',
      );
      const pinnedSnapshot: ReconciliationSnapshot = Object.freeze({
        id: randomUUID(),
        isolation: 'REPEATABLE READ READ ONLY',
        postgresSnapshot: pin.rows[0]?.postgres_snapshot ?? '',
      });
      snapshot = pinnedSnapshot;
      const org = await read.query<{ code: string }>(
        'select code from organizations where id = $1',
        [input.tenantId],
      );
      if (!org.rows[0]) throw new Error('UNKNOWN_TENANT');
      const context: RuleContext = Object.freeze({
        query: bindSnapshotQuery(
          { query: (text, values) => read.query(text, values) },
          snapshotGate,
        ),
        snapshot: pinnedSnapshot,
        tenantId: input.tenantId,
        operationalTenant: org.rows[0].code === 'MTD',
        scope,
        maxFindings,
        legacyScan: input.legacyScan ?? null,
      });
      await input.snapshotHooks?.beforeRules?.(context);
      for (const [index, rule] of selected.entries()) {
        const began = Date.now();
        const pushHook = async () => {
          await input.snapshotHooks?.afterRule?.({
            ruleCode: rule.ruleCode,
            index,
            snapshot: pinnedSnapshot,
            context,
            runId,
          });
        };
        if (!rule.executable) {
          ruleResults.push({
            ruleCode: rule.ruleCode,
            status: 'NOT_APPLICABLE',
            evaluatedCount: 0,
            findingCount: 0,
            totalDetected: 0,
            truncated: false,
            durationMs: Date.now() - began,
            severity: rule.defaultSeverity,
            error: null,
          });
          try {
            await pushHook();
          } catch (error) {
            technicalFailure = error instanceof Error ? error.message : 'SNAPSHOT_HOOK_FAILED';
            if (isFatalSnapshotError(error) || rule.defaultSeverity === 'CRITICAL') break;
          }
          continue;
        }
        const impl = IMPLEMENTATION_BY_CODE.get(rule.ruleCode);
        if (!impl) {
          technicalFailure = `Missing implementation for ${rule.ruleCode}`;
          ruleResults.push({
            ruleCode: rule.ruleCode,
            status: 'ERROR_EXECUTING_RULE',
            evaluatedCount: 0,
            findingCount: 0,
            totalDetected: 0,
            truncated: false,
            durationMs: Date.now() - began,
            severity: rule.defaultSeverity,
            error: technicalFailure,
          });
          break;
        }
        try {
          const evaluation = await impl.evaluate(context);
          const unique = new Map<string, PersistedFinding>();
          for (const finding of evaluation.findings) {
            const fingerprint = reconciliationFindingFingerprint({
              ruleCode: rule.ruleCode,
              entityType: finding.entityType,
              entityId: finding.entityId,
              relatedEntityId: finding.relatedEntityId,
            });
            if (unique.has(fingerprint)) continue;
            unique.set(fingerprint, {
              ...finding,
              evidence: phiSafeEvidence(finding.evidence),
              ruleCode: rule.ruleCode,
              ruleVersion: rule.version,
              category: rule.category,
              severity: rule.defaultSeverity,
              domain: rule.domain,
              fingerprint,
              truncated: evaluation.totalDetected > maxFindings,
            });
          }
          const persisted = [...unique.values()];
          findings.push(...persisted);
          await this.repository.insertFindings(runId, input.tenantId, persisted);
          ruleResults.push({
            ruleCode: rule.ruleCode,
            status: classifyRuleStatus(evaluation),
            evaluatedCount: evaluation.evaluatedCount,
            findingCount: persisted.length,
            totalDetected: evaluation.totalDetected,
            truncated: evaluation.totalDetected > persisted.length,
            durationMs: Date.now() - began,
            severity: rule.defaultSeverity,
            error: null,
          });
          await pushHook();
        } catch (error) {
          technicalFailure = error instanceof Error ? error.message : 'RULE_EXECUTION_FAILED';
          const alreadyRecorded = ruleResults.some((item) => item.ruleCode === rule.ruleCode);
          if (!alreadyRecorded) {
            ruleResults.push({
              ruleCode: rule.ruleCode,
              status: 'ERROR_EXECUTING_RULE',
              evaluatedCount: 0,
              findingCount: 0,
              totalDetected: 0,
              truncated: false,
              durationMs: Date.now() - began,
              severity: rule.defaultSeverity,
              error: technicalFailure,
            });
          }
          if (isFatalSnapshotError(error) || rule.defaultSeverity === 'CRITICAL') break;
        }
      }
      await read.query('ROLLBACK');
    } catch (error) {
      try {
        await read.query('ROLLBACK');
      } catch {
        /* ignore rollback of a failed snapshot */
      }
      technicalFailure = error instanceof Error ? error.message : 'SNAPSHOT_FAILED';
    } finally {
      snapshotGate.closed = true;
      read.release();
    }

    const durationMs = Date.now() - started;
    const status = technicalFailure ? 'FAILED' : 'COMPLETED';
    const criticalFindings = findings.filter((item) => item.severity === 'CRITICAL').length;
    const errorFindings = findings.filter((item) => item.severity === 'ERROR').length;
    const warningFindings = findings.filter((item) => item.severity === 'WARNING').length;
    const infoFindings = findings.filter((item) => item.severity === 'INFO').length;
    await this.repository.completeRun(runId, {
      status,
      passedRules: ruleResults.filter((item) => item.status === 'PASS').length,
      failedRules: ruleResults.filter((item) => item.status === 'FAIL').length,
      notApplicableRules: ruleResults.filter((item) => item.status === 'NOT_APPLICABLE').length,
      criticalFindings,
      errorFindings,
      warningFindings,
      infoFindings,
      durationMs,
      metadata: {
        isolation: 'REPEATABLE READ READ ONLY',
        statementTimeoutMs,
        maxFindingsPerRule: maxFindings,
        technicalFailure,
        snapshot,
        readerConnection: 'pool.connect() REPEATABLE READ READ ONLY',
        writerConnection: 'pool.query reconciliation_runs/findings/issues',
        ruleResults,
        truncated: ruleResults.some((item) => item.truncated),
        legacyScan: input.legacyScan ?? null,
        writableTables: [
          'reconciliation_runs',
          'reconciliation_findings',
          'reconciliation_issues',
          'reconciliation_issue_events',
          'reconciliation_issue_comments',
        ],
        autoRepair: false,
        sourceOfTruth: 'postgresql',
      },
    });
    this.metrics?.runsTotal.inc({ status });
    this.metrics?.runDuration.observe(durationMs / 1000);
    for (const finding of findings) {
      this.metrics?.findingsTotal.inc({ severity: finding.severity, domain: finding.domain });
    }
    for (const result of ruleResults) {
      this.metrics?.ruleDuration.observe({ rule_code: result.ruleCode }, result.durationMs / 1000);
    }
    return { id: runId };
  }
}

export async function withReadOnlyClient<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await fn(client);
    await client.query('ROLLBACK');
    return result;
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
