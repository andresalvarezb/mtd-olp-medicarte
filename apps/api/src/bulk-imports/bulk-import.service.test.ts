import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import {
  AUTHORIZATION_IMPORT_COLUMNS,
  ESP014_AUTHORIZATIONS_TEMPLATE_VERSION,
} from '@authorization/contracts';
import { BulkImportService } from './bulk-import.service';
import type { BulkImportRepository } from './bulk-import.repository';
import type { ApiConfig } from '@authorization/config';
import type { Scope } from '../common/request-scope';

function buildAuthorizationWorkbook(
  codes: readonly string[],
  expirationDate = '2099-12-31',
): Buffer {
  const workbook = XLSX.utils.book_new();
  const header = [...AUTHORIZATION_IMPORT_COLUMNS];
  const rows = codes.map((code, index) =>
    AUTHORIZATION_IMPORT_COLUMNS.map((column) => {
      if (column === 'CODIGO_COMERCIAL') return code;
      if (column === 'NUMERO_AUTORIZACION') return `AUTH-${index + 1}`;
      if (column === 'CANTIDAD') return 2;
      if (column === 'FECHA_ASIGNACION') return '2026-09-16';
      if (column === 'FECHA_FINAL_VIGENCIA') return expirationDate;
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
    findActiveTariffAnnexProducts: vi
      .fn()
      .mockResolvedValue(
        new Map([
          [
            'TAR-001',
            {
              tipoInclusion:
                'PBS',
              minimumQuantity:
                1,
            },
          ],
        ]),
      ),
    hasDuplicateHash: vi.fn().mockResolvedValue(false),
    createJob: vi.fn().mockResolvedValue({ id: 'job-1' }),
    findJob: vi.fn().mockResolvedValue({ id: 'job-1', status: 'READY' }),
    listRows: vi.fn(),
  };
  const service = new BulkImportService(
    { IMPORT_MAX_FILE_BYTES: 20 * 1024 * 1024 } as unknown as ApiConfig,
    repository as unknown as BulkImportRepository,
  );
  return { service, repository };
}

describe('BulkImportService', () => {
  it('prepara para persistencia una AUTO aunque el producto no exista en el AT', async () => {
    const {
      service,
      repository,
    } = createService();

    await service.uploadAuthorizations({
      file: {
        buffer:
          buildAuthorizationWorkbook([
            'TAR-001',
            'TAR-999',
          ]),
        originalname:
          'autorizaciones.xlsx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 1,
      },
      actor: {
        organizationId:
          'org-1',
        userId:
          'user-1',
        correlationId:
          '11111111-1111-1111-1111-111111111111',
      } as unknown as Scope,
    });

    expect(
      repository
        .findActiveTariffAnnexProducts,
    ).not.toHaveBeenCalled();

    const input =
      repository.createJob
        .mock.calls[0]?.[0] as {
          rows:
            Array<
              Record<
                string,
                unknown
              >
            >;
        };

    expect(
      input.rows,
    ).toHaveLength(2);

    expect(
      input.rows[0],
    ).toMatchObject({
      validationStatus:
        'VALID',
      errorCode:
        null,
      commercialCode:
        'TAR-001',
    });

    expect(
      input.rows[1],
    ).toMatchObject({
      validationStatus:
        'VALID',
      errorCode:
        null,
      commercialCode:
        'TAR-999',
    });
  });

  it('prepara para persistencia una AUTO vencida', async () => {
    const {
      service,
      repository,
    } = createService();

    await service.uploadAuthorizations({
      file: {
        buffer:
          buildAuthorizationWorkbook(
            ['TAR-001'],
            '2020-01-01',
          ),
        originalname:
          'autorizaciones-vencidas.xlsx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 1,
      },
      actor: {
        organizationId:
          'org-1',
        userId:
          'user-1',
        correlationId:
          '11111111-1111-1111-1111-111111111111',
      } as unknown as Scope,
    });

    const input =
      repository.createJob
        .mock.calls[0]?.[0] as {
          rows:
            Array<
              Record<
                string,
                unknown
              >
            >;
        };

    expect(
      input.rows[0],
    ).toMatchObject({
      validationStatus:
        'VALID',
      errorCode:
        null,
    });
  });

  it('prepara para persistencia una AUTO con vigencia inválida', async () => {
    const {
      service,
      repository,
    } = createService();

    await service.uploadAuthorizations({
      file: {
        buffer:
          buildAuthorizationWorkbook(
            ['TAR-001'],
            '',
          ),
        originalname:
          'autorizaciones-sin-vigencia.xlsx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 1,
      },
      actor: {
        organizationId:
          'org-1',
        userId:
          'user-1',
        correlationId:
          '11111111-1111-1111-1111-111111111111',
      } as unknown as Scope,
    });

    const input =
      repository.createJob
        .mock.calls[0]?.[0] as {
          rows:
            Array<
              Record<
                string,
                unknown
              >
            >;
        };

    expect(
      input.rows[0],
    ).toMatchObject({
      validationStatus:
        'VALID',
      errorCode:
        null,
    });
  });

  it('solo rechaza en staging una AUTO que no tenga identidad operacional', async () => {
    const {
      service,
      repository,
    } = createService();

    await service.uploadAuthorizations({
      file: {
        buffer:
          buildAuthorizationWorkbook([
            '',
          ]),
        originalname:
          'autorizaciones-sin-identidad.xlsx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 1,
      },
      actor: {
        organizationId:
          'org-1',
        userId:
          'user-1',
        correlationId:
          '11111111-1111-1111-1111-111111111111',
      } as unknown as Scope,
    });

    const input =
      repository.createJob
        .mock.calls[0]?.[0] as {
          rows:
            Array<
              Record<
                string,
                unknown
              >
            >;
        };

    expect(
      input.rows[0],
    ).toMatchObject({
      validationStatus:
        'INVALID',
      errorCode:
        'AUTHORIZATION_IDENTITY_REQUIRED',
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
    } as unknown as Scope);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets.RESULTADO!;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

    expect(rows).toHaveLength(3);
    expect(rows[1]?.[0]).toBe(2);
    expect(rows[2]?.[0]).toBe(3);
  });
});
