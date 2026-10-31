import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertComposeProjectIsEmpty,
  assertIntegrationDatabaseTarget,
  assertIntegrationProjectName,
  createIntegrationProjectName,
  integrationComposeArgs,
} from './integration-safety.mjs';

const testId = '10000000-0000-4000-8000-000000000001';
const testProject = 'mtd-olp-medicarte-integration-' + testId;

test('excludes secrets and local credentials from Docker build context', () => {
  const dockerignore = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8');
  for (const pattern of ['secrets/', '.env*', 'node_modules', '.git']) {
    assert.ok(
      dockerignore.split(/\r?\n/).includes(pattern),
      `Missing .dockerignore rule: ${pattern}`,
    );
  }
});

test('uses one Compose project for CI setup, logs and cleanup', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const composeProject = workflow.match(/^\s+COMPOSE_PROJECT_NAME:\s*([^\r\n]+)$/m)?.[1].trim();
  const integrationProject = workflow
    .match(/^\s+INTEGRATION_COMPOSE_PROJECT_NAME:\s*([^\r\n]+)$/m)?.[1]
    .trim();

  assert.ok(composeProject);
  assert.equal(integrationProject, composeProject);
});

test('crea un proyecto por ejecución dentro del namespace de integración', () => {
  assert.equal(createIntegrationProjectName(testId), testProject);
  assert.equal(assertIntegrationProjectName(testProject), testProject);

  const firstRun = createIntegrationProjectName();
  const secondRun = createIntegrationProjectName();
  assert.notEqual(firstRun, secondRun);
  assert.match(firstRun, /^mtd-olp-medicarte-integration-[0-9a-f-]+$/);
});

test('rechaza nombres de proyectos de otros entornos o identificadores inválidos', () => {
  for (const project of [
    'mtd-olp-medicarte-local',
    'mtd-olp-medicarte',
    'default',
    'mtd-olp-medicarte-integration-custom',
  ]) {
    assert.throws(() => assertIntegrationProjectName(project), /outside the integration namespace/);
  }
  assert.throws(() => createIntegrationProjectName('not-a-uuid'), /invalid integration project/);
});

test('cada comando Compose fija proyecto y archivo del repositorio explícitamente', () => {
  assert.deepEqual(integrationComposeArgs(testProject, 'docker-compose.yml', ['down', '-v']), [
    'compose',
    '--project-name',
    testProject,
    '--file',
    'docker-compose.yml',
    'down',
    '-v',
  ]);
  assert.throws(
    () => integrationComposeArgs('mtd-olp-medicarte-local', 'docker-compose.yml', ['down', '-v']),
    /outside the integration namespace/,
  );
  assert.throws(
    () => integrationComposeArgs(testProject, '', ['down', '-v']),
    /without an explicit file/,
  );
});

test('acepta solo la base local de integración con credenciales sintéticas', () => {
  const database = assertIntegrationDatabaseTarget(
    'postgresql://authorization:authorization@localhost:25432/authorization_test_integration',
    '25432',
  );
  assert.equal(database.pathname, '/authorization_test_integration');
});

test('rechaza destinos de base de datos remotos, credenciales o nombres inseguros', () => {
  const unsafeTargets = [
    [
      'postgresql://authorization:authorization@db.example.com:25432/authorization_test_integration',
      '25432',
    ],
    [
      'postgresql://real-user:real-password@localhost:25432/authorization_test_integration',
      '25432',
    ],
    [
      'postgresql://authorization:authorization@localhost:5432/authorization_test_integration',
      '25432',
    ],
    ['postgresql://authorization:authorization@localhost:25432/authorization', '25432'],
    [
      'postgresql://authorization:authorization@localhost:25432/authorization_test_integration?sslmode=require',
      '25432',
    ],
  ];
  for (const [url, port] of unsafeTargets) {
    assert.throws(() => assertIntegrationDatabaseTarget(url, port), /Refusing integration setup/);
  }
});

test('preflight acepta un proyecto sin recursos y rechaza contenedores, volúmenes o redes existentes', () => {
  const calls = [];
  assertComposeProjectIsEmpty(testProject, (_command, args) => {
    calls.push(args);
    return '';
  });
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every((args) => args.at(-1) === `label=com.docker.compose.project=${testProject}`),
  );

  for (let resourceIndex = 0; resourceIndex < 3; resourceIndex++) {
    let currentResource = 0;
    assert.throws(
      () =>
        assertComposeProjectIsEmpty(testProject, (_command, _args) =>
          currentResource++ === resourceIndex ? 'resource-id\n' : '',
        ),
      /already owns resources/,
    );
  }
});
