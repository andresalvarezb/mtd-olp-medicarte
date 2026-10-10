import * as XLSX from 'xlsx';
import { BadRequestException } from '@nestjs/common';

export const BILLING_AUDIT_BULK_TEMPLATE_VERSION = 'BILLING_AUDIT_V1';
export const BILLING_AUDIT_BULK_MAX_BYTES = 20 * 1024 * 1024;
export const BILLING_AUDIT_BULK_MAX_ROWS = 5000;

export type BillingBulkInputRow = {
  rowNumber: number;
  authorizationKey: string;
  result: 'COMPLIES' | 'DOES_NOT_COMPLY' | null;
  observation: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

function reject(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}

function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return reject('INVALID_CELL', 'Use texto para las claves AUTO numéricas.');
    return String(value);
  }
  if (typeof value !== 'string') return reject('INVALID_CELL', 'Solo se admiten celdas de texto.');
  return value.trim();
}

function readWorkbook(buffer: Buffer): XLSX.WorkBook {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return reject('INVALID_XLSX', 'El archivo no es un XLSX válido.');
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', raw: true, cellFormula: true, cellHTML: false, bookVBA: true });
  } catch {
    return reject('INVALID_XLSX', 'No fue posible leer el archivo XLSX.');
  }
  if ((workbook as XLSX.WorkBook & { vbaraw?: unknown }).vbaraw) {
    return reject('MACROS_NOT_ALLOWED', 'No se permiten macros.');
  }
  if (workbook.SheetNames.length > 5) return reject('TOO_MANY_SHEETS', 'Máximo cinco hojas.');
  for (const sheet of Object.values(workbook.Sheets)) {
    for (const value of Object.values(sheet)) {
      if (!value || typeof value !== 'object') continue;
      const cell = value as { f?: unknown; l?: unknown };
      if (cell.f || cell.l) return reject('UNSAFE_XLSX_CELL', 'No se permiten fórmulas ni vínculos externos.');
    }
  }
  return workbook;
}

export function parseBillingAuditBulkWorkbook(buffer: Buffer): BillingBulkInputRow[] {
  const wb = readWorkbook(buffer);
  const meta = wb.Sheets.METADATA;
  const sheet = wb.Sheets.Auditoria;
  if (!meta || !sheet) return reject('INVALID_TEMPLATE', 'Faltan las hojas Auditoria o METADATA.');
  const metadata = XLSX.utils.sheet_to_json<unknown[]>(meta, { header: 1, raw: true, defval: null });
  const config = new Map(metadata.map((r) => [text(r[0]), text(r[1])]));
  if (config.get('templateVersion') !== BILLING_AUDIT_BULK_TEMPLATE_VERSION || config.get('importType') !== 'BILLING_AUDITS') {
    return reject('INVALID_TEMPLATE_VERSION', 'Versión o tipo de plantilla no soportado.');
  }
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1, raw: true, defval: null, blankrows: false,
  });
  const header = (matrix[0] ?? []).map((cell) => text(cell).toUpperCase());
  if (header.length !== 3 || header.join('|') !== 'CLAVE_AUTO|RESULTADO|OBSERVACION') {
    return reject('INVALID_HEADERS', 'Se requieren exactamente: CLAVE_AUTO, RESULTADO, OBSERVACION.');
  }
  if (matrix.length < 2) return reject('EMPTY_FILE', 'La plantilla no contiene registros.');
  if (matrix.length - 1 > BILLING_AUDIT_BULK_MAX_ROWS) {
    return reject('TOO_MANY_ROWS', 'Máximo 5000 registros por archivo.');
  }
  const rows: BillingBulkInputRow[] = [];
  for (let i = 1; i < matrix.length; i += 1) {
    const cells = matrix[i] ?? [];
    if (cells.every((cell) => cell == null || cell === '')) continue;
    const key = text(cells[0]);
    const rawResult = text(cells[1]).toUpperCase().replace(/\s+/g, ' ');
    const observation = text(cells[2]) || null;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    const result: BillingBulkInputRow['result'] =
      rawResult === 'CUMPLE' ? 'COMPLIES' : rawResult === 'NO CUMPLE' ? 'DOES_NOT_COMPLY' : null;
    if (!key || key.length > 511) {
      errorCode = 'INVALID_AUTO_KEY'; errorMessage = 'La clave AUTO es obligatoria (máximo 511 caracteres).';
    } else if (!result) {
      errorCode = 'INVALID_RESULT'; errorMessage = 'El resultado debe ser CUMPLE o NO CUMPLE.';
    } else if (observation && observation.length > 4000) {
      errorCode = 'OBSERVATION_TOO_LONG'; errorMessage = 'La observación no puede superar 4000 caracteres.';
    } else if (result === 'DOES_NOT_COMPLY' && !observation) {
      errorCode = 'OBSERVATION_REQUIRED'; errorMessage = 'NO CUMPLE requiere observación.';
    }
    rows.push({ rowNumber: i + 1, authorizationKey: key, result, observation, errorCode, errorMessage });
  }
  if (!rows.length) return reject('EMPTY_FILE', 'No existen registros para procesar.');
  const frequency = new Map<string, number>();
  for (const row of rows) if (row.authorizationKey) frequency.set(row.authorizationKey, (frequency.get(row.authorizationKey) ?? 0) + 1);
  for (const row of rows) {
    if (row.authorizationKey && (frequency.get(row.authorizationKey) ?? 0) > 1) {
      row.errorCode = 'DUPLICATE_AUTO_IN_FILE';
      row.errorMessage = 'La clave AUTO está repetida dentro del archivo.';
    }
  }
  return rows;
}

export function createBillingAuditBulkTemplate(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['CLAVE_AUTO', 'RESULTADO', 'OBSERVACION']]), 'Auditoria');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['KEY', 'VALUE'], ['templateVersion', BILLING_AUDIT_BULK_TEMPLATE_VERSION], ['importType', 'BILLING_AUDITS'],
  ]), 'METADATA');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['CAMPO', 'INSTRUCCIÓN'],
    ['CLAVE_AUTO', 'Clave exacta de la AUTO. No usar únicamente el número de autorización.'],
    ['RESULTADO', 'Escribir CUMPLE o NO CUMPLE.'],
    ['OBSERVACION', 'Obligatoria para NO CUMPLE y para CUMPLE cuando no existan soportes. Máximo 4000 caracteres.'],
    ['ESTADOS', 'Solo autorizaciones cerradas (CLOSED), incluso con aplicación pendiente. La decisión es definitiva.'],
  ]), 'Instrucciones');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function createBillingAuditBulkResult(rows: ReadonlyArray<{
  rowNumber: number; authorizationKey: string; result: string | null; observation: string | null;
  executionStatus: string; errorCode: string | null; errorMessage: string | null; operationalStatus: string | null;
}>): Buffer {
  const escapeCell = (s: string | null) => s && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['FILA', 'CLAVE_AUTO', 'RESULTADO', 'OBSERVACION', 'ESTADO', 'CODIGO_ERROR', 'ERROR', 'ESTADO_AUTO_AL_AUDITAR'],
    ...rows.map((r) => [r.rowNumber, escapeCell(r.authorizationKey), r.result === 'COMPLIES' ? 'CUMPLE' : r.result === 'DOES_NOT_COMPLY' ? 'NO CUMPLE' : '', escapeCell(r.observation), r.executionStatus, r.errorCode, escapeCell(r.errorMessage), r.operationalStatus]),
  ]), 'Resultado');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
