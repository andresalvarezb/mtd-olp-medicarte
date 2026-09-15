import { sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDatabase } from './index';

const envPath = resolve(__dirname, '../../../.env');
if (!process.env.DATABASE_URL && existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const OPERATIONAL_TABLES = [
  'reconciliation_issue_comments',
  'reconciliation_issue_events',
  'reconciliation_findings',
  'reconciliation_issues',
  'reconciliation_runs',
  'user_point_scopes',
  'bulk_import_row_attempts',
  'bulk_import_rows',
  'bulk_import_jobs',
  'patient_application_audits',
  'patient_application_lines',
  'patient_applications',
  'patient_schedule_outcome_lines',
  'patient_schedule_outcomes',
  'stock_transfer_lines',
  'stock_transfers',
  'inventory_movements',
  'inventory_lots',
  'receipt_lines',
  'receipts',
  'demand_sources',
  'projected_demand_lines',
  'purchase_order_demand_allocations',
  'purchase_order_lines',
  'purchase_orders',
  'delivery_lines',
  'deliveries',
  'patient_schedule_history',
  'patient_schedules',
  'planning_periods',
  'dispensing_points',
  'audit_findings',
  'audit_reviews',
  'audit_events',
  'operational_field_changes',
  'bulk_update_rows',
  'bulk_update_source_files',
  'bulk_update_batches',
  'validation_errors',
  'import_rows',
  'import_source_files',
  'import_batches',
  'mipres_directions',
  'mipres_checks',
  'tariff_annex_import_rows',
  'tariff_annex_import_source_files',
  'tariff_annex_imports',
  'tariff_annex_products',
  'coverage_evaluations',
  'authorization_item_organizations',
  'authorization_items',
  'outbox_events',
  'job_results',
  'idempotency_records',
] as const;

const PRESERVED_TABLES = [
  'organizations',
  'users',
  'roles',
  'permissions',
  'role_permissions',
  'user_organization_roles',
] as const;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const flag = process.argv[2];
  if (flag !== '--yes') {
    console.error(
      `This deletes ALL operational data from the database (users, organizations, roles and permissions are preserved).\n` +
        `Tables to truncate:\n  ${OPERATIONAL_TABLES.join('\n  ')}\n` +
        `Tables preserved:\n  ${PRESERVED_TABLES.join('\n  ')}\n` +
        `Run again with --yes to confirm.`,
    );
    process.exit(1);
  }

  const { db, pool } = createDatabase(databaseUrl);
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`TRUNCATE TABLE ${OPERATIONAL_TABLES.join(', ')} CASCADE`));
    });
    console.log(
      `Database reset complete: truncated ${OPERATIONAL_TABLES.length} operational tables.`,
    );
  } finally {
    await pool.end();
  }
}

void main();
