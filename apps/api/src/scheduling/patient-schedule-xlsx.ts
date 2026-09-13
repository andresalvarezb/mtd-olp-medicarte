import * as XLSX from 'xlsx';
import {
  PATIENT_SCHEDULE_IMPORT_OPTIONAL_COLUMNS,
  PATIENT_SCHEDULE_IMPORT_REQUIRED_COLUMNS,
} from '@authorization/contracts';

/**
 * ESP-003: parser XLSX de programación. La identidad del producto es
 * COD_COMERCIAL (nunca descripción/nombre). Los encabezados se canonizan con
 * alias para tolerar planillas históricas sin relajar la obligatoriedad.
 */

export type PatientScheduleCanonicalColumn =
  | 'AUTORIZACION'
  | 'DOCUMENTO'
  | 'COD_COMERCIAL'
  | 'CANTIDAD'
  | 'PUNTO'
  | 'FECHA_PROGRAMADA'
  | 'MANEJO_TARDIO';

export type ParsedPatientScheduleRow = Readonly<{
  rowNumber: number;
  rawData: Record<string, unknown>;
  values: Partial<Record<PatientScheduleCanonicalColumn, unknown>>;
}>;

export class PatientScheduleFileError extends Error {
  constructor(
    readonly code: 'INVALID_FILE_FORMAT' | 'INVALID_HEADERS' | 'EMPTY_FILE',
    message: string,
  ) {
    super(message);
    this.name = 'PatientScheduleFileError';
  }
}

const HEADER_ALIASES: Record<string, PatientScheduleCanonicalColumn> = {
  AUTORIZACION: 'AUTORIZACION',
  NUMERO_AUTORIZACION: 'AUTORIZACION',
  NUM_AUTORIZACION: 'AUTORIZACION',
  NO_AUTORIZACION: 'AUTORIZACION',
  DOCUMENTO: 'DOCUMENTO',
  NUM_DOCUMENTO: 'DOCUMENTO',
  DOCUMENTO_PACIENTE: 'DOCUMENTO',
  IDENTIFICACION_PACIENTE: 'DOCUMENTO',
  CEDULA: 'DOCUMENTO',
  COD_COMERCIAL: 'COD_COMERCIAL',
  CODIGO_COMERCIAL: 'COD_COMERCIAL',
  CODIGO_MEDICAMENTO: 'COD_COMERCIAL',
  COD_MEDICAMENTO: 'COD_COMERCIAL',
  COD_PRODUCTO: 'COD_COMERCIAL',
  CANTIDAD: 'CANTIDAD',
  PUNTO: 'PUNTO',
  PUNTO_DISPENSACION: 'PUNTO',
  LUGAR_DISPENSACION: 'PUNTO',
  CODIGO_PUNTO: 'PUNTO',
  FECHA_PROGRAMADA: 'FECHA_PROGRAMADA',
  FECHA: 'FECHA_PROGRAMADA',
  FECHA_PROGRAMACION: 'FECHA_PROGRAMADA',
  MANEJO_TARDIO: 'MANEJO_TARDIO',
  MANEJO: 'MANEJO_TARDIO',
  TIPO_MANEJO: 'MANEJO_TARDIO',
};

function stringifyCell(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return '';
}

export function sanitizeImportHeader(value: unknown): string {
  return stringifyCell(value)
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

export function canonicalizeImportHeader(value: unknown): PatientScheduleCanonicalColumn | null {
  const sanitized = sanitizeImportHeader(value);
  return HEADER_ALIASES[sanitized] ?? null;
}

export function parsePatientScheduleFile(content: Buffer): ParsedPatientScheduleRow[] {
  // Firma ZIP/OOXML: evita que SheetJS interprete CSV/TXT como planilla válida.
  if (content.length < 4 || content[0] !== 0x50 || content[1] !== 0x4b) {
    throw new PatientScheduleFileError('INVALID_FILE_FORMAT', 'The file is not a valid XLSX file');
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(content, { type: 'buffer', raw: true });
  } catch {
    throw new PatientScheduleFileError('INVALID_FILE_FORMAT', 'The file is not a valid XLSX file');
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName === undefined ? undefined : workbook.Sheets[sheetName];
  if (!sheet) throw new PatientScheduleFileError('EMPTY_FILE', 'The XLSX file has no sheets');

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  const headerRow = matrix[0];
  if (!headerRow) throw new PatientScheduleFileError('EMPTY_FILE', 'The XLSX file has no header row');

  const columnMap = new Map<number, PatientScheduleCanonicalColumn>();
  for (const [index, header] of headerRow.entries()) {
    const canonical = canonicalizeImportHeader(header);
    if (canonical !== null) columnMap.set(index, canonical);
  }
  const missing = PATIENT_SCHEDULE_IMPORT_REQUIRED_COLUMNS.filter(
    (required) => ![...columnMap.values()].includes(required),
  );
  if (missing.length > 0) {
    throw new PatientScheduleFileError(
      'INVALID_HEADERS',
      `Missing required columns: ${missing.join(', ')}`,
    );
  }

  const rows: ParsedPatientScheduleRow[] = [];
  for (let index = 1; index < matrix.length; index += 1) {
    const cells = matrix[index];
    if (!cells || cells.every((cell) => cell === null || cell === undefined || cell === '')) {
      continue;
    }
    const rawData: Record<string, unknown> = {};
    const values: Partial<Record<PatientScheduleCanonicalColumn, unknown>> = {};
    for (const [cellIndex, cell] of cells.entries()) {
      const originalHeader = sanitizeImportHeader(headerRow[cellIndex]) || `COLUMNA_${cellIndex + 1}`;
      rawData[originalHeader] = cell;
      const canonical = columnMap.get(cellIndex);
      if (canonical !== undefined) values[canonical] = cell;
    }
    rows.push({ rowNumber: index + 1, rawData, values });
  }
  return rows;
}

export function buildPatientScheduleTemplateXlsx(): Buffer {
  const headers = [...PATIENT_SCHEDULE_IMPORT_REQUIRED_COLUMNS];
  const instructions = [
    ['COLUMNA', 'OBLIGATORIA', 'DESCRIPCION'],
    ['AUTORIZACION', 'SI', 'Número de autorización registrado en la plataforma.'],
    ['DOCUMENTO', 'SI', 'Documento del paciente tal como está en la autorización.'],
    ['COD_COMERCIAL', 'SI', 'Código comercial del producto autorizado (identidad del producto).'],
    ['CANTIDAD', 'SI', 'Entero mayor que cero.'],
    ['PUNTO', 'SI', 'Código del punto de dispensación activo.'],
    ['FECHA_PROGRAMADA', 'SI', 'Fecha en formato AAAA-MM-DD.'],
    [
      'MANEJO_TARDIO',
      'NO',
      'Obligatorio solo si la fecha programa después del corte: COMPLEMENTARY_PURCHASE_ORDER o NEXT_PERIOD.',
    ],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers]), 'Programacion');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(instructions), 'Instrucciones');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function normalizeImportText(value: unknown): string | null {
  const text = stringifyCell(value).trim();
  return text === '' ? null : text;
}

export function normalizeImportQuantity(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed =
    typeof value === 'number' ? value : Number(stringifyCell(value).trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  return parsed;
}

export function normalizeImportDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000;
    return new Date(milliseconds).toISOString().slice(0, 10);
  }
  const text = stringifyCell(value).trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) {
    return `${match[3]}-${match[2]!.padStart(2, '0')}-${match[1]!.padStart(2, '0')}`;
  }
  return null;
}

export function optionalColumns(): readonly string[] {
  return PATIENT_SCHEDULE_IMPORT_OPTIONAL_COLUMNS;
}
