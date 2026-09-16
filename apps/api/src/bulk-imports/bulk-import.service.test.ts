import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import { AUTHORIZATION_IMPORT_COLUMNS, ESP014_AUTHORIZATIONS_TEMPLATE_VERSION } from '@authorization/contracts';
import { BulkImportService } from './bulk-import.service';

function buildAuthorizationWorkbook(codes: readonly string[]): Buffer {
  const workbook = XLSX.utils.book_new();
  const header = [...AUTHORIZATION_IMPORT_COLUMNS];
  const rows = codes.map((code, index) =>
    AUTHORIZATION_IMPORT_COLUMNS.map((column) => {
      if (column === 'CODIGO_COMERCIAL') return code;
      if (column === 'NUMERO_AUTORIZACION') return `AUTH-${index + 1}`;
      if (column === 'CANTIDAD') return 2;
      if (column === 'FECHA_ASIGNACION') return '2026-09-16';
      return `${column}-${index + 1}`;
    }),
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([header, ...rows]),
    'Autorizaciones',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['KEY', 'VALUE'],
      ['templateVersion', ESP014_AUTHORIZATIONS_TEMPLATE_VERSION],
      ['importType', 'AUTHORIZATIONS'],
    ]),
    'METADATA',
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function createService() {
  const repository = {
    findActiveTariffAnnexProductCodes: vi.fn().mockResolvedValue(new Set(['TAR-001'])),
    hasDuplicateHash: vi.fn().mockResolvedValue(false),
    createJob: vi.fn().mockResolvedValue({ id: 'job-1' }),
    findJob: vi.fn().mockResolvedValue({ id: 'job-1', status: 'READY' }),
    listRows: vi.fn(),
  } as any;
  const service = new BulkImportService({ IMPORT_MAX_FILE_BYTES: 20 * 1024 * 1024 } as any, repository);
  return { service, repository };
}

describe('BulkImportService', () => {
  it('rechaza filas cuyo código no existe en el anexo tarifario activo', async () => {
    const { service, repository } = createService();
    const file = {
      buffer: buildAuthorizationWorkbook(['TAR-001', 'TAR-999']),
      originalname: 'autorizaciones.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 1,
    };
    await service.uploadAuthorizations({
      file,
      actor: {
        organizationId: 'org-1',
        userId: 'user-1',
        correlationId: '11111111-1111-1111-1111-111111111111',
      } as any,
    });
    expect(repository.findActiveTariffAnnexProductCodes).toHaveBeenCalledWith('org-1', [
      'TAR-001',
      'TAR-999',
    ]);
    const createJobInput = repository.createJob.mock.calls[0][0];
    expect(createJobInput.rows).toHaveLength(2);
    expect(createJobInput.rows[0]).toMatchObject({
      validationStatus: 'VALID',
      errorCode: null,
      commercialCode: 'TAR-001',
    });
    expect(createJobInput.rows[1]).toMatchObject({
      validationStatus: 'INVALID',
      errorCode: 'TARIFF_ANNEX_PRODUCT_NOT_FOUND',
      commercialCode: 'TAR-999',
    });
  });

  it('exporta solo las filas rechazadas en el workbook de descarga', async () => {
    const { service, repository } = createService();
    repository.listRows.mockResolvedValue([
      {
        rowNumber: 1,
        validationStatus: 'VALID',
        executionStatus: 'READY',
        errorCode: null,
        errorMessage: null,
        entityReference: null,
        authorizationNumber: 'AUTH-1',
        commercialCode: 'TAR-001',
        dispensingPointCode: null,
        assignmentDate: '2026-09-16',
        quantity: 1,
      },
      {
        rowNumber: 2,
        validationStatus: 'INVALID',
        executionStatus: 'INVALID',
        errorCode: 'TARIFF_ANNEX_PRODUCT_NOT_FOUND',
        errorMessage: 'No existe en el anexo tarifario activo',
        entityReference: null,
        authorizationNumber: 'AUTH-2',
        commercialCode: 'TAR-999',
        dispensingPointCode: null,
        assignmentDate: '2026-09-16',
        quantity: 1,
      },
      {
        rowNumber: 3,
        validationStatus: 'VALID',
        executionStatus: 'FAILED',
        errorCode: 'PROCESSING_ERROR',
        errorMessage: 'Falló la ejecución',
        entityReference: null,
        authorizationNumber: 'AUTH-3',
        commercialCode: 'TAR-002',
        dispensingPointCode: null,
        assignmentDate: '2026-09-16',
        quantity: 1,
      },
    ]);

    const buffer = await service.rejectedRowsWorkbook('job-1', {
      organizationId: 'org-1',
    } as any);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets.RESULTADO!;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

    expect(rows).toHaveLength(3);
    expect(rows[1]?.[0]).toBe(2);
    expect(rows[2]?.[0]).toBe(3);
  });
});
