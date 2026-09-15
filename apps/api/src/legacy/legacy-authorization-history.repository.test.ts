import { describe, expect, it, vi } from 'vitest';
import type { createDatabase } from '@authorization/database';
import { LegacyAuthorizationHistoryRepository } from './legacy-authorization-history.repository';

type Database = ReturnType<typeof createDatabase>;

describe('legacy authorization history repository', () => {
  it('reads historical operational columns without creating modern lineage', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
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
      ],
    });
    const repository = new LegacyAuthorizationHistoryRepository({
      pool: { query },
    } as unknown as Database);
    const history = await repository.findById('10000000-0000-4000-8000-000000000001');
    expect(history?.ordenCompra).toBe('OC-LEGACY-1');
    expect(history?.fechaProgramada).toBe('2026-09-01');
    expect(query.mock.calls[0]?.[0]).toContain('orden_compra');
  });
});
