import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import type { Scope } from '../common/request-scope';
import { ExportablesService } from './exportables.service';

const scope = {
  organizationCode: 'MTD',
} as Scope;

function fixture(
  id: string,
  billingAuditStatus: string | null,
  billingAuditResult: string | null,
  billingAuditObservation: string | null,
) {
  return {
    id,
    authorization_key: `${id}:10157`,
    numero_autorizacion: id,
    codigo_medicamento: '10157',
    source_data: {
      NUMERO_AUTORIZACION: id,
      CODIGO_COMERCIAL: '10157',
      CANTIDAD: '1',
      FECHA_ASIGNACION: '20260901',
      FECHA_FINAL_VIGENCIA: '20991231',
    },
    enablement_status: 'ENABLED',
    tariff_membership_status: 'LISTED',
    coverage_type: 'PBS',
    direction_status: 'NOT_APPLICABLE',
    minimum_quantity: 1,
    has_any_po: false,
    has_active_po: false,
    purchase_order_codes: null,
    dispensing_points: null,
    allocated_quantity: 0,
    consumed_quantity: 0,
    released_quantity: 0,
    remaining_quantity: 0,
    fulfillment_type: null,
    effective_date: null,
    fulfillment_quantity: null,
    has_legacy_fulfillment: false,
    // Una revisión clínica no debe sobrescribir la auditoría de facturación.
    resolved_review_status: 'REJECTED',
    audit_observations: 'Observación clínica ajena a facturación',
    billing_audit_status: billingAuditStatus,
    billing_audit_result: billingAuditResult,
    billing_audit_observation: billingAuditObservation,
    created_at: new Date('2026-10-08T21:25:06.509Z'),
    updated_at: new Date('2026-10-08T21:25:06.509Z'),
  };
}

describe('ExportablesService: auditoría de facturación en AUTORIZACIONES', () => {
  it('exporta el estado real y la observación desde authorization_billing_audits', async () => {
    const historicalObservation =
      'Homologación histórica. Fuente: 1.Medicamentos Alto Costo-Sep.xlsx; ' +
      'hoja: 1.Base Datos Medicamentos; fila: 667; estado fuente: Facturado.';

    const query = vi.fn().mockResolvedValue({
      rows: [
        fixture('262095760542497', 'REVIEWED', 'COMPLIES', historicalObservation),
        fixture('AUTO-NO-CUMPLE', 'REVIEWED', 'DOES_NOT_COMPLY', 'Falta soporte'),
        fixture('AUTO-PENDIENTE', 'PENDING', null, null),
        fixture('AUTO-SIN-AUDITORIA', null, null, null),
        fixture('AUTO-INCONSISTENTE', 'REVIEWED', null, null),
      ],
    });

    const service = new ExportablesService({ pool: { query } } as never);
    const result = await service.authorizations(scope);
    const workbook = XLSX.read(result.content, { type: 'buffer' });
    const sheet = workbook.Sheets.AUTORIZACIONES;
    expect(sheet).toBeDefined();

    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(
      sheet!,
      { defval: '' },
    );
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => [row.AUDITORIA, row.OBSERVACION_AUDITORIA])).toEqual([
      ['Revisada · Cumple', historicalObservation],
      ['Revisada · No cumple', 'Falta soporte'],
      ['Pendiente', ''],
      ['Sin auditoría de facturación', ''],
      ['Inconsistente', ''],
    ]);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('authorization_billing_audits');
    expect(sql).not.toContain('from\n                audit_reviews review');
  });
});
