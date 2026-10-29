import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';

async function availableRedisPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Cannot determine Redis test port'));
        return;
      }

      const port = String(address.port);
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

const postgresHostPort = process.env.POSTGRES_HOST_PORT ?? '25432';
const integrationProject = 'authorization-integration-' + postgresHostPort;
const databaseUrl =
  process.env.DATABASE_URL ??
  `postgresql://authorization:authorization@localhost:${postgresHostPort}/authorization`;
const database = new URL(databaseUrl);
const integrationEnvironment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  API_HOST_PORT: process.env.API_HOST_PORT ?? '3003',
  POSTGRES_HOST_PORT: postgresHostPort,
  REDIS_HOST_PORT: process.env.REDIS_HOST_PORT ?? await availableRedisPort(),
  COMPOSE_PROJECT_NAME: integrationProject,
};
if (
  database.hostname !== 'localhost' ||
  database.port !== postgresHostPort ||
  database.pathname !== '/authorization'
) {
  throw new Error('Refusing integration setup outside the isolated TEST/INTEGRATION project');
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
    env: { ...integrationEnvironment, INTEGRATION_DB_RESET: '1' },
  },
);
execFileSync('docker', ['compose', 'up', '-d', '--build', '--wait', 'api', 'worker'], {
  stdio: 'inherit',
  env: integrationEnvironment,
});
