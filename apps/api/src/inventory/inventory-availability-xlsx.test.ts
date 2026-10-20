import { describe, expect, it } from 'vitest';

import {
  buildInventoryAvailabilityTemplate,
  parseInventoryAvailabilityWorkbook,
} from './inventory-availability-xlsx';

describe('inventory availability xlsx', () => {
  it('round-trips the official OC template', () => {
    const content = buildInventoryAvailabilityTemplate();

    expect(content.length).toBeGreaterThan(0);

    expect(() => parseInventoryAvailabilityWorkbook(content)).toThrow(
      'INVENTORY_AVAILABILITY_NO_ROWS',
    );
  });
});

describe('Disponibilidades: exportación de compromisos liberados', () => {
  it('separa stock físico, saldo de compra e historial', async () => {
    const XLSX = await import('xlsx');
    const { InventoryAvailabilityService } =
      await import('./inventory-availability.service');

    const service = new InventoryAvailabilityService({
      list: async () => ({
        items: [{
          purchaseOrderId: 'PO-1',
          purchaseOrderCode: 'OC-1',
          commercialCode: '10517',
          productDescription: 'Producto prueba',
          dispensingPointCode: 'IBAGUE',
          requestedQuantity: 10,
          receivedQuantity: 6,
          fulfilledQuantity: 0,
          assignedQuantity: 0,
          availableQuantity: 6,
          pendingReceiptQuantity: 4,
          activeCommitmentQuantity: 0,
          purchaseCommitmentAvailableQuantity: 4,
          historicalAnnulmentReleasedQuantity: 10,
        }],
      }),
    } as never);

    const buffer = await service.exportWorkbook(
      { organizationCode: 'MTD' } as never,
      {},
    );

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, number | string>>(
      workbook.Sheets['DISPONIBILIDAD']!,
    );

    expect(rows[0]).toMatchObject({
      RECIBIDO: 6,
      DISPONIBLE_SIN_ASIGNAR: 6,
      COMPROMISO_OC_ACTIVO: 0,
      SALDO_OC_PENDIENTE_SIN_COMPROMETER: 4,
      LIBERADO_ANULACION_HISTORICO: 10,
    });
  });
});
