import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import {
  assertIntegrationTestFiles,
  assertReusableIntegrationProject,
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

const reusable = process.env.INTEGRATION_REUSE === '1';
const postgresPort = reusable ? (process.env.POSTGRES_HOST_PORT ?? '25432') : await availablePort();
const redisPort = reusable ? (process.env.REDIS_HOST_PORT ?? '26379') : await availablePort();
const apiPort = reusable ? (process.env.API_HOST_PORT ?? '3003') : await availablePort();
const projectName = assertIntegrationProjectName(
  process.env.INTEGRATION_COMPOSE_PROJECT_NAME ?? createIntegrationProjectName(),
);
const selectedFiles =
  process.argv.length > 2
    ? assertIntegrationTestFiles(
        process.argv.slice(2).filter((arg) => arg !== '--'),
        resolve(import.meta.dirname, '..'),
      )
    : [];
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
if (reusable && selectedFiles.length === 0) {
  throw new Error('Reusable integration mode requires explicit test files');
}

console.log('INTEGRATION_COMPOSE_PROJECT_NAME=' + projectName);

let setupCompleted = false;
let runError;

try {
  if (reusable) {
    if (!process.env.INTEGRATION_COMPOSE_PROJECT_NAME) {
      throw new Error('INTEGRATION_REUSE=1 requires an explicit INTEGRATION_COMPOSE_PROJECT_NAME');
    }
    env.INTEGRATION_REUSE = '1';
    const running = execFileSync(
      'docker',
      integrationComposeArgs(projectName, composeFile, ['ps', '--services', '--status', 'running']),
      { encoding: 'utf8', stdio: 'pipe', env },
    ).trim();
    if (!running) {
      execFileSync(process.execPath, [pnpmPath, 'integration:setup'], { stdio: 'inherit', env });
    }
    assertReusableIntegrationProject(projectName, composeFile, postgresPort, env);
    execFileSync(process.execPath, [pnpmPath, 'db:reset', '--', '--yes'], {
      stdio: 'inherit',
      env,
    });
    execFileSync(
      process.execPath,
      [
        pnpmPath,
        'exec',
        'vitest',
        'run',
        '--config',
        'tests/vitest.integration.config.ts',
        ...selectedFiles,
      ],
      { stdio: 'inherit', env },
    );
  } else {
    execFileSync(process.execPath, [pnpmPath, 'integration:setup'], { stdio: 'inherit', env });
    setupCompleted = true;
    execFileSync(
      process.execPath,
      [
        pnpmPath,
        'exec',
        'vitest',
        'run',
        '--config',
        'tests/vitest.integration.config.ts',
        ...selectedFiles,
      ],
      { stdio: 'inherit', env },
    );
  }

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
