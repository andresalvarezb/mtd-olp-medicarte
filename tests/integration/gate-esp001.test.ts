import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const database = new Client({ connectionString: databaseUrl });
const suffix = randomUUID().slice(0, 8);
const authorizationNumber = `ESP001-${suffix}`;
const authorizationKey = `${authorizationNumber}:COD001`;
let importBatchId: string;
let authorizationItemId: string;
let periodId: string;
let pointId: string;
let scheduleId: string;
let demandLineId: string;

beforeAll(async () => {
  await database.connect();
  const organization = await database.query<{ id: string }>(
    `select id from organizations where code = 'MTD'`,
  );
  const admin = await database.query<{ id: string }>(
    `select id from users where username = 'foundation-admin'`,
  );
  const organizationId = organization.rows[0]?.id;
  const userId = admin.rows[0]?.id;
  if (!organizationId || !userId) throw new Error('Foundation fixtures are unavailable');

  const batch = await database.query<{ id: string }>(
    `insert into import_batches
      (organization_id, created_by, original_filename, mime_type, size_bytes, sha256,
       processor_version, status, total_rows, confirmed_rows, completed_at, confirmed_at)
     values ($1, $2, $3, $4, 1, $5, 1, 'COMPLETED', 1, 1, now(), now())
     returning id`,
    [
      organizationId,
      userId,
      `esp001-${suffix}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'a'.repeat(64),
    ],
  );
  importBatchId = batch.rows[0]!.id;

  const item = await database.query<{ id: string }>(
    `insert into authorization_items
      (numero_autorizacion, codigo_medicamento, authorization_key, source_data,
       source_status_normalized, source_prescripcion_normalized, no_prescripcion,
       enablement_status, coverage_type, direction_status, coverage_rule_version,
       lugar_dispensacion, fecha_programada, orden_compra, created_from_batch_id)
     values ($1, 'COD001', $2, '{}'::jsonb, 'VIGENTE', '', '', 'ENABLED', 'PBS',
             'NOT_APPLICABLE', 'ESP001', 'LEGACY SEDE', '2026-09-01', 'LEGACY-OC', $3)
     returning id`,
    [authorizationNumber, authorizationKey, importBatchId],
  );
  authorizationItemId = item.rows[0]!.id;

  const point = await database.query<{ id: string }>(
    `insert into dispensing_points (organization_id, code, name, created_by)
     values ($1, $2, 'ESP-001 Point', $3) returning id`,
    [organizationId, `ESP001-${suffix}`, userId],
  );
  pointId = point.rows[0]!.id;

  const period = await database.query<{ id: string }>(
    `insert into planning_periods
      (start_date, end_date, programming_deadline_at, purchase_order_deadline_at,
       expected_delivery_date, created_by)
     values ('2026-09-14', '2026-09-20', '2026-09-15T23:59:00Z',
             '2026-09-16T23:59:00Z', '2026-09-21', $1)
     returning id`,
    [userId],
  );
  periodId = period.rows[0]!.id;

  const schedule = await database.query<{ id: string }>(
    `insert into patient_schedules
      (authorization_item_id, planning_period_id, dispensing_point_id, commercial_code,
       scheduled_date, quantity, created_by, updated_by)
     values ($1, $2, $3, 'COD001', '2026-09-16', 2, $4, $4)
     returning id`,
    [authorizationItemId, periodId, pointId, userId],
  );
  scheduleId = schedule.rows[0]!.id;

  await database.query(
    `insert into patient_schedule_history
      (patient_schedule_id, revision, authorization_item_id, planning_period_id,
       dispensing_point_id, commercial_code, scheduled_date, quantity, status,
       change_type, changed_by, correlation_id)
     values ($1, 1, $2, $3, $4, 'COD001', '2026-09-16', 2, 'SCHEDULED',
             'CREATED', $5, $6)`,
    [scheduleId, authorizationItemId, periodId, pointId, userId, randomUUID()],
  );

  const demand = await database.query<{ id: string }>(
    `insert into projected_demand_lines
      (planning_period_id, dispensing_point_id, commercial_code, projected_quantity,
       created_by, updated_by)
     values ($1, $2, 'COD001', 2, $3, $3)
     returning id`,
    [periodId, pointId, userId],
  );
  demandLineId = demand.rows[0]!.id;
  await database.query(
    `insert into demand_sources
      (projected_demand_line_id, patient_schedule_id, schedule_revision, quantity)
     values ($1, $2, 1, 2)`,
    [demandLineId, scheduleId],
  );
});

afterAll(async () => {
  await database.query('begin');
  try {
    await database.query(
      `alter table patient_schedule_history disable trigger patient_schedule_history_no_delete`,
    );
    await database.query(`delete from demand_sources where projected_demand_line_id = $1`, [
      demandLineId,
    ]);
    await database.query(`delete from projected_demand_lines where id = $1`, [demandLineId]);
    await database.query(`delete from patient_schedule_history where patient_schedule_id = $1`, [
      scheduleId,
    ]);
    await database.query(`delete from patient_schedules where id = $1`, [scheduleId]);
    await database.query(`delete from planning_periods where id = $1`, [periodId]);
    await database.query(`delete from dispensing_points where id = $1`, [pointId]);
    await database.query(`delete from authorization_items where id = $1`, [authorizationItemId]);
    await database.query(`delete from import_batches where id = $1`, [importBatchId]);
    await database.query(
      `alter table patient_schedule_history enable trigger patient_schedule_history_no_delete`,
    );
    await database.query('commit');
  } catch (error) {
    await database.query('rollback');
    throw error;
  }
  await database.end();
});

describe('ESP-001 — separación del dominio clínico y logístico', () => {
  it('creates the structural entities without a logistics FK on demand lines', async () => {
    const columns = await database.query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'public' and table_name = 'projected_demand_lines'`,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain('authorization_item_id');
    expect(demandLineId).toBeTruthy();
  });

  it('preserves the authorization legacy projection when demand is created', async () => {
    const item = await database.query<{
      orden_compra: string | null;
      fecha_programada: string | null;
      lugar_dispensacion: string | null;
    }>(
      `select orden_compra, to_char(fecha_programada, 'YYYY-MM-DD') as fecha_programada,
              lugar_dispensacion
         from authorization_items where id = $1`,
      [authorizationItemId],
    );
    expect(item.rows[0]).toEqual({
      orden_compra: 'LEGACY-OC',
      fecha_programada: '2026-09-01',
      lugar_dispensacion: 'LEGACY SEDE',
    });
  });

  it('requires the schedule commercial code to match the authorization item', async () => {
    const user = await database.query<{ id: string }>(
      `select id from users where username = 'foundation-admin'`,
    );
    await expect(
      database.query(
        `insert into patient_schedules
          (authorization_item_id, planning_period_id, dispensing_point_id, commercial_code,
           scheduled_date, quantity, created_by, updated_by)
         values ($1, $2, $3, 'WRONG-CODE', '2026-09-16', 1, $4, $4)`,
        [authorizationItemId, periodId, pointId, user.rows[0]!.id],
      ),
    ).rejects.toThrow(/patient_schedules_authorization_code_fk/);
  });

  it('keeps schedule history append-only', async () => {
    await expect(
      database.query(`delete from patient_schedule_history where patient_schedule_id = $1`, [
        scheduleId,
      ]),
    ).rejects.toThrow(/append-only/);
  });
});
