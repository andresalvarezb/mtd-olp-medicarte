import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import pg from 'pg';
import {
  assertComposeProjectIsEmpty,
  createIntegrationProjectName,
  integrationComposeArgs,
} from './integration-safety.mjs';

const { Client } = pg;
const databaseName =
  'authorization_e2e_' + new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const projectName = createIntegrationProjectName();
const composeFile = resolve(import.meta.dirname, '..', 'docker-compose.yml');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Cannot determine an available local port'));
        return;
      }
      const port = String(address.port);
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function compose(args, env) {
  execFileSync('docker', integrationComposeArgs(projectName, composeFile, args), {
    stdio: 'inherit',
    env,
  });
}

function assertOwnedResources({ requireContainers = false } = {}) {
  const label = `label=com.docker.compose.project=${projectName}`;
  const containerIds = execFileSync('docker', ['ps', '--all', '--quiet', '--filter', label], {
    encoding: 'utf8',
  })
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (requireContainers && containerIds.length === 0) {
    throw new Error('Expected temporary Compose containers were not found');
  }

  if (containerIds.length > 0) {
    const containers = JSON.parse(
      execFileSync('docker', ['inspect', ...containerIds], { encoding: 'utf8' }),
    );
    if (
      containers.some(
        (container) => container.Config?.Labels?.['com.docker.compose.project'] !== projectName,
      )
    ) {
      throw new Error('Refusing cleanup because a container has an unexpected Compose owner');
    }
  }

  for (const type of ['volume', 'network']) {
    const ids = execFileSync('docker', [type, 'ls', '--quiet', '--filter', label], {
      encoding: 'utf8',
    })
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length === 0) continue;
    const inspect = type === 'volume' ? ['volume', 'inspect'] : ['network', 'inspect'];
    const resources = JSON.parse(
      execFileSync('docker', [...inspect, ...ids], { encoding: 'utf8' }),
    );
    if (
      resources.some((resource) => resource.Labels?.['com.docker.compose.project'] !== projectName)
    ) {
      throw new Error(`Refusing cleanup because a ${type} has an unexpected Compose owner`);
    }
  }
}

const [postgresPort, redisPort, apiPort] = await Promise.all([
  availablePort(),
  availablePort(),
  availablePort(),
]);
const databaseUrl = `postgresql://authorization:authorization@127.0.0.1:${postgresPort}/${databaseName}`;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: projectName,
  POSTGRES_DB: databaseName,
  POSTGRES_HOST_PORT: postgresPort,
  REDIS_HOST_PORT: redisPort,
  API_HOST_PORT: apiPort,
  DATABASE_URL: databaseUrl,
  API_URL: apiUrl,
  AUTH_DEV_ADMIN_USERNAME: 'foundation-admin',
  AUTH_DEV_ADMIN_PASSWORD: 'foundation-admin',
};

assertComposeProjectIsEmpty(projectName);
let startAttempted = false;
let runError;

try {
  console.log(`E2E_COMPOSE_PROJECT=${projectName}`);
  console.log(`E2E_DATABASE=${databaseName}`);
  startAttempted = true;
  compose(['up', '-d', '--build', '--wait', 'postgres', 'redis', 'migrate', 'api'], env);
  assertOwnedResources({ requireContainers: true });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const identity = await client.query(
      'select current_database() as database, current_user as username, inet_server_port() as port',
    );
    const actual = identity.rows[0];
    if (
      actual?.database !== databaseName ||
      actual?.username !== 'authorization' ||
      Number(actual?.port) !== 5432
    ) {
      throw new Error('E2E PostgreSQL identity verification failed');
    }
    console.log('E2E_POSTGRES_IDENTITY=VERIFIED_TEMPORARY');
  } finally {
    await client.end();
  }

  const health = await fetch(`${apiUrl}/api/v1/health`);
  if (!health.ok) throw new Error(`Temporary API health check failed: ${health.status}`);

  execFileSync(
    pnpmCommand,
    [
      'exec',
      'vitest',
      'run',
      '--config',
      'tests/vitest.prodshadow.config.ts',
      'tests/integration/inventory-expiration-auto-release.prodshadow.test.ts',
      'tests/integration/po-operational-cycle.prodshadow.test.ts',
    ],
    { stdio: 'inherit', env },
  );
} catch (error) {
  runError = error;
  if (startAttempted) {
    try {
      compose(['logs', '--no-color'], env);
    } catch (logsError) {
      console.error('Could not collect isolated E2E service logs:', logsError);
    }
  }
} finally {
  if (startAttempted) {
    try {
      assertOwnedResources();
      compose(['down', '-v', '--remove-orphans'], env);
      console.log('E2E_TEMPORARY_RESOURCES_CLEANED=YES');
    } catch (cleanupError) {
      console.error('Could not safely clean the isolated E2E project:', cleanupError);
      if (!runError) runError = cleanupError;
    }
  }
}

if (runError) throw runError;
