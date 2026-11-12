import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  processCompensarPatientBackfillBatch,
  revertCompensarPatientBackfillBatch,
} from '../../apps/api/src/patient-backfill-compensar.repository';

const postgres = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://authorization:authorization@localhost:15432/authorization_test_integration',
});

describe('COMPENSAR backfill audit SQL against PostgreSQL', () => {
  beforeAll(async () => postgres.connect());
  afterAll(async () => postgres.end());

  it('inserts link and reversal audits with UUID and text bindings', async () => {
    const batchId = randomUUID();
    const organizationId = randomUUID();
    const authorizationId = randomUUID();
    const patientId = randomUUID();
    const query = async (sql: string, values: unknown[] = []) => {
      const normalized = sql.trim().toLowerCase();
      if (['begin', 'commit', 'rollback'].includes(normalized)) return { rows: [], rowCount: 0 };
      if (normalized.startsWith('select id, organization_id, policy_version')) {
        return {
          rows: [
            {
              id: batchId,
              organization_id: organizationId,
              policy_version: 'COMPENSAR_DOCUMENT_TYPE_CATALOG_V1',
              status: 'RUNNING',
              batch_size: 100,
              summary: {},
            },
          ],
          rowCount: 1,
        };
      }
      if (normalized.startsWith('select ai.id as authorization_item_id')) {
        return {
          rows: [
            {
              authorization_item_id: authorizationId,
              source_data: { TIPO_IDENTIFICACION: 1, IDENTIFICACION_PACIENTE: '000123' },
              patient_id: null,
              linked_type: null,
              linked_value: null,
              linked_source_code: null,
              exact_candidate_patient_count: 0,
            },
          ],
          rowCount: 1,
        };
      }
      if (normalized.startsWith('select id from patients')) return { rows: [], rowCount: 0 };
      if (normalized.startsWith('insert into patients')) {
        return { rows: [{ id: patientId }], rowCount: 1 };
      }
      if (normalized.startsWith('select id, authorization_item_id, previous_patient_id')) {
        return {
          rows: [
            {
              id: randomUUID(),
              authorization_item_id: authorizationId,
              previous_patient_id: null,
              applied_patient_id: patientId,
            },
          ],
          rowCount: 1,
        };
      }
      if (normalized.startsWith('insert into audit_events')) return postgres.query(sql, values);
      return { rows: [{ id: authorizationId }], rowCount: 1 };
    };
    const database = {
      pool: { query, connect: () => Promise.resolve({ query, release: () => undefined }) },
    } as never;

    await postgres.query('begin');
    try {
      await expect(processCompensarPatientBackfillBatch(database, batchId)).resolves.toMatchObject({
        processed: 1,
      });
      await expect(revertCompensarPatientBackfillBatch(database, batchId)).resolves.toEqual({
        reverted: 1,
        conflicts: 0,
      });
      const audit = await postgres.query<{
        action: string;
        correlation_id: string;
        request_id: string;
      }>(
        `select action, correlation_id, request_id from audit_events
          where correlation_id = $1 order by action`,
        [batchId],
      );
      expect(audit.rows).toEqual([
        { action: 'patient.backfill.link', correlation_id: batchId, request_id: batchId },
        { action: 'patient.backfill.revert', correlation_id: batchId, request_id: batchId },
      ]);
    } finally {
      await postgres.query('rollback');
    }
  });
});
