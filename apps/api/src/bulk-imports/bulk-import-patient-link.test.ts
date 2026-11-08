import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PatientIdentityNormalizationPolicy } from '@authorization/domain';
import { BulkImportRepository, type BulkImportTransaction } from './bulk-import.repository';

type SyntheticPolicy = PatientIdentityNormalizationPolicy &
  Readonly<{
    version: `SYNTHETIC_EXACT_TEST_${string}`;
  }>;

const exactSyntheticPolicy: SyntheticPolicy = {
  version: 'SYNTHETIC_EXACT_TEST_V1',
  normalizeDocumentType: (value) => value,
  normalizeDocumentValue: (value) => value,
};

const patientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const authorizationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const correlationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const organizationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const actor = { correlationId, organizationId } as never;
const sourceData = {
  TIPO_IDENTIFICACION: 'CC',
  IDENTIFICACION_PACIENTE: '000123',
  NUM_DOCUMENTO: '000123',
};

function createHarness(
  existingPatients: readonly { id: string }[] = [],
  policy: SyntheticPolicy = exactSyntheticPolicy,
) {
  const dialect = new PgDialect();
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  const tx = {
    execute: (statement: Parameters<typeof dialect.sqlToQuery>[0]) => {
      const query = dialect.sqlToQuery(statement);
      executed.push({ sql: query.sql, params: query.params });
      if (query.sql.includes('from patients'))
        return Promise.resolve({ rows: [...existingPatients] });
      if (query.sql.includes('insert into patients'))
        return Promise.resolve({ rows: [{ id: patientId }] });
      if (query.sql.includes('update authorization_items'))
        return Promise.resolve({ rows: [{ patient_id: patientId }] });
      return Promise.resolve({ rows: [] });
    },
  };
  const repository = new BulkImportRepository({} as never, policy);
  const link = (input: Readonly<Record<string, unknown>>) =>
    (
      repository as unknown as {
        linkPatientForSyntheticIdentityInTx(
          transaction: BulkImportTransaction,
          authorizationItemId: string,
          payload: Readonly<Record<string, unknown>>,
        ): Promise<string | null>;
      }
    ).linkPatientForSyntheticIdentityInTx(
      tx as unknown as BulkImportTransaction,
      authorizationId,
      input,
    );
  return { executed, link };
}

describe('bulk authorization patient link (synthetic policy only)', () => {
  it('keeps identity linking disabled when no policy is injected', async () => {
    const repository = new BulkImportRepository({} as never);
    const executeCalls: unknown[] = [];
    const tx = {
      execute: (statement: unknown) => {
        executeCalls.push(statement);
        return Promise.resolve({ rows: [] });
      },
    };
    await (
      repository as unknown as {
        linkPatientForSyntheticIdentityInTx(
          transaction: BulkImportTransaction,
          authorizationItemId: string,
          payload: Readonly<Record<string, unknown>>,
        ): Promise<string | null>;
      }
    ).linkPatientForSyntheticIdentityInTx(
      tx as unknown as BulkImportTransaction,
      authorizationId,
      sourceData,
    );
    expect(executeCalls).toEqual([]);
  });

  it('keeps the synthetic matcher disabled outside the test runtime even if injected', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { executed, link } = createHarness();
      await link(sourceData);
      expect(executed).toEqual([]);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('creates and links one patient under an exact composite identity in the row transaction', async () => {
    const { executed, link } = createHarness();
    await expect(link(sourceData)).resolves.toBe(patientId);
    expect(executed[0]?.sql.trim()).toBe('select pg_advisory_xact_lock($1::bigint)');
    expect(executed[1]?.sql).toContain('from patients');
    expect(executed[2]?.sql).toContain('insert into patients');
    expect(executed[3]?.sql).toContain('update authorization_items');
    expect(executed[1]?.params).toEqual(['CC', '000123']);
    expect(executed[2]?.params).toEqual(['CC', '000123']);
    expect(executed[3]?.params).toEqual([patientId, authorizationId]);
  });

  it('reuses one exact patient and does not create a duplicate', async () => {
    const { executed, link } = createHarness([{ id: patientId }]);
    await link(sourceData);
    expect(executed.some((item) => item.sql.includes('insert into patients'))).toBe(false);
    expect(executed.at(-1)?.params).toEqual([patientId, authorizationId]);
  });

  it('leaves ambiguous existing duplicates unlinked', async () => {
    const { executed, link } = createHarness([
      { id: patientId },
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    ]);
    await link(sourceData);
    expect(executed.some((item) => item.sql.includes('insert into patients'))).toBe(false);
    expect(executed.some((item) => item.sql.includes('update authorization_items'))).toBe(false);
  });

  it.each([
    { TIPO_IDENTIFICACION: 'CC', IDENTIFICACION_PACIENTE: 123 },
    { TIPO_IDENTIFICACION: 'CC', IDENTIFICACION_PACIENTE: '000123', NUM_DOCUMENTO: '123' },
    { TIPO_IDENTIFICACION: ' cc ', IDENTIFICACION_PACIENTE: '000123' },
  ])('does not create or link an identity requiring review', async (payload) => {
    const { executed, link } = createHarness([], {
      version: 'SYNTHETIC_EXACT_TEST_TRIM_POLICY',
      normalizeDocumentType: (value) => (value === value.trim() ? value : value.trim()),
      normalizeDocumentValue: (value) => value,
    });
    await link(payload);
    expect(executed).toEqual([]);
  });

  it('keeps document type in the exact composite lookup', async () => {
    const { executed, link } = createHarness();
    await link({ ...sourceData, TIPO_IDENTIFICACION: 'CE' });
    expect(executed[1]?.params).toEqual(['CE', '000123']);
  });

  it('inserts only a minimal idempotent patient event in the row transaction', async () => {
    const dialect = new PgDialect();
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    const tx = {
      execute: (statement: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const query = dialect.sqlToQuery(statement);
        captured.push({ sql: query.sql, params: query.params });
        return Promise.resolve({ rows: [] });
      },
    };
    const repository = new BulkImportRepository({} as never, exactSyntheticPolicy);
    await (
      repository as unknown as {
        enqueuePatientLookupInTx(
          transaction: BulkImportTransaction,
          input: { patientId: string; actor: typeof actor },
        ): Promise<void>;
      }
    ).enqueuePatientLookupInTx(tx as unknown as BulkImportTransaction, { patientId, actor });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.sql).toContain('insert into outbox_events');
    expect(captured[0]?.sql).toContain('on conflict (idempotency_key) do nothing');
    expect(captured[0]?.params).toEqual([
      'patient.lookup',
      JSON.stringify({ patientId }),
      correlationId,
      organizationId,
      `patient.lookup.v1:${patientId}`,
    ]);
    expect(JSON.stringify(captured[0]?.params)).not.toContain('000123');
  });

  it('serializes concurrent synthetic confirmations through the transaction lock', async () => {
    const dialect = new PgDialect();
    const patients: Array<{ id: string; type: string; value: string }> = [];
    const links: string[] = [];
    const waiters: Array<() => void> = [];
    let locked = false;
    let created = 0;
    const repository = new BulkImportRepository({} as never, exactSyntheticPolicy);

    const runOne = async (rowId: string) => {
      const tx = {
        execute: async (statement: Parameters<typeof dialect.sqlToQuery>[0]) => {
          const query = dialect.sqlToQuery(statement);
          if (query.sql.includes('pg_advisory_xact_lock')) {
            if (locked) await new Promise<void>((resolve) => waiters.push(resolve));
            locked = true;
            return { rows: [] };
          }
          if (query.sql.includes('from patients')) {
            const [type, value] = query.params as [string, string];
            return {
              rows: patients
                .filter((patient) => patient.type === type && patient.value === value)
                .slice(0, 2),
            };
          }
          if (query.sql.includes('insert into patients')) {
            const [type, value] = query.params as [string, string];
            const id = `synthetic-patient-${++created}`;
            patients.push({ id, type, value });
            return { rows: [{ id }] };
          }
          if (query.sql.includes('update authorization_items')) {
            links.push(rowId);
          }
          return { rows: [] };
        },
      };

      try {
        await (
          repository as unknown as {
            linkPatientForSyntheticIdentityInTx(
              transaction: BulkImportTransaction,
              authorizationItemId: string,
              payload: Readonly<Record<string, unknown>>,
            ): Promise<string | null>;
          }
        ).linkPatientForSyntheticIdentityInTx(
          tx as unknown as BulkImportTransaction,
          rowId,
          sourceData,
        );
      } finally {
        const next = waiters.shift();
        if (next) next();
        else locked = false;
      }
    };

    await Promise.all([runOne('row-a'), runOne('row-b')]);
    expect(patients).toHaveLength(1);
    expect(links.sort()).toEqual(['row-a', 'row-b']);
  });

  it('propagates a patient-write failure before marking the claimed row successful', async () => {
    const dialect = new PgDialect();
    const executed: string[] = [];
    let committed = false;
    let rolledBack = false;
    const tx = {
      execute: (statement: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const query = dialect.sqlToQuery(statement);
        executed.push(query.sql);
        if (query.sql.includes('insert into patients'))
          throw new Error('synthetic patient insert failure');
        if (query.sql.includes('from bulk_import_rows'))
          return Promise.resolve({ rows: [{ id: 'row' }] });
        return Promise.resolve({ rows: [] });
      },
    };
    const repository = new BulkImportRepository(
      {
        db: {
          transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => {
            try {
              const result = await callback(tx);
              committed = true;
              return result;
            } catch (error) {
              rolledBack = true;
              throw error;
            }
          },
        },
      } as never,
      exactSyntheticPolicy,
    );

    await expect(
      repository.executeClaimedRow({
        rowId: 'row',
        attemptNumber: 1,
        claimToken: 'claim',
        claimGeneration: 1,
        execute: async (transaction) => {
          await (
            repository as unknown as {
              linkPatientForSyntheticIdentityInTx(
                current: BulkImportTransaction,
                authorizationItemId: string,
                payload: Readonly<Record<string, unknown>>,
              ): Promise<string | null>;
            }
          ).linkPatientForSyntheticIdentityInTx(transaction, authorizationId, sourceData);
          return { id: authorizationId };
        },
      }),
    ).rejects.toThrow('synthetic patient insert failure');

    expect(committed).toBe(false);
    expect(rolledBack).toBe(true);
    expect(
      executed.some((statement) => statement.includes("set execution_status = 'SUCCEEDED'")),
    ).toBe(false);
  });
});
