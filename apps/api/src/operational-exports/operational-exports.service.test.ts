import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import { OperationalExportsService } from './operational-exports.service';

describe('OperationalExportsService', () => {
  it('incluye fecha y codigo de autorizacion de Medicarte en la descarga', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'item-1',
          authorization_key: 'AUTH-1:MED-1',
          numero_autorizacion: 'AUTH-1',
          codigo_medicamento: 'MED-1',
          enablement_status: 'ENABLED',
          coverage_type: 'PBS',
          direction_status: 'NOT_APPLICABLE',
          operation_status: 'DISPENSATION_REPORTED',
          lugar_dispensacion: 'Sede',
          fecha_programada: '2026-08-01',
          fecha_dispensacion: '2026-08-02',
          fecha_aplicacion: '2026-08-03',
          cod_autorizacion_medicarte: 'MED-AUTH-1',
          audit_status: 'READY',
          operational_version: 3,
          version: 3,
          created_at: new Date('2026-08-01T00:00:00.000Z'),
          updated_at: new Date('2026-08-03T00:00:00.000Z'),
          nombre_paciente: null,
          numero_documento: null,
          cdgn001: null,
          cups_autorizado: null,
          cantidad: null,
          dosis: null,
          fecha_asignacion: null,
          fecha_final_vigencia: null,
          estado_autorizacion: null,
          obs_autorizacion: null,
          valor_cuota_moderadora: null,
          no_prescripcion: null,
        },
      ],
    });
    const service = new OperationalExportsService({ pool: { query } } as never);

    const result = await service.authorizationItems({
      query: { operationType: 'REPORT_APPLICATION_DATE', format: 'xlsx' },
      scope: {
        organizationId: 'org-1',
        organizationCode: 'MEDICARTE',
        userId: 'user-1',
        correlationId: 'correlation-1',
        readSensitive: false,
        isFoundationAdmin: false,
        canCrossOrganizationOperationalExport: false,
      },
    });

    const sheet = XLSX.utils.sheet_to_json(
      XLSX.read(result.content, { type: 'buffer' }).Sheets.Datos!,
      {
        header: 1,
        raw: false,
      },
    ) as string[][];
    expect(sheet[0]).toContain('FECHA_APLICACION');
    expect(sheet[0]).toContain('COD_AUTORIZACION_MEDICARTE');
    expect(sheet[1]).toContain('2026-08-03');
    expect(sheet[1]).toContain('MED-AUTH-1');
  });
});
