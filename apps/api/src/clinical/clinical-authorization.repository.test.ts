import { describe, expect, it, vi } from 'vitest';
import type { createDatabase } from '@authorization/database';
import {
  ClinicalAuthorizationRepository,
  LegacyAuthorizationHistoryRepository,
} from './clinical-authorization.repository';

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

describe('clinical authorization repositories', () => {
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
  });

  it('keeps the legacy projection behind a separate read-only repository', async () => {
    const fixture = databaseWithRows([
      {
        id: '10000000-0000-4000-8000-000000000001',
        numero_autorizacion: 'AUTH-1',
        codigo_medicamento: 'COD001',
        lugar_dispensacion: 'Sede histórica',
        fecha_programada: '2026-09-01',
        fecha_dispensacion: null,
        fecha_aplicacion: null,
        cod_autorizacion_medicarte: null,
        orden_compra: 'OC-LEGACY-1',
        process_status: 'PENDIENTE_ORDEN_COMPRA',
        operation_status: null,
        operational_version: 1,
        updated_at: new Date('2026-09-13T12:00:00.000Z'),
      },
    ]);
    const repository = new LegacyAuthorizationHistoryRepository(fixture.database);
    const history = await repository.findById('10000000-0000-4000-8000-000000000001');

    expect(history?.ordenCompra).toBe('OC-LEGACY-1');
    expect(history?.fechaProgramada).toBe('2026-09-01');
    expect(fixture.query.mock.calls[0]?.[0]).toContain('orden_compra');
  });
});
