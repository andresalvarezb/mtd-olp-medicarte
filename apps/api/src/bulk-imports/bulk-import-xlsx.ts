import * as XLSX from 'xlsx';
import {
  BULK_IMPORT_MAX_COLUMNS,
  BULK_IMPORT_MAX_ROWS,
  BULK_IMPORT_MAX_SHEETS,
  AUTHORIZATION_IMPORT_COLUMNS,
  ESP014_AUTHORIZATIONS_TEMPLATE_VERSION,
  ESP014_SCHEDULING_TEMPLATE_VERSION,
  SCHEDULING_TEMPLATE_REQUIRED_COLUMNS,
} from '@authorization/contracts';
import { isSupportedSchedulingTemplate } from '@authorization/domain';
import {
  PatientScheduleFileError,
  parsePatientScheduleFile,
  type ParsedPatientScheduleRow,
} from '../scheduling/patient-schedule-xlsx';

export class BulkImportFileError extends Error {
  constructor(
    readonly code:
      | 'INVALID_FILE_FORMAT'
      | 'UNKNOWN_TEMPLATE_VERSION'
      | 'MISSING_TEMPLATE_VERSION'
      | 'INVALID_HEADERS'
      | 'EMPTY_FILE'
      | 'TOO_MANY_SHEETS'
      | 'TOO_MANY_COLUMNS'
      | 'TOO_MANY_ROWS'
      | 'FORMULA_NOT_ALLOWED'
      | 'MACRO_NOT_ALLOWED',
    message: string,
  ) {
    super(message);
    this.name = 'BulkImportFileError';
  }
}

export type ParsedAuthorizationRow = Readonly<{
  rowNumber: number;
  rawData: Record<string, unknown>;
  values: Record<(typeof AUTHORIZATION_IMPORT_COLUMNS)[number], unknown>;
}>;

const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  '',
]);

export function isAcceptedXlsxMime(mime: string): boolean {
  return XLSX_MIME_TYPES.has(mime);
}

function rejectUnsafeWorkbook(workbook: XLSX.WorkBook): void {
  const withMacros = workbook as XLSX.WorkBook & { vbaraw?: unknown };
  if (withMacros.vbaraw) {
    throw new BulkImportFileError('MACRO_NOT_ALLOWED', 'Macro-enabled workbooks are rejected');
  }
  if (workbook.SheetNames.length > BULK_IMPORT_MAX_SHEETS) {
    throw new BulkImportFileError(
      'TOO_MANY_SHEETS',
      `The workbook exceeds ${BULK_IMPORT_MAX_SHEETS} sheets`,
    );
  }
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    for (const cell of Object.values(sheet)) {
      if (!cell || typeof cell !== 'object') continue;
      const candidate = cell as { f?: unknown; l?: unknown };
      if (candidate.f) {
        throw new BulkImportFileError('FORMULA_NOT_ALLOWED', 'Formula cells are not allowed');
      }
      if (candidate.l) {
        throw new BulkImportFileError('FORMULA_NOT_ALLOWED', 'External links are not allowed');
      }
    }
  }
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function metadataValue(workbook: XLSX.WorkBook, key: string): string | null {
  const sheet = workbook.Sheets.METADATA;
  if (!sheet) return null;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  for (const row of matrix) {
    const label = cellText(row?.[0]).trim().toUpperCase();
    if (label === key.toUpperCase()) {
      const value = cellText(row?.[1]).trim();
      return value === '' ? null : value;
    }
  }
  return null;
}

export function parseEsp014SchedulingWorkbook(content: Buffer): {
  templateVersion: string;
  rows: ParsedPatientScheduleRow[];
} {
  if (content.length < 4 || content[0] !== 0x50 || content[1] !== 0x4b) {
    throw new BulkImportFileError('INVALID_FILE_FORMAT', 'The file is not a valid XLSX file');
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(content, {
      type: 'buffer',
      raw: true,
      cellFormula: true,
      cellHTML: false,
    });
  } catch {
    throw new BulkImportFileError('INVALID_FILE_FORMAT', 'The file is not a valid XLSX file');
  }
  rejectUnsafeWorkbook(workbook);
  const templateVersion = metadataValue(workbook, 'templateVersion');
  if (templateVersion == null) {
    throw new BulkImportFileError(
      'MISSING_TEMPLATE_VERSION',
      'METADATA.templateVersion is required',
    );
  }
  if (!isSupportedSchedulingTemplate(templateVersion)) {
    throw new BulkImportFileError(
      'UNKNOWN_TEMPLATE_VERSION',
      `Unsupported templateVersion ${templateVersion}`,
    );
  }
  const importType = metadataValue(workbook, 'importType');
  if (importType !== 'SCHEDULING') {
    throw new BulkImportFileError(
      'UNKNOWN_TEMPLATE_VERSION',
      `Unsupported importType ${importType ?? 'missing'}`,
    );
  }
  const dataSheet = workbook.Sheets.Programacion ?? workbook.Sheets[workbook.SheetNames[0] ?? ''];
  if (!dataSheet) throw new BulkImportFileError('EMPTY_FILE', 'The XLSX file has no sheets');
  const isolated = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(isolated, dataSheet, 'Programacion');
  const isolatedBuffer = XLSX.write(isolated, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  let rows: ParsedPatientScheduleRow[];
  try {
    rows = parsePatientScheduleFile(isolatedBuffer);
  } catch (error) {
    if (error instanceof PatientScheduleFileError) {
      throw new BulkImportFileError(error.code, error.message);
    }
    throw error;
  }
  const headerWidth = XLSX.utils.sheet_to_json<unknown[]>(dataSheet, { header: 1, raw: true })[0]
    ?.length;
  if ((headerWidth ?? 0) > BULK_IMPORT_MAX_COLUMNS) {
    throw new BulkImportFileError(
      'TOO_MANY_COLUMNS',
      `The sheet exceeds ${BULK_IMPORT_MAX_COLUMNS} columns`,
    );
  }
  if (rows.length > BULK_IMPORT_MAX_ROWS) {
    throw new BulkImportFileError(
      'TOO_MANY_ROWS',
      `The file exceeds ${BULK_IMPORT_MAX_ROWS} data rows`,
    );
  }
  return { templateVersion, rows };
}

export function parseAuthorizationWorkbook(content: Buffer): {
  templateVersion: string;
  rows: ParsedAuthorizationRow[];
} {
  const workbook = readSafeWorkbook(content);
  const templateVersion = metadataValue(workbook, 'templateVersion');
  if (templateVersion !== ESP014_AUTHORIZATIONS_TEMPLATE_VERSION) {
    throw new BulkImportFileError(
      templateVersion == null ? 'MISSING_TEMPLATE_VERSION' : 'UNKNOWN_TEMPLATE_VERSION',
      `Unsupported authorization templateVersion ${templateVersion ?? 'missing'}`,
    );
  }
  if (metadataValue(workbook, 'importType') !== 'AUTHORIZATIONS') {
    throw new BulkImportFileError('UNKNOWN_TEMPLATE_VERSION', 'Unsupported importType');
  }
  const sheet = workbook.Sheets.Autorizaciones ?? workbook.Sheets[workbook.SheetNames[0] ?? ''];
  if (!sheet) throw new BulkImportFileError('EMPTY_FILE', 'The XLSX file has no sheets');
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  const firstRow: unknown[] = matrix[0] ?? [];
  const headers: string[] = firstRow.map((value: unknown) => sanitizeHeader(value));
  const authorizationColumns = [...AUTHORIZATION_IMPORT_COLUMNS];
  const missing = authorizationColumns.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    throw new BulkImportFileError('INVALID_HEADERS', `Missing required columns: ${missing.join(', ')}`);
  }
  const rows: ParsedAuthorizationRow[] = [];
  for (let index = 1; index < matrix.length; index += 1) {
    const cells = matrix[index];
    if (!cells || cells.every((cell) => cell === null || cell === undefined || cell === '')) continue;
    const rawData: Record<string, unknown> = {};
    const values = {} as Record<(typeof AUTHORIZATION_IMPORT_COLUMNS)[number], unknown>;
    for (const [columnIndex, cell] of cells.entries()) {
      const column = headers[columnIndex] ?? `COLUMNA_${columnIndex + 1}`;
      rawData[column] = cell;
      if (authorizationColumns.includes(column as (typeof AUTHORIZATION_IMPORT_COLUMNS)[number])) {
        values[column as (typeof AUTHORIZATION_IMPORT_COLUMNS)[number]] = cell;
      }
    }
    rows.push({ rowNumber: index + 1, rawData, values });
  }
  if (rows.length > BULK_IMPORT_MAX_ROWS) {
    throw new BulkImportFileError('TOO_MANY_ROWS', `The file exceeds ${BULK_IMPORT_MAX_ROWS} data rows`);
  }
  return { templateVersion, rows };
}

function sanitizeHeader(value: unknown): string {
  return cellText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function readSafeWorkbook(content: Buffer): XLSX.WorkBook {
  if (content.length < 4 || content[0] !== 0x50 || content[1] !== 0x4b) {
    throw new BulkImportFileError('INVALID_FILE_FORMAT', 'The file is not a valid XLSX file');
  }
  try {
    const workbook = XLSX.read(content, { type: 'buffer', raw: true, cellFormula: true, cellHTML: false });
    rejectUnsafeWorkbook(workbook);
    return workbook;
  } catch (error) {
    if (error instanceof BulkImportFileError) throw error;
    throw new BulkImportFileError('INVALID_FILE_FORMAT', 'The file is not a valid XLSX file');
  }
}

export function buildEsp014SchedulingTemplate(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([[...SCHEDULING_TEMPLATE_REQUIRED_COLUMNS, 'MANEJO_TARDIO']]),
    'Programacion',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['KEY', 'VALUE'],
      ['templateVersion', ESP014_SCHEDULING_TEMPLATE_VERSION],
      ['importType', 'SCHEDULING'],
    ]),
    'METADATA',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['COLUMNA', 'OBLIGATORIA', 'DESCRIPCION'],
      ['AUTORIZACION', 'SI', 'Número de autorización registrado en la plataforma.'],
      ['DOCUMENTO', 'SI', 'Documento del paciente tal como está en la autorización.'],
      ['COD_COMERCIAL', 'SI', 'Código comercial del producto autorizado.'],
      ['CANTIDAD', 'SI', 'Entero mayor que cero.'],
      ['PUNTO', 'SI', 'Código del punto de dispensación activo.'],
      ['FECHA_PROGRAMADA', 'SI', 'Fecha en formato AAAA-MM-DD.'],
      ['MANEJO_TARDIO', 'NO', 'COMPLEMENTARY_PURCHASE_ORDER o NEXT_PERIOD si la fecha es tardía.'],
    ]),
    'Instrucciones',
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function buildAuthorizationTemplate(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([[...AUTHORIZATION_IMPORT_COLUMNS]]),
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
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['CAMPO', 'DESCRIPCION'],
      ['FECHA_ASIGNACION', 'Fecha usada para ubicar la autorización en el período de planificación.'],
      ['FECHA_FINAL_VIGENCIA', 'Fecha de vencimiento de la autorización.'],
      ['CANTIDAD', 'Cantidad entera positiva autorizada.'],
      ['PUNTO', 'No aplica: el punto se selecciona en la orden de compra.'],
    ]),
    'Instrucciones',
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function buildBulkImportResultWorkbook(
  rows: ReadonlyArray<{
    rowNumber: number;
    executionStatus: string;
    errorCode: string | null;
    errorMessage: string | null;
    entityReference: string | null;
    authorizationNumber: string | null;
    commercialCode: string | null;
    dispensingPointCode: string | null;
    assignmentDate: string | null;
    quantity: number | null;
  }>,
): Buffer {
  const header = [
    'ROW',
    'STATUS',
    'ERROR_CODE',
    'ERROR_MESSAGE',
    'CREATED_ENTITY_ID',
    'AUTORIZACION',
    'COD_COMERCIAL',
    'PUNTO',
    'FECHA_ASIGNACION',
    'CANTIDAD',
  ];
  const body = rows.map((row) => [
    row.rowNumber,
    row.executionStatus,
    row.errorCode,
    row.errorMessage,
    row.entityReference,
    row.authorizationNumber,
    row.commercialCode,
    row.dispensingPointCode,
    row.assignmentDate,
    row.quantity,
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, ...body]), 'RESULTADO');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
