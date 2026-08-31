import { sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDatabase } from './index';

const envPath = resolve(__dirname, '../../../.env');
if (!process.env.DATABASE_URL && existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const OPERATIONAL_TABLES = [
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
  'coverage_evaluations',
  'authorization_item_organizations',
  'authorization_items',
  'notifications',
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
  'notification_templates',
  'notification_recipients',
  'pending_user_requests',
] as const;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const flag = process.argv[2];
  if (flag !== '--yes') {
    console.error(
      `This deletes ALL operational data from the database (users, organizations, roles, permissions and notification config are preserved).\n` +
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
    console.log(`Database reset complete: truncated ${OPERATIONAL_TABLES.length} operational tables.`);
  } finally {
    await pool.end();
  }
}

void main();
