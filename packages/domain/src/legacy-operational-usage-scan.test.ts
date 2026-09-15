import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_SCAN_FORBIDDEN_FIELDS, classifyLegacyField } from './legacy-operational-cutover';
import {
  LEGACY_SCAN_ALLOWLIST,
  LEGACY_SCAN_NEGATIVE_FIXTURES,
  LEGACY_SCAN_POLICY_REPORT,
  LEGACY_SCAN_POSITIVE_FIXTURES,
  LEGACY_SCAN_REQUIRED_COVERAGE,
  LEGACY_SCAN_REQUIRED_NEGATIVE_COUNT,
  LEGACY_SCAN_REQUIRED_POSITIVE_COUNT,
  LEGACY_SCAN_RUNTIME_ROOTS,
  LEGACY_SCAN_SKIP_DIRECTORY_NAMES,
  SCHEMA_DECLARATION_PATH,
  collectLegacyOperationalUsageHits,
  findLegacyAuthorizationAuditStatusUsages,
  forbiddenLegacyScanTokens,
  isAdmissionStatusPathAllowed,
  isLegacyScanSourceFile,
  isPathAllowlistedForLegacyScan,
  sourceForLegacyFieldScan,
} from './legacy-operational-usage-scan';

function repoRoot(): string {
  let directory = process.cwd();
  for (;;) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error('repository root not found');
    directory = parent;
  }
}

function walkRuntimeSources(directory: string, files: string[] = []): string[] {
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory)) {
    if ((LEGACY_SCAN_SKIP_DIRECTORY_NAMES as readonly string[]).includes(entry)) continue;
    const full = join(directory, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkRuntimeSources(full, files);
    else if (isLegacyScanSourceFile(entry)) files.push(full);
  }
  return files;
}

describe('ESP-016 full-runtime legacy usage scanner', () => {
  it('derives forbidden tokens from the classification registry and never treats admission_status as generic legacy', () => {
    expect(LEGACY_SCAN_FORBIDDEN_FIELDS).toEqual([
      'lugar_dispensacion',
      'fecha_programada',
      'fecha_dispensacion',
      'fecha_aplicacion',
      'cod_autorizacion_medicarte',
      'orden_compra',
      'process_status',
      'operation_status',
      'operational_version',
      'audit_status',
    ]);
    expect(classifyLegacyField('admission_status')).toBe('AUTHORITATIVE');
    expect(forbiddenLegacyScanTokens()).toContain('fechaAplicacion');
    expect(forbiddenLegacyScanTokens()).toContain('processStatus');
    expect(forbiddenLegacyScanTokens()).not.toContain('auditStatus');
    expect(forbiddenLegacyScanTokens()).not.toContain('admission_status');
    expect(forbiddenLegacyScanTokens()).not.toContain('operationalStatus');
  });

  it('covers the modern runtime roots required by ESP-016', () => {
    expect(LEGACY_SCAN_RUNTIME_ROOTS).toEqual([
      'apps/api/src',
      'apps/worker/src',
      'apps/web',
      'packages/domain/src',
      'packages/database/src',
      'packages/contracts/src',
      'packages/config/src',
      'packages/ui/src',
    ]);
    expect(LEGACY_SCAN_REQUIRED_COVERAGE).toEqual([
      'API',
      'WORKER',
      'WEB',
      'DOMAIN',
      'DATABASE_RUNTIME',
      'CONTRACTS',
      'CONFIG',
      'UI',
    ]);
  });

  it('keeps a granular allowlist with path, rule, fields and reason; schema.ts is not fully free', () => {
    expect(
      LEGACY_SCAN_POLICY_REPORT.every(
        (entry) => entry.path.length > 0 && entry.rule.length > 0 && entry.reason.length > 0,
      ),
    ).toBe(true);
    expect(LEGACY_SCAN_ALLOWLIST.some((entry) => entry.path.includes('**'))).toBe(false);
    expect(
      LEGACY_SCAN_ALLOWLIST.some((entry) => (entry.path as string) === SCHEMA_DECLARATION_PATH),
    ).toBe(false);
    expect(isPathAllowlistedForLegacyScan(SCHEMA_DECLARATION_PATH)).toBe(false);
    expect(isAdmissionStatusPathAllowed(SCHEMA_DECLARATION_PATH)).toBe(false);
    expect(isPathAllowlistedForLegacyScan('packages/database/src/reset.ts')).toBe(false);
    expect(isPathAllowlistedForLegacyScan('packages/database/src/index.ts')).toBe(false);
    expect(
      isPathAllowlistedForLegacyScan(
        'apps/api/src/legacy/legacy-compatibility-projection.service.ts',
      ),
    ).toBe(true);
    expect(
      isPathAllowlistedForLegacyScan('apps/api/src/scheduling/patient-schedule.service.ts'),
    ).toBe(false);
    expect(
      isPathAllowlistedForLegacyScan('apps/api/src/scheduling/patient-schedule.service.test.ts'),
    ).toBe(true);
    expect(isPathAllowlistedForLegacyScan('apps/web/features/inventory/inventory-view.tsx')).toBe(
      false,
    );
    expect(
      isPathAllowlistedForLegacyScan('apps/web/features/inventory/inventory-view.test.tsx'),
    ).toBe(true);
    expect(isPathAllowlistedForLegacyScan('apps/worker/src/worker.service.ts')).toBe(false);
    expect(isPathAllowlistedForLegacyScan('packages/contracts/src/index.ts')).toBe(false);
  });

  it('locks the negative/positive matrix so coverage cannot be dropped silently', () => {
    expect(LEGACY_SCAN_NEGATIVE_FIXTURES).toHaveLength(LEGACY_SCAN_REQUIRED_NEGATIVE_COUNT);
    expect(LEGACY_SCAN_POSITIVE_FIXTURES).toHaveLength(LEGACY_SCAN_REQUIRED_POSITIVE_COUNT);
    expect(LEGACY_SCAN_NEGATIVE_FIXTURES.map((fixture) => fixture.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 18, 19, 20, 21,
    ]);
    expect(LEGACY_SCAN_POSITIVE_FIXTURES.map((fixture) => fixture.id)).toEqual([
      11, 12, 13, 14, 15, 16, 17, 22, 23, 24,
    ]);
    expect(LEGACY_SCAN_NEGATIVE_FIXTURES.map((fixture) => fixture.token)).toEqual([
      'fecha_aplicacion',
      'operation_status',
      'audit_status',
      'authorizationItems.auditStatus',
      'process_status',
      'row.auditStatus',
      'LegacyAuthorizationHistoryRepository',
      'admissionStatus',
      'admissionStatus',
      'processStatus',
      "authorizationItems['auditStatus']",
      'authorizationItem["fechaAplicacion"]',
      "row['operationStatus']",
      'admissionStatus',
    ]);
  });

  it('fails closed on the required negative matrix', () => {
    const hits = collectLegacyOperationalUsageHits(
      LEGACY_SCAN_NEGATIVE_FIXTURES.map((fixture) => ({
        path: fixture.path,
        source: fixture.source,
      })),
    );
    for (const fixture of LEGACY_SCAN_NEGATIVE_FIXTURES) {
      expect(
        hits.some(
          (hit) =>
            hit.path === fixture.path &&
            hit.token === fixture.token &&
            hit.policy === fixture.policy,
        ),
        `expected a hit for #${fixture.id} ${fixture.path} token ${fixture.token}`,
      ).toBe(true);
    }
  });

  it('allows the required positive matrix', () => {
    expect(collectLegacyOperationalUsageHits([...LEGACY_SCAN_POSITIVE_FIXTURES])).toEqual([]);
  });

  it('distinguishes legacy authorizationItems.auditStatus from modern auditStatus', () => {
    expect(
      findLegacyAuthorizationAuditStatusUsages(
        "db.select({ audit: authorizationItems.auditStatus }); eq(authorizationItems.auditStatus, 'APPROVED');",
      ),
    ).toEqual(['authorizationItems.auditStatus']);
    expect(findLegacyAuthorizationAuditStatusUsages("authorizationItems['auditStatus']")).toEqual([
      "authorizationItems['auditStatus']",
    ]);
    expect(findLegacyAuthorizationAuditStatusUsages("modernAudit['auditStatus']")).toEqual([]);
    expect(findLegacyAuthorizationAuditStatusUsages("query['auditStatus']")).toEqual([]);
    expect(
      collectLegacyOperationalUsageHits([
        {
          path: 'apps/api/src/analytics/analytics.repository.ts',
          source: 'const auditStatus = query.auditStatus; sql`paa.status = ${query.auditStatus}`',
        },
      ]),
    ).toEqual([]);
  });

  it('allows schema declarations and rejects an operational helper in the same file', () => {
    const hits = collectLegacyOperationalUsageHits([
      {
        path: SCHEMA_DECLARATION_PATH,
        source: `auditStatus: varchar('audit_status', { length: 30 }),
fechaAplicacion: date('fecha_aplicacion'),
function legacyAuditDecision(row) {
  return row.auditStatus === 'APPROVED';
}`,
      },
    ]);
    expect(hits.some((hit) => hit.token === 'audit_status')).toBe(false);
    expect(hits.some((hit) => hit.token === 'fechaAplicacion')).toBe(false);
    expect(hits).toContainEqual({
      path: SCHEMA_DECLARATION_PATH,
      token: 'row.auditStatus',
      policy: 'forbidden_legacy',
    });
  });

  it('flags undocumented admissionStatus in scheduling and analytics while allowing ESP-012 boundaries', () => {
    expect(
      collectLegacyOperationalUsageHits([
        {
          path: 'apps/api/src/scheduling/patient-schedule.service.ts',
          source: "if (item.admissionStatus === 'READY') return true;",
        },
      ]),
    ).toEqual([
      {
        path: 'apps/api/src/scheduling/patient-schedule.service.ts',
        token: 'admissionStatus',
        policy: 'admission_boundary',
      },
    ]);
    expect(
      collectLegacyOperationalUsageHits([
        {
          path: 'apps/api/src/analytics/analytics.service.ts',
          source: "if (row.admissionStatus === 'READY') return row;",
        },
      ]),
    ).toEqual([
      {
        path: 'apps/api/src/analytics/analytics.service.ts',
        token: 'admissionStatus',
        policy: 'admission_boundary',
      },
    ]);
    expect(
      collectLegacyOperationalUsageHits([
        {
          path: 'apps/api/src/audits/patient-application-audit.repository.ts',
          source: 'select ai.admission_status, paa.status as application_audit_status',
        },
      ]),
    ).toEqual([]);
    expect(
      collectLegacyOperationalUsageHits([
        {
          path: SCHEMA_DECLARATION_PATH,
          source: `admissionStatus: varchar('admission_status', { length: 20 }),
sql\`\${table.admissionStatus} <> 'READY' OR \${table.auditStatus} = 'APPROVED'\`,
function canSchedule(row) {
  return row.admissionStatus === 'READY';
}`,
        },
      ]),
    ).toContainEqual({
      path: SCHEMA_DECLARATION_PATH,
      token: 'admissionStatus',
      policy: 'admission_boundary',
    });
  });

  it('forbids modern services from importing the historical repository and allows composition root', () => {
    expect(
      collectLegacyOperationalUsageHits([
        {
          path: 'apps/api/src/analytics/analytics.service.ts',
          source:
            "import { LegacyAuthorizationHistoryRepository } from '../legacy/legacy-authorization-history.repository';",
        },
      ]),
    ).toEqual([
      {
        path: 'apps/api/src/analytics/analytics.service.ts',
        token: 'LegacyAuthorizationHistoryRepository',
        policy: 'historical_repository_import',
      },
    ]);
    expect(
      collectLegacyOperationalUsageHits([
        {
          path: 'apps/api/src/app.module.ts',
          source:
            "import { LegacyAuthorizationHistoryRepository } from './legacy/legacy-authorization-history.repository';",
        },
      ]),
    ).toEqual([]);
  });

  it('strips only the marked historical compatibility contract so the same field outside still fails', () => {
    const inside = LEGACY_SCAN_POSITIVE_FIXTURES.find((fixture) => fixture.id === 14);
    const outside = LEGACY_SCAN_NEGATIVE_FIXTURES.find((fixture) => fixture.id === 10);
    expect(inside).toBeDefined();
    expect(outside).toBeDefined();
    const strippedInside = sourceForLegacyFieldScan(inside!.path, inside!.source);
    const strippedOutside = sourceForLegacyFieldScan(outside!.path, outside!.source);
    expect(strippedInside).not.toContain('fechaAplicacion');
    expect(strippedInside).not.toContain('processStatus');
    expect(strippedOutside).not.toContain('fechaAplicacion');
    expect(strippedOutside).toContain('processStatus');
    expect(collectLegacyOperationalUsageHits([inside!])).toEqual([]);
    expect(collectLegacyOperationalUsageHits([outside!])).toEqual([
      {
        path: outside!.path,
        token: 'processStatus',
        policy: 'forbidden_legacy',
      },
    ]);
  });

  it('passes against the current monorepo runtime sources', () => {
    const root = repoRoot();
    const files = LEGACY_SCAN_RUNTIME_ROOTS.flatMap((scanRoot) =>
      walkRuntimeSources(join(root, scanRoot)).map((file) => ({
        path: relative(root, file).replaceAll('\\', '/'),
        source: readFileSync(file, 'utf8'),
      })),
    );
    expect(files.length).toBeGreaterThan(50);
    expect(collectLegacyOperationalUsageHits(files)).toEqual([]);
  });
});
