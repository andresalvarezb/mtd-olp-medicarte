import * as XLSX from 'xlsx';
import {
  canonicalizeHeader,
  requiredAuthorizationSourceColumns,
} from '@authorization/contracts';

export type ParsedImportRow = Readonly<{
  rowNumber: number;
  rawData: Record<string, unknown>;
}>;

export type ParsedImportFile = Readonly<{
  rows: ParsedImportRow[];
  headers: string[];
  missingHeaders: string[];
}>;

export class ImportFileError extends Error {
  readonly code = 'INVALID_FIELD_FORMAT' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ImportFileError';
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
  if (normalizedFilename.endsWith('.csv'))
    return mimeType === 'text/csv' || mimeType === 'application/octet-stream' || mimeType === '';
  if (normalizedFilename.endsWith('.xlsx')) {
    return (
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/octet-stream' ||
      mimeType === ''
    );
  }
  return false;
}

export function parseImportFile(
  content: Buffer,
  filename: string,
  mimeType: string,
): ParsedImportFile {
  if (!isSupportedFile(filename, mimeType)) {
    throw new ImportFileError('Solo se admiten archivos CSV o XLSX.');
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(content, { type: 'buffer', raw: true, cellDates: true, WTF: true });
  } catch {
    throw new ImportFileError('El archivo no tiene un formato legible.');
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new ImportFileError('El archivo no contiene una hoja de datos.');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new ImportFileError('No fue posible leer la hoja de datos.');

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  const headerRow = matrix[0];
  if (!headerRow || headerRow.length === 0)
    throw new ImportFileError('El archivo no contiene encabezados.');

  const headers = headerRow.map(cellToHeader);
  if (headers.some((header) => !header))
    throw new ImportFileError('Todos los encabezados deben tener nombre.');
  if (new Set(headers).size !== headers.length)
    throw new ImportFileError('El archivo contiene encabezados duplicados.');

  const missingHeaders = requiredAuthorizationSourceColumns.filter(
    (column) => !headers.includes(column),
  );
  const rows: ParsedImportRow[] = [];
  for (let index = 1; index < matrix.length; index += 1) {
    const values = matrix[index] ?? [];
    if (values.every(isBlank)) continue;
    const rawData: Record<string, unknown> = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      const header = headers[columnIndex];
      if (header) rawData[header] = cellToJsonValue(values[columnIndex]);
    }
    rows.push({ rowNumber: index + 1, rawData });
  }

  return { rows, headers, missingHeaders };
}
