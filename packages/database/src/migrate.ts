import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDatabase } from './index';

const envPath = resolve(__dirname, '../../../.env');
if (!process.env.DATABASE_URL && existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const { db, pool } = createDatabase(databaseUrl);
  const lock = await pool.connect();
  try {
    await lock.query("select pg_advisory_lock(hashtext('authorization-platform:migrations'))");
    try {
      await migrate(db, { migrationsFolder: resolve(__dirname, '../migrations') });
    } finally {
      await lock.query("select pg_advisory_unlock(hashtext('authorization-platform:migrations'))");
    }
  } finally {
    lock.release();
    await pool.end();
  }
}

void main();
