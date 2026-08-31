import * as XLSX from 'xlsx';
import { isValidTariffProductCode, normalizeTariffProductCode } from '@authorization/domain';
import { tariffAnnexCodeColumn } from '@authorization/contracts';

export type ParsedTariffRow = Readonly<{
  rowNumber: number;
  rawData: Record<string, unknown>;
  codigoProducto: string | null;
}>;

export type ParsedTariffFile = Readonly<{
  rows: ParsedTariffRow[];
  headers: string[];
}>;

export class TariffFileError extends Error {
  constructor(
    readonly code: 'INVALID_FILE_FORMAT' | 'EMPTY_FILE' | 'INVALID_HEADERS',
    message: string,
  ) {
    super(message);
    this.name = 'TariffFileError';
  }
}

function cellToJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  // Un código de producto nunca debe interpretarse como fecha; se conserva el
  // valor textual crudo de la celda.
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
 * SPEC-014 §5-6: el archivo contiene exactamente la columna `codigo_producto`
 * (mismo dominio de valores de authorization_items.codigo_medicamento). Un
 * archivo sin filas de datos es un error de archivo, no un lote vacío válido.
 */
export function parseTariffImportFile(
  content: Buffer,
  filename: string,
  mimeType: string,
  requiredColumns: readonly string[],
): ParsedTariffFile {
  if (!isSupportedFile(filename, mimeType)) {
    throw new TariffFileError('INVALID_FILE_FORMAT', 'Solo se admiten archivos CSV o XLSX.');
  }

  let workbook: XLSX.WorkBook;
  try {
    if (filename.toLowerCase().endsWith('.csv')) {
      // CSV se decodifica como texto UTF-8 para preservar acentos en los
      // encabezados mapeados del contrato comercial.
      workbook = XLSX.read(content.toString('utf8'), {
        type: 'string',
        raw: true,
        cellDates: false,
        WTF: true,
      });
    } else {
      workbook = XLSX.read(content, { type: 'buffer', raw: true, cellDates: false, WTF: true });
    }
  } catch {
    throw new TariffFileError('INVALID_FILE_FORMAT', 'El archivo no tiene un formato legible.');
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName)
    throw new TariffFileError('INVALID_FILE_FORMAT', 'El archivo no contiene una hoja de datos.');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new TariffFileError('INVALID_FILE_FORMAT', 'No fue posible leer la hoja de datos.');

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  const headerRow = matrix[0];
  if (!headerRow || headerRow.length === 0)
    throw new TariffFileError('INVALID_HEADERS', 'El archivo no contiene encabezados.');

  const headers = headerRow.map(cellToHeader);
  // SheetJS rellena la fila de encabezados hasta la longitud de la fila más
  // ancha; los rellenos finales vacíos se recortan aquí y una fila de datos
  // más ancha que el contrato se rechaza después con INVALID_HEADERS.
  while (headers.length > 1 && headers[headers.length - 1] === '') headers.pop();
  if (headers.some((header) => !header))
    throw new TariffFileError('INVALID_HEADERS', 'Todos los encabezados deben tener nombre.');
  if (new Set(headers).size !== headers.length)
    throw new TariffFileError('INVALID_HEADERS', 'El archivo contiene encabezados duplicados.');

  const expected = [...requiredColumns].sort();
  const actual = [...headers].sort();
  if (
    expected.length !== actual.length ||
    expected.some((column, index) => column !== actual[index])
  ) {
    throw new TariffFileError(
      'INVALID_HEADERS',
      `Los encabezados deben ser exactamente: ${requiredColumns.join(', ')}.`,
    );
  }

  const rows: ParsedTariffRow[] = [];
  const codeColumn: string = tariffAnnexCodeColumn;
  for (let index = 1; index < matrix.length; index += 1) {
    const values = matrix[index] ?? [];
    if (values.every(isBlank)) continue;
    if (values.slice(headers.length).some((value) => !isBlank(value))) {
      throw new TariffFileError(
        'INVALID_HEADERS',
        'Las filas no pueden contener celdas por fuera de las columnas declaradas.',
      );
    }
    const rawData: Record<string, unknown> = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      const header = headers[columnIndex];
      if (header) rawData[header] = cellToJsonValue(values[columnIndex]);
    }
    const codigoProducto = normalizeTariffProductCode(rawData[codeColumn]);
    rows.push({
      rowNumber: index + 1,
      rawData,
      codigoProducto: isValidTariffProductCode(codigoProducto) ? codigoProducto : null,
    });
  }
  if (rows.length === 0) {
    throw new TariffFileError('EMPTY_FILE', 'El archivo no contiene filas de datos.');
  }

  return { rows, headers };
}
