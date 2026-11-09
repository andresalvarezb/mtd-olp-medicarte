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
  const database = {
    db: { execute },
    pool: { totalCount: 0, idleCount: 0, waitingCount: 0, options: { max: 4 } },
  } as unknown as Database;
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
    execute.mockResolvedValueOnce({ rows: [{ id: null, total_count: 0 }] });

    await repository.list({ page: 1, limit: 50 }, scope);

    expect(execute).toHaveBeenCalledTimes(1);
    const pageQuery = queryText(execute.mock.calls[0]?.[0]);

    expect(pageQuery).toContain('matching_authorizations as materialized');
    expect(pageQuery).toContain('query_total as materialized');
    expect(pageQuery).toContain('assignment_date_key');
    expect(pageQuery).toContain('validity_end_date_key');
    expect(pageQuery).toContain('join matching_authorizations matched');
    expect(pageQuery).toContain('i.mipres_manual_decision');
    expect(pageQuery).toContain('coverage_type');
    expect(pageQuery).toContain('authorization_fulfillments');
    expect(pageQuery).toContain('authorization_item_id');
    expect(pageQuery).toContain('inventory_authorization_allocations');
    expect(pageQuery).toContain('dispensing_points');
    expect(pageQuery).toContain('user_point_scopes');
    expect(pageQuery).toContain("'PARTIALLY_CONSUMED'");
    expect(pageQuery).toContain('> 0');
    expect(pageQuery).toContain('sort_closed asc');
    expect(pageQuery).toContain('sort_validation asc');
    expect(pageQuery).toContain('sort_validity asc');
    expect(pageQuery).toContain('sort_operational asc');
    expect(pageQuery).toContain('limit $');
    expect(pageQuery).toContain('offset $');
  });

  it('keeps source date keys out of the repeated SQL parameter list', async () => {
    const { repository, execute } = fixture();
    execute.mockResolvedValueOnce({ rows: [{ id: null, total_count: 0 }] });

    await repository.list({ page: 1, limit: 10 }, scope);

    const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0] as never);
    expect(compiled.sql).toMatch(/->>\s*'FECHA_ASIGNACION'/);
    expect(compiled.sql).toMatch(/->>\s*'FECHA_FINAL_VIGENCIA'/);
    expect(compiled.params).not.toContain('FECHA_ASIGNACION');
    expect(compiled.params).not.toContain('FECHA_FINAL_VIGENCIA');
    expect(compiled.params.length).toBeLessThan(100);
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
    mtd.execute.mockResolvedValueOnce({ rows: [{ id: null, total_count: 0 }] });
    await mtd.repository.list(
      { page: 1, limit: 50 },
      { ...scope, organizationCode: 'MTD', pointAccessKind: 'unrestricted' },
    );
    const mtdQuery = queryText(mtd.execute.mock.calls[0]?.[0]);
    expect(mtdQuery).not.toContain('authorization_item_organizations');
    expect(mtdQuery).not.toContain('user_point_scopes');

    const compensar = fixture();
    compensar.execute.mockResolvedValueOnce({ rows: [{ id: null, total_count: 0 }] });
    await compensar.repository.list(
      { page: 1, limit: 50 },
      { ...scope, organizationCode: 'COMPENSAR', pointAccessKind: 'unrestricted' },
    );
    const compensarQuery = queryText(compensar.execute.mock.calls[0]?.[0]);
    expect(compensarQuery).toContain('authorization_item_organizations');
    expect(compensarQuery).not.toContain('user_point_scopes');
  });

  it('keeps patient search inside the shared filtered set', async () => {
    const { repository, execute } = fixture();
    execute.mockResolvedValueOnce({ rows: [{ id: null, total_count: 0 }] });

    await repository.list(
      { page: 2, limit: 10, patient: 'SYNTHETIC-001' },
      { ...scope, readSensitive: true },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const query = queryText(execute.mock.calls[0]?.[0]);
    expect(query).toContain("'IDENTIFICACION_PACIENTE'");
    expect(query).toContain("'NUM_DOCUMENTO'");
    expect(query).toContain("'NOMBRE_PACIENTE'");
    expect(query).toContain('SYNTHETIC-001');
    expect(query).toContain('limit $');
    expect(query).toContain('offset $');
    expect(query).toContain('user_point_scopes');
  });
});
