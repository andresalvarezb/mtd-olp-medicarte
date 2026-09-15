/**
 * ESP-016 full-runtime legacy operational usage scan.
 *
 * Registry classifications in `legacy-operational-cutover.ts` are the source of
 * truth for which columns are forbidden in modern code. This module decides
 * *where* those tokens may appear and how `auditStatus` is identified.
 *
 * LEGACY AUTHORIZATION AUDIT STATUS ≠ MODERN AUDIT STATUS.
 * Schema column/index/CHECK declaration ≠ operational helper/query usage.
 * Compatibility projection is NEW DOMAIN → legacy only.
 */
import { LEGACY_SCAN_FORBIDDEN_FIELDS } from './legacy-operational-cutover';

export type LegacyScanRule =
  | 'forbidden_legacy'
  | 'admission_boundary'
  | 'historical_repository_import'
  | 'schema_declaration'
  | 'historical_contract_marker'
  | 'test_evidence';

export type LegacyScanAllowlistEntry = Readonly<{
  path: string;
  rule: LegacyScanRule;
  fields: string;
  reason: string;
}>;

export const LEGACY_SCAN_RUNTIME_ROOTS = [
  'apps/api/src',
  'apps/worker/src',
  'apps/web',
  'packages/domain/src',
  'packages/database/src',
  'packages/contracts/src',
  'packages/config/src',
  'packages/ui/src',
] as const;

export const LEGACY_SCAN_REQUIRED_COVERAGE = [
  'API',
  'WORKER',
  'WEB',
  'DOMAIN',
  'DATABASE_RUNTIME',
  'CONTRACTS',
  'CONFIG',
  'UI',
] as const;

export const LEGACY_SCAN_SKIP_DIRECTORY_NAMES = [
  'node_modules',
  'dist',
  '.next',
  'coverage',
  'build',
  '.turbo',
] as const;

export const LEGACY_SCAN_SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const;

export const LEGACY_SCAN_COVERAGE_BY_ROOT = {
  'apps/api/src': 'API',
  'apps/worker/src': 'WORKER',
  'apps/web': 'WEB',
  'packages/domain/src': 'DOMAIN',
  'packages/database/src': 'DATABASE_RUNTIME',
  'packages/contracts/src': 'CONTRACTS',
  'packages/config/src': 'CONFIG',
  'packages/ui/src': 'UI',
} as const;

export function isLegacyScanSourceFile(fileName: string): boolean {
  if (fileName.endsWith('.d.ts') || fileName === 'next-env.d.ts') return false;
  return LEGACY_SCAN_SOURCE_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}

export const LEGACY_SCAN_ALLOWED_TEST_SUFFIX = '.test.ts';

export const LEGACY_SCAN_ALLOWED_TEST_SUFFIXES = ['.test.ts', '.test.tsx'] as const;

export const SCHEMA_DECLARATION_PATH = 'packages/database/src/schema.ts';

/**
 * Path-specific exceptions. Never `apps/api/**` or `packages/database/**`.
 * `schema.ts` is NOT fully allowlisted: only Drizzle declarations are stripped.
 * `*.test.ts` / `*.test.tsx` are test evidence (not this list); runtime helpers
 * without that suffix are still scanned.
 */
export const LEGACY_SCAN_ALLOWLIST = [
  {
    path: 'packages/domain/src/legacy-operational-cutover.ts',
    rule: 'forbidden_legacy' as const,
    fields: 'registry field names',
    reason: 'ESP-016 classification registry; source of truth for controlled field names',
  },
  {
    path: 'packages/domain/src/legacy-operational-usage-scan.ts',
    rule: 'forbidden_legacy' as const,
    fields: 'scan policy tokens',
    reason: 'scanner policy/engine and fixtures; tokens appear as rules, not operational reads',
  },
  {
    path: 'packages/domain/src/clinical-logistics-boundary.ts',
    rule: 'forbidden_legacy' as const,
    fields: 'ESP-001 historical type',
    reason: 'ESP-001 historical type and field list; not a modern operational reader',
  },
  {
    path: 'apps/api/src/legacy/',
    rule: 'forbidden_legacy' as const,
    fields: 'HISTORICAL_ONLY + DERIVED_COMPATIBILITY',
    reason:
      'explicit legacy boundary: LegacyAuthorizationHistoryRepository + LegacyCompatibilityProjectionService (NEW → legacy only)',
  },
  {
    path: 'packages/domain/src/reconciliation-registry.ts',
    rule: 'forbidden_legacy' as const,
    fields: 'audit_status (catalog text)',
    reason:
      'ESP-017 rule catalog documents leftover compatibility verification; it does not write leftover columns',
  },
  {
    path: 'apps/api/src/reconciliation/reconciliation.rules-rest.ts',
    rule: 'forbidden_legacy' as const,
    fields: 'ai.audit_status',
    reason:
      'ESP-017 REC-LEG-002 reads leftover audit_status only to detect divergence from modern audits; read-only, no projection write',
  },
] as const satisfies readonly LegacyScanAllowlistEntry[];

export const LEGACY_SCAN_ALLOWLIST_PATHS = LEGACY_SCAN_ALLOWLIST.map((entry) => entry.path);

/**
 * admission_status remains AUTHORITATIVE for ESP-012 READY downstream.
 * These paths may read/write it; anywhere else is a new undocumented boundary.
 */
export const LEGACY_SCAN_ADMISSION_ALLOWLIST = [
  {
    path: 'packages/domain/src/legacy-operational-cutover.ts',
    rule: 'admission_boundary' as const,
    fields: 'admission_status',
    reason: 'classifies admission_status as AUTHORITATIVE under ESP-012',
  },
  {
    path: 'packages/domain/src/legacy-operational-usage-scan.ts',
    rule: 'admission_boundary' as const,
    fields: 'admission_status',
    reason: 'admission scan policy',
  },
  {
    path: 'apps/api/src/legacy/legacy-compatibility-projection.service.ts',
    rule: 'admission_boundary' as const,
    fields: 'admission_status',
    reason: 'NEW DOMAIN audit APPROVED projects admission READY in the same transaction',
  },
  {
    path: 'apps/api/src/audits/patient-application-audit.repository.ts',
    rule: 'admission_boundary' as const,
    fields: 'admission_status',
    reason: 'ESP-012 application-audit read model exposes admissionStatus from the same item',
  },
  {
    path: 'packages/contracts/src/index.ts',
    rule: 'admission_boundary' as const,
    fields: 'admissionStatus',
    reason:
      'ApplicationAuditResponse.admissionStatus is the ESP-012 modern DTO, not a legacy field',
  },
  {
    path: 'apps/web/features/audits/patient-application-audits-view.tsx',
    rule: 'admission_boundary' as const,
    fields: 'admissionStatus',
    reason: 'displays ESP-012 admissionStatus from the application-audit read model',
  },
  {
    path: 'packages/domain/src/reconciliation-registry.ts',
    rule: 'admission_boundary' as const,
    fields: 'admission_status',
    reason: 'ESP-017 catalog describes REC-AUD invariants over authoritative admission_status',
  },
  {
    path: 'apps/api/src/reconciliation/reconciliation.rules-rest.ts',
    rule: 'admission_boundary' as const,
    fields: 'admission_status',
    reason:
      'ESP-017 REC-AUD-* reads admission_status to verify ESP-012 READY↔APPROVED; verification-only, no mutation',
  },
] as const satisfies readonly LegacyScanAllowlistEntry[];

export const LEGACY_SCAN_HISTORICAL_IMPORT_ALLOWLIST = [
  {
    path: 'apps/api/src/legacy/',
    rule: 'historical_repository_import' as const,
    fields: 'LegacyAuthorizationHistoryRepository',
    reason: 'historical adapter lives in the legacy boundary',
  },
  {
    path: 'apps/api/src/app.module.ts',
    rule: 'historical_repository_import' as const,
    fields: 'LegacyAuthorizationHistoryRepository',
    reason:
      'composition root registers the historical repository; it does not query it for decisions',
  },
  {
    path: 'packages/domain/src/legacy-operational-usage-scan.ts',
    rule: 'historical_repository_import' as const,
    fields: 'LegacyAuthorizationHistoryRepository',
    reason:
      'scanner detects historical-repository imports by token; it does not import the repository',
  },
] as const satisfies readonly LegacyScanAllowlistEntry[];

export const LEGACY_SCAN_CONSTRUCT_RULES = [
  {
    path: SCHEMA_DECLARATION_PATH,
    rule: 'schema_declaration' as const,
    fields: 'HISTORICAL_ONLY + audit_status + admission_status',
    reason:
      'Drizzle column/index/CHECK declarations only (incl. admission_status); helpers/queries in the same file are scanned',
  },
  {
    path: 'packages/contracts/src/index.ts',
    rule: 'historical_contract_marker' as const,
    fields: 'legacyAuthorizationHistoryResponseSchema',
    reason: 'only the marked Historical compatibility contract block is stripped',
  },
  {
    path: '*.test.ts / *.test.tsx',
    rule: 'test_evidence' as const,
    fields: '*',
    reason: 'test evidence; runtime helpers without that suffix remain scanned',
  },
] as const satisfies readonly LegacyScanAllowlistEntry[];

export const LEGACY_SCAN_POLICY_REPORT = [
  ...LEGACY_SCAN_ALLOWLIST,
  ...LEGACY_SCAN_ADMISSION_ALLOWLIST,
  ...LEGACY_SCAN_HISTORICAL_IMPORT_ALLOWLIST,
  ...LEGACY_SCAN_CONSTRUCT_RULES,
] as const;

export const HISTORICAL_COMPATIBILITY_CONTRACT_PATH = 'packages/contracts/src/index.ts';
export const HISTORICAL_COMPATIBILITY_CONTRACT_MARKER =
  '/** Historical compatibility contract. Not a modern operational API. ESP-016. */';

export type LegacyScanHit = Readonly<{
  path: string;
  token: string;
  policy: 'forbidden_legacy' | 'admission_boundary' | 'historical_repository_import';
}>;

export type LegacyScanFile = Readonly<{
  path: string;
  source: string;
}>;

const ADMISSION_TOKENS = ['admission_status', 'admissionStatus'] as const;
const DRIZZLE_COLUMN_TYPES = 'varchar|date|text|integer|timestamp';

/**
 * Member receivers that mean patient_application_audits / analytics query filters.
 * Not authorization_items.audit_status.
 */
export const MODERN_AUDIT_STATUS_RECEIVERS = [
  'query',
  'audit',
  'modernAudit',
  'applicationAudit',
  'patientApplicationAudit',
] as const;

function snakeToCamel(field: string): string {
  return field.replaceAll(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Global camelCase `auditStatus` is NOT forbidden: it collides with modern
 * application-audit / analytics filters. Identity is recovered from member
 * expressions such as authorizationItems.auditStatus.
 */
export function forbiddenLegacyScanTokens(): readonly string[] {
  const camel = LEGACY_SCAN_FORBIDDEN_FIELDS.filter((field) => field !== 'audit_status').map(
    snakeToCamel,
  );
  return [...LEGACY_SCAN_FORBIDDEN_FIELDS, ...camel];
}

export function tokenRegex(field: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9_])${field}([^A-Za-z0-9_]|$)`);
}

function matchesPathRule(relativePath: string, rulePath: string): boolean {
  return rulePath.endsWith('/') ? relativePath.startsWith(rulePath) : relativePath === rulePath;
}

export function isTestEvidencePath(relativePath: string): boolean {
  return LEGACY_SCAN_ALLOWED_TEST_SUFFIXES.some((suffix) => relativePath.endsWith(suffix));
}

export function isPathAllowlistedForLegacyScan(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  if (isTestEvidencePath(normalized)) return true;
  return LEGACY_SCAN_ALLOWLIST.some((entry) => matchesPathRule(normalized, entry.path));
}

export function isAdmissionStatusPathAllowed(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  if (isTestEvidencePath(normalized)) return true;
  return LEGACY_SCAN_ADMISSION_ALLOWLIST.some((entry) => matchesPathRule(normalized, entry.path));
}

export function isHistoricalRepositoryImportAllowed(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  if (isTestEvidencePath(normalized)) return true;
  return LEGACY_SCAN_HISTORICAL_IMPORT_ALLOWLIST.some((entry) =>
    matchesPathRule(normalized, entry.path),
  );
}

export function stripHistoricalCompatibilityContract(source: string): string {
  const start = source.indexOf(HISTORICAL_COMPATIBILITY_CONTRACT_MARKER);
  const typeDecl = source.indexOf('export type LegacyAuthorizationHistoryResponse');
  if (start === -1 || typeDecl === -1) return source;
  const close = source.indexOf(';', typeDecl);
  if (close === -1) return source;
  return `${source.slice(0, start)}${source.slice(close + 1)}`;
}

export function stripSchemaLegacyDeclarations(source: string): string {
  const fields = [...LEGACY_SCAN_FORBIDDEN_FIELDS, 'admission_status'];
  let next = source;
  for (const field of fields) {
    const camel = snakeToCamel(field);
    next = next.replaceAll(
      new RegExp(`\\b${camel}\\s*:\\s*(?:${DRIZZLE_COLUMN_TYPES})\\(\\s*'${field}'`, 'g'),
      '/* schema-decl */',
    );
    next = next.replaceAll(new RegExp(`\\btable\\.${camel}\\b`, 'g'), '/* schema-table-col */');
  }
  return next;
}

export function sourceForLegacyFieldScan(relativePath: string, source: string): string {
  let next = source;
  if (relativePath === HISTORICAL_COMPATIBILITY_CONTRACT_PATH) {
    next = stripHistoricalCompatibilityContract(next);
  }
  if (relativePath === SCHEMA_DECLARATION_PATH) {
    next = stripSchemaLegacyDeclarations(next);
  }
  return next;
}

function hasToken(source: string, token: string): boolean {
  return tokenRegex(token).test(source);
}

const MODERN_AUDIT_STATUS_RECEIVER_SET = new Set<string>(MODERN_AUDIT_STATUS_RECEIVERS);

export const LEGACY_SCAN_DYNAMIC_COMPUTED_KEYS_OUT_OF_SCOPE =
  "Dynamic keys such as const field = 'auditStatus'; authorizationItems[field] are not resolved.";

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function controlledLegacyMemberProperties(): readonly string[] {
  const properties = new Set<string>();
  for (const field of LEGACY_SCAN_FORBIDDEN_FIELDS) {
    properties.add(field);
    properties.add(snakeToCamel(field));
  }
  return [...properties];
}

function memberExpressionToken(match: string): string {
  const start = match.search(/[A-Za-z_]/);
  return start === -1 ? match : match.slice(start);
}

/**
 * Dot and static computed members: `receiver.field`, `receiver['field']`,
 * `receiver["field"]`. `auditStatus` stays contextual (modern receivers allowed).
 * Dynamic keys (`authorizationItems[field]`) are out of scope.
 */
export function findControlledMemberAccesses(source: string): string[] {
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const property of controlledLegacyMemberProperties()) {
    const pattern = new RegExp(
      `(?:^|[^A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*(?:\\.${escapeRegExp(property)}|\\[['"]${escapeRegExp(property)}['"]\\]))`,
      'g',
    );
    let match = pattern.exec(source);
    while (match) {
      const token = memberExpressionToken(match[1] ?? match[0] ?? '');
      const receiver = token.split(/\.|\[/)[0] ?? '';
      if (property === 'auditStatus' && MODERN_AUDIT_STATUS_RECEIVER_SET.has(receiver)) {
        match = pattern.exec(source);
        continue;
      }
      if (!seen.has(token)) {
        seen.add(token);
        hits.push(token);
      }
      match = pattern.exec(source);
    }
  }
  return hits;
}

/**
 * Detect authorization_items.audit_status via member identity, not a global
 * `auditStatus` string. Covers dot and static computed access.
 */
export function findLegacyAuthorizationAuditStatusUsages(source: string): string[] {
  return findControlledMemberAccesses(source).filter((token) =>
    /(?:\.auditStatus|\[['"]auditStatus['"]\])$/.test(token),
  );
}

export function collectLegacyOperationalUsageHits(
  files: readonly LegacyScanFile[],
): LegacyScanHit[] {
  const hits: LegacyScanHit[] = [];
  for (const file of files) {
    const path = file.path.replaceAll('\\', '/');
    if (isTestEvidencePath(path)) continue;
    const scannedSource = sourceForLegacyFieldScan(path, file.source);

    if (!isPathAllowlistedForLegacyScan(path)) {
      for (const token of forbiddenLegacyScanTokens()) {
        if (hasToken(scannedSource, token)) {
          hits.push({ path, token, policy: 'forbidden_legacy' });
        }
      }
      for (const token of findControlledMemberAccesses(scannedSource)) {
        hits.push({ path, token, policy: 'forbidden_legacy' });
      }
    }

    if (!isAdmissionStatusPathAllowed(path)) {
      for (const token of ADMISSION_TOKENS) {
        if (hasToken(scannedSource, token)) {
          hits.push({ path, token, policy: 'admission_boundary' });
        }
      }
    }

    if (!isHistoricalRepositoryImportAllowed(path)) {
      if (
        hasToken(file.source, 'LegacyAuthorizationHistoryRepository') ||
        file.source.includes('legacy-authorization-history.repository')
      ) {
        hits.push({
          path,
          token: 'LegacyAuthorizationHistoryRepository',
          policy: 'historical_repository_import',
        });
      }
    }
  }
  return hits;
}

export const LEGACY_SCAN_REQUIRED_NEGATIVE_COUNT = 14;
export const LEGACY_SCAN_REQUIRED_POSITIVE_COUNT = 10;
export const LEGACY_SCAN_COMPUTED_MEMBER_FAIL_IDS = [18, 19, 20] as const;
export const LEGACY_SCAN_COMPUTED_MEMBER_PASS_IDS = [22] as const;
export const LEGACY_SCAN_SCHEMA_ADMISSION_FAIL_IDS = [21] as const;
export const LEGACY_SCAN_SCHEMA_ADMISSION_PASS_IDS = [23, 24] as const;

export const LEGACY_SCAN_NEGATIVE_FIXTURES = [
  {
    id: 1,
    path: 'apps/api/src/scheduling/patient-schedule.service.ts',
    source: 'const date = authorizationItem.fecha_aplicacion;',
    token: 'fecha_aplicacion',
    policy: 'forbidden_legacy' as const,
  },
  {
    id: 2,
    path: 'apps/api/src/analytics/analytics.service.ts',
    source: 'const status = authorizationItem.operation_status;',
    token: 'operation_status',
    policy: 'forbidden_legacy' as const,
  },
  {
    id: 3,
    path: 'apps/api/src/applications/patient-application.repository.ts',
    source: 'SELECT audit_status FROM authorization_items',
    token: 'audit_status',
    policy: 'forbidden_legacy' as const,
  },
  {
    id: 4,
    path: 'apps/api/src/applications/patient-application.repository.ts',
    source:
      "db.select({ audit: authorizationItems.auditStatus }); eq(authorizationItems.auditStatus, 'APPROVED');",
    token: 'authorizationItems.auditStatus',
    policy: 'forbidden_legacy' as const,
  },
  {
    id: 5,
    path: 'apps/web/features/inventory/inventory-view.tsx',
    source: 'return <span>{item.process_status}</span>;',
    token: 'process_status',
    policy: 'forbidden_legacy' as const,
  },
  {
    id: 6,
    path: SCHEMA_DECLARATION_PATH,
    source: `auditStatus: varchar('audit_status', { length: 30 }),
function legacyAuditDecision(row) {
  return row.auditStatus === 'APPROVED';
}`,
    token: 'row.auditStatus',
    policy: 'forbidden_legacy' as const,
  },
  {
    id: 7,
    path: 'apps/api/src/analytics/analytics.service.ts',
    source:
      "import { LegacyAuthorizationHistoryRepository } from '../legacy/legacy-authorization-history.repository';",
    token: 'LegacyAuthorizationHistoryRepository',
    policy: 'historical_repository_import' as const,
  },
  {
    id: 8,
    path: 'apps/api/src/scheduling/patient-schedule.service.ts',
    source: "if (item.admissionStatus === 'READY') return true;",
    token: 'admissionStatus',
    policy: 'admission_boundary' as const,
  },
  {
    id: 9,
    path: 'apps/api/src/analytics/analytics.service.ts',
    source: "if (row.admissionStatus === 'READY') return row;",
    token: 'admissionStatus',
    policy: 'admission_boundary' as const,
  },
  {
    id: 10,
    path: HISTORICAL_COMPATIBILITY_CONTRACT_PATH,
    source: `${HISTORICAL_COMPATIBILITY_CONTRACT_MARKER}
export const legacyAuthorizationHistoryResponseSchema = z.object({
  fechaAplicacion: z.string().nullable(),
});
export type LegacyAuthorizationHistoryResponse = z.infer<
  typeof legacyAuthorizationHistoryResponseSchema
>;
export const leaked = z.object({ processStatus: z.string() });`,
    token: 'processStatus',
    policy: 'forbidden_legacy' as const,
  },
  {
    id: 18,
    path: 'apps/api/src/applications/patient-application.repository.ts',
    source:
      "const status = authorizationItems['auditStatus']; const snake = authorizationItems['audit_status'];",
    token: "authorizationItems['auditStatus']",
    policy: 'forbidden_legacy' as const,
  },
  {
    id: 19,
    path: 'apps/api/src/scheduling/patient-schedule.service.ts',
    source: 'const date = authorizationItem["fechaAplicacion"];',
    token: 'authorizationItem["fechaAplicacion"]',
    policy: 'forbidden_legacy' as const,
  },
  {
    id: 20,
    path: 'apps/api/src/analytics/analytics.service.ts',
    source: "const status = row['operationStatus'];",
    token: "row['operationStatus']",
    policy: 'forbidden_legacy' as const,
  },
  {
    id: 21,
    path: SCHEMA_DECLARATION_PATH,
    source: `admissionStatus: varchar('admission_status', { length: 20 }),
sql\`\${table.admissionStatus} <> 'READY' OR \${table.auditStatus} = 'APPROVED'\`,
function operationalDecision(row) {
  return row.admissionStatus === 'READY';
}`,
    token: 'admissionStatus',
    policy: 'admission_boundary' as const,
  },
] as const;

export const LEGACY_SCAN_POSITIVE_FIXTURES = [
  {
    id: 11,
    path: SCHEMA_DECLARATION_PATH,
    source: `auditStatus: varchar('audit_status', { length: 30 }),
fechaAplicacion: date('fecha_aplicacion'),
operationStatus: varchar('operation_status', { length: 40 }),
index('authorization_items_audit_status_idx').on(table.auditStatus, table.createdAt),
sql\`\${table.auditStatus} IN ('NOT_STARTED', 'APPROVED')\`,`,
  },
  {
    id: 12,
    path: 'apps/api/src/legacy/legacy-authorization-history.repository.ts',
    source: 'fechaAplicacion: row.fecha_aplicacion, ordenCompra: row.orden_compra,',
  },
  {
    id: 13,
    path: 'apps/api/src/legacy/legacy-compatibility-projection.service.ts',
    source: "set audit_status = ${projection.auditStatus}, admission_status = 'READY',",
  },
  {
    id: 14,
    path: HISTORICAL_COMPATIBILITY_CONTRACT_PATH,
    source: `${HISTORICAL_COMPATIBILITY_CONTRACT_MARKER}
export const legacyAuthorizationHistoryResponseSchema = z.object({
  fechaAplicacion: z.string().nullable(),
  processStatus: z.string().nullable(),
});
export type LegacyAuthorizationHistoryResponse = z.infer<
  typeof legacyAuthorizationHistoryResponseSchema
>;
export const modernSchema = z.object({ ok: z.string() });`,
  },
  {
    id: 15,
    path: 'apps/api/src/audits/patient-application-audit.repository.ts',
    source: 'select paa.status from patient_application_audits patientApplicationAudits.status',
  },
  {
    id: 16,
    path: 'apps/api/src/analytics/analytics.repository.ts',
    source:
      'const auditStatus = modernAudit.status; sql`paa.status = ${query.auditStatus}`; audit.auditStatus;',
  },
  {
    id: 17,
    path: 'apps/api/src/audits/patient-application-audit.repository.ts',
    source: 'select ai.admission_status, paa.status as application_audit_status',
  },
  {
    id: 22,
    path: 'apps/api/src/analytics/analytics.repository.ts',
    source: "const fromQuery = query['auditStatus']; const fromAudit = modernAudit['auditStatus'];",
  },
  {
    id: 23,
    path: SCHEMA_DECLARATION_PATH,
    source:
      "admissionStatus: varchar('admission_status', { length: 20 }).notNull().default('NOT_READY'),",
  },
  {
    id: 24,
    path: SCHEMA_DECLARATION_PATH,
    source: "sql`${table.admissionStatus} <> 'READY' OR ${table.auditStatus} = 'APPROVED'`",
  },
] as const;
