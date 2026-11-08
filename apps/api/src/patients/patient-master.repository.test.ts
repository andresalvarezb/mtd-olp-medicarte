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
  dispensingPointId: null,
};

const medicarteScope: PatientMasterScope = {
  organizationId: '00000000-0000-4000-8000-000000000003',
  organizationCode: 'MEDICARTE',
  userId: '00000000-0000-4000-8000-000000000004',
  pointAccessKind: 'explicit',
  dispensingPointId: '00000000-0000-4000-8000-000000000005',
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

  it('constrains MEDICARTE reads to organization, granted point and active user scope', async () => {
    const { repository, query } = makeRepository([]);
    await repository.search(medicarteScope, { page: 1, limit: 10 });
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('aio.organization_id = $1::uuid');
    expect(sql).toContain('dp.id = $2::uuid');
    expect(sql).toContain('ups.user_id = $3::uuid');
    expect(sql).toContain('ups.revoked_at IS NULL');
    expect(values).toEqual([
      medicarteScope.organizationId,
      medicarteScope.dispensingPointId,
      medicarteScope.userId,
      10,
      0,
    ]);
  });

  it('does not expose an out-of-scope or absent patient detail', async () => {
    const { repository } = makeRepository([]);
    await expect(
      repository.detail(medicarteScope, '00000000-0000-4000-8000-000000000099'),
    ).resolves.toBeNull();
  });

  it('keeps reconciliation evidence read-only and projects no identity fields', async () => {
    const { repository, query } = makeRepository([]);
    await expect(repository.reconciliationCases(12)).resolves.toEqual([]);
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain(
      "pbi.status IN ('NEEDS_RECONCILIATION', 'CONFLICT', 'RESOLVED', 'REVERT_CONFLICT')",
    );
    expect(sql).not.toMatch(/identification_value|document|source_data/i);
    expect(values).toEqual([12]);
  });
});
