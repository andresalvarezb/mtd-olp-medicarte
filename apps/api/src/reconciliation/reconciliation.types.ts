import type {
  ReconciliationCategory,
  ReconciliationDomain,
  ReconciliationRuleDefinition,
  ReconciliationSeverity,
} from '@authorization/domain';

export type ReconciliationScopeInput = Readonly<{
  planningPeriodId?: string;
  dispensingPointId?: string;
  commercialCode?: string;
  domains?: readonly ReconciliationDomain[];
  severities?: readonly ReconciliationSeverity[];
}>;

export type ReconciliationRunScope = Readonly<{
  kind: 'GLOBAL' | 'PLANNING_PERIOD' | 'DISPENSING_POINT' | 'COMMERCIAL_CODE' | 'COMBINED';
  planningPeriodId: string | null;
  dispensingPointId: string | null;
  commercialCode: string | null;
}>;

export type Queryable = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

export type ReconciliationSnapshot = Readonly<{
  id: string;
  isolation: 'REPEATABLE READ READ ONLY';
  postgresSnapshot: string;
}>;

export type LegacyScanInput = Readonly<{
  status: 'PASS' | 'FAIL';
  hitCount: number;
}>;

export type RuleContext = Readonly<{
  /** Operational reads must use this bound snapshot query. Never open another pool/client. */
  query: Queryable['query'];
  snapshot: ReconciliationSnapshot;
  tenantId: string;
  operationalTenant: boolean;
  scope: ReconciliationRunScope;
  maxFindings: number;
  legacyScan: LegacyScanInput | null;
}>;

export type EngineSnapshotHooks = Readonly<{
  beforeRules?: (context: RuleContext) => Promise<void>;
  afterRule?: (input: {
    runId: string;
    ruleCode: string;
    index: number;
    snapshot: ReconciliationSnapshot;
    context: RuleContext;
  }) => Promise<void>;
}>;

export function bindSnapshotQuery(
  reader: Queryable,
  gate: { closed: boolean },
): Queryable['query'] {
  return async (text, values) => {
    if (gate.closed) throw new Error('SNAPSHOT_CLOSED');
    return reader.query(text, values);
  };
}

export type DetectedFinding = Readonly<{
  entityType: string;
  entityId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  dispensingPointId: string | null;
  planningPeriodId: string | null;
  commercialCode: string | null;
  message: string;
  evidence: Record<string, unknown>;
}>;

export type RuleEvaluation = Readonly<{
  evaluatedCount: number;
  findings: readonly DetectedFinding[];
  totalDetected: number;
}>;

export type ExecutableRule = Readonly<{
  definition: ReconciliationRuleDefinition;
  evaluate: (context: RuleContext) => Promise<RuleEvaluation>;
}>;

export type PersistedFinding = DetectedFinding &
  Readonly<{
    ruleCode: string;
    ruleVersion: string;
    category: ReconciliationCategory;
    severity: ReconciliationSeverity;
    domain: ReconciliationDomain;
    fingerprint: string;
    truncated: boolean;
  }>;

export function resolveRunScope(input: ReconciliationScopeInput): ReconciliationRunScope {
  const planningPeriodId = input.planningPeriodId ?? null;
  const dispensingPointId = input.dispensingPointId ?? null;
  const commercialCode = input.commercialCode ?? null;
  const flags = [planningPeriodId, dispensingPointId, commercialCode].filter(Boolean).length;
  let kind: ReconciliationRunScope['kind'] = 'GLOBAL';
  if (flags > 1) kind = 'COMBINED';
  else if (planningPeriodId) kind = 'PLANNING_PERIOD';
  else if (dispensingPointId) kind = 'DISPENSING_POINT';
  else if (commercialCode) kind = 'COMMERCIAL_CODE';
  return { kind, planningPeriodId, dispensingPointId, commercialCode };
}

export class SqlParams {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export function scopeSql(
  params: SqlParams,
  scope: ReconciliationRunScope,
  columns: { period?: string; point?: string; code?: string },
): string {
  const parts = ['TRUE'];
  if (scope.planningPeriodId && columns.period) {
    parts.push(`${columns.period} = ${params.add(scope.planningPeriodId)}`);
  }
  if (scope.dispensingPointId && columns.point) {
    parts.push(`${columns.point} = ${params.add(scope.dispensingPointId)}`);
  }
  if (scope.commercialCode && columns.code) {
    parts.push(`${columns.code} = ${params.add(scope.commercialCode)}`);
  }
  return parts.join(' AND ');
}

const PHI_KEY =
  /nombre|documento|historia|observation|payload|source_data|raw_|fullName|identificacion|sourceData/i;
const TECHNICAL_KEY = /id$|ids$|count$|status$|quantity$|revision$|code$|type$/i;

export function phiSafeEvidence(evidence: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(evidence)) {
    if (PHI_KEY.test(key) && !TECHNICAL_KEY.test(key)) continue;
    if (typeof value === 'string' && value.length > 200) continue;
    next[key] = value;
  }
  return next;
}

export function classifyRuleStatus(evaluation: RuleEvaluation): 'PASS' | 'FAIL' | 'NOT_APPLICABLE' {
  if (evaluation.evaluatedCount === 0 && evaluation.totalDetected === 0) return 'NOT_APPLICABLE';
  if (evaluation.totalDetected > 0) return 'FAIL';
  return 'PASS';
}

export type EngineRuleResult = Readonly<{
  ruleCode: string;
  status: 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | 'ERROR_EXECUTING_RULE';
  evaluatedCount: number;
  findingCount: number;
  totalDetected: number;
  truncated: boolean;
  durationMs: number;
  severity: ReconciliationSeverity;
  error: string | null;
}>;
