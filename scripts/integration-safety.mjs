import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

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

export function assertIntegrationTestFiles(files, rootDirectory) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('At least one explicit integration test file is required');
  }
  const root = resolve(rootDirectory);
  return files.map((file) => {
    const absolute = resolve(root, file);
    const relativePath = relative(root, absolute);
    if (
      relativePath.startsWith('..' + sep) ||
      isAbsolute(relativePath) ||
      !/^tests\/integration\/.*\.(test|spec)\.[cm]?[jt]sx?$/.test(relativePath.split(sep).join('/'))
    ) {
      throw new Error('Refusing integration test selection outside tests/integration');
    }
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new Error('Refusing missing integration test file: ' + file);
    }
    return absolute;
  });
}

export function assertReusableIntegrationProject(
  projectName,
  composeFile,
  postgresPort,
  env,
  run = execFileSync,
) {
  const safeProject = assertIntegrationProjectName(projectName);
  const expectedPort = String(postgresPort);
  assertIntegrationDatabaseTarget(env.DATABASE_URL, expectedPort);
  const identity = run(
    'docker',
    integrationComposeArgs(safeProject, composeFile, [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      '127.0.0.1',
      '-U',
      EXPECTED_DATABASE_USER,
      '-d',
      EXPECTED_DATABASE,
      '-Atc',
      "select current_database() || '|' || current_user || '|' || inet_server_port()",
    ]),
    { encoding: 'utf8', stdio: 'pipe', env },
  ).trim();
  if (identity !== `${EXPECTED_DATABASE}|${EXPECTED_DATABASE_USER}|5432`) {
    throw new Error('Refusing reuse: PostgreSQL identity verification failed');
  }
  const args = integrationComposeArgs(safeProject, composeFile, [
    'ps',
    '--services',
    '--status',
    'running',
  ]);
  const services = String(run('docker', args, { encoding: 'utf8', stdio: 'pipe', env }))
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort();
  const expectedServices = ['api', 'mipres-mock', 'postgres', 'redis', 'worker'];
  if (JSON.stringify(services) !== JSON.stringify(expectedServices)) {
    throw new Error('Refusing reuse: expected all integration services to be running');
  }

  const postgresArgs = integrationComposeArgs(safeProject, composeFile, [
    'port',
    'postgres',
    '5432',
  ]);
  const published = String(
    run('docker', postgresArgs, { encoding: 'utf8', stdio: 'pipe', env }),
  ).trim();
  const match = published.match(/:(\d+)$/);
  if (!match || match[1] !== expectedPort) {
    throw new Error('Refusing reuse: PostgreSQL port does not match the guarded database URL');
  }
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
