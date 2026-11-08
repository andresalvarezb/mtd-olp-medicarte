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

  it('keeps the scheduling projection identical for linked and unlinked historical authorizations', async () => {
    const sourceProjection = {
      id: '10000000-0000-4000-8000-000000000002',
      numero_autorizacion: 'AUTH-2',
      authorization_key: 'AUTH-2:COD002',
      codigo_medicamento: 'COD002',
      enablement_status: 'ENABLED',
      coverage_type: 'PBS',
      direction_status: 'NOT_APPLICABLE',
      mipres_manual_decision: 'PENDING_MANUAL_ENABLEMENT',
      patient_document: '0009001',
      patient_name: 'SYNTHETIC PATIENT',
      authorized_quantity: '4',
      expiration_raw: '2031-12-31',
    };
    const scope = { organizationId: 'org-synthetic', bypassOrganizationScope: false };
    const read = async (patientId: string | null) => {
      const fixture = databaseWithRows([{ ...sourceProjection, patient_id: patientId }]);
      const repository = new ClinicalAuthorizationRepository(fixture.database);
      const result = await repository.findForSchedulingById(sourceProjection.id, scope);
      const query = fixture.query.mock.calls[0]?.[0] as string;
      expect(query).toContain("source_data->>'IDENTIFICACION_PACIENTE'");
      expect(query).toContain('authorization_item_organizations');
      expect(query).not.toMatch(/join\s+patients\b/i);
      expect(query).not.toMatch(/\bpatient_id\b/i);
      return result;
    };

    const linked = await read('20000000-0000-4000-8000-000000000002');
    const unlinked = await read(null);
    expect(linked).toEqual(unlinked);
    expect(linked).toMatchObject({ patientDocument: '0009001', patientName: 'SYNTHETIC PATIENT' });
  });
});
