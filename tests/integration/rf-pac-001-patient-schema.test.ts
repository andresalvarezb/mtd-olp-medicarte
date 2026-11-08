import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const database = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://authorization:authorization@localhost:15432/authorization_test_integration',
});

const migrationSql = readFileSync(
  resolve(process.cwd(), 'packages/database/migrations/0107_patient_master_additive.sql'),
  'utf8',
);
const outboxProcessingMigrationSql = readFileSync(
  resolve(process.cwd(), 'packages/database/migrations/0108_patient_lookup_outbox_processing.sql'),
  'utf8',
);
const patientMtdomStateMigrationSql = readFileSync(
  resolve(process.cwd(), 'packages/database/migrations/0109_patient_mtdom_lookup_state.sql'),
  'utf8',
);
const patientBackfillLedgerMigrationSql = readFileSync(
  resolve(process.cwd(), 'packages/database/migrations/0110_patient_backfill_ledger.sql'),
  'utf8',
);
const patientSyncCheckpointMigrationSql = readFileSync(
  resolve(process.cwd(), 'packages/database/migrations/0111_patient_sync_checkpoint.sql'),
  'utf8',
);

describe('RF-PAC-001 additive patient schema', () => {
  beforeAll(async () => database.connect());
  afterAll(async () => database.end());

  it('migrates a historical authorization and preserves nullable link and FK semantics', async () => {
    const schemaName = `rf_pac_001_${randomUUID().replaceAll('-', '')}`;
    const authorizationId = randomUUID();
    const sourceData = {
      TIPO_IDENTIFICACION: 'CC',
      IDENTIFICACION_PACIENTE: '000123',
      CANTIDAD: '5',
    };
    const authorizationKey = `RF-PAC-001-${randomUUID()}`;

    await database.query('begin');
    try {
      await database.query(`create schema "${schemaName}"`);
      await database.query(`set local search_path to "${schemaName}", public`);
      await database.query(
        `create table organizations (id uuid primary key, code varchar(50) unique not null)`,
      );
      await database.query(`create table users (id uuid primary key)`);
      await database.query(`
        create table authorization_items (
          id uuid primary key,
          authorization_key varchar(511) not null,
          source_data jsonb not null,
          operation_status varchar(40)
        )
      `);
      await database.query(`
        create table outbox_events (
          id uuid primary key,
          status varchar(30) not null default 'PENDING',
          attempts integer not null default 0,
          available_at timestamptz not null default now()
        )
      `);
      await database.query(
        `insert into authorization_items (id, authorization_key, source_data, operation_status)
         values ($1, $2, $3::jsonb, 'READY_TO_DISPENSE')`,
        [authorizationId, authorizationKey, JSON.stringify(sourceData)],
      );

      // Apply the actual versioned SQL after a legacy row already exists.
      await database.query(migrationSql);
      await database.query(outboxProcessingMigrationSql);
      await database.query(patientMtdomStateMigrationSql);
      await database.query(patientBackfillLedgerMigrationSql);
      await database.query(patientSyncCheckpointMigrationSql);

      const outboxId = randomUUID();
      await database.query(`insert into outbox_events (id) values ($1)`, [outboxId]);
      const processingCounter = await database.query<{ processing_attempts: number }>(
        `select processing_attempts from outbox_events where id = $1`,
        [outboxId],
      );
      expect(processingCounter.rows[0]?.processing_attempts).toBe(0);

      const checkpointColumns = await database.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = current_schema() and table_name = 'patient_sync_checkpoints'`,
      );
      expect(checkpointColumns.rows.map((row) => row.column_name)).toContain('sync_as_of');
      expect(checkpointColumns.rows.map((row) => row.column_name)).toContain('next_cursor');
      expect(checkpointColumns.rows.map((row) => row.column_name)).not.toContain(
        'response_payload',
      );
      expect(checkpointColumns.rows.map((row) => row.column_name)).not.toContain('document_value');
      const checkpointId = randomUUID();
      await database.query(
        `insert into patient_sync_checkpoints (id, feed_key, sync_as_of)
         values ($1, 'patients.changes.basic', '2026-01-01T00:00:00Z')`,
        [checkpointId],
      );
      await database.query('savepoint reject_personal_profile');
      await expect(
        database.query(`update patient_sync_checkpoints set profile = 'personal' where id = $1`, [
          checkpointId,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      await database.query('rollback to savepoint reject_personal_profile');
      await database.query('release savepoint reject_personal_profile');

      const migrated = await database.query<{
        patient_id: string | null;
        authorization_key: string;
        source_data: Record<string, unknown>;
        operation_status: string;
      }>(
        `select patient_id, authorization_key, source_data, operation_status
           from authorization_items where id = $1`,
        [authorizationId],
      );
      expect(migrated.rows[0]).toMatchObject({
        patient_id: null,
        authorization_key: authorizationKey,
        source_data: sourceData,
        operation_status: 'READY_TO_DISPENSE',
      });

      const foreignKey = await database.query<{ confdeltype: string }>(
        `select confdeltype
           from pg_constraint
          where conname = 'authorization_items_patient_id_patients_id_fk'
            and conrelid = 'authorization_items'::regclass`,
      );
      expect(foreignKey.rows[0]?.confdeltype).toBe('r');

      const patientIndex = await database.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
          where schemaname = current_schema()
            and indexname = 'authorization_items_patient_id_idx'`,
      );
      expect(patientIndex.rows[0]?.indexdef).toContain('(patient_id)');
      expect(patientIndex.rows[0]?.indexdef).not.toContain('UNIQUE');
      const patientIdentityIndex = await database.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
          where schemaname = current_schema()
            and indexname = 'patients_identification_raw_idx'`,
      );
      expect(patientIdentityIndex.rows[0]?.indexdef).toContain(
        '(identification_type_raw, identification_value_raw)',
      );
      expect(patientIdentityIndex.rows[0]?.indexdef).not.toContain('UNIQUE');

      const patientId = randomUUID();
      await database.query(
        `insert into patients (id, identification_type_raw, identification_value_raw)
         values ($1, 'CC', '000123')`,
        [patientId],
      );
      const exactRawValue = await database.query<{ identification_value_raw: string }>(
        `select identification_value_raw from patients where id = $1`,
        [patientId],
      );
      expect(exactRawValue.rows[0]?.identification_value_raw).toBe('000123');
      const changesSeenAtColumn = await database.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = current_schema() and table_name = 'patients'
            and column_name = 'mtdom_changes_seen_at'`,
      );
      expect(changesSeenAtColumn.rowCount).toBe(1);
      const initialMtdomState = await database.query<{
        mtdom_lookup_status: string;
        mtdom_last_checked_at: Date | null;
        mtdom_last_error_code: string | null;
      }>(
        `select mtdom_lookup_status, mtdom_last_checked_at, mtdom_last_error_code
           from patients where id = $1`,
        [patientId],
      );
      expect(initialMtdomState.rows[0]).toEqual({
        mtdom_lookup_status: 'NOT_REQUESTED',
        mtdom_last_checked_at: null,
        mtdom_last_error_code: null,
      });

      const organizationId = randomUUID();
      await database.query(`insert into organizations (id, code) values ($1, 'MEDICARTE')`, [
        organizationId,
      ]);
      const batchId = randomUUID();
      await database.query(
        `insert into patient_backfill_batches (id, organization_id, policy_version, batch_size)
         values ($1, $2, 'SYNTHETIC_EXACT_TEST_V1', 10)`,
        [batchId, organizationId],
      );
      await database.query(
        `insert into patient_backfill_items (batch_id, authorization_item_id, status, reason_code)
         values ($1, $2, 'NEEDS_RECONCILIATION', 'IDENTITY_INCOMPLETE')`,
        [batchId, authorizationId],
      );
      const reconciliation = await database.query<{ status: string; reason_code: string }>(
        `select status, reason_code from patient_backfill_items
          where batch_id = $1 and authorization_item_id = $2`,
        [batchId, authorizationId],
      );
      expect(reconciliation.rows[0]).toEqual({
        status: 'NEEDS_RECONCILIATION',
        reason_code: 'IDENTITY_INCOMPLETE',
      });

      // Duplicates remain representable until the approved normalization rule exists.
      await database.query(
        `insert into patients (identification_type_raw, identification_value_raw)
         values ('CC', '000123')`,
      );

      await database.query(`update authorization_items set patient_id = $1 where id = $2`, [
        patientId,
        authorizationId,
      ]);
      const linked = await database.query<{
        patient_id: string;
        authorization_key: string;
        source_data: Record<string, unknown>;
        operation_status: string;
      }>(
        `select patient_id, authorization_key, source_data, operation_status
           from authorization_items where id = $1`,
        [authorizationId],
      );
      expect(linked.rows[0]).toMatchObject({
        patient_id: patientId,
        authorization_key: authorizationKey,
        source_data: sourceData,
        operation_status: 'READY_TO_DISPENSE',
      });

      const expectSqlFailure = async (query: string, values: unknown[], code: string) => {
        await database.query('savepoint expected_constraint_failure');
        let errorCode: string | undefined;
        try {
          await database.query(query, values);
        } catch (error) {
          errorCode = (error as { code?: string }).code;
        }
        await database.query('rollback to savepoint expected_constraint_failure');
        await database.query('release savepoint expected_constraint_failure');
        expect(errorCode).toBe(code);
      };

      await expectSqlFailure(
        `insert into patient_backfill_items (batch_id, authorization_item_id, status, reason_code)
         values ($1, $2, 'NEEDS_RECONCILIATION', 'IDENTITY_INCOMPLETE')`,
        [batchId, authorizationId],
        '23505',
      );
      await expectSqlFailure(
        `insert into patient_backfill_items (batch_id, authorization_item_id, status, reason_code)
         values ($1, $2, 'RESOLVED', 'IDENTITY_VERIFIED')`,
        [batchId, authorizationId],
        '23514',
      );
      await expectSqlFailure(
        `insert into patient_backfill_items (batch_id, authorization_item_id, status, reason_code)
         values ($1, $2, 'LINKED', 'IDENTITY_VERIFIED')`,
        [batchId, authorizationId],
        '23514',
      );

      await expectSqlFailure(
        `update authorization_items set patient_id = $1 where id = $2`,
        [randomUUID(), authorizationId],
        '23503',
      );
      await expectSqlFailure(`delete from patients where id = $1`, [patientId], '23503');
      await expectSqlFailure(
        `insert into patients (identification_type_raw, identification_value_raw)
         values ('   ', 'synthetic')`,
        [],
        '23514',
      );
      await expectSqlFailure(
        `update outbox_events set processing_attempts = -1 where id = $1`,
        [outboxId],
        '23514',
      );
      await expectSqlFailure(
        `update patients set mtdom_lookup_status = 'ENRICHED' where id = $1`,
        [patientId],
        '23514',
      );
    } finally {
      await database.query('rollback');
    }
  });
});
