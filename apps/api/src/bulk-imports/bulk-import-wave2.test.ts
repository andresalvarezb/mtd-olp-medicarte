import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '@authorization/config';
import type { Scope } from '../common/request-scope';
import type { BulkImportRepository } from './bulk-import.repository';
import { BulkImportService } from './bulk-import.service';
import { buildBulkImportResultWorkbook } from './bulk-import-xlsx';


function readCellValue(
  sheet: XLSX.WorkSheet,
  address: string,
): unknown {
  const cell: unknown = sheet[address];

  if (typeof cell !== 'object' || cell === null || !('v' in cell)) {
    return undefined;
  }

  return cell.v;
}

describe('WAVE2 - XLSX masivos y rechazadas', () => {
  it('exporta filas en los bordes de bloque sin desplazarlas', () => {
    const rows = Array.from({ length: 2010 }, (_, i) => ({
      rowNumber: i + 2,
      executionStatus: 'FAILED',
      errorCode: 'PROCESSING_ERROR',
      errorMessage: 'Error original ' + i,
      entityReference: null,
      authorizationNumber: 'AUTO-' + i,
      commercialCode: 'MED-' + i,
      dispensingPointCode: null,
      assignmentDate: '2026-10-15',
      quantity: i + 1,
    }));

    const book = XLSX.read(buildBulkImportResultWorkbook(rows), {
      type: 'buffer',
    });
    const sheet = book.Sheets.RESULTADO!;

    expect(sheet['!ref']).toBe('A1:J2011');
    expect(readCellValue(sheet, 'A2')).toBe(2);
    expect(readCellValue(sheet, 'A1001')).toBe(1001);
    expect(readCellValue(sheet, 'A1002')).toBe(1002);
    expect(readCellValue(sheet, 'A2011')).toBe(2011);
    expect(readCellValue(sheet, 'D2011')).toBe('Error original 2009');
    expect(readCellValue(sheet, 'F2011')).toBe('AUTO-2009');
    expect(readCellValue(sheet, 'J2011')).toBe(2010);
  });

  it('mantiene claves y errores de cargues históricos de 2005 filas', async () => {
    const rejected = Array.from({ length: 2005 }, (_, i) => ({
      rowNumber: i + 2,
      authorizationKey: 'AUTO-' + i + '|MED-' + i,
      errorCode: 'PROCESSING_ERROR',
      errorMessage: 'Error registrado',
    }));

    const repository = {
      findJob: vi.fn().mockResolvedValue(null),
      getLegacyRejectedRows: vi.fn().mockResolvedValue(rejected),
    };

    const service = new BulkImportService(
      {} as ApiConfig,
      repository as unknown as BulkImportRepository,
    );

    const book = XLSX.read(
      await service.rejectedRowsWorkbook('historical', {} as Scope),
      { type: 'buffer' },
    );
    const sheet = book.Sheets.RECHAZADAS!;

    expect(sheet['!ref']).toBe('A1:B2006');
    expect(readCellValue(sheet, 'A2')).toBe('AUTO-0|MED-0');
    expect(readCellValue(sheet, 'A1002')).toBe('AUTO-1000|MED-1000');
    expect(readCellValue(sheet, 'A2006')).toBe('AUTO-2004|MED-2004');
    expect(typeof readCellValue(sheet, 'B2006')).toBe('string');
  });

  it('consulta solo rechazadas en jobs finalizados y mantiene ALL en PROCESSING', async () => {
    const repository = {
      findJob: vi.fn().mockResolvedValue({ status: 'COMPLETED' }),
      listRows: vi.fn().mockResolvedValue([]),
    };

    const service = new BulkImportService(
      {} as ApiConfig,
      repository as unknown as BulkImportRepository,
    );
    const actor = {} as Scope;

    await service.rejectedRowsWorkbook('job-1', actor);
    expect(repository.listRows).toHaveBeenCalledWith(
      'job-1', 'REJECTED', actor
    );

    repository.findJob.mockResolvedValue({ status: 'PROCESSING' });

    Object.assign(repository, {
      listExpiredClaimRowNumbers: vi.fn().mockResolvedValue([]),
    });

    await service.rejectedRowsWorkbook('job-1', actor);

    expect(repository.listRows).toHaveBeenLastCalledWith(
      'job-1', 'ALL', actor
    );
  });
});
