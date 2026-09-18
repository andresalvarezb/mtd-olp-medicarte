import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildTariffPreview,
  canonicalTariffValue,
  type ActiveTariffProduct,
} from './tariff-annex-xlsx';

function workbookBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'AT');

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
}

function product(overrides: Partial<ActiveTariffProduct> = {}): ActiveTariffProduct {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    codigoProducto: 'MED-001',
    tarifaUnidadRaw: '10,25',
    tarifaUnidadCanonical: '10.2500',
    numeroExpedienteInvima: 'EXP-1',
    consecutivoInvimaPresentacion: 'PRES-1',
    descripcionGenerica: 'Producto genérico',
    descripcionComercial: 'Producto comercial',
    laboratorio: 'Laboratorio',
    tipoInclusion: 'PBS',
    version: 1,
    active: true,
    ...overrides,
  };
}

const headers = [
  'CODIGO_PRODUCTO',
  'TARIFA_UNIDAD',
  'NUMERO_EXPEDIENTE_INVIMA',
  'CONSECUTIVO_INVIMA_PRESENTACION',
  'DESCRIPCION_GENERICA',
  'DESCRIPCION_COMERCIAL',
  'LABORATORIO',
  'TIPO_INCLUSION_MEDICAMENTO',
];

describe('tariff annex preview', () => {
  it('canonicaliza coma y punto al mismo numeric(18,4)', () => {
    expect(canonicalTariffValue('10,25')).toBe('10.2500');
    expect(canonicalTariffValue('10.2500')).toBe('10.2500');
    expect(canonicalTariffValue('0')).toBe('0.0000');
    expect(canonicalTariffValue('abc')).toBeNull();
  });

  it('clasifica producto nuevo como CHANGED + NEW', () => {
    const preview = buildTariffPreview({
      content: workbookBuffer([
        headers,
        ['MED-NEW', '12,50', 'EXP-2', 'PRES-2', 'Gen', 'Com', 'Lab', 'PBS'],
      ]),
      activeProducts: [],
    });

    expect(preview).toMatchObject({
      total: 1,
      unchanged: 0,
      changed: 1,
      anomalous: 0,
      rejected: 0,
    });

    expect(preview.rows[0]).toMatchObject({
      codigoProducto: 'MED-NEW',
      state: 'CHANGED',
      action: 'NEW',
    });
  });

  it('considera 10,25 y 10.2500 comercialmente iguales', () => {
    const preview = buildTariffPreview({
      content: workbookBuffer([
        headers,
        [
          'med-001',
          '10.2500',
          'EXP-1',
          'PRES-1',
          'Producto genérico',
          'Producto comercial',
          'Laboratorio',
          'PBS',
        ],
      ]),
      activeProducts: [product()],
    });

    expect(preview.unchanged).toBe(1);
    expect(preview.changed).toBe(0);
    expect(preview.rows[0]?.state).toBe('UNCHANGED');
    expect(preview.rows[0]?.action).toBe('UNCHANGED');
  });

  it('clasifica cambio comercial real como UPDATE', () => {
    const preview = buildTariffPreview({
      content: workbookBuffer([
        headers,
        [
          'MED-001',
          '12.50',
          'EXP-1',
          'PRES-1',
          'Producto genérico',
          'Producto comercial',
          'Laboratorio',
          'PBS',
        ],
      ]),
      activeProducts: [product()],
    });

    expect(preview.changed).toBe(1);
    expect(preview.rows[0]).toMatchObject({
      state: 'CHANGED',
      action: 'UPDATE',
      anomalyCode: null,
    });
  });

  it('detecta salto de escala x1000', () => {
    const preview = buildTariffPreview({
      content: workbookBuffer([
        headers,
        [
          'MED-001',
          '10250',
          'EXP-1',
          'PRES-1',
          'Producto genérico',
          'Producto comercial',
          'Laboratorio',
          'PBS',
        ],
      ]),
      activeProducts: [product()],
    });

    expect(preview.anomalous).toBe(1);
    expect(preview.rows[0]).toMatchObject({
      state: 'ANOMALOUS',
      action: 'UPDATE',
      anomalyCode: 'TARIFF_SCALE_X1000',
    });
  });

  it('marca scalePatternDetected con dos anomalías', () => {
    const preview = buildTariffPreview({
      content: workbookBuffer([
        headers,
        ['MED-001', '10250', 'EXP-1', 'PRES-1', 'Gen 1', 'Com 1', 'Lab', 'PBS'],
        ['MED-002', '20000', 'EXP-2', 'PRES-2', 'Gen 2', 'Com 2', 'Lab', 'PBS'],
      ]),
      activeProducts: [
        product({
          codigoProducto: 'MED-001',
          tarifaUnidadRaw: '10.25',
          tarifaUnidadCanonical: '10.2500',
          descripcionGenerica: 'Gen 1',
          descripcionComercial: 'Com 1',
        }),
        product({
          id: '00000000-0000-4000-8000-000000000002',
          codigoProducto: 'MED-002',
          tarifaUnidadRaw: '20',
          tarifaUnidadCanonical: '20.0000',
          numeroExpedienteInvima: 'EXP-2',
          consecutivoInvimaPresentacion: 'PRES-2',
          descripcionGenerica: 'Gen 2',
          descripcionComercial: 'Com 2',
        }),
      ],
    });

    expect(preview.anomalous).toBe(2);
    expect(preview.scalePatternDetected).toBe(true);
  });

  it('rechaza tarifa no numérica', () => {
    const preview = buildTariffPreview({
      content: workbookBuffer([
        headers,
        ['MED-001', 'NO-VALIDA', 'EXP-1', 'PRES-1', 'Gen', 'Com', 'Lab', 'PBS'],
      ]),
      activeProducts: [product()],
    });

    expect(preview.rejected).toBe(1);
    expect(preview.rows[0]).toMatchObject({
      state: 'REJECTED',
      action: 'REJECT',
      anomalyCode: 'INVALID_TARIFF_VALUE',
    });
  });

  it('acepta encabezados comerciales maduros *_MEDICAMENTO', () => {
    const matureHeaders = [
      'CODIGO_PRODUCTO',
      'TARIFA_UNIDAD',
      'NUMERO_EXPEDIENTE_INVIMA',
      'CONSECUTIVO_INVIMA_PRESENTACION',
      'DESCRIPCION_GENERICA_MEDICAMENTO',
      'DESCRIPCION_COMERCIAL_MEDICAMENTO',
      'LABORATORIO_MEDICAMENTO',
      'TIPO_INCLUSION_MEDICAMENTO',
    ];

    const preview = buildTariffPreview({
      content: workbookBuffer([
        matureHeaders,
        ['MED-MATURE', '25,50', 'EXP-M', 'PRES-M', 'Gen Mature', 'Com Mature', 'Lab Mature', 'PBS'],
      ]),
      activeProducts: [],
    });

    expect(preview.changed).toBe(1);

    expect(preview.rows[0]?.next).toMatchObject({
      codigoProducto: 'MED-MATURE',
      tarifaUnidadCanonical: '25.5000',
      descripcionGenerica: 'Gen Mature',
      descripcionComercial: 'Com Mature',
      laboratorio: 'Lab Mature',
      tipoInclusion: 'PBS',
    });
  });

  it('rechaza código duplicado dentro del mismo archivo', () => {
    const preview = buildTariffPreview({
      content: workbookBuffer([
        headers,
        ['MED-NEW', '10', null, null, null, null, null, 'PBS'],
        ['MED-NEW', '10', null, null, null, null, null, 'PBS'],
      ]),
      activeProducts: [],
    });

    expect(preview.total).toBe(2);
    expect(preview.changed).toBe(1);
    expect(preview.rejected).toBe(1);

    expect(preview.rows[1]).toMatchObject({
      state: 'REJECTED',
      action: 'REJECT',
      anomalyCode: 'DUPLICATE_PRODUCT_IN_FILE',
    });
  });
});
