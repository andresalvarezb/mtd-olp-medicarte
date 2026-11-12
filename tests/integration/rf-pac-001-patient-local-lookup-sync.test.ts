import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgPatientLocalLookupSyncRepository } from '../../apps/worker/src/patient-local-lookup-sync';

const database = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://authorization:authorization@localhost:15432/authorization_test_integration',
});
const migrationPaths = [
  '0107_patient_master_additive.sql',
  '0108_patient_lookup_outbox_processing.sql',
  '0109_patient_mtdom_lookup_state.sql',
  '0110_patient_backfill_ledger.sql',
  '0111_patient_sync_checkpoint.sql',
  '0118_patient_source_organization.sql',
];
const migrations = migrationPaths.map((path) =>
  readFileSync(resolve(process.cwd(), 'packages/database/migrations', path), 'utf8'),
);

describe('RF-PAC-001 local patient lookup checkpoint integration', () => {
  beforeAll(async () => database.connect());
  afterAll(async () => database.end());

  it('commits RUNNING to IDLE with its outbox events, and rolls both back on checkpoint failure', async () => {
    const schemaName = `rf_pac_001_sync_${randomUUID().replaceAll('-', '')}`;
    const organizationId = randomUUID();
    const sourceOrganizationId = randomUUID();
    const authorizationItemId = randomUUID();
    const excludedAuthorizationItemId = randomUUID();
    const patientId = randomUUID();
    const excludedPatientId = randomUUID();
    const now = new Date('2026-11-09T12:00:00.000Z');

    await database.query(`create schema "${schemaName}"`);
    await database.query(`set search_path to "${schemaName}", public`);
    try {
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
        create table authorization_item_organizations (
          authorization_item_id uuid not null references authorization_items(id),
          organization_id uuid not null references organizations(id),
          primary key (authorization_item_id, organization_id)
        )
      `);
      await database.query(`
        create table outbox_events (
          id uuid primary key default gen_random_uuid(),
          event_type varchar(120) not null,
          version integer not null,
          payload jsonb not null,
          correlation_id uuid not null,
          idempotency_key varchar(255) not null unique,
          status varchar(30) not null default 'PENDING',
          attempts integer not null default 0,
          available_at timestamptz not null default now()
        )
      `);
      for (const migration of migrations) await database.query(migration);

      await database.query(`insert into organizations (id, code) values ($1, 'MEDICARTE')`, [
        organizationId,
      ]);
      await database.query(`insert into organizations (id, code) values ($1, 'COMPENSAR')`, [
        sourceOrganizationId,
      ]);
      await database.query(
        `insert into patients (id, source_organization_id, identification_type_raw, identification_value_raw)
         values ($1, $2, '1', $3), ($4, $2, '1', $5)`,
        [patientId, sourceOrganizationId, `SYNTH-${patientId}`,
          excludedPatientId, `SYNTH-${excludedPatientId}`],
      );
      await database.query(
        `insert into authorization_items (id, authorization_key, source_data, patient_id)
         values ($1, $2, $3::jsonb, $4), ($5, $6, $7::jsonb, $8)`,
        [
          authorizationItemId,
          `RF-PAC-001-${authorizationItemId}`,
          JSON.stringify({ TIPO_IDENTIFICACION: 1, IDENTIFICACION_PACIENTE: `SYNTH-${patientId}` }),
          patientId,
          excludedAuthorizationItemId,
          `RF-PAC-001-${excludedAuthorizationItemId}`,
          JSON.stringify({ TIPO_IDENTIFICACION: 1,
            IDENTIFICACION_PACIENTE: `SYNTH-${excludedPatientId}` }),
          excludedPatientId,
        ],
      );
      await database.query(
        `insert into authorization_item_organizations (authorization_item_id, organization_id)
         values ($1, $2), ($3, $2)`,
        [authorizationItemId, organizationId, excludedAuthorizationItemId],
      );

      const repository = new PgPatientLocalLookupSyncRepository({
        connect: () =>
          Promise.resolve({
            query: database.query.bind(database),
            release: () => undefined,
          }),
      } as never, [patientId]);
      const claimed = await repository.claim({ now, intervalMs: 60 * 60 * 1000, leaseMs: 60_000 });
      expect(claimed.status).toBe('CLAIMED');
      if (claimed.status !== 'CLAIMED' || !claimed.checkpoint) throw new Error('claim failed');

      await database.query(`
        create function reject_idle_checkpoint_update() returns trigger language plpgsql as $$
        begin
          if new.status = 'IDLE' then return null; end if;
          return new;
        end;
        $$
      `);
      await database.query(`
        create trigger reject_idle_checkpoint_update
        before update on patient_sync_checkpoints
        for each row execute function reject_idle_checkpoint_update()
      `);

      await expect(
        repository.enqueueNextPage({
          checkpoint: claimed.checkpoint,
          now,
          intervalMs: 60 * 60 * 1000,
          leaseMs: 60_000,
          pageSize: 50,
        }),
      ).rejects.toThrow('checkpoint persistence failed');

      const rolledBackEvents = await database.query<{ count: string }>(
        `select count(*) from outbox_events where event_type = 'patient.lookup'`,
      );
      const stillRunning = await database.query<{ status: string; records_seen: number }>(
        `select status, records_seen from patient_sync_checkpoints
          where feed_key like 'patients.lookup.basic.pilot.%'`,
      );
      expect(rolledBackEvents.rows[0]?.count).toBe('0');
      expect(stillRunning.rows[0]).toMatchObject({ status: 'RUNNING', records_seen: 0 });

      await database.query(
        `drop trigger reject_idle_checkpoint_update on patient_sync_checkpoints`,
      );
      await database.query(`drop function reject_idle_checkpoint_update()`);
      const result = await repository.enqueueNextPage({
        checkpoint: claimed.checkpoint,
        now,
        intervalMs: 60 * 60 * 1000,
        leaseMs: 60_000,
        pageSize: 50,
      });
      expect(result).toMatchObject({ completed: true, recordsSeen: 1, patientsQueued: 1 });

      const completedCheckpoint = await database.query<{
        status: string;
        sync_as_of: Date;
        next_cursor: string | null;
        run_id: string | null;
        lease_token: string | null;
        pages_processed: number;
        records_seen: number;
      }>(
        `select status, sync_as_of, next_cursor, run_id, lease_token, pages_processed, records_seen
           from patient_sync_checkpoints
          where feed_key like 'patients.lookup.basic.pilot.%'`,
      );
      const persistedEvents = await database.query<{
        payload: { patientId: string };
        idempotency_key: string;
      }>(`select payload, idempotency_key from outbox_events where event_type = 'patient.lookup'`);
      expect(completedCheckpoint.rows[0]).toMatchObject({
        status: 'IDLE',
        next_cursor: null,
        run_id: null,
        lease_token: null,
        pages_processed: 1,
        records_seen: 1,
      });
      expect(new Date(completedCheckpoint.rows[0]!.sync_as_of).toISOString()).toBe(
        now.toISOString(),
      );
      expect(persistedEvents.rows).toEqual([
        {
          payload: { patientId },
          idempotency_key: `patient.lookup.v1:${patientId}:${now.toISOString()}`,
        },
      ]);
    } finally {
      await database.query(`set search_path to public`);
      await database.query(`drop schema "${schemaName}" cascade`);
    }
  });
});
