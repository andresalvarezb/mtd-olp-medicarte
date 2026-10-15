import { Client } from 'pg';

const integrationPort =
  process.env.POSTGRES_HOST_PORT ??
  (process.env.INTEGRATION_ANNULMENT_ISOLATED === '1' ? '26432' : '25432');

const databaseUrl =
  process.env.DATABASE_URL ??
  `postgresql://authorization:authorization@localhost:${integrationPort}/authorization_test_integration`;
const parsed = new URL(databaseUrl);
if (
  parsed.hostname !== 'localhost' ||
  parsed.port !== integrationPort ||
  parsed.pathname !== '/authorization_test_integration'
) {
  throw new Error(
    'Integration tests require the dedicated authorization_test_integration database',
  );
}
process.env.DATABASE_URL = databaseUrl;
process.env.API_URL ??= `http://localhost:${process.env.API_HOST_PORT ?? '3001'}`;
process.env.AUTH_DEV_ADMIN_USERNAME ??= 'foundation-admin';
process.env.AUTH_DEV_ADMIN_PASSWORD ??= 'foundation-admin';

const client = new Client({ connectionString: databaseUrl });
await client.connect();
const identity = await client.query<{ database: string }>('select current_database() as database');
if (identity.rows[0]?.database !== 'authorization_test_integration') {
  throw new Error('Integration database identity guard failed');
}
await client.end();
