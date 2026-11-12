import { describe, expect, it, vi } from 'vitest';
import {
  createCompensarPatientBackfillBatch,
  enqueueCompensarPatientBackfillBatch,
  inspectCompensarPatientBackfill,
  processCompensarPatientBackfillBatch,
  revertCompensarPatientBackfillBatch,
} from './patient-backfill-compensar.repository';

const authorizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const patientId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const batchId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const organizationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function row(sourceData: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    authorization_item_id: authorizationId,
    source_data: sourceData,
    patient_id: null,
    linked_type: null,
    linked_value: null,
    linked_source_code: null,
    exact_candidate_patient_count: 0,
    ...overrides,
  };
}

function createHarness(rows: ReturnType<typeof row>[], batchStatus = 'PENDING') {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    await Promise.resolve();
    statements.push({ sql, values });
    const normalized = sql.trim().toLowerCase();
    if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback')
      return { rows: [], rowCount: 0 };
    if (normalized.startsWith('select id, organization_id, policy_version'))
      return {
        rows: [
          {
            id: batchId,
            organization_id: organizationId,
            policy_version: 'COMPENSAR_DOCUMENT_TYPE_CC_ONLY_V1',
            status: batchStatus,
            batch_size: 100,
            summary: {},
          },
        ],
        rowCount: 1,
      };
    if (normalized.startsWith('select ai.id as authorization_item_id'))
      return { rows, rowCount: rows.length };
    if (normalized.startsWith('select id from patients')) return { rows: [], rowCount: 0 };
    if (normalized.startsWith('insert into patients'))
      return { rows: [{ id: patientId }], rowCount: 1 };
    if (normalized.startsWith('update authorization_items set patient_id = $2'))
      return { rows: [{ id: authorizationId }], rowCount: 1 };
    if (normalized.startsWith('insert into patient_backfill_batches'))
      return { rows: [{ id: batchId }], rowCount: 1 };
    if (normalized.startsWith('with candidates as'))
      return { rows: [{ id: 'outbox-1' }], rowCount: 1 };
    if (normalized.startsWith('select id, authorization_item_id, previous_patient_id'))
      return {
        rows: [
          {
            id: 'ledger-1',
            authorization_item_id: authorizationId,
            previous_patient_id: null,
            applied_patient_id: patientId,
          },
        ],
        rowCount: 1,
      };
    if (normalized.startsWith('update authorization_items set patient_id = $3'))
      return { rows: [{ id: authorizationId }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  return {
    database: {
      pool: { query, connect: () => Promise.resolve({ query, release: () => undefined }) },
    } as never,
    statements,
  };
}

describe('controlled COMPENSAR AUTO backfill', () => {
  it('reports aggregate inventory for numeric type cells but holds numeric document values for review', async () => {
    const harness = createHarness([
      row({ TIPO_IDENTIFICACION: 1, IDENTIFICACION_PACIENTE: '000123' }),
      row(
        { TIPO_IDENTIFICACION: 3, IDENTIFICACION_PACIENTE: '123' },
        { authorization_item_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
      ),
    ]);
    const report = await inspectCompensarPatientBackfill(harness.database);
    expect(report).toMatchObject({ scanned: 2, eligibleForBackfill: 1, identityRequiresReview: 1 });
    expect(JSON.stringify(report)).not.toContain('000123');
    expect(harness.statements).toHaveLength(1);
    expect(harness.statements[0]?.sql).toContain("operational_org.code = 'MEDICARTE'");
    expect(harness.statements[0]?.sql).toContain("candidate_source.code = 'COMPENSAR'");
  });

  it('writes one COMPENSAR-scoped patient and ledger link, without editing source or calling MTDOM', async () => {
    const harness = createHarness([
      row({ TIPO_IDENTIFICACION: 1, IDENTIFICACION_PACIENTE: '000123' }),
    ]);
    const result = await processCompensarPatientBackfillBatch(harness.database, batchId);
    expect(result).toMatchObject({
      processed: 1,
      remaining: false,
      summary: { linked_patient_created_and_linked: 1 },
    });
    const batchUpdate = harness.statements.find(({ sql }) =>
      sql.includes('update patient_backfill_batches') && sql.includes('set status = $2'),
    );
    expect(batchUpdate?.sql).toContain('completed_at = case when $4::boolean');
    expect(batchUpdate?.values).toEqual([
      batchId,
      'COMPLETED',
      JSON.stringify({ linked_patient_created_and_linked: 1 }),
      true,
    ]);
    const insert = harness.statements.find(({ sql }) => sql.includes('insert into patients'));
    expect(insert?.sql).toContain("code = 'COMPENSAR'");
    expect(insert?.values).toEqual(['1', '000123']);
    const ledger = harness.statements.find(({ sql }) =>
      sql.includes('insert into patient_backfill_items'),
    );
    expect(ledger?.values).toEqual([
      batchId,
      authorizationId,
      'LINKED',
      'PATIENT_CREATED_AND_LINKED',
      null,
      patientId,
      true,
    ]);
    const linkAudit = harness.statements.find(({ sql }) =>
      sql.includes("'patient.backfill.link'"),
    );
    expect(linkAudit?.sql).toContain('$5::uuid, $6::varchar');
    expect(linkAudit?.values).toEqual([
      organizationId,
      authorizationId,
      JSON.stringify({ patientId: null }),
      JSON.stringify({ patientId }),
      batchId,
      batchId,
    ]);
    expect(
      harness.statements.some(({ sql }) =>
        /update\s+authorization_items\s+set\s+source_data/i.test(sql),
      ),
    ).toBe(false);
    expect(harness.statements.some(({ sql }) => sql.includes('outbox_events'))).toBe(false);
  });

  it('records source type 3 as pending without creating or linking a patient', async () => {
    const harness = createHarness([
      row({ TIPO_IDENTIFICACION: 3, IDENTIFICACION_PACIENTE: '000123' }),
    ]);
    const result = await processCompensarPatientBackfillBatch(harness.database, batchId);
    expect(result.summary).toMatchObject({ needs_reconciliation_identity_requires_review: 1 });
    expect(harness.statements.some(({ sql }) => sql.includes('insert into patients'))).toBe(false);
    expect(harness.statements.some(({ sql }) => sql.includes('update authorization_items set patient_id'))).toBe(false);
    expect(harness.statements.find(({ sql }) => sql.includes('insert into patient_backfill_items'))?.values)
      .toEqual([batchId, authorizationId, 'NEEDS_RECONCILIATION', 'IDENTITY_REQUIRES_REVIEW', null, null, false]);
  });

  it('keeps ambiguous or cross-source links pending and supports guarded reversal', async () => {
    const harness = createHarness([
      row(
        { TIPO_IDENTIFICACION: '1', IDENTIFICACION_PACIENTE: '000123' },
        {
          patient_id: patientId,
          linked_type: '1',
          linked_value: '000123',
          linked_source_code: 'OLP',
        },
      ),
    ]);
    const result = await processCompensarPatientBackfillBatch(harness.database, batchId);
    expect(result.summary).toMatchObject({ needs_reconciliation_linked_source_mismatch: 1 });
    expect(
      harness.statements.some(({ sql }) =>
        sql.includes('update authorization_items set patient_id = $2'),
      ),
    ).toBe(false);
    const reverted = await revertCompensarPatientBackfillBatch(harness.database, batchId);
    expect(reverted).toEqual({ reverted: 1, conflicts: 0 });
    expect(
      harness.statements.find(({ sql }) =>
        sql.includes('update authorization_items set patient_id = $3'),
      )?.values,
    ).toEqual([authorizationId, patientId, null]);
    const revertAudit = harness.statements.find(({ sql }) =>
      sql.includes("'patient.backfill.revert'"),
    );
    expect(revertAudit?.sql).toContain('$5::uuid, $6::varchar');
    expect(revertAudit?.values).toEqual([
      organizationId,
      authorizationId,
      JSON.stringify({ patientId }),
      JSON.stringify({ patientId: null }),
      batchId,
      batchId,
    ]);
  });

  it('bounds pages and registers an MTD-owned policy-versioned batch', async () => {
    const harness = createHarness([]);
    await expect(createCompensarPatientBackfillBatch(harness.database, 501)).rejects.toThrow(
      'PATIENT_BACKFILL_BATCH_SIZE_INVALID',
    );
    await expect(createCompensarPatientBackfillBatch(harness.database, 25)).resolves.toBe(batchId);
    expect(
      harness.statements.find(({ sql }) => sql.includes('insert into patient_backfill_batches'))
        ?.values,
    ).toEqual(['COMPENSAR_DOCUMENT_TYPE_CC_ONLY_V1', 25]);
  });

  it('queues only a completed batch, by patient ID and without sending source values', async () => {
    const pending = createHarness([]);
    await expect(enqueueCompensarPatientBackfillBatch(pending.database, batchId)).rejects.toThrow(
      'PATIENT_BACKFILL_BATCH_NOT_READY_FOR_LOOKUP',
    );
    const completed = createHarness([], 'COMPLETED');
    await expect(enqueueCompensarPatientBackfillBatch(completed.database, batchId)).resolves.toBe(
      1,
    );
    const statement = completed.statements.find(({ sql }) => sql.includes('with candidates as'));
    expect(statement?.sql).toContain("source_org.code = 'COMPENSAR'");
    expect(statement?.sql).toContain("operational_org.code = 'MEDICARTE'");
    expect(statement?.sql).toContain("p.identification_type_raw = '1'");
    expect(statement?.sql).toContain("bi.status in ('LINKED', 'ALREADY_LINKED')");
    expect(statement?.sql).toContain('on conflict (idempotency_key) do nothing');
    expect(statement?.values).toEqual([batchId, 100, organizationId]);
    expect(JSON.stringify(statement?.values)).not.toContain('000123');
  });
});
