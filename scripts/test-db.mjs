import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const repoRoot = resolve(import.meta.dirname, '..');
const pgBin = process.env.TEST_DB_PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const dataDirectory =
  process.env.TEST_DB_DATA_DIR ??
  resolve(process.env.LOCALAPPDATA ?? '', 'mtd-olp-medicarte-test-db', 'pgdata');
const logPath = resolve(dataDirectory, '..', 'logs', 'postgres.log');
const databaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://mtd_test@127.0.0.1:55439/mtd_olp_medicarte_test';
const expected = {
  database: 'mtd_olp_medicarte_test',
  host: '127.0.0.1',
  port: 55439,
  dataDirectory: dataDirectory.replaceAll('\\', '/').toLowerCase(),
};

function executable(name) {
  const path = resolve(pgBin, name + '.exe');
  if (!existsSync(path)) {
    throw new Error('No se encontró ' + path + '. Configura TEST_DB_PG_BIN.');
  }
  return path;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + ' terminó con código ' + result.status);
  }
}

async function verify() {
  const parsed = new URL(databaseUrl);
  if (
    parsed.hostname !== expected.host ||
    Number(parsed.port) !== expected.port ||
    parsed.pathname !== '/' + expected.database
  ) {
    throw new Error('SAFETY_STOP: TEST_DATABASE_URL no identifica la instancia TEST esperada.');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      'select current_database() as database_name, ' +
        'host(inet_server_addr()) as host, ' +
        'inet_server_port() as port, ' +
        "current_setting('data_directory') as data_directory",
    );
    const actual = result.rows[0];
    const actualDirectory = String(actual?.data_directory ?? '')
      .replaceAll('\\', '/')
      .toLowerCase();
    if (
      actual?.database_name !== expected.database ||
      actual?.host !== expected.host ||
      Number(actual?.port) !== expected.port ||
      actualDirectory !== expected.dataDirectory
    ) {
      throw new Error('SAFETY_STOP: identidad TEST no verificada: ' + JSON.stringify(actual));
    }
    console.log('SAFE_TEST_TARGET_VERIFIED');
  } finally {
    await client.end();
  }
}

function pnpm(args, extraEnv = {}) {
  const pnpmExecPath = process.env.npm_execpath;
  if (!pnpmExecPath) {
    throw new Error('Ejecuta este comando mediante pnpm db:test:<acción>.');
  }
  run(process.execPath, [pnpmExecPath, ...args], { env: extraEnv });
}

async function start() {
  const pgCtl = executable('pg_ctl');
  const status = spawnSync(pgCtl, ['-D', dataDirectory, 'status'], { stdio: 'ignore' });
  if (status.status !== 0) {
    run(pgCtl, ['-D', dataDirectory, '-l', logPath, '-o', '-h 127.0.0.1 -p 55439', '-w', 'start']);
  }
  await verify();
}

async function stop() {
  await verify();
  run(executable('pg_ctl'), ['-D', dataDirectory, '-w', 'stop']);
}

async function migrate() {
  await verify();
  pnpm(['--filter', '@authorization/database', 'db:migrate'], {
    DATABASE_URL: databaseUrl,
  });
  await verify();
}

async function seed() {
  await verify();
  run(executable('psql'), [
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '--dbname',
    databaseUrl,
    '--file',
    resolve(repoRoot, 'infra', 'test-db', 'seed.sql'),
  ]);
}

async function check() {
  await verify();
  pnpm(
    [
      '--filter',
      '@authorization/database',
      'exec',
      'tsx',
      '--tsconfig',
      resolve(repoRoot, 'apps', 'api', 'tsconfig.json'),
      resolve(repoRoot, 'tests', 'integration', 'check-test-db.ts'),
    ],
    {
      DATABASE_URL: databaseUrl,
      TEST_DB_DATA_DIR: dataDirectory,
    },
  );
}

const command = process.argv[2];
if (command === 'start') await start();
else if (command === 'stop') await stop();
else if (command === 'verify') await verify();
else if (command === 'migrate') await migrate();
else if (command === 'seed') await seed();
else if (command === 'check') await check();
else if (command === 'setup') {
  await start();
  await migrate();
  await seed();
  await check();
} else {
  throw new Error('Uso: node scripts/test-db.mjs <start|stop|verify|migrate|seed|check|setup>');
}
