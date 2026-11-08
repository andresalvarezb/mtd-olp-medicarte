import { describe, expect, it } from 'vitest';
import {
  assertSyntheticPatientBackfillAllowed,
  createSyntheticPatientBackfillBatch,
  inspectPatientBackfillInventory,
  processSyntheticPatientBackfillBatch,
  revertSyntheticPatientBackfillBatch,
} from './patient-backfill.repository';

const policy = {
  version: 'SYNTHETIC_EXACT_TEST_V1',
  normalizeDocumentType: (value: string) => value,
  normalizeDocumentValue: (value: string) => value,
};
const guard = {
  enabled: true,
  nodeEnv: 'test',
  databaseUrl: 'postgresql://synthetic:synthetic@localhost:25432/authorization_test_integration',
  policyVersion: policy.version,
};

type AuthRow = { id: string; source_data: Record<string, unknown>; patient_id: string | null };
type Patient = { id: string; identification_type_raw: string; identification_value_raw: string };
type Ledger = {
  batch_id: string;
  authorization_item_id: string;
  status: string;
  reason_code: string;
  previous_patient_id: string | null;
  applied_patient_id: string | null;
  created_patient: boolean;
};

function createHarness(authRows: AuthRow[]) {
  const state = {
    batch: null as null | {
      id: string;
      organization_id: string;
      policy_version: string;
      status: string;
      batch_size: number;
      summary: Record<string, number>;
    },
    authRows,
    patients: [] as Patient[],
    ledgers: [] as Ledger[],
    audits: [] as unknown[][],
  };
  let snapshot: typeof state | null = null;
  let nextId = 0;
  let failNextLink = false;
  let batchLock = Promise.resolve();
  const clone = <T>(value: T): T => structuredClone(value);
  const query = (sqlText: string, values: unknown[] = []) => {
    const sql = sqlText.trim().replace(/\s+/g, ' ').toLowerCase();
    if (sql === 'begin') {
      snapshot = clone(state);
      return { rows: [], rowCount: 0 };
    }
    if (sql === 'commit') {
      snapshot = null;
      return { rows: [], rowCount: 0 };
    }
    if (sql === 'rollback') {
      if (snapshot) Object.assign(state, clone(snapshot));
      snapshot = null;
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('insert into patient_backfill_batches')) {
      state.batch = {
        id: 'batch-synthetic-1',
        organization_id: 'org-medicarte-synthetic',
        policy_version: String(values[0]),
        status: 'PENDING',
        batch_size: Number(values[1]),
        summary: {},
      };
      return { rows: [{ id: state.batch.id }], rowCount: 1 };
    }
    if (sql.startsWith('select ai.id authorization_item_id')) {
      const candidates = state.authRows.filter(
        (auth) =>
          !state.ledgers.some(
            (item) => item.batch_id === values[0] && item.authorization_item_id === auth.id,
          ),
      );
      const selected = sql.includes('limit $2')
        ? candidates.slice(0, Number(values[1]))
        : candidates;
      return {
        rows: selected.map((auth) => {
          const patient = state.patients.find((item) => item.id === auth.patient_id);
          return {
            authorization_item_id: auth.id,
            source_data: auth.source_data,
            patient_id: auth.patient_id,
            linked_type: patient?.identification_type_raw ?? null,
            linked_value: patient?.identification_value_raw ?? null,
            exact_candidate_patient_count: state.patients.filter(
              (candidate) =>
                candidate.identification_type_raw === auth.source_data.TIPO_IDENTIFICACION &&
                candidate.identification_value_raw ===
                  (auth.source_data.IDENTIFICACION_PACIENTE ?? auth.source_data.NUM_DOCUMENTO),
            ).length,
            organization_codes: ['MEDICARTE'],
          };
        }),
        rowCount: selected.length,
      };
    }
    if (sql.startsWith('select id, organization_id, policy_version')) {
      return { rows: state.batch ? [state.batch] : [], rowCount: state.batch ? 1 : 0 };
    }
    if (sql.startsWith('select pg_advisory_xact_lock')) {
      expect(typeof values[0]).toBe('string');
      expect(JSON.parse(values[0] as string)).toHaveLength(2);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('select id from patients')) {
      const found = state.patients.filter(
        (patient) =>
          patient.identification_type_raw === values[0] &&
          patient.identification_value_raw === values[1],
      );
      return { rows: found.map((patient) => ({ id: patient.id })), rowCount: found.length };
    }
    if (sql.startsWith('insert into patients')) {
      const patient = {
        id: `patient-synthetic-${++nextId}`,
        identification_type_raw: String(values[0]),
        identification_value_raw: String(values[1]),
      };
      state.patients.push(patient);
      return { rows: [{ id: patient.id }], rowCount: 1 };
    }
    if (sql.startsWith('update authorization_items set patient_id = $2')) {
      if (failNextLink) {
        failNextLink = false;
        throw new Error('synthetic transaction failure');
      }
      const auth = state.authRows.find((item) => item.id === values[0]);
      if (!auth || auth.patient_id !== null) return { rows: [], rowCount: 0 };
      auth.patient_id = String(values[1]);
      return { rows: [{ id: auth.id }], rowCount: 1 };
    }
    if (sql.startsWith('update authorization_items set patient_id = $3')) {
      const auth = state.authRows.find((item) => item.id === values[0]);
      if (!auth || auth.patient_id !== values[1]) return { rows: [], rowCount: 0 };
      auth.patient_id = values[2] === null ? null : typeof values[2] === 'string' ? values[2] : '';
      return { rows: [{ id: auth.id }], rowCount: 1 };
    }
    if (sql.startsWith('insert into patient_backfill_items')) {
      state.ledgers.push({
        batch_id: String(values[0]),
        authorization_item_id: String(values[1]),
        status: String(values[2]),
        reason_code: String(values[3]),
        previous_patient_id:
          values[4] === null ? null : typeof values[4] === 'string' ? values[4] : '',
        applied_patient_id:
          values[5] === null ? null : typeof values[5] === 'string' ? values[5] : '',
        created_patient: Boolean(values[6]),
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('insert into audit_events')) {
      state.audits.push(values);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('update patient_backfill_batches set status = $2')) {
      if (state.batch) {
        state.batch.status = String(values[1]);
        state.batch.summary = JSON.parse(String(values[2])) as Record<string, number>;
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('update patient_backfill_batches set status = case')) {
      if (state.batch) state.batch.status = state.batch.status === 'PENDING' ? 'FAILED' : 'PARTIAL';
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('select organization_id, status from patient_backfill_batches')) {
      return { rows: state.batch ? [state.batch] : [], rowCount: state.batch ? 1 : 0 };
    }
    if (sql.startsWith('select id, authorization_item_id, previous_patient_id')) {
      const linked = state.ledgers.filter(
        (item) => item.batch_id === values[0] && item.status === 'LINKED',
      );
      return {
        rows: linked.map((item) => ({
          id: `ledger-${item.authorization_item_id}`,
          authorization_item_id: item.authorization_item_id,
          previous_patient_id: item.previous_patient_id,
          applied_patient_id: item.applied_patient_id,
        })),
        rowCount: linked.length,
      };
    }
    if (sql.startsWith("update patient_backfill_items set status = 'reverted'")) {
      const item = state.ledgers.find(
        (row) => row.authorization_item_id === String(values[0]).replace('ledger-', ''),
      );
      if (item) item.status = 'REVERTED';
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("update patient_backfill_items set status = 'revert_conflict'")) {
      const item = state.ledgers.find(
        (row) => row.authorization_item_id === String(values[0]).replace('ledger-', ''),
      );
      if (item) item.status = 'REVERT_CONFLICT';
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("update patient_backfill_batches set status = 'reverted'")) {
      if (state.batch) state.batch.status = 'REVERTED';
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected synthetic SQL: ${sql}`);
  };
  const database = {
    pool: {
      query,
      connect: () => {
        let unlockBatch: (() => void) | undefined;
        const clientQuery = async (sqlText: string, values: unknown[] = []) => {
          const sql = sqlText.trim().replace(/\s+/g, ' ').toLowerCase();
          if (
            sql.startsWith('select id, organization_id, policy_version') &&
            sql.includes('for update')
          ) {
            const previous = batchLock;
            let unlock!: () => void;
            batchLock = new Promise<void>((resolve) => {
              unlock = resolve;
            });
            await previous;
            unlockBatch = unlock;
          }
          const result = query(sqlText, values);
          if (sql === 'commit' || sql === 'rollback') {
            unlockBatch?.();
            unlockBatch = undefined;
          }
          return result;
        };
        return { query: clientQuery, release: () => undefined };
      },
    },
  };
  return {
    state,
    database: database as never,
    failNextLink: () => {
      failNextLink = true;
    },
  };
}

describe('synthetic patient historical backfill', () => {
  it('rejects real, non-test, or unapproved execution targets', () => {
    expect(() => assertSyntheticPatientBackfillAllowed(guard)).not.toThrow();
    expect(() => assertSyntheticPatientBackfillAllowed({ ...guard, enabled: false })).toThrow(
      'PATIENT_BACKFILL_SYNTHETIC_MODE_REQUIRED',
    );
    expect(() =>
      assertSyntheticPatientBackfillAllowed({ ...guard, nodeEnv: 'production' }),
    ).toThrow('PATIENT_BACKFILL_SYNTHETIC_MODE_REQUIRED');
    expect(() =>
      assertSyntheticPatientBackfillAllowed({
        ...guard,
        databaseUrl: 'postgresql://localhost/production',
      }),
    ).toThrow('PATIENT_BACKFILL_TEST_DATABASE_REQUIRED');
  });

  it('runs inventory as aggregate-only read-only SQL and creates no batch or event', async () => {
    const harness = createHarness([
      {
        id: 'auth-syn-1',
        source_data: { TIPO_IDENTIFICACION: 'CC', NUM_DOCUMENTO: 'DOC-SYN-1' },
        patient_id: null,
      },
    ]);
    const report = await inspectPatientBackfillInventory(harness.database);
    expect(report.identityComplete).toBe(1);
    expect(report.eligibleForBackfill).toBe(0);
    expect(JSON.stringify(report)).not.toContain('DOC-SYN-1');
    expect(harness.state.batch).toBeNull();
    expect(harness.state.ledgers).toHaveLength(0);
    expect(harness.state.audits).toHaveLength(0);
  });

  it('serializes concurrent resumes on the durable batch row', async () => {
    const harness = createHarness([
      {
        id: 'auth-syn-1',
        source_data: {
          TIPO_IDENTIFICACION: 'CC',
          IDENTIFICACION_PACIENTE: 'DOC-SYN-1',
        },
        patient_id: null,
      },
    ]);
    const batchId = await createSyntheticPatientBackfillBatch(harness.database, guard, policy);
    const [first, second] = await Promise.all([
      processSyntheticPatientBackfillBatch(harness.database, guard, batchId, policy),
      processSyntheticPatientBackfillBatch(harness.database, guard, batchId, policy),
    ]);
    expect(first.processed + second.processed).toBe(1);
    expect(harness.state.patients).toHaveLength(1);
    expect(harness.state.ledgers).toHaveLength(1);
    expect(harness.state.authRows[0]?.patient_id).toBe(harness.state.patients[0]?.id);
  });

  it('creates and reuses one patient, resumes idempotently, audits links, and reverses only links from its batch', async () => {
    const source = {
      TIPO_IDENTIFICACION: 'CC',
      IDENTIFICACION_PACIENTE: 'DOC-SYN-1',
      CANTIDAD: '7',
    };
    const harness = createHarness([
      { id: 'auth-syn-1', source_data: source, patient_id: null },
      { id: 'auth-syn-2', source_data: { ...source }, patient_id: null },
    ]);
    const batchId = await createSyntheticPatientBackfillBatch(harness.database, guard, policy, 1);

    const first = await processSyntheticPatientBackfillBatch(
      harness.database,
      guard,
      batchId,
      policy,
    );
    expect(first).toMatchObject({ processed: 1, remaining: true });
    const second = await processSyntheticPatientBackfillBatch(
      harness.database,
      guard,
      batchId,
      policy,
    );
    expect(second).toMatchObject({ processed: 1, remaining: true });
    const finish = await processSyntheticPatientBackfillBatch(
      harness.database,
      guard,
      batchId,
      policy,
    );
    expect(finish).toMatchObject({ processed: 0, remaining: false });
    expect(harness.state.patients).toHaveLength(1);
    expect(harness.state.authRows.map((row) => row.patient_id)).toEqual([
      harness.state.patients[0]?.id,
      harness.state.patients[0]?.id,
    ]);
    expect(harness.state.authRows.map((row) => row.source_data)).toEqual([source, source]);
    expect(harness.state.ledgers.map((item) => item.status)).toEqual(['LINKED', 'LINKED']);
    expect(harness.state.audits).toHaveLength(2);
    expect(JSON.stringify(harness.state.audits)).not.toContain('DOC-SYN-1');

    await expect(
      revertSyntheticPatientBackfillBatch(harness.database, guard, batchId),
    ).resolves.toEqual({ reverted: 2, conflicts: 0 });
    expect(harness.state.authRows.map((row) => row.patient_id)).toEqual([null, null]);
    expect(harness.state.patients).toHaveLength(1);
    expect(harness.state.ledgers.map((item) => item.status)).toEqual(['REVERTED', 'REVERTED']);
    expect(harness.state.audits).toHaveLength(4);
  });

  it('keeps ambiguous rows pending and preserves pre-existing links with identity discrepancies', async () => {
    const harness = createHarness([
      { id: 'auth-incomplete', source_data: { TIPO_IDENTIFICACION: 'CC' }, patient_id: null },
      {
        id: 'auth-linked',
        source_data: {
          TIPO_IDENTIFICACION: 'CC',
          IDENTIFICACION_PACIENTE: 'DOC-SYN-1',
        },
        patient_id: 'patient-existing',
      },
    ]);
    harness.state.patients.push({
      id: 'patient-existing',
      identification_type_raw: 'CE',
      identification_value_raw: 'DOC-SYN-1',
    });
    const batchId = await createSyntheticPatientBackfillBatch(harness.database, guard, policy);
    await processSyntheticPatientBackfillBatch(harness.database, guard, batchId, policy);
    expect(harness.state.ledgers.map((item) => item.reason_code).sort()).toEqual([
      'IDENTITY_INCOMPLETE',
      'LINKED_IDENTITY_DISCREPANCY',
    ]);
    expect(harness.state.authRows[0]?.patient_id).toBeNull();
    expect(harness.state.authRows[1]?.patient_id).toBe('patient-existing');
    expect(harness.state.patients).toHaveLength(1);
  });

  it('does not choose between multiple existing local patients with the same raw composite', async () => {
    const harness = createHarness([
      {
        id: 'auth-duplicate-candidates',
        source_data: {
          TIPO_IDENTIFICACION: 'CC',
          IDENTIFICACION_PACIENTE: 'DOC-SYN-1',
        },
        patient_id: null,
      },
    ]);
    harness.state.patients.push(
      {
        id: 'patient-duplicate-1',
        identification_type_raw: 'CC',
        identification_value_raw: 'DOC-SYN-1',
      },
      {
        id: 'patient-duplicate-2',
        identification_type_raw: 'CC',
        identification_value_raw: 'DOC-SYN-1',
      },
    );
    const batchId = await createSyntheticPatientBackfillBatch(harness.database, guard, policy);
    await processSyntheticPatientBackfillBatch(harness.database, guard, batchId, policy);

    expect(harness.state.authRows[0]?.patient_id).toBeNull();
    expect(harness.state.patients).toHaveLength(2);
    expect(harness.state.ledgers[0]).toMatchObject({
      status: 'CONFLICT',
      reason_code: 'MULTIPLE_LOCAL_PATIENT_MATCHES',
    });
    expect(harness.state.audits).toHaveLength(0);
  });

  it('rolls back the failed page, records no partial link, and can resume', async () => {
    const harness = createHarness([
      {
        id: 'auth-syn-1',
        source_data: {
          TIPO_IDENTIFICACION: 'CC',
          IDENTIFICACION_PACIENTE: 'DOC-SYN-1',
        },
        patient_id: null,
      },
    ]);
    const batchId = await createSyntheticPatientBackfillBatch(harness.database, guard, policy);
    harness.failNextLink();
    await expect(
      processSyntheticPatientBackfillBatch(harness.database, guard, batchId, policy),
    ).rejects.toThrow('PATIENT_BACKFILL_BATCH_FAILED');
    expect(harness.state.authRows[0]?.patient_id).toBeNull();
    expect(harness.state.patients).toHaveLength(0);
    expect(harness.state.ledgers).toHaveLength(0);
    await expect(
      processSyntheticPatientBackfillBatch(harness.database, guard, batchId, policy),
    ).resolves.toMatchObject({ processed: 1, remaining: false });
    expect(harness.state.authRows[0]?.patient_id).not.toBeNull();
  });

  it('does not reverse a link changed after the batch and never deletes patients', async () => {
    const harness = createHarness([
      {
        id: 'auth-syn-1',
        source_data: {
          TIPO_IDENTIFICACION: 'CC',
          IDENTIFICACION_PACIENTE: 'DOC-SYN-1',
        },
        patient_id: null,
      },
    ]);
    const batchId = await createSyntheticPatientBackfillBatch(harness.database, guard, policy);
    await processSyntheticPatientBackfillBatch(harness.database, guard, batchId, policy);
    harness.state.patients.push({
      id: 'patient-reassigned-synthetic',
      identification_type_raw: 'CC',
      identification_value_raw: 'DOC-SYN-OTHER',
    });
    harness.state.authRows[0]!.patient_id = 'patient-reassigned-synthetic';
    await expect(
      revertSyntheticPatientBackfillBatch(harness.database, guard, batchId),
    ).resolves.toEqual({ reverted: 0, conflicts: 1 });
    expect(harness.state.authRows[0]?.patient_id).toBe('patient-reassigned-synthetic');
    expect(harness.state.patients).toHaveLength(2);
    expect(harness.state.ledgers[0]?.status).toBe('REVERT_CONFLICT');
  });
});
