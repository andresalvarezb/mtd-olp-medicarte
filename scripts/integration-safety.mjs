import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const PROJECT_PREFIX = 'mtd-olp-medicarte-integration-';
const UUID_SUFFIX = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const CI_SUFFIX = 'ci-[0-9]+-[0-9]+';
const PROJECT_NAME = new RegExp(`^${PROJECT_PREFIX}(?:${UUID_SUFFIX}|${CI_SUFFIX})$`);

const EXPECTED_DATABASE = 'authorization_test_integration';
const EXPECTED_DATABASE_USER = 'authorization';
const EXPECTED_DATABASE_PASSWORD = 'authorization';

export function createIntegrationProjectName(id = randomUUID()) {
  const normalized = String(id).toLowerCase();
  if (!new RegExp(`^${UUID_SUFFIX}$`).test(normalized)) {
    throw new Error('Refusing invalid integration project identifier');
  }
  return PROJECT_PREFIX + normalized;
}

export function assertIntegrationProjectName(projectName) {
  if (typeof projectName !== 'string' || !PROJECT_NAME.test(projectName)) {
    throw new Error('Refusing Compose project outside the integration namespace');
  }
  return projectName;
}

export function integrationComposeArgs(projectName, composeFile, args) {
  const safeProject = assertIntegrationProjectName(projectName);
  if (typeof composeFile !== 'string' || composeFile.length === 0) {
    throw new Error('Refusing integration Compose command without an explicit file');
  }
  return ['compose', '--project-name', safeProject, '--file', composeFile, ...args];
}

export function assertIntegrationDatabaseTarget(databaseUrl, expectedPort) {
  let database;
  try {
    database = new URL(databaseUrl);
  } catch {
    throw new Error('Refusing integration setup with an invalid database URL');
  }

  const port = Number(expectedPort);
  if (
    database.protocol !== 'postgresql:' ||
    !['localhost', '127.0.0.1'].includes(database.hostname) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    database.port !== String(port) ||
    database.pathname !== `/${EXPECTED_DATABASE}` ||
    database.username !== EXPECTED_DATABASE_USER ||
    database.password !== EXPECTED_DATABASE_PASSWORD ||
    database.search !== '' ||
    database.hash !== ''
  ) {
    throw new Error('Refusing integration setup outside the dedicated local TEST database');
  }

  return database;
}

export function assertComposeProjectIsEmpty(projectName, run = execFileSync) {
  const safeProject = assertIntegrationProjectName(projectName);
  const label = `label=com.docker.compose.project=${safeProject}`;
  const resources = [
    ['ps', '--all', '--quiet', '--filter', label],
    ['volume', 'ls', '--quiet', '--filter', label],
    ['network', 'ls', '--quiet', '--filter', label],
  ];

  for (const args of resources) {
    const output = run('docker', args, { encoding: 'utf8', stdio: 'pipe' });
    if (String(output).trim()) {
      throw new Error('Refusing to reuse an integration project that already owns resources');
    }
  }
}
