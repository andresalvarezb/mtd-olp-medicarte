import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export function createDatabase(databaseUrl: string) {
  const maxConnections =
    Number(process.env.DATABASE_POOL_MAX ?? 4);

  if (
    !Number.isInteger(maxConnections) ||
    maxConnections < 1 ||
    maxConnections > 20
  ) {
    throw new Error('Invalid DATABASE_POOL_MAX');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: maxConnections,
    connectionTimeoutMillis: 10_000,
  });

  pool.on('error', (error) => {
    console.error('[database] PostgreSQL idle client error', {
      name: error.name,
      message: error.message,
    });
  });
  return {
    db: drizzle(pool, { schema }),
    pool,
  };
}

export * from './schema';
export * from './novelties';
