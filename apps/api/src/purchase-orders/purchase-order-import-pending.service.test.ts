import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { PurchaseOrderImportService } from './purchase-order-import.service';

const OC_ID = '20000000-0000-4000-8000-000000000001';
const AUTO_ID = '30000000-0000-4000-8000-000000000001';
const POINT_ID = '40000000-0000-4000-8000-000000000001';
const LINE_ID = '50000000-0000-4000-8000-000000000001';

const actor = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  organizationCode: 'MTD',
  userId: '10000000-0000-4000-8000-000000000002',
  correlationId: '10000000-0000-4000-8000-000000000003',
  readSensitive: true,
  isFoundationAdmin: true,
  canCrossOrganizationOperationalExport: true,
  pointAccessKind: 'unrestricted',
} as const;

function workbook() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['AUTO_ORIGEN', 'AUTO_DESTINO', 'OC', 'CODIGO_PRODUCTO', 'CANTIDAD'],
    ['', 'AUTO-DEST', 'OC-ANULACION', 'PROD-1', 2],
  ]), 'ORDENES_COMPRA');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['templateVersion', 'PURCHASE_ORDERS_V2'],
    ['importType', 'PURCHASE_ORDERS'],
  ]), 'METADATA');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    originalname: 'oc.xlsx',
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length,
    buffer,
  };
}

function result<T>(rows: T[]) {
  return { rows, rowCount: rows.length };
}

function assignmentDateWithinWindow() {
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) =>
    Number(dateParts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(
    value('year'),
    value('month') - 1,
    value('day') + 7,
  )).toISOString().slice(0, 10).replaceAll('-', '');
}

function setup(options: {
  requested: number;
  committed?: number;
  received?: number;
  activeLinked?: boolean;
  assignmentRaw?: string;
  expirationRaw?: string;
  physicalAvailable?: number;
}) {
  const poolQuery = vi.fn((sql: string) => {
    if (String(sql).replace(/\s+/g, ' ').includes('purchase_order_code = any($1::text[])')) {
      return result([{ purchase_order_code: 'OC-ANULACION' }]);
    }
    throw new Error(`UNEXPECTED_POOL_QUERY: ${sql}`);
  });

  const clientQuery = vi.fn((sql: string, params?: unknown[]) => {
    const q = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

    if (['begin', 'commit', 'rollback'].includes(q)) return result([]);

    if (q.includes('select id, planning_period_id, order_type, status')) {
      return result([{
        id: OC_ID,
        planning_period_id: null,
        order_type: 'STANDARD',
        status: 'ISSUED',
      }]);
    }

    if (q.includes('from authorization_items ai') &&
        !q.includes('patient_default_dispensing_points pdp')) {
      return result([{
        id: AUTO_ID,
        authorization_key: 'AUTO-DEST',
        commercial_code: 'PROD-1',
        authorization_version: 1,
        authorized_quantity: 2,
        enablement_status: 'ENABLED',
        source_status_normalized: '5',
        coverage_type: 'PBS',
        direction_status: 'NOT_APPLICABLE',
        mipres_manual_decision: 'PENDING_MANUAL_ENABLEMENT',
        assignment_raw: options.assignmentRaw ?? assignmentDateWithinWindow(),
        expiration_raw: options.expirationRaw ?? '20991231',
        closed: false,
      }]);
    }

    if (q.includes('as fulfilled_quantity') &&
        q.includes('as assigned_quantity') &&
        q.includes('as committed_quantity')) {
      return result([{
        fulfilled_quantity: 0,
        assigned_quantity: 0,
        committed_quantity: 0,
      }]);
    }

    if (q.includes('as committed_here') && q.includes('as allocated_here')) {
      return result([{ committed_here: 0, allocated_here: 0 }]);
    }

    if (q.includes('from patient_schedules ps') ||
        q.includes('patient_default_dispensing_points pdp')) {
      return result([]);
    }

    if (q.includes('from tariff_annex_products tap') &&
        q.includes('join product_delivery_point_mappings mapping') &&
        q.includes('limit 2')) {
      return result([{ dispensing_point_id: POINT_ID }]);
    }

    if (q.includes('from purchase_order_lines pol') &&
        q.includes('limit 1')) {
      return result([{ id: LINE_ID }]);
    }

    if (q.includes('pg_advisory_xact_lock')) return result([]);

    if (q.includes('as point_available_quantity')) {
      return result([{
        point_available_quantity: options.physicalAvailable ?? 0,
        global_available_quantity: options.physicalAvailable ?? 0,
        point_received_quantity: options.received ?? 0,
        global_received_quantity: options.received ?? 0,
        has_direct_receipt: false,
      }]);
    }

    if (q.includes('as physical_available_quantity')) {
      return result([{ physical_available_quantity: 0 }]);
    }

    if (q.includes('with product_lines as (') &&
        q.includes('destination_active_linked')) {
      return result([{
        line_id: LINE_ID,
        requested_quantity: options.requested,
        received_quantity: options.received ?? 0,
        committed_quantity: options.committed ?? 0,
        destination_active_linked: options.activeLinked ?? false,
        global_requested_quantity: options.requested,
        point_requested_quantity: options.requested,
        global_commitment_quantity: options.committed ?? 0,
        point_commitment_quantity: options.committed ?? 0,
      }]);
    }

    if (q.includes('insert into purchase_order_authorization_sources') ||
        q.includes('insert into audit_events')) {
      return result([]);
    }

    throw new Error(`UNEXPECTED_CLIENT_QUERY: ${q}; PARAMS=${JSON.stringify(params)}`);
  });

  const release = vi.fn();
  const instance = new PurchaseOrderImportService({
    pool: {
      query: poolQuery,
      connect: vi.fn(() => ({ query: clientQuery, release })),
    },
  } as never, {} as never);
  return { instance, clientQuery, release };
}

describe('Asignación de compromiso de compra pendiente', () => {
  afterEach(() => vi.useRealTimers());

  it('vincula una AUTO dentro de la gracia a compra pendiente sin reservar inventario recibido', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
    const { instance, clientQuery } = setup({
      requested: 5,
      received: 2,
      physicalAvailable: 2,
      assignmentRaw: '2026-10-01',
      expirationRaw: '2026-11-01',
    });
    const imported = await instance.import(workbook(), actor);

    expect(imported.acceptedRows, JSON.stringify(imported.results)).toBe(1);
    const statements = clientQuery.mock.calls.map(([sql]) => String(sql).toLowerCase()).join('\n');
    expect(statements).toContain('insert into purchase_order_authorization_sources');
    expect(statements).not.toContain('insert into inventory_authorization_allocations');
    expect(statements).not.toContain('insert into inventory_allocation_batches');
  });

  it('vincula a otra AUTO una OC no recibida con compromiso liberado sin inventar inventario ni alterar OC', async () => {
    const { instance, clientQuery, release } = setup({ requested: 5 });
    const imported = await instance.import(workbook(), actor);

    expect(imported.acceptedRows).toBe(1);
    expect(imported.rejectedRows).toBe(0);
    expect(imported.createdOrders).toBe(0);

    const insertSource = clientQuery.mock.calls.find(([sql]) =>
      String(sql).toLowerCase().includes('insert into purchase_order_authorization_sources'));
    expect(insertSource).toBeDefined();
    expect(insertSource?.[1]).toEqual([LINE_ID, AUTO_ID, 2]);

    const statements = clientQuery.mock.calls.map(([sql]) =>
      String(sql).replace(/\s+/g, ' ').toLowerCase()).join('\n');
    expect(statements).not.toMatch(/insert into inventory_authorization_allocations/);
    expect(statements).not.toMatch(/insert into inventory_allocation_batches/);
    expect(statements).not.toMatch(/update purchase_order_lines/);
    expect(statements).not.toMatch(/update purchase_order_authorization_sources/);
    expect(statements).not.toMatch(/update purchase_order_receipt/);
    const audit = clientQuery.mock.calls.find(([sql]) =>
      String(sql).replace(/\s+/g, ' ').toLowerCase().includes('insert into audit_events'));
    expect(audit?.[1]?.[2]).toBe('PURCHASE_ORDER_PENDING_COMMITMENT_ASSIGNED');
    expect(statements).toContain('commit');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rechaza una solicitud superior al compromiso liberado', async () => {
    const { instance, clientQuery } = setup({ requested: 5, committed: 4 });
    const imported = await instance.import(workbook(), actor);

    expect(imported.acceptedRows).toBe(0);
    expect(imported.rejectedRows).toBe(1);
    expect(imported.results[0]?.errorCode).toBe(
      'PURCHASE_ORDER_PENDING_COMMITMENT_INSUFFICIENT');
    const statements = clientQuery.mock.calls.map(([sql]) => String(sql).toLowerCase()).join('\n');
    expect(statements).not.toContain('insert into purchase_order_authorization_sources');
    expect(statements).toContain('rollback');
  });

  it('permite volver a vincular la misma AUTO renovada tras liberar su vínculo anterior', async () => {
    const { instance, clientQuery } = setup({ requested: 5 });
    const imported = await instance.import(workbook(), actor);

    expect(imported.acceptedRows).toBe(1);
    const statements = clientQuery.mock.calls.map(([sql]) => String(sql).toLowerCase()).join('\n');
    expect(statements).toContain('insert into purchase_order_authorization_sources');
    expect(statements).not.toContain('update purchase_order_authorization_sources');
  });

  it('rechaza otro vínculo activo para la misma AUTO y línea', async () => {
    const { instance, clientQuery } = setup({ requested: 5, activeLinked: true });
    const imported = await instance.import(workbook(), actor);

    expect(imported.acceptedRows).toBe(0);
    expect(imported.rejectedRows).toBe(1);
    expect(imported.results[0]?.errorCode).toBe(
      'PURCHASE_ORDER_PENDING_COMMITMENT_LINES_INSUFFICIENT');
    const statements = clientQuery.mock.calls.map(([sql]) => String(sql).toLowerCase()).join('\n');
    expect(statements).not.toContain('insert into purchase_order_authorization_sources');
    expect(statements).toContain('rollback');
  });
});
