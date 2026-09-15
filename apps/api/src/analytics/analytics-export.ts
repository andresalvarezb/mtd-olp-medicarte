import * as XLSX from 'xlsx';
import type { OperationalAnalyticsResponse } from '@authorization/contracts';
import {
  ANALYTICS_EXPORT_UNAVAILABLE_LABEL,
  CURRENT_ON_HAND_LABEL,
  moneyExportRow,
} from '@authorization/domain';

function sheet(name: string, rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null>>) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows.map((row) => [...row]));
  worksheet['!cols'] = (rows[0] ?? []).map(() => ({ wch: 28 }));
  return { name, worksheet };
}

export function buildAnalyticsExportWorkbook(
  data: OperationalAnalyticsResponse,
  includeEconomics: boolean,
): Buffer {
  const workbook = XLSX.utils.book_new();
  const money = includeEconomics ? data.economics : null;
  const sheets = [
    sheet('RESUMEN', [
      ['Filtro', 'Valor'],
      ['generatedAt', data.freshness.generatedAt],
      ['planningPeriodId', data.freshness.planningPeriodId],
      ['lastConsolidatedAt', data.demand.lastConsolidatedAt],
      ['projectedDemandStale', data.demand.stale],
      ['definitionsVersion', data.freshness.definitionsVersion],
      ['projectedQuantity', data.funnel.projectedQuantity],
      ['requestedQuantity', data.funnel.requestedQuantity],
      ['acceptedQuantity', data.funnel.acceptedQuantity],
      ['dispatchedQuantity', data.funnel.dispatchedQuantity],
      ['physicallyReceivedQuantity', data.funnel.physicallyReceivedQuantity],
      ['acceptedIntoInventoryQuantity', data.funnel.acceptedIntoInventoryQuantity],
      ['appliedQuantity', data.funnel.appliedQuantity],
      ['purchaseCoverageRate', data.procurement.purchaseCoverageRate.rate],
      ['supplierAcceptanceRate', data.procurement.supplierAcceptanceRate.rate],
    ]),
    sheet('FUNNEL', [
      ['Etapa', 'Cantidad'],
      ['Proyectado', data.funnel.projectedQuantity],
      ['Solicitado a OLP', data.funnel.requestedQuantity],
      ['Aceptado OLP', data.funnel.acceptedQuantity],
      ['Despachado', data.funnel.dispatchedQuantity],
      ['Recibido físico', data.funnel.physicallyReceivedQuantity],
      ['Aceptado a inventario', data.funnel.acceptedIntoInventoryQuantity],
      ['Aplicado', data.funnel.appliedQuantity],
    ]),
    sheet('INVENTARIO', [
      ['Indicador', 'Valor'],
      ['Stock físico actual', data.inventory.currentOnHandQuantity],
      ['Stock utilizable actual', data.inventory.usableBalance],
      ['En tránsito', data.inventory.inTransitQuantity],
      [CURRENT_ON_HAND_LABEL, data.inventory.currentOnHandQuantity],
      [
        data.inventory.receivedMinusAppliedFlow.label,
        data.inventory.receivedMinusAppliedFlow.value,
      ],
      ['disclaimer', data.inventory.receivedMinusAppliedFlow.disclaimer],
    ]),
    sheet('NOVEDADES', [
      ['noveltyCode', 'count'],
      ...data.outcomes.distribution.map((item) => [item.noveltyCode, item.count]),
      ['notAppliedCount', data.outcomes.notAppliedCount],
      ['noShowRate', data.outcomes.noShowRate.rate],
    ]),
    sheet('AUDITORIA', [
      ['Indicador', 'Valor'],
      ['readyForAudit', data.audit.readyForAudit],
      ['inReview', data.audit.inReview],
      ['approved', data.audit.approved],
      ['rejected', data.audit.rejected],
    ]),
    ...(money
      ? [
          sheet('ECONOMIA', [
            ['metric', 'availability', 'value', 'basis', 'reason'],
            moneyExportRow(
              'projectedTariffReferenceValue',
              money.compensar.projectedTariffReferenceValue,
            ),
            moneyExportRow(
              'requestedTariffSnapshotValue',
              money.compensar.requestedTariffSnapshotValue,
            ),
            moneyExportRow(
              'acceptedTariffSnapshotValue',
              money.compensar.acceptedTariffSnapshotValue,
            ),
            moneyExportRow('requestedSupplierValue', money.olp.requestedSupplierValue),
            moneyExportRow('acceptedSupplierValue', money.olp.acceptedSupplierValue),
            moneyExportRow('dispatchedSupplierValue', money.olp.dispatchedSupplierValue),
            moneyExportRow('acceptedReceiptSupplierValue', money.olp.acceptedReceiptSupplierValue),
            moneyExportRow('appliedSupplierCost', money.olp.appliedSupplierCost),
            moneyExportRow(
              'grossOperationalSpreadReference',
              money.grossOperationalSpreadReference,
            ),
            ['UNAVAILABLE_LABEL', ANALYTICS_EXPORT_UNAVAILABLE_LABEL, null, null, null],
          ]),
        ]
      : []),
    sheet('METADATA', [
      ['key', 'value'],
      ['exportKind', 'ANALYTICS'],
      ['definitionsVersion', data.freshness.definitionsVersion],
      ['economicsIncluded', includeEconomics],
    ]),
  ];
  for (const item of sheets) {
    XLSX.utils.book_append_sheet(workbook, item.worksheet, item.name);
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
