import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { createDatabase } from '@authorization/database';
import type { Scope } from '../common/request-scope';
import { AuthorizationQueryRepository } from './authorization-query.repository';

type Database = ReturnType<typeof createDatabase>;

const scope: Scope = {
  organizationId: '10000000-0000-4000-8000-000000000004',
  organizationCode: 'MEDICARTE',
  userId: '20000000-0000-4000-8000-000000000001',
  correlationId: 'test-correlation',
  readSensitive: false,
  isFoundationAdmin: false,
  canCrossOrganizationOperationalExport: false,
  pointAccessKind: 'explicit',
};

function fixture() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const database = { db: { execute } } as unknown as Database;
  return {
    repository: new AuthorizationQueryRepository(database),
    execute,
  };
}

function queryText(query: unknown): string {
  const compiled = new PgDialect().sqlToQuery(query as never);
  return `${compiled.sql}\n${JSON.stringify(compiled.params)}`;
}

describe('authorization query MEDICARTE visibility', () => {
  it('applies the operational and point scope before counting or paging', async () => {
    const { repository, execute } = fixture();
    execute.mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await repository.list({ page: 1, limit: 50 }, scope);

    expect(execute).toHaveBeenCalledTimes(2);
    const countQuery = queryText(execute.mock.calls[0]?.[0]);
    const pageQuery = queryText(execute.mock.calls[1]?.[0]);

    for (const query of [countQuery, pageQuery]) {
      expect(query).toContain('i.mipres_manual_decision');
      expect(query).toContain('coverage_type');
      expect(query).toContain('authorization_fulfillments');
      expect(query).toContain('authorization_item_id');
      expect(query).toContain('inventory_authorization_allocations');
      expect(query).toContain('dispensing_points');
      expect(query).toContain('user_point_scopes');
      expect(query).toContain("'PARTIALLY_CONSUMED'");
      expect(query).toContain('> 0');
    }
  });

  it('uses the same visibility predicate for UUID detail lookup', async () => {
    const { repository, execute } = fixture();

    await repository.detail('30000000-0000-4000-8000-000000000001', scope);

    expect(execute).toHaveBeenCalledTimes(1);
    const detailQuery = queryText(execute.mock.calls[0]?.[0]);
    expect(detailQuery).toContain('user_point_scopes');
    expect(detailQuery).toContain('inventory_authorization_allocations');
    expect(detailQuery).toContain('i.mipres_manual_decision');
  });

  it('masks patient identity when sensitive-read permission is absent', () => {
    const { repository } = fixture();
    const toResponse = (
      repository as unknown as {
        toResponse: (row: Record<string, unknown>, scope: Scope) => Record<string, unknown>;
      }
    ).toResponse.bind(repository);

    const result = toResponse(
      {
        quantity: '10',
        created_at: '2026-11-09T00:00:00.000Z',
        updated_at: '2026-11-09T00:00:00.000Z',
        fulfilled_quantity: 4,
        remaining_authorized_quantity: 6,
        remaining_assigned_quantity: 3,
        authorized_quantity: 10,
        patient_document: 'SYNTHETIC-001',
        patient_name: 'SYNTHETIC PATIENT',
      },
      scope,
    );

    expect(result.patientDocument).toBeNull();
    expect(result.patientName).toBeNull();
    expect(result.dosage).toBeNull();
  });

  it('rejects patient searches without sensitive-read permission', async () => {
    const { repository, execute } = fixture();

    await expect(
      repository.list({ page: 1, limit: 50, patient: 'SYNTHETIC-001' }, scope),
    ).rejects.toMatchObject({
      response: { code: 'SENSITIVE_AUTHORIZATION_READ_REQUIRED' },
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps MTD and COMPENSAR list visibility policies distinct from MEDICARTE', async () => {
    const mtd = fixture();
    mtd.execute.mockResolvedValueOnce({ rows: [{ total: 0 }] });
    await mtd.repository.list(
      { page: 1, limit: 50 },
      { ...scope, organizationCode: 'MTD', pointAccessKind: 'unrestricted' },
    );
    const mtdCount = queryText(mtd.execute.mock.calls[0]?.[0]);
    expect(mtdCount).not.toContain('authorization_item_organizations');
    expect(mtdCount).not.toContain('user_point_scopes');

    const compensar = fixture();
    compensar.execute.mockResolvedValueOnce({ rows: [{ total: 0 }] });
    await compensar.repository.list(
      { page: 1, limit: 50 },
      { ...scope, organizationCode: 'COMPENSAR', pointAccessKind: 'unrestricted' },
    );
    const compensarCount = queryText(compensar.execute.mock.calls[0]?.[0]);
    expect(compensarCount).toContain('authorization_item_organizations');
    expect(compensarCount).not.toContain('user_point_scopes');
  });
});
