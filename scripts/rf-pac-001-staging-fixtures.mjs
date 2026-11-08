import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Pool } = pg;
const repoRoot = resolve(import.meta.dirname, '..');
const LOCAL = Object.freeze({
  host: '127.0.0.1',
  port: 55439,
  database: 'mtd_olp_medicarte_test',
  user: 'mtd_test',
  dataDirectorySuffix: '/mtd-olp-medicarte-test-db/pgdata',
});
const STAGING = Object.freeze({
  database: 'authorization_rf_pac_staging',
  user: 'authorization_rf_pac_staging',
});
// Production resource id from the checked-in deployment audit. Refresh this list
// from an approved, read-only inventory before any future staging provisioning.
const DENIED_RENDER_RESOURCE_IDS = new Set(['dpg-dab4nt7avr4c73eput1g-a']);
const MIGRATIONS = [
  '0107_patient_master_additive.sql',
  '0108_patient_lookup_outbox_processing.sql',
  '0109_patient_mtdom_lookup_state.sql',
  '0110_patient_backfill_ledger.sql',
  '0111_patient_sync_checkpoint.sql',
  '0112_patient_master_read_permissions.sql',
];
const PERMISSION_CODES = ['patient_master.read', 'patient_reconciliation.read'];

export class FixtureSafetyError extends Error {
  constructor(code) {
    super(code);
    this.name = 'FixtureSafetyError';
    this.code = code;
  }
}

function fail(code) {
  throw new FixtureSafetyError(code);
}

export function parseArgs(argv) {
  const options = { command: argv[0] };
  const allowed = new Set([
    '--target',
    '--database-url-env',
    '--allow-system-id',
    '--allow-resource-id',
    '--run-id',
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (!allowed.has(key) || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      fail('INVALID_ARGUMENTS');
    }
    if (Object.hasOwn(options, key)) fail('DUPLICATE_ARGUMENT');
    options[key] = argv[++index];
  }
  if (!['inspect', 'seed', 'cleanup'].includes(options.command)) fail('INVALID_COMMAND');
  if (!['local', 'render'].includes(options['--target'])) fail('TARGET_REQUIRED');
  if (
    options['--database-url-env'] &&
    !/^[A-Z][A-Z0-9_]{1,80}$/.test(options['--database-url-env'])
  ) {
    fail('INVALID_DATABASE_URL_ENV_NAME');
  }
  if (
    options.command === 'seed' &&
    options['--run-id'] &&
    !/^[a-f0-9-]{36}$/i.test(options['--run-id'])
  ) {
    fail('INVALID_RUN_ID');
  }
  if (options.command === 'cleanup' && !options['--run-id']) fail('RUN_ID_REQUIRED');
  return options;
}

function parsedUrl(connectionString) {
  if (typeof connectionString !== 'string' || !connectionString) fail('DATABASE_URL_MISSING');
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    fail('DATABASE_URL_INVALID');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) fail('DATABASE_PROTOCOL_INVALID');
  if (url.hash) fail('DATABASE_URL_OPTIONS_FORBIDDEN');
  for (const [key, value] of url.searchParams) {
    if (key !== 'sslmode' || !['require', 'verify-ca', 'verify-full', 'prefer'].includes(value)) {
      fail('DATABASE_URL_OPTIONS_FORBIDDEN');
    }
  }
  return url;
}

export function validateTargetUrl(connectionString, target, allowlist = {}) {
  const url = parsedUrl(connectionString);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  if (target === 'local') {
    if (
      url.hostname !== LOCAL.host ||
      Number(url.port || 5432) !== LOCAL.port ||
      dbName !== LOCAL.database ||
      decodeURIComponent(url.username) !== LOCAL.user ||
      allowlist.systemIdentifier === undefined ||
      !/^\d{10,25}$/.test(String(allowlist.systemIdentifier))
    )
      fail('LOCAL_DESTINATION_NOT_ALLOWLISTED');
    return {
      target,
      host: LOCAL.host,
      port: LOCAL.port,
      database: LOCAL.database,
      systemIdentifier: String(allowlist.systemIdentifier),
    };
  }
  if (target === 'render') {
    const resourceId = allowlist.resourceId;
    if (!/^dpg-[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(resourceId ?? ''))
      fail('RENDER_RESOURCE_ID_REQUIRED');
    if (DENIED_RENDER_RESOURCE_IDS.has(resourceId)) fail('PRODUCTION_RESOURCE_ID_DENIED');
    if (
      dbName !== STAGING.database ||
      decodeURIComponent(url.username) !== STAGING.user ||
      url.hostname.split('.')[0] !== resourceId
    )
      fail('RENDER_DESTINATION_NOT_ALLOWLISTED');
    return { target, hostResourceId: resourceId, database: STAGING.database };
  }
  fail('TARGET_INVALID');
}

function uuidFor(runId, key) {
  const hex = createHash('sha256')
    .update(`rf-pac-001-staging:${runId}:${key}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function fixtureIds(runId) {
  const ids = {
    orgMtd: null,
    orgMed: null,
    orgOlp: null,
    userMtd: uuidFor(runId, 'user:mtd'),
    userMed: uuidFor(runId, 'user:medicarte'),
    userOlp: uuidFor(runId, 'user:olp'),
    roleMtd: uuidFor(runId, 'role:mtd'),
    roleMed: uuidFor(runId, 'role:medicarte'),
    roleOlp: uuidFor(runId, 'role:olp'),
    pointA: uuidFor(runId, 'point:a'),
    pointB: uuidFor(runId, 'point:b'),
    period: uuidFor(runId, 'planning-period'),
    batch: uuidFor(runId, 'import-batch'),
    patients: Array.from({ length: 32 }, (_, i) => uuidFor(runId, `patient:${i}`)),
    auth: {
      mtdPatients: Array.from({ length: 30 }, (_, i) => uuidFor(runId, `authorization:mtd:${i}`)),
      sharedMedA: uuidFor(runId, 'authorization:shared:med:a'),
      sharedMedB: uuidFor(runId, 'authorization:shared:med:b'),
      medA: uuidFor(runId, 'authorization:med:a'),
      medB: uuidFor(runId, 'authorization:med:b'),
      ambiguous: uuidFor(runId, 'authorization:ambiguous'),
      incomplete: uuidFor(runId, 'authorization:incomplete'),
      absent: uuidFor(runId, 'authorization:absent'),
    },
    schedules: [],
  };
  ids.schedules = Array.from({ length: 4 }, (_, i) => uuidFor(runId, `schedule:${i}`));
  return ids;
}

function expectedPatientIdentity(runId, index) {
  return `SYN-${runId.slice(0, 8)}-${String(index + 1).padStart(2, '0')}`;
}

function fixtureCounts() {
  return {
    patients: 32,
    linkedAuthorizations: 34,
    unlinkedAuthorizations: 3,
    scopedUsers: 3,
    points: 2,
    schedules: 4,
  };
}

async function queryIdentity(client, includeSystemIdentifier) {
  const result = await client.query(`
    SELECT current_database() AS database_name,
           current_user AS user_name,
           host(inet_server_addr()) AS server_host,
           inet_server_port() AS server_port,
           current_setting('data_directory') AS data_directory
  `);
  const identity = result.rows[0];
  if (includeSystemIdentifier) {
    const system = await client.query(
      'SELECT (pg_control_system()).system_identifier::text AS system_identifier',
    );
    identity.system_identifier = system.rows[0]?.system_identifier;
  }
  return identity;
}

export async function verifyTarget(client, connectionString, target, allowlist = {}) {
  const expected = validateTargetUrl(connectionString, target, allowlist);
  const actual = await queryIdentity(client, target === 'local');
  if (target === 'local') {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) fail('LOCALAPPDATA_REQUIRED');
    const expectedDirectory = resolve(localAppData, 'mtd-olp-medicarte-test-db', 'pgdata')
      .replaceAll('\\', '/')
      .toLowerCase();
    const actualDirectory = String(actual.data_directory).replaceAll('\\', '/').toLowerCase();
    if (
      actual.database_name !== LOCAL.database ||
      actual.user_name !== LOCAL.user ||
      actual.server_host !== LOCAL.host ||
      Number(actual.server_port) !== LOCAL.port ||
      actualDirectory !== expectedDirectory ||
      actualDirectory.endsWith(LOCAL.dataDirectorySuffix) === false ||
      String(actual.system_identifier) !== expected.systemIdentifier
    )
      fail('LOCAL_SERVER_IDENTITY_MISMATCH');
  } else {
    if (
      actual.database_name !== STAGING.database ||
      actual.user_name !== STAGING.user ||
      String(actual.server_host ?? '').startsWith('127.') ||
      actual.server_host === '::1'
    )
      fail('RENDER_SERVER_IDENTITY_MISMATCH');
  }
  return {
    target,
    database: actual.database_name,
    user: actual.user_name,
    host: actual.server_host,
    port: Number(actual.server_port),
    systemIdentifier: target === 'local' ? String(actual.system_identifier) : undefined,
    renderResourceId: target === 'render' ? expected.hostResourceId : undefined,
  };
}

async function verifyMigrationsAndSchema(client) {
  const fs = await import('node:fs/promises');
  const journalPath = resolve(repoRoot, 'packages/database/migrations/meta/_journal.json');
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8'));
  const entries = new Map(journal.entries.map((entry) => [entry.tag + '.sql', Number(entry.when)]));
  const needed = [];
  for (const name of MIGRATIONS) {
    const timestamp = entries.get(name);
    if (!timestamp) fail('MIGRATION_JOURNAL_ENTRY_MISSING');
    const contents = await fs.readFile(resolve(repoRoot, 'packages/database/migrations', name));
    needed.push({ name, timestamp, hash: createHash('sha256').update(contents).digest('hex') });
  }
  const applied = await client.query('SELECT hash, created_at FROM drizzle.__drizzle_migrations');
  if (
    needed.some(
      (migration) =>
        !applied.rows.some(
          (row) => Number(row.created_at) === migration.timestamp && row.hash === migration.hash,
        ),
    )
  )
    fail('RF_PAC_MIGRATIONS_NOT_APPLIED_OR_HASH_MISMATCH');

  const required = {
    patients: ['id', 'identification_type_raw', 'identification_value_raw', 'mtdom_lookup_status'],
    authorization_items: [
      'id',
      'patient_id',
      'source_data',
      'numero_autorizacion',
      'created_from_batch_id',
    ],
    authorization_item_organizations: ['authorization_item_id', 'organization_id'],
    import_batches: ['id', 'organization_id', 'created_by', 'sha256'],
    user_point_scopes: ['id', 'user_id', 'dispensing_point_id', 'granted_by', 'revoked_at'],
    patient_schedules: ['id', 'authorization_item_id', 'planning_period_id', 'dispensing_point_id'],
    patient_backfill_batches: ['id', 'status'],
    patient_backfill_items: ['id', 'batch_id', 'authorization_item_id'],
    patient_sync_checkpoints: ['id', 'feed_key', 'status', 'profile'],
    audit_events: ['id', 'action', 'resource_type', 'resource_id', 'after', 'correlation_id'],
  };
  const columns = await client.query(
    `
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY($1::text[])
  `,
    [Object.keys(required)],
  );
  const found = new Map();
  for (const row of columns.rows)
    found.set(row.table_name, (found.get(row.table_name) ?? new Set()).add(row.column_name));
  for (const [table, names] of Object.entries(required)) {
    const actual = found.get(table);
    if (!actual || names.some((name) => !actual.has(name))) fail('RF_PAC_SCHEMA_INCOMPLETE');
  }
  const permissions = await client.query(
    'SELECT code FROM permissions WHERE code = ANY($1::text[])',
    [PERMISSION_CODES],
  );
  if (permissions.rows.length !== PERMISSION_CODES.length) fail('PATIENT_PERMISSIONS_NOT_APPLIED');
  const organizations = await client.query(
    "SELECT code FROM organizations WHERE code = ANY(ARRAY['MTD','MEDICARTE','OLP']) AND active",
  );
  if (organizations.rows.length !== 3) fail('BASE_ORGANIZATIONS_MISSING');
  const fk = await client.query(`
    SELECT c.confdeltype, a.attnotnull
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'authorization_items'::regclass AND c.confrelid = 'patients'::regclass
      AND c.contype = 'f' AND a.attname = 'patient_id'
  `);
  if (fk.rows.length !== 1 || fk.rows[0].confdeltype !== 'r' || fk.rows[0].attnotnull)
    fail('PATIENT_FK_CONTRACT_INVALID');
  return {
    migrations: MIGRATIONS,
    tables: Object.keys(required).length,
    permissions: PERMISSION_CODES.length,
  };
}

async function passwordHashes(passwords) {
  const names = ['mtd', 'medicarte', 'olp'];
  if (
    !passwords ||
    names.some((name) => typeof passwords[name] !== 'string' || passwords[name].length < 16)
  )
    fail('SYNTHETIC_PASSWORDS_REQUIRED');
  const requireFromApi = createRequire(resolve(repoRoot, 'apps/api/package.json'));
  const { argon2id } = requireFromApi('hash-wasm');
  const hashes = {};
  for (const name of names) {
    hashes[name] = await argon2id({
      password: passwords[name],
      salt: createHash('sha256').update(`${name}:${passwords[name]}`).digest().subarray(0, 16),
      parallelism: 1,
      iterations: 2,
      memorySize: 19456,
      hashLength: 32,
      outputType: 'encoded',
    });
  }
  return hashes;
}

async function insertFixtureData(client, runId, ids, hashes) {
  const orgs = await client.query(
    "SELECT id, code FROM organizations WHERE code = ANY(ARRAY['MTD','MEDICARTE','OLP'])",
  );
  const orgByCode = Object.fromEntries(orgs.rows.map((row) => [row.code, row.id]));
  ids.orgMtd = orgByCode.MTD;
  ids.orgMed = orgByCode.MEDICARTE;
  ids.orgOlp = orgByCode.OLP;
  // The run's own synthetic MTD subject is the creator; no existing account or grant is reused.
  const actorId = ids.userMtd;

  const users = [
    [ids.userMtd, `rfpac.${runId.slice(0, 8)}.mtd`, 'Synthetic MTD RF-PAC test', hashes.mtd],
    [
      ids.userMed,
      `rfpac.${runId.slice(0, 8)}.med`,
      'Synthetic MEDICARTE RF-PAC test',
      hashes.medicarte,
    ],
    [ids.userOlp, `rfpac.${runId.slice(0, 8)}.olp`, 'Synthetic OLP RF-PAC test', hashes.olp],
  ];
  for (const [id, username, display, hash] of users) {
    await client.query(
      `INSERT INTO users (id, username, display_name, password_hash, active, provenance, must_change_password)
      VALUES ($1,$2,$3,$4,true,'TEST_FIXTURE',false)`,
      [id, username, display, hash],
    );
  }
  const roles = [
    [
      ids.roleMtd,
      `CUSTOM_RFPAC_MTD_${runId.slice(0, 8).toUpperCase()}`,
      'Synthetic RF-PAC MTD read',
    ],
    [
      ids.roleMed,
      `CUSTOM_RFPAC_MED_${runId.slice(0, 8).toUpperCase()}`,
      'Synthetic RF-PAC MEDICARTE read',
    ],
    [
      ids.roleOlp,
      `CUSTOM_RFPAC_OLP_${runId.slice(0, 8).toUpperCase()}`,
      'Synthetic RF-PAC OLP denied',
    ],
  ];
  for (const [id, code, name] of roles)
    await client.query('INSERT INTO roles (id, code, name, active) VALUES ($1,$2,$3,true)', [
      id,
      code,
      name,
    ]);
  const permissionRows = await client.query(
    'SELECT id, code FROM permissions WHERE code = ANY($1::text[])',
    [PERMISSION_CODES],
  );
  const permissionByCode = Object.fromEntries(permissionRows.rows.map((row) => [row.code, row.id]));
  await client.query(
    'INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2),($1,$3),($4,$2)',
    [
      ids.roleMtd,
      permissionByCode['patient_master.read'],
      permissionByCode['patient_reconciliation.read'],
      ids.roleMed,
    ],
  );
  await client.query(
    `INSERT INTO role_organization_scopes (role_id, organization_id) VALUES
    ($1,$2),($3,$4),($5,$6)`,
    [ids.roleMtd, ids.orgMtd, ids.roleMed, ids.orgMed, ids.roleOlp, ids.orgOlp],
  );
  await client.query(
    `INSERT INTO user_organization_roles (user_id,organization_id,role_id) VALUES
    ($1,$2,$3),($4,$5,$6),($7,$8,$9)`,
    [
      ids.userMtd,
      ids.orgMtd,
      ids.roleMtd,
      ids.userMed,
      ids.orgMed,
      ids.roleMed,
      ids.userOlp,
      ids.orgOlp,
      ids.roleOlp,
    ],
  );

  await client.query(
    `INSERT INTO dispensing_points (id,organization_id,code,name,created_by) VALUES
    ($1,$2,$3,'Synthetic RF-PAC point A',$4),($5,$2,$6,'Synthetic RF-PAC point B',$4)`,
    [
      ids.pointA,
      ids.orgMed,
      `RFPAC-A-${runId.slice(0, 8)}`,
      actorId,
      ids.pointB,
      `RFPAC-B-${runId.slice(0, 8)}`,
    ],
  );
  await client.query(
    `INSERT INTO user_point_scopes (user_id,dispensing_point_id,granted_by) VALUES ($1,$2,$3)`,
    [ids.userMed, ids.pointA, actorId],
  );

  await client.query(
    `INSERT INTO planning_periods (id,start_date,end_date,scheduling_cutoff_at,purchase_order_deadline_at,expected_delivery_date,created_by,updated_by)
    VALUES ($1,current_date,current_date + 60,now() + interval '1 day',now() + interval '2 days',current_date + 3,$2,$2)`,
    [ids.period, actorId],
  );
  await client.query(
    `INSERT INTO import_batches (id,organization_id,created_by,original_filename,mime_type,size_bytes,sha256,processor_version,status,total_rows,valid_rows,confirmed_rows,completed_at,confirmed_at)
    VALUES ($1,$2,$3,$4,'application/json',1,$5,1,'COMPLETED',36,36,36,now(),now())`,
    [
      ids.batch,
      ids.orgMtd,
      actorId,
      `rf-pac-staging-${runId}.json`,
      createHash('sha256').update(runId).digest('hex'),
    ],
  );

  const patientRows = [];
  for (let index = 0; index < 30; index += 1) {
    const value =
      index === 29 ? `SYN-MED-A-${runId.slice(0, 8)}` : expectedPatientIdentity(runId, index);
    patientRows.push([ids.patients[index], 'TEST', value]);
  }
  patientRows.push(
    [ids.patients[30], 'TEST', `SYN-AMB-${runId.slice(0, 8)}`],
    [ids.patients[31], 'TEST', `SYN-AMB-${runId.slice(0, 8)}`],
  );
  for (const [id, type, value] of patientRows)
    await client.query(
      `INSERT INTO patients (id,identification_type_raw,identification_value_raw) VALUES ($1,$2,$3)`,
      [id, type, value],
    );

  const authorizationRows = [];
  const orgLinks = [];
  const scheduleRows = [];
  const addAuth = (id, identity, patientId, organizationIds, pointId = null) => {
    const authNumber = `RFPAC-${runId.slice(0, 8)}-${String(authorizationRows.length + 1).padStart(3, '0')}`;
    const code = `SYN-${runId.slice(0, 8)}-${String(authorizationRows.length + 1).padStart(3, '0')}`;
    const source = {
      TIPO_IDENTIFICACION: identity?.type,
      IDENTIFICACION_PACIENTE: identity?.value,
      RF_PAC_FIXTURE_RUN: runId,
    };
    if (!identity) delete source.TIPO_IDENTIFICACION;
    if (!identity?.value) delete source.IDENTIFICACION_PACIENTE;
    authorizationRows.push([
      id,
      patientId,
      authNumber,
      code,
      `${authNumber}:${code}`,
      JSON.stringify(source),
      ids.batch,
    ]);
    for (const organizationId of organizationIds) orgLinks.push([id, organizationId]);
    if (pointId)
      scheduleRows.push([
        uuidFor(runId, `schedule:${scheduleRows.length}`),
        id,
        ids.period,
        pointId,
        code,
        actorId,
      ]);
  };
  for (let index = 0; index < 30; index += 1) {
    addAuth(
      ids.auth.mtdPatients[index],
      { type: 'TEST', value: expectedPatientIdentity(runId, index) },
      ids.patients[index],
      [ids.orgMtd],
    );
  }
  addAuth(
    ids.auth.sharedMedA,
    { type: 'TEST', value: expectedPatientIdentity(runId, 0) },
    ids.patients[0],
    [ids.orgMed],
    ids.pointA,
  );
  addAuth(
    ids.auth.sharedMedB,
    { type: 'TEST', value: expectedPatientIdentity(runId, 0) },
    ids.patients[0],
    [ids.orgMed],
    ids.pointB,
  );
  addAuth(
    ids.auth.medA,
    { type: 'TEST', value: `SYN-MED-A-${runId.slice(0, 8)}` },
    ids.patients[29],
    [ids.orgMed],
    ids.pointA,
  );
  addAuth(
    ids.auth.medB,
    { type: 'TEST', value: `SYN-MED-B-${runId.slice(0, 8)}` },
    null,
    [ids.orgMed],
    ids.pointB,
  );
  addAuth(ids.auth.ambiguous, { type: 'TEST', value: `SYN-AMB-${runId.slice(0, 8)}` }, null, [
    ids.orgMtd,
  ]);
  addAuth(ids.auth.incomplete, { type: 'TEST', value: null }, null, [ids.orgMtd]);
  addAuth(ids.auth.absent, null, null, [ids.orgMtd]);

  for (const row of authorizationRows) {
    await client.query(
      `INSERT INTO authorization_items (id,patient_id,numero_autorizacion,codigo_medicamento,authorization_key,source_data,source_status_normalized,source_prescripcion_normalized,no_prescripcion,enablement_status,coverage_type,direction_status,coverage_rule_version,created_from_batch_id)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,'VIGENTE', '', '', 'ENABLED','PBS','NOT_APPLICABLE','RF-PAC-001-STAGING',$7)`,
      row,
    );
  }
  for (const row of orgLinks)
    await client.query(
      'INSERT INTO authorization_item_organizations (authorization_item_id,organization_id) VALUES ($1,$2)',
      row,
    );
  for (const row of scheduleRows)
    await client.query(
      `INSERT INTO patient_schedules (id,authorization_item_id,planning_period_id,dispensing_point_id,commercial_code,scheduled_date,quantity,created_by,updated_by)
    VALUES ($1,$2,$3,$4,$5,current_date,1,$6,$6)`,
      row,
    );
  return { actorId, orgByCode, counts: fixtureCounts() };
}

async function verifyLedger(client, runId, ids) {
  const created = await client.query(
    `SELECT after FROM audit_events
    WHERE action='RF_PAC_STAGING_FIXTURES_CREATED' AND resource_type='rf_pac_staging_fixture_run' AND resource_id=$1`,
    [runId],
  );
  if (created.rows.length !== 1) fail('FIXTURE_RUN_NOT_FOUND_OR_DUPLICATE');
  const cleaned = await client.query(
    `SELECT 1 FROM audit_events
    WHERE action='RF_PAC_STAGING_FIXTURES_CLEANED' AND resource_type='rf_pac_staging_fixture_run' AND resource_id=$1`,
    [runId],
  );
  if (cleaned.rows.length) fail('FIXTURE_RUN_ALREADY_CLEANED');
  const summary = created.rows[0].after;
  const authIds = Object.values(ids.auth).flat();
  if (
    summary?.runId !== runId ||
    JSON.stringify(summary.patientIds) !== JSON.stringify(ids.patients) ||
    JSON.stringify(summary.authorizationIds) !== JSON.stringify(authIds) ||
    summary.batchId !== ids.batch ||
    summary.periodId !== ids.period ||
    summary.pointIds?.allowed !== ids.pointA ||
    summary.pointIds?.denied !== ids.pointB ||
    summary.userIds?.mtd !== ids.userMtd ||
    summary.userIds?.med !== ids.userMed ||
    summary.userIds?.olp !== ids.userOlp ||
    summary.roleIds?.mtd !== ids.roleMtd ||
    summary.roleIds?.med !== ids.roleMed ||
    summary.roleIds?.olp !== ids.roleOlp
  )
    fail('FIXTURE_LEDGER_INVALID');
  const patientCount = await client.query(
    `SELECT count(*)::int n FROM patients
     WHERE id = ANY($1::uuid[]) AND identification_type_raw='TEST' AND identification_value_raw LIKE 'SYN-%'`,
    [ids.patients],
  );
  const authCount = await client.query(
    `SELECT count(*)::int n,
      count(*) FILTER (WHERE source_data->>'RF_PAC_FIXTURE_RUN'=$1 AND created_from_batch_id=$2)::int owned
     FROM authorization_items WHERE id = ANY($3::uuid[])`,
    [runId, ids.batch, authIds],
  );
  const batch = await client.query(
    'SELECT count(*)::int n FROM import_batches WHERE id=$1 AND original_filename=$2',
    [ids.batch, `rf-pac-staging-${runId}.json`],
  );
  const users = await client.query(
    `SELECT count(*)::int n FROM users WHERE id=ANY($1::uuid[]) AND provenance='TEST_FIXTURE' AND username LIKE $2`,
    [[ids.userMtd, ids.userMed, ids.userOlp], `rfpac.${runId.slice(0, 8)}.%`],
  );
  const roles = await client.query(
    'SELECT count(*)::int n FROM roles WHERE id=ANY($1::uuid[]) AND code LIKE $2',
    [[ids.roleMtd, ids.roleMed, ids.roleOlp], `CUSTOM_RFPAC_%_${runId.slice(0, 8).toUpperCase()}`],
  );
  const points = await client.query(
    'SELECT count(*)::int n FROM dispensing_points WHERE id=ANY($1::uuid[]) AND code LIKE $2',
    [[ids.pointA, ids.pointB], `RFPAC-%-${runId.slice(0, 8)}`],
  );
  const schedules = await client.query(
    'SELECT count(*)::int n FROM patient_schedules WHERE id=ANY($1::uuid[])',
    [ids.schedules],
  );
  const mtdAuthIds = [
    ...ids.auth.mtdPatients,
    ids.auth.ambiguous,
    ids.auth.incomplete,
    ids.auth.absent,
  ];
  const medAuthIds = [ids.auth.sharedMedA, ids.auth.sharedMedB, ids.auth.medA, ids.auth.medB];
  const organizationLinks = await client.query(
    `SELECT count(*)::int n,
       count(*) FILTER (WHERE (authorization_item_id=ANY($1::uuid[]) AND organization_id=$2)
         OR (authorization_item_id=ANY($3::uuid[]) AND organization_id=$4))::int owned
     FROM authorization_item_organizations
     WHERE authorization_item_id=ANY($5::uuid[])`,
    [mtdAuthIds, summary.orgIds?.mtd, medAuthIds, summary.orgIds?.med, authIds],
  );
  if (
    patientCount.rows[0].n !== 32 ||
    authCount.rows[0].n !== 37 ||
    authCount.rows[0].owned !== 37 ||
    batch.rows[0].n !== 1 ||
    users.rows[0].n !== 3 ||
    roles.rows[0].n !== 3 ||
    points.rows[0].n !== 2 ||
    schedules.rows[0].n !== 4 ||
    organizationLinks.rows[0].n !== 37 ||
    organizationLinks.rows[0].owned !== 37
  )
    fail('FIXTURE_RUN_INCOMPLETE_OR_OWNERSHIP_MISMATCH');
  return summary;
}

async function assertNoForeignKeyReferences(client, parentTable, parentIds) {
  const references = await client.query(
    `SELECT DISTINCT child_ns.nspname AS schema_name, child_rel.relname AS table_name,
       child_attr.attname AS column_name
     FROM pg_constraint c
     JOIN pg_class parent_rel ON parent_rel.oid=c.confrelid
     JOIN pg_namespace parent_ns ON parent_ns.oid=parent_rel.relnamespace
     JOIN pg_class child_rel ON child_rel.oid=c.conrelid
     JOIN pg_namespace child_ns ON child_ns.oid=child_rel.relnamespace
     JOIN LATERAL unnest(c.conkey,c.confkey) AS key_columns(child_attnum,parent_attnum) ON true
     JOIN pg_attribute parent_attr ON parent_attr.attrelid=parent_rel.oid AND parent_attr.attnum=key_columns.parent_attnum
     JOIN pg_attribute child_attr ON child_attr.attrelid=child_rel.oid AND child_attr.attnum=key_columns.child_attnum
     WHERE c.contype='f' AND parent_ns.nspname='public' AND parent_rel.relname=$1 AND parent_attr.attname='id'`,
    [parentTable],
  );
  for (const row of references.rows) {
    const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
    const relation = `${quote(row.schema_name)}.${quote(row.table_name)}`;
    const column = quote(row.column_name);
    const found = await client.query(
      `SELECT EXISTS (SELECT 1 FROM ${relation} WHERE ${column}=ANY($1::uuid[])) AS has_reference`,
      [parentIds],
    );
    if (found.rows[0].has_reference) fail('FIXTURE_CLEANUP_HAS_EXTERNAL_DEPENDENCIES');
  }
}

export async function seedFixtures({
  connectionString,
  target,
  allowlist,
  authorizeFixtures,
  runId,
  passwords,
}) {
  if (authorizeFixtures !== true) fail('FIXTURE_AUTHORIZATION_REQUIRED');
  if (!runId || !/^[a-f0-9-]{36}$/i.test(runId)) fail('RUN_ID_REQUIRED');
  const pool = new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 4000,
    application_name: 'rf-pac-001-staging-fixtures',
  });
  const client = await pool.connect();
  try {
    await verifyTarget(client, connectionString, target, allowlist);
    const schema = await verifyMigrationsAndSchema(client);
    const ids = fixtureIds(runId);
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `rf-pac-001-staging-fixtures:${runId}`,
    ]);
    const previous = await client.query(
      `SELECT 1 FROM audit_events WHERE action='RF_PAC_STAGING_FIXTURES_CREATED' AND resource_type='rf_pac_staging_fixture_run' AND resource_id=$1`,
      [runId],
    );
    if (previous.rows.length) {
      const summary = await verifyLedger(client, runId, ids);
      await client.query('COMMIT');
      return { status: 'IDEMPOTENT', runId, summary, schema };
    }
    const hashes = await passwordHashes(passwords);
    const result = await insertFixtureData(client, runId, ids, hashes);
    const summary = {
      runId,
      ...result.counts,
      orgIds: { mtd: ids.orgMtd, med: ids.orgMed, olp: ids.orgOlp },
      userIds: { mtd: ids.userMtd, med: ids.userMed, olp: ids.userOlp },
      roleIds: { mtd: ids.roleMtd, med: ids.roleMed, olp: ids.roleOlp },
      pointIds: { allowed: ids.pointA, denied: ids.pointB },
      patientIds: ids.patients,
      authorizationIds: Object.values(ids.auth).flat(),
      batchId: ids.batch,
      periodId: ids.period,
    };
    await client.query(
      `INSERT INTO audit_events (actor_type,actor_id,organization_id,action,resource_type,resource_id,after,correlation_id,result)
      VALUES ('SYSTEM',$1,$2,'RF_PAC_STAGING_FIXTURES_CREATED','rf_pac_staging_fixture_run',$3,$4::jsonb,$5,'SUCCESS')`,
      [result.actorId, ids.orgMtd, runId, JSON.stringify(summary), runId],
    );
    await client.query('COMMIT');
    return { status: 'CREATED', runId, summary, schema };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof FixtureSafetyError) throw error;
    if (process.env.RF_PAC_FIXTURE_DEBUG === '1') {
      const missingColumn = String(error?.message ?? '').match(
        /column "([a-z0-9_]+)" does not exist/i,
      )?.[1];
      process.stderr.write(
        `${JSON.stringify({ pgCode: error?.code, message: String(error?.message ?? '').slice(0, 160), constraint: error?.constraint, table: error?.table, column: error?.column ?? missingColumn })}\n`,
      );
    }
    fail('FIXTURE_TRANSACTION_FAILED');
  } finally {
    client.release();
    await pool.end();
  }
}

export async function cleanupFixtures({
  connectionString,
  target,
  allowlist,
  authorizeCleanup,
  runId,
}) {
  if (authorizeCleanup !== true) fail('CLEANUP_AUTHORIZATION_REQUIRED');
  if (!runId || !/^[a-f0-9-]{36}$/i.test(runId)) fail('RUN_ID_REQUIRED');
  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 4000,
    application_name: 'rf-pac-001-staging-fixture-cleanup',
  });
  const client = await pool.connect();
  try {
    await verifyTarget(client, connectionString, target, allowlist);
    await verifyMigrationsAndSchema(client);
    const ids = fixtureIds(runId);
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `rf-pac-001-staging-fixtures:${runId}`,
    ]);
    const prior = await client.query(
      `SELECT 1 FROM audit_events WHERE action='RF_PAC_STAGING_FIXTURES_CLEANED' AND resource_type='rf_pac_staging_fixture_run' AND resource_id=$1`,
      [runId],
    );
    if (prior.rows.length) {
      await client.query('COMMIT');
      return { status: 'ALREADY_CLEANED', runId };
    }
    const summary = await verifyLedger(client, runId, ids);
    const authIds = Object.values(ids.auth).flat();
    await assertNoForeignKeyReferences(client, 'patient_schedules', ids.schedules);
    await client.query('DELETE FROM patient_schedules WHERE id = ANY($1::uuid[])', [ids.schedules]);
    await client.query(
      'DELETE FROM authorization_item_organizations WHERE authorization_item_id = ANY($1::uuid[])',
      [authIds],
    );
    await assertNoForeignKeyReferences(client, 'authorization_items', authIds);
    await client.query('DELETE FROM authorization_items WHERE id = ANY($1::uuid[])', [authIds]);
    await assertNoForeignKeyReferences(client, 'patients', ids.patients);
    await client.query('DELETE FROM patients WHERE id = ANY($1::uuid[])', [ids.patients]);
    await assertNoForeignKeyReferences(client, 'import_batches', [ids.batch]);
    await client.query('DELETE FROM import_batches WHERE id=$1', [ids.batch]);
    await assertNoForeignKeyReferences(client, 'planning_periods', [ids.period]);
    await client.query('DELETE FROM planning_periods WHERE id=$1', [ids.period]);
    await client.query(
      'UPDATE user_point_scopes SET revoked_at=COALESCE(revoked_at,now()), revoked_by=$2 WHERE user_id=$1 AND dispensing_point_id=$3',
      [ids.userMed, summary.userIds.mtd, ids.pointA],
    );
    // Keep FK-referenced point scope rows for audit; deactivate only this run's points.
    await client.query('UPDATE dispensing_points SET active=false WHERE id = ANY($1::uuid[])', [
      [ids.pointA, ids.pointB],
    ]);
    await client.query(
      'UPDATE user_organization_roles SET active=false WHERE user_id = ANY($1::uuid[])',
      [[ids.userMtd, ids.userMed, ids.userOlp]],
    );
    await client.query('DELETE FROM role_permissions WHERE role_id = ANY($1::uuid[])', [
      [ids.roleMtd, ids.roleMed, ids.roleOlp],
    ]);
    await client.query('DELETE FROM role_organization_scopes WHERE role_id = ANY($1::uuid[])', [
      [ids.roleMtd, ids.roleMed, ids.roleOlp],
    ]);
    await client.query('UPDATE roles SET active=false WHERE id = ANY($1::uuid[])', [
      [ids.roleMtd, ids.roleMed, ids.roleOlp],
    ]);
    await client.query(
      'UPDATE users SET active=false,password_hash=NULL,updated_at=now() WHERE id = ANY($1::uuid[])',
      [[ids.userMtd, ids.userMed, ids.userOlp]],
    );
    await client.query(
      `INSERT INTO audit_events (actor_type,actor_id,organization_id,action,resource_type,resource_id,after,correlation_id,result)
      VALUES ('SYSTEM',$1,$2,'RF_PAC_STAGING_FIXTURES_CLEANED','rf_pac_staging_fixture_run',$3,$4::jsonb,$5,'SUCCESS')`,
      [
        summary.userIds.mtd,
        summary.orgIds.mtd,
        runId,
        JSON.stringify({
          runId,
          removedPatients: 32,
          removedAuthorizations: 37,
          deactivatedSyntheticUsers: 3,
          auditAppendOnly: true,
        }),
        runId,
      ],
    );
    await client.query('COMMIT');
    return { status: 'CLEANED', runId, removedPatients: 32, removedAuthorizations: 37 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof FixtureSafetyError) throw error;
    if (process.env.RF_PAC_FIXTURE_DEBUG === '1') {
      process.stderr.write(
        `${JSON.stringify({ pgCode: error?.code, constraint: error?.constraint, table: error?.table, column: error?.column })}\n`,
      );
    }
    fail('FIXTURE_CLEANUP_FAILED');
  } finally {
    client.release();
    await pool.end();
  }
}

export async function inspect({ connectionString, target, allowlist }) {
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 4000,
    application_name: 'rf-pac-001-staging-fixtures-inspect',
  });
  const client = await pool.connect();
  try {
    const identity = await verifyTarget(client, connectionString, target, allowlist);
    const schema = await verifyMigrationsAndSchema(client);
    return { identity, schema };
  } catch (error) {
    if (error instanceof FixtureSafetyError) throw error;
    fail('TARGET_INSPECTION_FAILED');
  } finally {
    client.release();
    await pool.end();
  }
}

async function cli() {
  const options = parseArgs(process.argv.slice(2));
  const envName =
    options['--database-url-env'] ??
    (options['--target'] === 'local' ? 'TEST_DATABASE_URL' : 'DATABASE_URL');
  const connectionString = process.env[envName];
  if (!connectionString) fail('DATABASE_URL_ENV_MISSING');
  const allowlist = {
    systemIdentifier: options['--allow-system-id'],
    resourceId: options['--allow-resource-id'],
  };
  if (options.command === 'inspect') {
    const result = await inspect({ connectionString, target: options['--target'], allowlist });
    console.log(JSON.stringify(result));
    return;
  }
  if (process.env.RF_PAC_STAGING_FIXTURES_AUTHORIZED !== 'YES')
    fail('FIXTURE_AUTHORIZATION_REQUIRED');
  if (options.command === 'seed') {
    const result = await seedFixtures({
      connectionString,
      target: options['--target'],
      allowlist,
      authorizeFixtures: true,
      runId: options['--run-id'] ?? randomUUID(),
      passwords: {
        mtd: process.env.RF_PAC_STAGE_MTD_PASSWORD,
        medicarte: process.env.RF_PAC_STAGE_MED_PASSWORD,
        olp: process.env.RF_PAC_STAGE_OLP_PASSWORD,
      },
    });
    console.log(JSON.stringify(result));
    return;
  }
  if (process.env.RF_PAC_STAGING_FIXTURE_CLEANUP_AUTHORIZED !== 'YES')
    fail('CLEANUP_AUTHORIZATION_REQUIRED');
  const result = await cleanupFixtures({
    connectionString,
    target: options['--target'],
    allowlist,
    authorizeCleanup: true,
    runId: options['--run-id'],
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  cli().catch((error) => {
    const code = error instanceof FixtureSafetyError ? error.code : 'FIXTURE_PROCESS_FAILED';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
