import { describe, expect, it, vi } from 'vitest';
import type { createDatabase } from '@authorization/database';
import { ClinicalAuthorizationRepository } from './clinical-authorization.repository';

type Database = ReturnType<typeof createDatabase>;

function databaseWithRows(rows: unknown[]): {
  database: Database;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn().mockResolvedValue({ rows });
  return {
    database: { pool: { query } } as unknown as Database,
    query,
  };
}

describe('clinical authorization repository', () => {
  it('does not include legacy operational columns in clinical reads', async () => {
    const fixture = databaseWithRows([
      {
        id: '10000000-0000-4000-8000-000000000001',
        numero_autorizacion: 'AUTH-1',
        codigo_medicamento: 'COD001',
        authorization_key: 'AUTH-1:COD001',
        source_status_normalized: 'VIGENTE',
        coverage_type: 'PBS',
        direction_status: 'NOT_APPLICABLE',
        created_at: new Date('2026-09-13T12:00:00.000Z'),
        updated_at: new Date('2026-09-13T12:00:00.000Z'),
      },
    ]);
    const repository = new ClinicalAuthorizationRepository(fixture.database);

    await repository.findById('10000000-0000-4000-8000-000000000001');

    const query = fixture.query.mock.calls[0]?.[0] as string;
    expect(query).not.toContain('orden_compra');
    expect(query).not.toContain('fecha_aplicacion');
    expect(query).not.toContain('lugar_dispensacion');
    expect(query).not.toContain('audit_status');
  });
});
