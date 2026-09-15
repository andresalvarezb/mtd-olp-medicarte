import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  EXECUTABLE_RECONCILIATION_RULES,
  RECONCILIATION_RULES,
  reconciliationFindingFingerprint,
} from '@authorization/domain';
import { ReconciliationEngine } from './reconciliation.engine';
import type { ReconciliationRepository } from './reconciliation.repository';
import { RECONCILIATION_RULE_IMPLEMENTATIONS } from './reconciliation.rules';
import { RECONCILIATION_RULE_IMPLEMENTATIONS_REST } from './reconciliation.rules-rest';
import {
  bindSnapshotQuery,
  classifyRuleStatus,
  phiSafeEvidence,
  resolveRunScope,
  type RuleContext,
} from './reconciliation.types';

describe('ESP-017 reconciliation engine helpers', () => {
  it('implements every executable registry rule', () => {
    const implemented = new Set(
      [...RECONCILIATION_RULE_IMPLEMENTATIONS, ...RECONCILIATION_RULE_IMPLEMENTATIONS_REST].map(
        (rule) => rule.definition.ruleCode,
      ),
    );
    for (const rule of EXECUTABLE_RECONCILIATION_RULES) {
      expect(implemented.has(rule.ruleCode), rule.ruleCode).toBe(true);
    }
  });

  it('classifies applicability without a fake PASS on empty populations', () => {
    expect(classifyRuleStatus({ evaluatedCount: 0, findings: [], totalDetected: 0 })).toBe(
      'NOT_APPLICABLE',
    );
    expect(classifyRuleStatus({ evaluatedCount: 4, findings: [], totalDetected: 0 })).toBe('PASS');
    expect(
      classifyRuleStatus({
        evaluatedCount: 4,
        findings: [
          {
            entityType: 'patient_application_line',
            entityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            relatedEntityType: null,
            relatedEntityId: null,
            dispensingPointId: null,
            planningPeriodId: null,
            commercialCode: null,
            message: 'missing movement',
            evidence: { expectedMovementCount: 1, actualMovementCount: 0 },
          },
        ],
        totalDetected: 1,
      }),
    ).toBe('FAIL');
  });

  it('resolves combined scopes without changing rules', () => {
    expect(resolveRunScope({})).toMatchObject({ kind: 'GLOBAL', planningPeriodId: null });
    expect(
      resolveRunScope({
        planningPeriodId: '10000000-0000-4000-8000-000000000011',
        dispensingPointId: '10000000-0000-4000-8000-000000000012',
      }).kind,
    ).toBe('COMBINED');
  });

  it('strips PHI-like keys from evidence and keeps technical IDs', () => {
    expect(
      phiSafeEvidence({
        applicationLineId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        patientApplicationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        nombrePaciente: 'Juan Perez',
        documento: '123',
        expectedMovementCount: 1,
      }),
    ).toEqual({
      applicationLineId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      patientApplicationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      expectedMovementCount: 1,
    });
    expect(
      reconciliationFindingFingerprint({
        ruleCode: 'REC-APP-003',
        entityType: 'patient_application_line',
        entityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    ).not.toMatch(/Juan|documento/i);
  });
});

type CompletedRun = {
  status: 'COMPLETED' | 'FAILED';
  passedRules: number;
  metadata: { technicalFailure: string | null; ruleResults: Array<{ status: string }> };
};

function memoryRepository() {
  const completed: CompletedRun[] = [];
  const repository = {
    createRun() {
      return Promise.resolve('00000000-0000-4000-8000-000000000017');
    },
    markRunning() {
      return Promise.resolve();
    },
    insertFindings() {
      return Promise.resolve();
    },
    completeRun(_id: string, input: CompletedRun) {
      completed.push(input);
      return Promise.resolve();
    },
  };
  return { repository: repository as unknown as ReconciliationRepository, completed };
}

function fakePool(options?: {
  abortAfterFirstRule?: { current: boolean };
  timeoutSql?: RegExp;
}): Pool {
  const reader = {
    query(text: string) {
      if (options?.abortAfterFirstRule?.current && !/^(BEGIN|SET LOCAL|ROLLBACK)/.test(text)) {
        return Promise.reject(
          new Error(
            'current transaction is aborted, commands ignored until end of transaction block',
          ),
        );
      }
      if (options?.timeoutSql?.test(text)) {
        return Promise.reject(new Error('canceling statement due to statement timeout'));
      }
      if (text.includes('pg_current_snapshot')) {
        return Promise.resolve({ rows: [{ postgres_snapshot: '10:10:' }] });
      }
      if (text.includes('from organizations')) {
        return Promise.resolve({ rows: [{ code: 'MTD' }] });
      }
      return Promise.resolve({ rows: [{ n: 0 }] });
    },
    release() {
      /* pool */
    },
  };
  return {
    connect() {
      return Promise.resolve(reader);
    },
    query() {
      return Promise.resolve({ rows: [] });
    },
  } as unknown as Pool;
}

describe('ESP-017 run-level snapshot', () => {
  it('binds operational reads to one snapshot gate', async () => {
    const gate = { closed: false };
    const query = bindSnapshotQuery(
      {
        query: <T extends Record<string, unknown>>() =>
          Promise.resolve({ rows: [{ n: 1 }] as unknown as T[] }),
      },
      gate,
    );
    await expect(query('select 1')).resolves.toEqual({ rows: [{ n: 1 }] });
    gate.closed = true;
    await expect(query('select 1')).rejects.toThrow('SNAPSHOT_CLOSED');
  });

  it('gives every selected rule the same snapshot context object', async () => {
    const { repository } = memoryRepository();
    const engine = new ReconciliationEngine(fakePool(), repository);
    const contexts: RuleContext[] = [];
    const snapshotIds: string[] = [];
    await engine.execute({
      tenantId: '10000000-0000-4000-8000-000000000001',
      startedBy: null,
      snapshotHooks: {
        afterRule: ({ context, snapshot }) => {
          contexts.push(context);
          snapshotIds.push(snapshot.id);
          return Promise.resolve();
        },
      },
    });
    expect(contexts).toHaveLength(RECONCILIATION_RULES.length);
    expect(new Set(snapshotIds).size).toBe(1);
    expect(contexts.every((item) => item === contexts[0])).toBe(true);
    expect(contexts[0]?.snapshot.isolation).toBe('REPEATABLE READ READ ONLY');
    expect(EXECUTABLE_RECONCILIATION_RULES.length).toBeGreaterThan(0);
  });

  it('does not complete PASS when a rule times out', async () => {
    const { repository, completed } = memoryRepository();
    const engine = new ReconciliationEngine(fakePool({ timeoutSql: /pg_sleep/ }), repository);
    await engine.execute({
      tenantId: '10000000-0000-4000-8000-000000000001',
      startedBy: null,
      domains: ['SCHEDULING'],
      snapshotHooks: {
        beforeRules: async (context) => {
          await context.query('select pg_sleep(1)');
        },
      },
    });
    expect(completed[0]?.status).toBe('FAILED');
    expect(completed[0]?.metadata.technicalFailure).toMatch(/statement timeout/i);
    expect(completed[0]?.metadata.ruleResults.every((item) => item.status !== 'PASS')).toBe(true);
  });

  it('marks the run FAILED when the reader transaction is aborted', async () => {
    const abortAfterFirstRule = { current: false };
    const { repository, completed } = memoryRepository();
    const engine = new ReconciliationEngine(fakePool({ abortAfterFirstRule }), repository);
    await engine.execute({
      tenantId: '10000000-0000-4000-8000-000000000001',
      startedBy: null,
      domains: ['SCHEDULING'],
      snapshotHooks: {
        afterRule: ({ index }) => {
          if (index === 0) abortAfterFirstRule.current = true;
          return Promise.resolve();
        },
      },
    });
    expect(completed[0]?.status).toBe('FAILED');
    expect(completed[0]?.metadata.technicalFailure).toMatch(/aborted/i);
    expect(
      completed[0]?.metadata.ruleResults.some((item) => item.status === 'ERROR_EXECUTING_RULE'),
    ).toBe(true);
  });
});
