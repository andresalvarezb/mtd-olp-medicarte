import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import type { Scope } from '../common/request-scope';
import { ExportablesService } from './exportables.service';


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

describe('WAVE2 - exportaciones por bloques', () => {
  it('preserva filas, ceros iniciales y protección de fórmulas', async () => {
    const products = Array.from({ length: 2005 }, (_, i) => ({
      OC: 'OC-' + i,
      CODIGO_PRODUCTO: i === 2004 ? '00000123' : 'MED-' + i,
      PRODUCTO: i === 1000 ? '=1+1' : 'PRODUCTO-' + i,
      CANTIDAD_SOLICITADA: i,
      CANTIDAD_OLP: i,
      CANTIDAD_MEDICARTE: i,
      PUNTO: 'CIMA',
    }));

    const related = products.map((row, i) => ({
      OC: row.OC,
      CLAVE_AUTO: 'AUTO-' + i + '|MED-' + i,
      NUMERO_AUTORIZACION: 'AUTO-' + i,
      CODIGO_PRODUCTO: row.CODIGO_PRODUCTO,
      CANTIDAD_AUTO: i,
      CANTIDAD_APORTADA_A_OC: i,
      PUNTO: 'CIMA',
    }));

    const query = vi.fn()
      .mockResolvedValueOnce({ rows: products })
      .mockResolvedValueOnce({ rows: related });

    const service = new ExportablesService({
      pool: { query },
    } as never);

    const result = await service.purchaseOrders({
      organizationCode: 'MTD',
    } as Scope);

    const book = XLSX.read(result.content, { type: 'buffer' });
    const sheet = book.Sheets.OC_PRODUCTOS!;
    const linked = book.Sheets.AUTO_RELACIONADAS!;

    expect(result.rowCount).toBe(2005);
    expect(sheet['!ref']).toBe('A1:G2006');
    expect(linked['!ref']).toBe('A1:G2006');
    expect(readCellValue(sheet, 'A2')).toBe('OC-0');
    expect(readCellValue(sheet, 'A1001')).toBe('OC-999');
    expect(readCellValue(sheet, 'A1002')).toBe('OC-1000');
    expect(readCellValue(sheet, 'A2006')).toBe('OC-2004');
    expect(readCellValue(sheet, 'B2006')).toBe('00000123');
    expect(readCellValue(sheet, 'C1002')).toBe("'=1+1");
    expect(readCellValue(sheet, 'D2')).toBe(0);
    expect(readCellValue(linked, 'B2006')).toBe('AUTO-2004|MED-2004');
    expect(query).toHaveBeenCalledTimes(2);
  });
});
