import { describe, expect, it, vi } from 'vitest';
import type { createDatabase } from '@authorization/database';
import { PatientMasterRepository } from './patient-master.repository';
import type { PatientMasterScope } from './patient-master.access-policy';

function makeRepository(rows: unknown[] = []) {
  const query = vi.fn().mockResolvedValue({ rows });
  const database = { pool: { query } } as unknown as ReturnType<typeof createDatabase>;
  return { repository: new PatientMasterRepository(database), query };
}

const mtdScope: PatientMasterScope = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  organizationCode: 'MTD',
  userId: '00000000-0000-4000-8000-000000000002',
  pointAccessKind: 'global',
  accessiblePointIds: [],
  dispensingPointId: null,
};

describe('PatientMasterRepository', () => {
  it('uses parameterized raw identity search and returns a minimized DTO', async () => {
    const { repository, query } = makeRepository([
      {
        patient_id: '00000000-0000-4000-8000-000000000010',
        mtdom_lookup_status: 'NOT_REQUESTED',
        mtdom_last_checked_at: null,
        mtdom_last_error_code: null,
        mtdom_changes_seen_at: null,
        patient_updated_at: '2026-01-01T00:00:00.000Z',
        linked_authorization_count: 1,
        historical_candidate_authorization_count: 0,
        total: 1,
      },
    ]);

    const result = await repository.search(mtdScope, {
      identificationType: 'CC',
      identificationValue: 'SYNTHETIC-001',
      page: 1,
      limit: 25,
    });

    expect(query).toHaveBeenCalledOnce();
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('aio.organization_id = $1::uuid');
    expect(sql).toContain('p.identification_type_raw = $2');
    expect(sql).toContain('p.identification_value_raw = $3');
    expect(sql).toContain('authorization_item_organizations');
    expect(values).toEqual([mtdScope.organizationId, 'CC', 'SYNTHETIC-001', 25, 0]);
    expect(result.items[0]).toEqual({
      id: '00000000-0000-4000-8000-000000000010',
      identityStatus: 'LOCAL_KEY_RECORDED',
      mtdomLookupStatus: 'NOT_REQUESTED',
      mtdomLastCheckedAt: null,
      mtdomLastErrorCode: null,
      mtdomChangesSeenAt: null,
      linkedAuthorizationCount: 1,
      historicalCandidateAuthorizationCount: 0,
    });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC-001');
  });

  it('does not expose an out-of-scope or absent patient detail', async () => {
    const { repository } = makeRepository([]);
    await expect(
      repository.detail(mtdScope, '00000000-0000-4000-8000-000000000099'),
    ).resolves.toBeNull();
  });

  it('checks exact identity against MEDICARTE authorization evidence and point grants before live lookup', async () => {
    const { repository, query } = makeRepository([{ visible: true }]);
    await expect(
      repository.isAuthorizedLiveLookup(
        {
          ...mtdScope,
          pointAccessKind: 'explicit',
          accessiblePointIds: ['00000000-0000-4000-8000-000000000003'],
        },
        {
          identificationType: 'CC',
          identificationValue: '000123',
        },
      ),
    ).resolves.toBe(true);
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("org.code = 'MEDICARTE'");
    expect(sql).toContain("ai.source_data->>'TIPO_IDENTIFICACION' = $1");
    expect(values).toEqual(['CC', '000123', ['00000000-0000-4000-8000-000000000003']]);

    const explicitScope = {
      ...mtdScope,
      pointAccessKind: 'explicit' as const,
      accessiblePointIds: ['00000000-0000-4000-8000-000000000003'],
      dispensingPointId: '00000000-0000-4000-8000-000000000003',
    };
    await repository.isAuthorizedLiveLookup(explicitScope, {
      identificationType: 'CC',
      identificationValue: '000123',
    });
    const [scopedSql, scopedValues] = query.mock.calls[1] as unknown as [string, unknown[]];
    expect(scopedSql).toContain('ps.dispensing_point_id = ANY($3::uuid[])');
    expect(scopedSql).toContain('ps.dispensing_point_id = $4::uuid');
    expect(scopedValues).toEqual([
      'CC',
      '000123',
      explicitScope.accessiblePointIds,
      explicitScope.dispensingPointId,
    ]);
  });

  it('keeps reconciliation evidence read-only and projects no identity fields', async () => {
    const { repository, query } = makeRepository([]);
    await expect(repository.reconciliationCases(mtdScope, 12)).resolves.toEqual([]);
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain(
      "pbi.status IN ('NEEDS_RECONCILIATION', 'CONFLICT', 'RESOLVED', 'REVERT_CONFLICT')",
    );
    expect(sql).toContain('pbb.organization_id = $1::uuid');
    expect(sql).toContain('aio.organization_id = $1::uuid');
    expect(sql).not.toMatch(/identification_value|document|source_data/i);
    expect(values).toEqual([mtdScope.organizationId, 12]);
  });

  it('restricts explicit-point searches even when no point is requested', async () => {
    const scope = {
      ...mtdScope,
      pointAccessKind: 'explicit' as const,
      accessiblePointIds: ['00000000-0000-4000-8000-000000000003'],
    };
    const { repository, query } = makeRepository([]);
    await repository.search(scope, { page: 1, limit: 10 });
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('ps.dispensing_point_id = ANY($2::uuid[])');
    expect(values).toEqual([scope.organizationId, scope.accessiblePointIds, 10, 0]);
  });
});
