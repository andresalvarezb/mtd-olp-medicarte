import * as XLSX from 'xlsx';
import { canonicalizeHeader, requiredTariffImportColumns } from '@authorization/contracts';
import { normalizeTariffProductCode } from '@authorization/domain';

export type ParsedTariffRow = Readonly<{
  rowNumber: number;
  codigoProducto: string;
  rawData: Record<string, unknown>;
}>;

export type ParsedTariffFile = Readonly<{
  rows: ParsedTariffRow[];
  headers: string[];
}>;

export class TariffFileError extends Error {
  constructor(
    readonly code: 'INVALID_FILE_FORMAT' | 'EMPTY_FILE',
    message: string,
  ) {
    super(message);
    this.name = 'TariffFileError';
  }
}

function cellToJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  return JSON.stringify(value) ?? '';
}

function cellToHeader(value: unknown): string {
  const normalized = cellToJsonValue(value);
  return canonicalizeHeader(typeof normalized === 'string' ? normalized : '');
}

function isBlank(value: unknown): boolean {
  return (
    value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
  );
}

function isSupportedFile(filename: string, mimeType: string): boolean {
  const normalizedFilename = filename.toLowerCase();
  return (
    normalizedFilename.endsWith('.xlsx') &&
    (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/octet-stream' ||
      mimeType === '')
  );
}

/**
 * SPEC-014: el contrato del cargue masivo del Anexo Tarifario exige el
 * encabezado exacto `CODIGO_MEDICAMENTO`. El valor se normaliza con la misma
 * regla técnica de COD_COMERCIAL; filas sin código se conservan para el
 * reporte por fila.
 */
export function parseTariffImportFile(
  content: Buffer,
  filename: string,
  mimeType: string,
): ParsedTariffFile {
  if (!isSupportedFile(filename, mimeType)) {
    throw new TariffFileError('INVALID_FILE_FORMAT', 'Solo se admiten archivos XLSX (.xlsx).');
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(content, {
      type: 'buffer',
      raw: true,
      cellDates: true,
      WTF: true,
    });
  } catch {
    throw new TariffFileError('INVALID_FILE_FORMAT', 'El archivo no tiene un formato legible.');
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName)
    throw new TariffFileError('INVALID_FILE_FORMAT', 'El archivo no contiene una hoja de datos.');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet)
    throw new TariffFileError('INVALID_FILE_FORMAT', 'No fue posible leer la hoja de datos.');

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
  const headerRow = matrix[0];
  if (!headerRow || headerRow.length === 0)
    throw new TariffFileError('INVALID_FILE_FORMAT', 'El archivo no contiene encabezados.');

  const headers = headerRow.map(cellToHeader);
  const missingHeaders = requiredTariffImportColumns.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new TariffFileError(
      'INVALID_FILE_FORMAT',
      `Faltan encabezados obligatorios: ${missingHeaders.join(', ')}.`,
    );
  }

  // Las filas en blanco intermedias se conservan (código vacío => reporte por
  // fila); solo se descartan las filas vacías al final del archivo.
  let lastDataRowIndex = matrix.length - 1;
  while (lastDataRowIndex > 0 && (matrix[lastDataRowIndex] ?? []).every(isBlank)) {
    lastDataRowIndex -= 1;
  }

  const codigoIndex = headers.indexOf('CODIGO_PRODUCTO');
  const rows: ParsedTariffRow[] = [];
  for (let index = 1; index <= lastDataRowIndex; index += 1) {
    const values = matrix[index] ?? [];
    const rawData: Record<string, unknown> = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      const header = headers[columnIndex];
      if (header) rawData[header] = cellToJsonValue(values[columnIndex]);
    }
    rows.push({
      rowNumber: index + 1,
      codigoProducto: normalizeTariffProductCode(values[codigoIndex]),
      rawData,
    });
  }

  if (rows.length === 0) {
    throw new TariffFileError('EMPTY_FILE', 'El archivo no contiene filas de datos.');
  }

  return { rows, headers };
}
