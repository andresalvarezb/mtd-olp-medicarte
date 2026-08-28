import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import { createDatabase } from './index';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const { db, pool } = createDatabase(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: resolve(__dirname, '../migrations') });
  } finally {
    await pool.end();
  }
}

void main();
