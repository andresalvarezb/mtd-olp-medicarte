import * as XLSX from 'xlsx';

type SpreadsheetValue = unknown;

function safeSpreadsheetValue(value: SpreadsheetValue): SpreadsheetValue {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return JSON.stringify(value) ?? '';
  }
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
}

export function createXlsxExport(
  columns: readonly string[],
  rows: readonly Record<string, SpreadsheetValue>[],
): Buffer {
  const sheetRows = [
    [...columns],
    ...rows.map((row) => columns.map((column) => safeSpreadsheetValue(row[column]))),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(sheetRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Datos');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
