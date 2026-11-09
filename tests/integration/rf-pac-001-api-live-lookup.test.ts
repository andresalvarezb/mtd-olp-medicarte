import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../packages/database/src';
import { PatientMasterRepository } from '../../apps/api/src/patients/patient-master.repository';
import { AccessService } from '../../apps/api/src/identity/access.service';
import type { PatientMasterScope } from '../../apps/api/src/patients/patient-master.access-policy';

const databaseUrl = process.env.DATABASE_URL ?? '';
const target = databaseUrl ? new URL(databaseUrl) : null;
if (
  target &&
  (target.hostname !== 'localhost' ||
    target.port !== (process.env.POSTGRES_HOST_PORT ?? '25432') ||
    target.pathname !== '/authorization_test_integration')
) {
  throw new Error('Refusing RF-PAC-001 API integration test outside isolated PostgreSQL');
}

const database = target ? createDatabase(databaseUrl) : null;
const ids = {
  user: randomUUID(),
  grantedPoint: randomUUID(),
  ungrantedPoint: randomUUID(),
  planningPeriod: randomUUID(),
  importBatch: randomUUID(),
  authorization: randomUUID(),
  scheduleGranted: randomUUID(),
  suffix: randomUUID(),
};
let medicarteOrganizationId = '';
let mtdOrganizationId = '';

describe.skipIf(!database)('RF-PAC-001 live lookup authorization on PostgreSQL', () => {
  const query = database!.pool;

  beforeAll(async () => {
    const organizations = await query.query<{ id: string; code: string }>(
      `select id, code from organizations where code in ('MTD', 'MEDICARTE') and active = true`,
    );
    medicarteOrganizationId = organizations.rows.find((row) => row.code === 'MEDICARTE')?.id ?? '';
    mtdOrganizationId = organizations.rows.find((row) => row.code === 'MTD')?.id ?? '';
    if (!medicarteOrganizationId || !mtdOrganizationId)
      throw new Error('Synthetic MTD/MEDICARTE organizations are missing');

    await query.query(
      `insert into users (id, username, display_name, active, provenance)
       values ($1, $2, 'Synthetic patient lookup test', true, 'TEST_FIXTURE')`,
      [ids.user, `pac-live-${ids.suffix.slice(0, 12)}`],
    );
    await query.query(
      `insert into import_batches (
         id, organization_id, created_by, original_filename, mime_type, size_bytes,
         sha256, processor_version, status, total_rows, valid_rows, confirmed_rows,
         started_at, completed_at, confirmed_at
       ) values ($1, $2, $3, 'rf-pac-live-synthetic.csv', 'text/csv', 1,
                 repeat('a', 64), 1, 'COMPLETED', 1, 1, 1, now(), now(), now())`,
      [ids.importBatch, mtdOrganizationId, ids.user],
    );
    await query.query(
      `insert into dispensing_points (id, organization_id, code, name, created_by)
       values ($1, $2, $3, 'Synthetic granted point', $4),
              ($5, $2, $6, 'Synthetic ungranted point', $4)`,
      [
        ids.grantedPoint,
        medicarteOrganizationId,
        `PAC-GRANTED-${ids.suffix.slice(0, 8)}`,
        ids.user,
        ids.ungrantedPoint,
        `PAC-UNGRANTED-${ids.suffix.slice(0, 8)}`,
      ],
    );
    await query.query(
      `insert into user_point_scopes (user_id, dispensing_point_id, granted_by)
       values ($1, $2, $1)`,
      [ids.user, ids.grantedPoint],
    );
    await query.query(
      `insert into planning_periods (
         id, start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
         expected_delivery_date, created_by, updated_by
       ) values ($1, current_date, current_date + 30, now(), now() + interval '1 day',
                 current_date + 2, $2, $2)`,
      [ids.planningPeriod, ids.user],
    );
    await query.query(
      `insert into authorization_items (
         id, patient_id, numero_autorizacion, codigo_medicamento, authorization_key,
         source_data, source_status_normalized, enablement_status, coverage_type,
         direction_status, coverage_rule_version, created_from_batch_id
       ) values ($1, null, $2, 'PAC-LIVE-SYNTHETIC', $3, $4::jsonb,
                 'AUTHORIZED', 'ENABLED', 'NO_PBS', 'CONFIRMED', 'RF-PAC-001-SYNTHETIC', $5)`,
      [
        ids.authorization,
        `PAC-LIVE-AUTH-${ids.suffix}`,
        `PAC-LIVE-AUTH-${ids.suffix}|PAC-LIVE-SYNTHETIC`,
        JSON.stringify({
          TIPO_IDENTIFICACION: 'CC',
          IDENTIFICACION_PACIENTE: `SYN-${ids.suffix}`,
          NUM_DOCUMENTO: `SYN-${ids.suffix}`,
        }),
        ids.importBatch,
      ],
    );
    await query.query(
      `insert into authorization_item_organizations (authorization_item_id, organization_id)
       values ($1, $2)`,
      [ids.authorization, medicarteOrganizationId],
    );
    await query.query(
      `insert into patient_schedules (
         id, authorization_item_id, planning_period_id, dispensing_point_id,
         commercial_code, scheduled_date, quantity, created_by, updated_by
       ) values ($1, $2, $3, $4, 'PAC-LIVE-SYNTHETIC', current_date, 1, $5, $5)`,
      [ids.scheduleGranted, ids.authorization, ids.planningPeriod, ids.grantedPoint, ids.user],
    );
  });

  afterAll(async () => {
    if (!database) return;
    await query.query('delete from patient_schedules where id = $1', [ids.scheduleGranted]);
    await query.query(
      'delete from authorization_item_organizations where authorization_item_id = $1',
      [ids.authorization],
    );
    await query.query('delete from authorization_items where id = $1', [ids.authorization]);
    await query.query('delete from import_batches where id = $1', [ids.importBatch]);
    await query.query('delete from user_point_scopes where user_id = $1', [ids.user]);
    await query.query('delete from planning_periods where id = $1', [ids.planningPeriod]);
    await query.query('delete from inventory_locations where created_by = $1', [ids.user]);
    await query.query('delete from dispensing_points where id = any($1::uuid[])', [
      [ids.grantedPoint, ids.ungrantedPoint],
    ]);
    await query.query('delete from users where id = $1', [ids.user]);
    await database.pool.end();
  });

  it('requires an exact MEDICARTE identity and an active granted point, without a local patient row', async () => {
    const repository = new PatientMasterRepository(database!);
    const access = new AccessService(database!);
    const grantedPoints = await access.getMedicartePointGrants(ids.user);
    expect(grantedPoints).toEqual([ids.grantedPoint]);

    const scope: PatientMasterScope = {
      organizationId: mtdOrganizationId,
      organizationCode: 'MTD',
      userId: ids.user,
      pointAccessKind: 'explicit',
      accessiblePointIds: grantedPoints,
      dispensingPointId: null,
    };
    const identity = { identificationType: 'CC', identificationValue: `SYN-${ids.suffix}` };
    await expect(repository.isAuthorizedLiveLookup(scope, identity)).resolves.toBe(true);
    await expect(
      repository.isAuthorizedLiveLookup(scope, {
        identificationType: 'cc',
        identificationValue: identity.identificationValue,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.isAuthorizedLiveLookup(scope, {
        identificationType: 'CC',
        identificationValue: `SYN-MISSING-${ids.suffix}`,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.isAuthorizedLiveLookup(
        { ...scope, accessiblePointIds: [ids.ungrantedPoint] },
        identity,
      ),
    ).resolves.toBe(false);

    const localPatient = await query.query(
      `select id from patients where identification_value_raw = $1`,
      [identity.identificationValue],
    );
    expect(localPatient.rowCount).toBe(0);
  });
});
