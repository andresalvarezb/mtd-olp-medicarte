import * as XLSX from 'xlsx';

export type ParsedBulkRow = Readonly<{
  rowNumber: number;
  rawData: Record<string, unknown>;
}>;

export type ParsedBulkFile = Readonly<{
  rows: ParsedBulkRow[];
  headers: string[];
}>;

export class BulkFileError extends Error {
  constructor(
    readonly code: 'INVALID_FILE_FORMAT' | 'INVALID_HEADERS',
    message: string,
  ) {
    super(message);
    this.name = 'BulkFileError';
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
  return (typeof normalized === 'string' ? normalized : '').replace(/^\uFEFF/, '').trim();
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

/**
 * SPEC-013/ADR-022: el archivo contiene exactamente las columnas del tipo de
 * operación. Cualquier columna adicional, faltante o duplicada invalida el
 * archivo completo con INVALID_HEADERS.
 */
export function parseBulkFile(
  content: Buffer,
  filename: string,
  mimeType: string,
  requiredColumns: readonly string[],
): ParsedBulkFile {
  if (!isSupportedFile(filename, mimeType)) {
    throw new BulkFileError('INVALID_FILE_FORMAT', 'Solo se admiten archivos CSV o XLSX.');
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(content, { type: 'buffer', raw: true, cellDates: true, WTF: true });
  } catch {
    throw new BulkFileError('INVALID_FILE_FORMAT', 'El archivo no tiene un formato legible.');
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new BulkFileError('INVALID_FILE_FORMAT', 'El archivo no contiene una hoja de datos.');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new BulkFileError('INVALID_FILE_FORMAT', 'No fue posible leer la hoja de datos.');

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  const headerRow = matrix[0];
  if (!headerRow || headerRow.length === 0)
    throw new BulkFileError('INVALID_HEADERS', 'El archivo no contiene encabezados.');

  const headers = headerRow.map(cellToHeader);
  if (headers.some((header) => !header))
    throw new BulkFileError('INVALID_HEADERS', 'Todos los encabezados deben tener nombre.');
  if (new Set(headers).size !== headers.length)
    throw new BulkFileError('INVALID_HEADERS', 'El archivo contiene encabezados duplicados.');

  const expected = [...requiredColumns].sort();
  const actual = [...headers].sort();
  if (
    expected.length !== actual.length ||
    expected.some((column, index) => column !== actual[index])
  ) {
    throw new BulkFileError(
      'INVALID_HEADERS',
      `Los encabezados deben ser exactamente: ${requiredColumns.join(', ')}.`,
    );
  }

  const rows: ParsedBulkRow[] = [];
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

  return { rows, headers };
}
