import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import {
  assertIntegrationProjectName,
  createIntegrationProjectName,
  integrationComposeArgs,
} from './integration-safety.mjs';

const usedPorts = new Set();

async function availablePort() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = await new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);

      server.listen(0, '127.0.0.1', () => {
        const address = server.address();

        if (!address || typeof address === 'string') {
          server.close();
          reject(new Error('No se pudo determinar el puerto'));
          return;
        }

        server.close((error) => {
          if (error) reject(error);
          else resolve(address.port);
        });
      });
    });

    if (!usedPorts.has(port)) {
      usedPorts.add(port);
      return String(port);
    }
  }

  throw new Error('No hay puertos independientes disponibles');
}

const postgresPort = await availablePort();
const redisPort = await availablePort();
const apiPort = await availablePort();
const projectName = assertIntegrationProjectName(
  process.env.INTEGRATION_COMPOSE_PROJECT_NAME ?? createIntegrationProjectName(),
);
const composeFile = resolve(import.meta.dirname, '..', 'docker-compose.yml');

const env = {
  ...process.env,
  INTEGRATION_COMPOSE_PROJECT_NAME: projectName,
  COMPOSE_PROJECT_NAME: projectName,
  POSTGRES_DB: 'authorization_test_integration',
  POSTGRES_HOST_PORT: postgresPort,
  REDIS_HOST_PORT: redisPort,
  API_HOST_PORT: apiPort,
  API_URL: 'http://localhost:' + apiPort,
  DATABASE_URL:
    'postgresql://authorization:authorization@localhost:' +
    postgresPort +
    '/authorization_test_integration',
};

const pnpmPath = process.env.npm_execpath;

if (!pnpmPath) {
  throw new Error('Ejecuta este script mediante pnpm test:integration');
}

console.log('INTEGRATION_POSTGRES_PORT=' + postgresPort);
console.log('INTEGRATION_REDIS_PORT=' + redisPort);
console.log('INTEGRATION_API_PORT=' + apiPort);
console.log('INTEGRATION_COMPOSE_PROJECT_NAME=' + projectName);

let setupCompleted = false;
let runError;

try {
  execFileSync(process.execPath, [pnpmPath, 'integration:setup'], { stdio: 'inherit', env });
  setupCompleted = true;

  execFileSync(
    process.execPath,
    [pnpmPath, 'exec', 'vitest', 'run', '--config', 'tests/vitest.integration.config.ts'],
    { stdio: 'inherit', env },
  );

  console.log('WAVE1_INTEGRATION=PASS');
} catch (error) {
  runError = error;
}

if (setupCompleted) {
  if (runError) {
    try {
      execFileSync(
        'docker',
        integrationComposeArgs(projectName, composeFile, ['logs', '--no-color']),
        { stdio: 'inherit', env },
      );
    } catch (logsError) {
      console.error('No se pudieron recuperar los logs del proyecto de integración:', logsError);
    }
  }

  try {
    execFileSync(
      'docker',
      integrationComposeArgs(projectName, composeFile, ['down', '-v', '--remove-orphans']),
      { stdio: 'inherit', env },
    );
  } catch (cleanupError) {
    if (runError) {
      console.error('No se pudo limpiar el proyecto aislado de integración:', cleanupError);
    } else {
      runError = cleanupError;
    }
  }
}

if (runError) throw runError;
