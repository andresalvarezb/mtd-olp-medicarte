import { execFileSync } from 'node:child_process';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization_test_integration';
const database = new URL(databaseUrl);
const integrationEnvironment = { ...process.env, DATABASE_URL: databaseUrl, API_HOST_PORT: '3003' };
if (
  database.hostname !== 'localhost' ||
  database.port !== '15432' ||
  database.pathname !== '/authorization_test_integration'
) {
  throw new Error('Refusing integration setup outside the dedicated TEST/INTEGRATION database');
}
execFileSync('docker', ['compose', 'down', '-v', '--remove-orphans'], {
  stdio: 'inherit',
  env: integrationEnvironment,
});
const compose = ['compose', 'up', '-d', '--build', '--wait', 'postgres', 'redis', 'migrate', 'api'];
execFileSync('docker', compose, { stdio: 'inherit', env: integrationEnvironment });
execFileSync('pnpm', ['db:reset', '--', '--yes'], {
  stdio: 'inherit',
  env: integrationEnvironment,
});
execFileSync('docker', ['compose', 'up', '-d', '--build', '--wait', 'api', 'worker'], {
  stdio: 'inherit',
  env: integrationEnvironment,
});
