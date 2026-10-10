import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  createBillingAuditBulkTemplate,
  parseBillingAuditBulkWorkbook,
} from './authorization-billing-audit-bulk.xlsx';

function makeWorkbook(rows: unknown[][], version = 'BILLING_AUDIT_V1'): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['CLAVE_AUTO', 'RESULTADO', 'OBSERVACION'], ...rows,
  ]), 'Auditoria');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['KEY', 'VALUE'], ['templateVersion', version], ['importType', 'BILLING_AUDITS'],
  ]), 'METADATA');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('BILLING_AUDIT_V1', () => {
  it('genera una plantilla válida', () => {
    expect(() => parseBillingAuditBulkWorkbook(createBillingAuditBulkTemplate())).toThrow(); // sin filas de datos
  });
  it('reconoce CUMPLE', () => {
    expect(parseBillingAuditBulkWorkbook(makeWorkbook([['AUTO-1', 'CUMPLE', 'Revisión correcta']]))[0])
      .toMatchObject({ result: 'COMPLIES', errorCode: null });
  });
  it('reconoce NO CUMPLE y exige observación', () => {
    expect(parseBillingAuditBulkWorkbook(makeWorkbook([['AUTO-1', 'NO CUMPLE', '']]))[0])
      .toMatchObject({ result: 'DOES_NOT_COMPLY', errorCode: 'OBSERVATION_REQUIRED' });
  });
  it('rechaza resultados no permitidos', () => {
    expect(parseBillingAuditBulkWorkbook(makeWorkbook([['AUTO-1', 'APROBADO', 'x']]))[0]?.errorCode)
      .toBe('INVALID_RESULT');
  });
  it('rechaza ambas filas duplicadas', () => {
    const rows = parseBillingAuditBulkWorkbook(makeWorkbook([
      ['AUTO-1', 'CUMPLE', 'x'], ['AUTO-1', 'NO CUMPLE', 'y'],
    ]));
    expect(rows.map((r) => r.errorCode)).toEqual(['DUPLICATE_AUTO_IN_FILE', 'DUPLICATE_AUTO_IN_FILE']);
  });
  it('rechaza observaciones mayores de 4000 caracteres', () => {
    const rows = parseBillingAuditBulkWorkbook(makeWorkbook([['AUTO-1', 'CUMPLE', 'x'.repeat(4001)]]));
    expect(rows[0]?.errorCode).toBe('OBSERVATION_TOO_LONG');
  });
  it('rechaza versiones desconocidas', () => {
    expect(() => parseBillingAuditBulkWorkbook(makeWorkbook([['AUTO-1', 'CUMPLE', 'x']], 'OTRA')))
      .toThrow();
  });
  it('rechaza fórmulas de Excel', () => {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['CLAVE_AUTO', 'RESULTADO', 'OBSERVACION'], ['AUTO-1', 'CUMPLE', 'x'],
    ]);
    sheet.C2 = { t: 'n', f: '1+1', v: 2 };
    XLSX.utils.book_append_sheet(wb, sheet, 'Auditoria');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['KEY', 'VALUE'], ['templateVersion', 'BILLING_AUDIT_V1'], ['importType', 'BILLING_AUDITS'],
    ]), 'METADATA');
    const content = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    expect(() => parseBillingAuditBulkWorkbook(content)).toThrow();
  });
});
