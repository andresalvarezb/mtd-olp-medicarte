import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import pg from 'pg';
import {
  cleanupFixtures,
  inspect,
  seedFixtures,
  validateTargetUrl,
  verifyTarget,
} from './rf-pac-001-staging-fixtures.mjs';

const { Client, Pool } = pg;
const repo = resolve(import.meta.dirname, '..');
const connectionString =
  process.env.RF_PAC_STAGE_TEST_DATABASE_URL ??
  'postgresql://mtd_test@127.0.0.1:55439/mtd_olp_medicarte_test';
const localAllowlist = { systemIdentifier: process.env.RF_PAC_STAGE_TEST_SYSTEM_ID };
const requireFromApi = createRequire(resolve(repo, 'apps/api/package.json'));
const { createDatabase } = requireFromApi('@authorization/database');
const { PatientMasterRepository } = requireFromApi(
  resolve(repo, 'apps/api/dist/patients/patient-master.repository.js'),
);
const { resolvePatientMasterScope } = requireFromApi(
  resolve(repo, 'apps/api/dist/patients/patient-master.access-policy.js'),
);
const { AccessService } = requireFromApi(resolve(repo, 'apps/api/dist/identity/access.service.js'));
const { verifyPassword } = requireFromApi(resolve(repo, 'apps/api/dist/identity/password.js'));

test('staging fixtures seeder: guardas, idempotencia, datos E2E y cleanup selectivo', async (t) => {
  assert.ok(
    localAllowlist.systemIdentifier,
    'Ejecutar con RF_PAC_STAGE_TEST_SYSTEM_ID tomado de una identidad local verificada.',
  );
  const inspectResult = await inspect({
    connectionString,
    target: 'local',
    allowlist: localAllowlist,
  });
  assert.equal(inspectResult.identity.database, 'mtd_olp_medicarte_test');

  assert.throws(() =>
    validateTargetUrl('postgresql://x@127.0.0.1:55439/production', 'local', localAllowlist),
  );
  assert.equal(
    validateTargetUrl(
      'postgresql://mtd_test@127.0.0.1:55439/mtd_olp_medicarte_test?sslmode=require',
      'local',
      localAllowlist,
    ).database,
    'mtd_olp_medicarte_test',
  );
  assert.throws(() =>
    validateTargetUrl('postgresql://x@render.example/authorization_rf_pac_staging', 'render', {
      resourceId: 'dpg-prod-123',
    }),
  );
  assert.throws(
    () =>
      validateTargetUrl(
        'postgresql://authorization_rf_pac_staging@dpg-dab4nt7avr4c73eput1g-a.oregon-postgres.render.com/authorization_rf_pac_staging',
        'render',
        { resourceId: 'dpg-dab4nt7avr4c73eput1g-a' },
      ),
    /PRODUCTION_RESOURCE_ID_DENIED/,
  );
  await assert.rejects(
    seedFixtures({
      connectionString,
      target: 'local',
      allowlist: localAllowlist,
      authorizeFixtures: false,
      runId: randomUUID(),
      passwords: {},
    }),
    /FIXTURE_AUTHORIZATION_REQUIRED/,
  );
  await assert.rejects(
    cleanupFixtures({
      connectionString,
      target: 'local',
      allowlist: localAllowlist,
      authorizeCleanup: false,
      runId: randomUUID(),
    }),
    /CLEANUP_AUTHORIZATION_REQUIRED/,
  );
  const unauthEnv = { ...process.env, TEST_DATABASE_URL: connectionString };
  delete unauthEnv.RF_PAC_STAGING_FIXTURES_AUTHORIZED;
  const unauthRun = spawnSync(
    process.execPath,
    [
      resolve(repo, 'scripts/rf-pac-001-staging-fixtures.mjs'),
      'seed',
      '--target',
      'local',
      '--allow-system-id',
      localAllowlist.systemIdentifier,
      '--database-url-env',
      'TEST_DATABASE_URL',
      '--run-id',
      randomUUID(),
    ],
    { cwd: repo, env: unauthEnv, encoding: 'utf8' },
  );
  assert.equal(unauthRun.status, 1);
  assert.match(unauthRun.stderr, /FIXTURE_AUTHORIZATION_REQUIRED/);

  const client = new Client({ connectionString });
  await client.connect();
  const identity = await verifyTarget(client, connectionString, 'local', localAllowlist);
  await client.end();
  assert.equal(identity.host, '127.0.0.1');

  const runId = randomUUID();
  const password = () => randomBytes(24).toString('base64url');
  const passwords = { mtd: password(), medicarte: password(), olp: password() };
  let created;
  t.after(async () => {
    if (created)
      await cleanupFixtures({
        connectionString,
        target: 'local',
        allowlist: localAllowlist,
        authorizeCleanup: true,
        runId,
      }).catch(() => {});
  });
  const before = new Pool({ connectionString, max: 1 });
  const unrelatedBefore = await before.query(
    `SELECT count(*)::int n FROM patients WHERE id NOT IN (SELECT id FROM patients WHERE identification_value_raw LIKE 'SYN-%')`,
  );
  await before.end();

  created = await seedFixtures({
    connectionString,
    target: 'local',
    allowlist: localAllowlist,
    authorizeFixtures: true,
    runId,
    passwords,
  });
  assert.equal(created.status, 'CREATED');
  const replay = await seedFixtures({
    connectionString,
    target: 'local',
    allowlist: localAllowlist,
    authorizeFixtures: true,
    runId,
    passwords,
  });
  assert.equal(replay.status, 'IDEMPOTENT');

  const db = createDatabase(connectionString);
  t.after(async () => {
    await db.pool.end();
  });
  const mtdScope = {
    organizationId: created.summary.orgIds.mtd,
    organizationCode: 'MTD',
    userId: created.summary.userIds.mtd,
    pointAccessKind: 'global',
    dispensingPointId: null,
  };
  const medScope = {
    organizationId: created.summary.orgIds.med,
    organizationCode: 'MEDICARTE',
    userId: created.summary.userIds.med,
    pointAccessKind: 'explicit',
    dispensingPointId: created.summary.pointIds.allowed,
  };
  const repository = new PatientMasterRepository(db);
  const access = new AccessService(db);
  const mtdProfile = await access.getProfile(created.summary.userIds.mtd);
  const medProfile = await access.getProfile(created.summary.userIds.med);
  const olpProfile = await access.getProfile(created.summary.userIds.olp);
  assert.ok(
    mtdProfile.organizations
      .find((org) => org.code === 'MTD')
      ?.permissions.includes('patient_master.read'),
  );
  assert.ok(
    mtdProfile.organizations
      .find((org) => org.code === 'MTD')
      ?.permissions.includes('patient_reconciliation.read'),
  );
  assert.ok(
    medProfile.organizations
      .find((org) => org.code === 'MEDICARTE')
      ?.permissions.includes('patient_master.read'),
  );
  assert.ok(
    !olpProfile.organizations
      .find((org) => org.code === 'OLP')
      ?.permissions.includes('patient_master.read'),
  );
  const mtdPage1 = await repository.search(mtdScope, { page: 1, limit: 25 });
  const mtdPage2 = await repository.search(mtdScope, { page: 2, limit: 25 });
  assert.equal(mtdPage1.total, 30);
  assert.equal(mtdPage1.items.length, 25);
  assert.equal(mtdPage2.items.length, 5);
  const sharedId = created.summary.patientIds[0];
  const sharedMtdDetail = await repository.detail(mtdScope, sharedId);
  assert.ok(sharedMtdDetail);
  assert.equal(sharedMtdDetail.authorizationEvidence.length, 1);
  assert.deepEqual(sharedMtdDetail.authorizationEvidence[0].organizationCodes, ['MTD']);
  const medResults = await repository.search(medScope, { page: 1, limit: 25 });
  assert.equal(medResults.total, 2);
  assert.ok(medResults.items.some((item) => item.id === sharedId));
  const sharedMedDetail = await repository.detail(medScope, sharedId);
  assert.ok(sharedMedDetail);
  assert.deepEqual(sharedMedDetail.authorizationEvidence[0].organizationCodes, ['MEDICARTE']);
  const sharedPoints = await db.pool.query(
    `SELECT count(DISTINCT ps.dispensing_point_id)::int n
    FROM patient_schedules ps JOIN authorization_items ai ON ai.id=ps.authorization_item_id
    WHERE ai.patient_id=$1 AND EXISTS (SELECT 1 FROM authorization_item_organizations aio WHERE aio.authorization_item_id=ai.id AND aio.organization_id=$2)`,
    [sharedId, medScope.organizationId],
  );
  assert.equal(sharedPoints.rows[0].n, 2);
  const emptySearch = await repository.search(medScope, {
    page: 1,
    limit: 25,
    identificationType: 'TEST',
    identificationValue: 'NO-MATCH',
  });
  assert.deepEqual(emptySearch.items, []);
  assert.equal(emptySearch.total, 0);
  const ambiguous = await repository.search(mtdScope, {
    page: 1,
    limit: 25,
    identificationType: 'TEST',
    identificationValue: `SYN-AMB-${runId.slice(0, 8)}`,
  });
  assert.deepEqual(ambiguous.items, []);

  assert.throws(
    () =>
      resolvePatientMasterScope(
        medProfile,
        medScope.organizationId,
        medScope.userId,
        created.summary.pointIds.denied,
      ),
    (error) => error.getStatus?.() === 403,
  );
  assert.throws(
    () =>
      resolvePatientMasterScope(
        olpProfile,
        created.summary.orgIds.olp,
        created.summary.userIds.olp,
      ),
    (error) => error.getStatus?.() === 403,
  );

  const check = new Pool({ connectionString, max: 1 });
  const unlinked = await check.query(
    `SELECT count(*)::int n FROM authorization_items WHERE id = ANY($1::uuid[]) AND patient_id IS NULL`,
    [created.summary.authorizationIds.slice(-3)],
  );
  assert.equal(unlinked.rows[0].n, 3);
  const linked = await check.query(
    `SELECT count(*)::int n, count(*) FILTER (WHERE source_data->>'RF_PAC_FIXTURE_RUN'=$1)::int preserved FROM authorization_items WHERE id = ANY($2::uuid[])`,
    [runId, created.summary.authorizationIds],
  );
  assert.equal(linked.rows[0].n, 37);
  assert.equal(linked.rows[0].preserved, 37);
  const syntheticOnly = await check.query(
    `SELECT
    bool_and(NOT (source_data ? 'NOMBRE_PACIENTE')) AS no_patient_names,
    bool_and(source_data->>'IDENTIFICACION_PACIENTE' IS NULL OR source_data->>'IDENTIFICACION_PACIENTE' LIKE 'SYN-%') AS synthetic_identities
    FROM authorization_items WHERE id=ANY($1::uuid[])`,
    [created.summary.authorizationIds],
  );
  assert.deepEqual(syntheticOnly.rows[0], { no_patient_names: true, synthetic_identities: true });
  for (const [subject, userKey, secret] of [
    ['mtd', 'mtd', passwords.mtd],
    ['medicarte', 'med', passwords.medicarte],
    ['olp', 'olp', passwords.olp],
  ]) {
    const userId = created.summary.userIds[userKey];
    const credential = await check.query('SELECT password_hash FROM users WHERE id=$1', [userId]);
    assert.ok(await verifyPassword(secret, credential.rows[0].password_hash));
  }
  const grants = await check.query(
    `SELECT ups.dispensing_point_id FROM user_point_scopes ups WHERE ups.user_id=$1 AND ups.revoked_at IS NULL`,
    [created.summary.userIds.med],
  );
  assert.deepEqual(
    grants.rows.map((row) => row.dispensing_point_id),
    [created.summary.pointIds.allowed],
  );
  const otherAfter = await check.query(
    `SELECT count(*)::int n FROM patients WHERE id NOT IN (SELECT id FROM patients WHERE identification_value_raw LIKE 'SYN-%')`,
  );
  assert.equal(otherAfter.rows[0].n, unrelatedBefore.rows[0].n);

  const dependencyId = randomUUID();
  await check.query(
    `INSERT INTO authorization_items (id,patient_id,numero_autorizacion,codigo_medicamento,authorization_key,source_data,source_status_normalized,source_prescripcion_normalized,no_prescripcion,enablement_status,coverage_type,direction_status,coverage_rule_version,created_from_batch_id)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,'VIGENTE','','','ENABLED','PBS','NOT_APPLICABLE','RF-PAC-TEST-GUARD',$7)`,
    [
      dependencyId,
      sharedId,
      `RFPAC-GUARD-${runId}`,
      `SYN-GUARD-${runId}`,
      `RFPAC-GUARD-${runId}:SYN`,
      JSON.stringify({ TEST_CLEANUP_GUARD: runId }),
      created.summary.batchId,
    ],
  );
  await check.query(
    'INSERT INTO authorization_item_organizations (authorization_item_id,organization_id) VALUES ($1,$2)',
    [dependencyId, created.summary.orgIds.mtd],
  );
  await assert.rejects(
    cleanupFixtures({
      connectionString,
      target: 'local',
      allowlist: localAllowlist,
      authorizeCleanup: true,
      runId,
    }),
    /FIXTURE_CLEANUP_HAS_EXTERNAL_DEPENDENCIES/,
  );
  const preserved = await check.query(
    'SELECT count(*)::int n FROM authorization_items WHERE id=ANY($1::uuid[])',
    [created.summary.authorizationIds],
  );
  assert.equal(preserved.rows[0].n, 37);
  await check.query('DELETE FROM authorization_item_organizations WHERE authorization_item_id=$1', [
    dependencyId,
  ]);
  await check.query('DELETE FROM authorization_items WHERE id=$1', [dependencyId]);
  await check.end();

  const cleaned = await cleanupFixtures({
    connectionString,
    target: 'local',
    allowlist: localAllowlist,
    authorizeCleanup: true,
    runId,
  });
  assert.equal(cleaned.status, 'CLEANED');
  const cleanedAgain = await cleanupFixtures({
    connectionString,
    target: 'local',
    allowlist: localAllowlist,
    authorizeCleanup: true,
    runId,
  });
  assert.equal(cleanedAgain.status, 'ALREADY_CLEANED');
  const after = new Pool({ connectionString, max: 1 });
  const remaining = await after.query(
    `SELECT
    (SELECT count(*) FROM patients WHERE id = ANY($1::uuid[]))::int patients,
    (SELECT count(*) FROM authorization_items WHERE id = ANY($2::uuid[]))::int authorizations,
    (SELECT count(*) FROM audit_events WHERE resource_type='rf_pac_staging_fixture_run' AND resource_id=$3)::int audit_rows,
    (SELECT count(*) FROM users WHERE id=ANY($4::uuid[]) AND NOT active AND password_hash IS NULL)::int inactive_users,
    (SELECT count(*) FROM roles WHERE id=ANY($5::uuid[]) AND NOT active)::int inactive_roles,
    (SELECT count(*) FROM user_point_scopes WHERE user_id=$6 AND revoked_at IS NOT NULL)::int revoked_scopes,
    (SELECT count(*) FROM dispensing_points WHERE id=ANY($7::uuid[]) AND NOT active)::int inactive_points`,
    [
      created.summary.patientIds,
      created.summary.authorizationIds,
      runId,
      Object.values(created.summary.userIds),
      Object.values(created.summary.roleIds),
      created.summary.userIds.med,
      Object.values(created.summary.pointIds),
    ],
  );
  assert.deepEqual(remaining.rows[0], {
    patients: 0,
    authorizations: 0,
    audit_rows: 2,
    inactive_users: 3,
    inactive_roles: 3,
    revoked_scopes: 1,
    inactive_points: 2,
  });
  await after.end();
});
