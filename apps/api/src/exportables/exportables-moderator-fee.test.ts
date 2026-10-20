import * as XLSX from 'xlsx';

import { describe, expect, it, vi } from 'vitest';

import type { Scope } from '../common/request-scope';

import { ExportablesService } from './exportables.service';

const scope = {
  organizationCode: 'MTD',
} as Scope;

const userId =
  '40000000-0000-4000-8000-000000000001';

function row(
  id: string,
  status: string | null,
  amount: string | null,
  collectedAt: string | null,
  version: number | null,
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
      VALOR_CUOTA_MODERADORA: '15000',
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

    billing_audit_status: null,
    billing_audit_result: null,
    billing_audit_observation: null,

    moderator_fee_status: status,
    moderator_fee_amount_cop: amount,
    moderator_fee_collected_at: collectedAt,
    moderator_fee_registered_at: version
      ? '2026-10-17T18:00:00.000Z'
      : null,
    moderator_fee_registered_by: version ? userId : null,
    moderator_fee_version: version,

    created_at: new Date('2026-10-08T12:00:00.000Z'),
    updated_at: new Date('2026-10-08T12:00:00.000Z'),
  };
}

describe('ExportablesService: recaudo de cuota moderadora', () => {
  it('separa cuota original, recaudo y ausencia de registro', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        row(
          'AUTO-PAGADA',
          'COLLECTED',
          '12500.50',
          '2026-10-16T15:00:00.000Z',
          2,
        ),

        row(
          'AUTO-NO-PAGADA',
          'NOT_COLLECTED',
          null,
          null,
          1,
        ),

        row(
          'AUTO-SIN-REGISTRO',
          null,
          null,
          null,
          null,
        ),
      ],
    });

    const service = new ExportablesService({
      pool: { query },
    } as never);

    const result = await service.authorizations(scope);

    const workbook = XLSX.read(result.content, {
      type: 'buffer',
    });

    const sheet = workbook.Sheets.AUTORIZACIONES;

    expect(sheet).toBeDefined();
    expect(result.rowCount).toBe(3);

    const records = XLSX.utils.sheet_to_json<
      Record<string, string | number>
    >(sheet!, { defval: '' });

    expect(records).toHaveLength(3);

    const paid = records.find(
      item => item.NUMERO_AUTORIZACION === 'AUTO-PAGADA',
    );

    const unpaid = records.find(
      item => item.NUMERO_AUTORIZACION === 'AUTO-NO-PAGADA',
    );

    const unrecorded = records.find(
      item => item.NUMERO_AUTORIZACION === 'AUTO-SIN-REGISTRO',
    );

    expect(paid).toBeDefined();
    expect(unpaid).toBeDefined();
    expect(unrecorded).toBeDefined();

    // Valor original intacto y diferente del recaudo.
    expect(String(paid?.VALOR_CUOTA_MODERADORA)).toBe('15000');

    expect(
      String(paid?.CUOTA_ESTABLECIDA_AUTORIZACION),
    ).toBe('15000');

    expect(paid?.ESTADO_RECAUDO_CUOTA).toBe('RECAUDADA');
    expect(paid?.VALOR_RECAUDADO_CUOTA_COP).toBe(12500.5);
    expect(paid?.VERSION_REGISTRO_RECAUDO_CUOTA).toBe(2);
    expect(
      paid?.USUARIO_REGISTRO_RECAUDO_CUOTA,
    ).toBe(userId);

    expect(
      String(paid?.FECHA_EFECTIVA_RECAUDO_CUOTA),
    ).toContain('2026-10-16');

    expect(
      String(paid?.FECHA_REGISTRO_RECAUDO_CUOTA),
    ).toContain('2026-10-17');

    expect(unpaid?.ESTADO_RECAUDO_CUOTA).toBe('NO RECAUDADA');
    expect(unpaid?.VALOR_RECAUDADO_CUOTA_COP).toBe('');
    expect(unpaid?.FECHA_EFECTIVA_RECAUDO_CUOTA).toBe('');
    expect(unpaid?.VERSION_REGISTRO_RECAUDO_CUOTA).toBe(1);

    expect(unrecorded?.ESTADO_RECAUDO_CUOTA).toBe('SIN REGISTRO');
    expect(unrecorded?.VALOR_RECAUDADO_CUOTA_COP).toBe('');
    expect(unrecorded?.VERSION_REGISTRO_RECAUDO_CUOTA).toBe('');
  });

  it('selecciona solo el evento financiero más reciente por versión', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        row(
          'AUTO-CORREGIDA',
          'COLLECTED',
          '14000.00',
          '2026-10-17T15:00:00.000Z',
          3,
        ),
      ],
    });

    const service = new ExportablesService({
      pool: { query },
    } as never);

    const result = await service.authorizations(scope);

    const sql = String(query.mock.calls[0]?.[0]);

    expect(sql).toContain(
      'authorization_moderator_fee_events fee'
    );

    expect(sql).toMatch(
      /order by\s+fee\.version desc\s+limit 1/
    );

    expect(sql).toContain('left join lateral');

    // No multiplica autorizaciones por sus eventos históricos.
    expect(result.rowCount).toBe(1);

    const workbook = XLSX.read(result.content, {
      type: 'buffer',
    });

    const records = XLSX.utils.sheet_to_json<
      Record<string, string | number>
    >(workbook.Sheets.AUTORIZACIONES!, {
      defval: '',
    });

    expect(records).toHaveLength(1);

    expect(records[0]?.VERSION_REGISTRO_RECAUDO_CUOTA).toBe(3);
    expect(records[0]?.VALOR_RECAUDADO_CUOTA_COP).toBe(14000);
    expect(records[0]?.ESTADO_RECAUDO_CUOTA).toBe('RECAUDADA');
  });
});
