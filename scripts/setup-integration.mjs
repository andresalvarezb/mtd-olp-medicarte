import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import {
  assertComposeProjectIsEmpty,
  assertIntegrationDatabaseTarget,
  assertIntegrationProjectName,
  createIntegrationProjectName,
  integrationComposeArgs,
} from './integration-safety.mjs';

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
const databaseUrl =
  process.env.DATABASE_URL ??
  `postgresql://authorization:authorization@localhost:${postgresHostPort}/authorization_test_integration`;
assertIntegrationDatabaseTarget(databaseUrl, postgresHostPort);
const projectName = assertIntegrationProjectName(
  process.env.INTEGRATION_COMPOSE_PROJECT_NAME ?? createIntegrationProjectName(),
);
const composeFile = resolve(import.meta.dirname, '..', 'docker-compose.yml');
const integrationEnvironment = {
  ...process.env,
  INTEGRATION_COMPOSE_PROJECT_NAME: projectName,
  COMPOSE_PROJECT_NAME: projectName,
  POSTGRES_DB: 'authorization_test_integration',
  DATABASE_URL: databaseUrl,
  API_HOST_PORT: process.env.API_HOST_PORT ?? '3003',
  POSTGRES_HOST_PORT: postgresHostPort,
  REDIS_HOST_PORT: process.env.REDIS_HOST_PORT ?? (await availableRedisPort()),
};
console.log('INTEGRATION_COMPOSE_PROJECT_NAME=' + projectName);
const pnpmExecPath = process.env.npm_execpath;
if (!pnpmExecPath) {
  throw new Error('npm_execpath is unavailable; run setup through pnpm integration:setup');
}

assertComposeProjectIsEmpty(projectName);

let composeStartAttempted = false;
try {
  composeStartAttempted = true;
  const compose = integrationComposeArgs(projectName, composeFile, [
    'up',
    '-d',
    '--build',
    '--wait',
    'postgres',
    'redis',
    'migrate',
    'api',
  ]);
  execFileSync('docker', compose, { stdio: 'inherit', env: integrationEnvironment });

  execFileSync(process.execPath, [pnpmExecPath, 'db:reset'], {
    stdio: 'inherit',
    env: integrationEnvironment,
  });

  execFileSync(
    'docker',
    integrationComposeArgs(projectName, composeFile, [
      'up',
      '-d',
      '--build',
      '--wait',
      'api',
      'worker',
    ]),
    { stdio: 'inherit', env: integrationEnvironment },
  );
} catch (error) {
  if (composeStartAttempted) {
    try {
      execFileSync(
        'docker',
        integrationComposeArgs(projectName, composeFile, ['down', '-v', '--remove-orphans']),
        { stdio: 'inherit', env: integrationEnvironment },
      );
    } catch (cleanupError) {
      console.error('No se pudo limpiar el proyecto aislado de integración:', cleanupError);
    }
  }
  throw error;
}
