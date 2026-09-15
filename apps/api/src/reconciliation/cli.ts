import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createDatabase } from '@authorization/database';
import { RECONCILIATION_MAX_FINDINGS_PER_RULE } from '@authorization/domain';
import { ReconciliationEngine } from './reconciliation.engine';
import { ReconciliationRepository } from './reconciliation.repository';
import type { LegacyScanInput } from './reconciliation.types';

const envPath = resolve(__dirname, '../../../../.env');
if (!process.env.DATABASE_URL && existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

function arg(name: string): string | undefined {
  const prefixed = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (prefixed) return prefixed.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

function loadLegacyScan(): LegacyScanInput | null {
  if (!process.argv.includes('--legacy-scan')) return null;
  const result = spawnSync(process.execPath, ['scripts/check-legacy-operational-usage.mjs'], {
    cwd: resolve(__dirname, '../../../..'),
    encoding: 'utf8',
  });
  return { status: result.status === 0 ? 'PASS' : 'FAIL', hitCount: result.status === 0 ? 0 : 1 };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is required\n');
    process.exit(2);
  }
  const database = createDatabase(databaseUrl);
  const repository = new ReconciliationRepository(database);
  const engine = new ReconciliationEngine(database.pool, repository);
  try {
    const tenantId =
      arg('tenantId') ??
      (await database.pool.query<{ id: string }>(`select id from organizations where code = 'MTD'`))
        .rows[0]?.id;
    if (!tenantId) {
      process.stderr.write('MTD organization was not found\n');
      process.exit(2);
    }
    const planningPeriodId = arg('planningPeriodId');
    const dispensingPointId = arg('dispensingPointId');
    const commercialCode = arg('commercialCode');
    const maxFindingsArg = arg('maxFindings');
    const legacyScan = loadLegacyScan();
    const { id } = await engine.execute({
      tenantId,
      startedBy: null,
      ...(planningPeriodId ? { planningPeriodId } : {}),
      ...(dispensingPointId ? { dispensingPointId } : {}),
      ...(commercialCode ? { commercialCode } : {}),
      maxFindings: maxFindingsArg ? Number(maxFindingsArg) : RECONCILIATION_MAX_FINDINGS_PER_RULE,
      ...(legacyScan ? { legacyScan } : {}),
    });
    const run = await database.pool.query<{
      id: string;
      status: string;
      critical_findings: number;
      error_findings: number;
      warning_findings: number;
      info_findings: number;
      duration_ms: number | null;
      rules_version: string;
      total_rules: number;
      passed_rules: number;
      failed_rules: number;
    }>(
      `select id, status, critical_findings, error_findings, warning_findings, info_findings,
              duration_ms, rules_version, total_rules, passed_rules, failed_rules
         from reconciliation_runs where id = $1`,
      [id],
    );
    const row = run.rows[0]!;
    process.stdout.write(
      `${JSON.stringify(
        {
          id: row.id,
          status: row.status,
          rulesVersion: row.rules_version,
          totalRules: row.total_rules,
          passedRules: row.passed_rules,
          failedRules: row.failed_rules,
          criticalFindings: row.critical_findings,
          errorFindings: row.error_findings,
          warningFindings: row.warning_findings,
          infoFindings: row.info_findings,
          durationMs: row.duration_ms,
        },
        null,
        2,
      )}\n`,
    );
    if (row.status === 'FAILED') process.exit(2);
    if (Number(row.critical_findings) > 0 || Number(row.error_findings) > 0) process.exit(1);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'reconciliation failed'}\n`);
    process.exit(2);
  } finally {
    await database.pool.end();
  }
}

void main();
