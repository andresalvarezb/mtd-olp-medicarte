import { execFileSync } from 'node:child_process';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:25432/authorization_test_integration';
const database = new URL(databaseUrl);
const integrationEnvironment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  API_HOST_PORT: '3003',
  POSTGRES_HOST_PORT: '25432',
  REDIS_HOST_PORT: '16379',
};
if (
  database.hostname !== 'localhost' ||
  database.port !== '25432' ||
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
const pnpmExecPath = process.env.npm_execpath;
if (!pnpmExecPath) {
  throw new Error('npm_execpath is unavailable; run setup through pnpm integration:setup');
}

execFileSync(
  process.execPath,
  [pnpmExecPath, 'db:reset'],
  {
    stdio: 'inherit',
    env: integrationEnvironment,
  },
);
execFileSync('docker', ['compose', 'up', '-d', '--build', '--wait', 'api', 'worker'], {
  stdio: 'inherit',
  env: integrationEnvironment,
});
