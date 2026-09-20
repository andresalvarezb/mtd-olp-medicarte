import { randomInt, randomUUID } from 'node:crypto';

import * as XLSX from 'xlsx';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ORGANIZATION_IDS, adminLogin } from './helpers/auth';

const database = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://authorization:authorization@localhost:15432/authorization_test_integration',
});

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

const suffix = randomUUID().slice(0, 8).toUpperCase();

const commercialCode = `W2A-${suffix}`;

const invimaRecord = String(randomInt(10_000_000, 99_999_999));

const invimaPresentation = '3';

const cumCode = `${invimaRecord}-03-0S01LA05`;

const firstSiteName = `CENTUM W2A ${suffix}`;

const firstSiteCode = `CENTUM_W2A_${suffix}`;

const secondSiteCode = `CHAPINERO_W2A_${suffix}`;

const periodStart = '2197-04-01';
const periodEnd = '2197-04-30';

let adminToken = '';
let userId = '';
let periodId = '';
let demandLineId = '';

let firstPointId = '';
let secondPointId = '';

let firstOrderId = '';
let firstOrderVersion = 0;

function workbook(): Buffer {
  const book = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['Código CUM Final ', 'MODELO', 'SEDE ENTREGA'],
      [cumCode, 'DISPENSACION', firstSiteName],
    ]),
    'Hoja1',
  );

  return XLSX.write(book, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
}

async function api(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
      'x-organization-id': ORGANIZATION_IDS.MTD,
    },
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
        }),
  });
}

async function uploadMapping(): Promise<Response> {
  const form = new FormData();

  form.append(
    'file',
    new Blob([new Uint8Array(workbook())], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `delivery-points-${suffix}.xlsx`,
  );

  return fetch(`${apiUrl}/api/v1/admin/product-delivery-points/import`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'x-organization-id': ORGANIZATION_IDS.MTD,
    },
    body: form,
  });
}

async function available() {
  const response = await api('GET', `/purchase-demand/available?planningPeriodId=${periodId}`);

  expect(response.status).toBe(200);

  const payload = (await response.json()) as {
    items: Array<Record<string, unknown>>;
  };

  const row = payload.items.find((item) => item.commercialCode === commercialCode);

  expect(row).toBeDefined();

  return row!;
}

async function createOrder(code: string) {
  return api('POST', '/purchase-orders', {
    planningPeriodId: periodId,
    orderType: 'STANDARD',
    purchaseOrderCode: code,
    lines: [
      {
        projectedDemandLineId: demandLineId,
        expectedDemandRevision: 1,
        requestedQuantity: 4,
        demandBucket: 'REGULAR',
      },
    ],
  });
}

async function cleanupFixture(): Promise<void> {
  await database.query(
    `delete from purchase_order_authorization_sources
      where purchase_order_line_id in (
        select pol.id
        from purchase_order_lines pol
        join purchase_orders po
          on po.id = pol.purchase_order_id
        join planning_periods pp
          on pp.id = po.planning_period_id
        where pp.start_date = $1
          and pp.end_date = $2
      )`,
    [periodStart, periodEnd],
  );

  await database.query(
    `delete from purchase_order_demand_allocations
      where purchase_order_line_id in (
        select pol.id
        from purchase_order_lines pol
        join purchase_orders po
          on po.id = pol.purchase_order_id
        join planning_periods pp
          on pp.id = po.planning_period_id
        where pp.start_date = $1
          and pp.end_date = $2
      )`,
    [periodStart, periodEnd],
  );

  await database.query(
    `delete from purchase_order_lines
      where purchase_order_id in (
        select po.id
        from purchase_orders po
        join planning_periods pp
          on pp.id = po.planning_period_id
        where pp.start_date = $1
          and pp.end_date = $2
      )`,
    [periodStart, periodEnd],
  );

  await database.query(
    `delete from purchase_orders
      where planning_period_id in (
        select id
        from planning_periods
        where start_date = $1
          and end_date = $2
      )`,
    [periodStart, periodEnd],
  );

  await database.query(
    `delete from demand_sources
      where projected_demand_line_id in (
        select pdl.id
        from projected_demand_lines pdl
        join planning_periods pp
          on pp.id = pdl.planning_period_id
        where pp.start_date = $1
          and pp.end_date = $2
      )`,
    [periodStart, periodEnd],
  );

  await database.query(
    `delete from projected_demand_lines
      where planning_period_id in (
        select id
        from planning_periods
        where start_date = $1
          and end_date = $2
      )`,
    [periodStart, periodEnd],
  );

  await database.query(
    `delete from product_delivery_point_mappings
      where dispensing_point_id in (
        select id
        from dispensing_points
        where code like 'CENTUM_W2A_%'
           or code like 'CHAPINERO_W2A_%'
      )`,
  );

  await database.query(
    `delete from tariff_annex_products
      where codigo_producto like 'W2A-%'`,
  );

  await database.query(
    `delete from inventory_locations
      where legacy_dispensing_point_id in (
        select id
        from dispensing_points
        where code like 'CENTUM_W2A_%'
           or code like 'CHAPINERO_W2A_%'
      )`,
  );

  await database.query(
    `delete from dispensing_points
      where code like 'CENTUM_W2A_%'
         or code like 'CHAPINERO_W2A_%'`,
  );

  await database.query(
    `delete from planning_periods
      where start_date = $1
        and end_date = $2`,
    [periodStart, periodEnd],
  );
}

describe('Wave 2A — product delivery point procurement', () => {
  beforeAll(async () => {
    await database.connect();

    await cleanupFixture();

    adminToken = await adminLogin();

    userId = (
      await database.query<{
        id: string;
      }>(
        `select id
             from users
            where username =
                  'foundation-admin'`,
      )
    ).rows[0]!.id;

    periodId = (
      await database.query<{
        id: string;
      }>(
        `insert into planning_periods (
             start_date,
             end_date,
             scheduling_cutoff_at,
             purchase_order_deadline_at,
             expected_delivery_date,
             status,
             created_by,
             updated_by
           )
           values (
             $1,
             $2,
             '2197-03-20T08:00:00Z',
             '2197-03-25T08:00:00Z',
             '2197-04-01',
             'PURCHASING',
             $3,
             $3
           )
           returning id`,
        [periodStart, periodEnd, userId],
      )
    ).rows[0]!.id;

    await database.query(
      `insert into tariff_annex_products (
           codigo_producto,
           tarifa_unidad,
           tarifa_unidad_canonical,
           numero_expediente_invima,
           consecutivo_invima_presentacion,
           descripcion_generica,
           descripcion_comercial,
           tipo_inclusion,
           active,
           organization_id,
           created_by,
           updated_by
         )
         values (
           $1,
           '500.00',
           500.0000,
           $2,
           '03',
           'Wave 2A generic',
           'Wave 2A commercial',
           'PBS',
           true,
           $3,
           $4,
           $4
         )`,
      [commercialCode, invimaRecord, ORGANIZATION_IDS.MTD, userId],
    );

    demandLineId = (
      await database.query<{
        id: string;
      }>(
        `insert into projected_demand_lines (
             planning_period_id,
             dispensing_point_id,
             commercial_code,
             projected_quantity,
             regular_quantity,
             late_quantity,
             status,
             revision,
             created_by,
             updated_by
           )
           values (
             $1,
             null,
             $2,
             10,
             10,
             0,
             'OPEN',
             1,
             $3,
             $3
           )
           returning id`,
        [periodId, commercialCode, userId],
      )
    ).rows[0]!.id;
  });
  afterAll(async () => {
    try {
      await cleanupFixture();
    } finally {
      await database.end();
    }
  });

  it('shows valid demand but reports that the logistics mapping is missing', async () => {
    const row = await available();

    expect(row).toMatchObject({
      commercialCode,
      regularAvailable: 10,
      dispensingPointId: null,
      dispensingPointCode: null,
      dispensingPointName: null,
      deliveryPointMapped: false,
    });
  });

  it('blocks purchase creation while the product has no delivery-point mapping', async () => {
    const response = await createOrder(`W2A-MISSING-${suffix}`);

    expect(response.status).toBe(409);

    const body = (await response.json()) as {
      code?: string;
    };

    expect(body.code).toBe('DELIVERY_POINT_MAPPING_MISSING');
  });

  it('imports the product-to-Medicarte-site mapping from XLSX', async () => {
    const response = await uploadMapping();

    expect(response.status).toBe(200);

    expect(await response.json()).toMatchObject({
      totalMappings: 1,
      duplicateRows: 0,
      createdMappings: 1,
      createdPoints: 1,
    });

    const mapping = await database.query<{
      dispensing_point_id: string;
      point_code: string;
      organization_id: string;
    }>(
      `select
               m.dispensing_point_id,
               dp.code as point_code,
               dp.organization_id
             from product_delivery_point_mappings m
             join dispensing_points dp
               on dp.id =
                  m.dispensing_point_id
             where m.invima_record_normalized =
                   $1
               and m.invima_presentation_normalized =
                   $2`,
      [invimaRecord, invimaPresentation],
    );

    expect(mapping.rows).toHaveLength(1);

    firstPointId = mapping.rows[0]!.dispensing_point_id;

    expect(mapping.rows[0]).toMatchObject({
      point_code: firstSiteCode,
      organization_id: ORGANIZATION_IDS.MEDICARTE,
    });
  });

  it('exposes the automatically derived Medicarte point without changing modern demand identity', async () => {
    const row = await available();

    expect(row).toMatchObject({
      commercialCode,
      dispensingPointId: firstPointId,
      dispensingPointCode: firstSiteCode,
      deliveryPointMapped: true,
      regularAvailable: 10,
    });

    const demand = await database.query<{
      dispensing_point_id: string | null;
    }>(
      `select dispensing_point_id
               from projected_demand_lines
              where id=$1`,
      [demandLineId],
    );

    expect(demand.rows[0]?.dispensing_point_id).toBeNull();
  });

  it('does not allow the caller to override the derived point', async () => {
    const response = await api('POST', '/purchase-orders', {
      planningPeriodId: periodId,
      orderType: 'STANDARD',
      purchaseOrderCode: `W2A-MANUAL-${suffix}`,
      lines: [
        {
          projectedDemandLineId: demandLineId,
          dispensingPointId: firstPointId,
          expectedDemandRevision: 1,
          requestedQuantity: 1,
          demandBucket: 'REGULAR',
        },
      ],
    });

    expect(response.status).toBe(400);

    const body = (await response.json()) as {
      code?: string;
    };

    expect(body.code).toBe('PURCHASE_ORDER_MODERN_DEMAND_POINT_NOT_ALLOWED');
  });

  it('snapshots the derived point on the purchase-order line', async () => {
    const response = await createOrder(`W2A-OC1-${suffix}`);

    expect(response.status).toBe(201);

    const order = (await response.json()) as {
      id: string;
      version: number;
      lines: Array<{
        id: string;
        commercialCode: string;
        dispensingPointId: string | null;
        dispensingPointCode: string | null;
      }>;
    };

    firstOrderId = order.id;

    firstOrderVersion = order.version;

    expect(order.lines[0]).toMatchObject({
      commercialCode,
      dispensingPointId: firstPointId,
      dispensingPointCode: firstSiteCode,
    });

    const persisted = await database.query<{
      dispensing_point_id: string | null;
    }>(
      `select dispensing_point_id
               from purchase_order_lines
              where purchase_order_id=$1`,
      [firstOrderId],
    );

    expect(persisted.rows[0]?.dispensing_point_id).toBe(firstPointId);
  });

  it('keeps old OC point immutable when the logistics master changes', async () => {
    secondPointId = (
      await database.query<{
        id: string;
      }>(
        `insert into dispensing_points (
               organization_id,
               code,
               name,
               active,
               created_by
             )
             values (
               $1,
               $2,
               $2,
               true,
               $3
             )
             returning id`,
        [ORGANIZATION_IDS.MEDICARTE, secondSiteCode, userId],
      )
    ).rows[0]!.id;

    await database.query(
      `update product_delivery_point_mappings
              set dispensing_point_id=$1,
                  source_site_name=$2,
                  version=version+1,
                  updated_by=$3,
                  updated_at=now()
            where invima_record_normalized=$4
              and invima_presentation_normalized=$5`,
      [secondPointId, `CHAPINERO W2A ${suffix}`, userId, invimaRecord, invimaPresentation],
    );

    const historical = await api('GET', `/purchase-orders/${firstOrderId}`);

    expect(historical.status).toBe(200);

    expect(await historical.json()).toMatchObject({
      lines: [
        {
          dispensingPointId: firstPointId,
          dispensingPointCode: firstSiteCode,
        },
      ],
    });

    const cancelled = await api('POST', `/purchase-orders/${firstOrderId}/cancel`, {
      expectedVersion: firstOrderVersion,
    });

    expect(cancelled.status).toBe(200);

    const row = await available();

    expect(row).toMatchObject({
      dispensingPointId: secondPointId,
      dispensingPointCode: secondSiteCode,
      deliveryPointMapped: true,
      regularAvailable: 10,
    });

    const second = await createOrder(`W2A-OC2-${suffix}`);

    expect(second.status).toBe(201);

    const secondBody = (await second.json()) as {
      id: string;
      lines: Array<{
        dispensingPointId: string | null;
        dispensingPointCode: string | null;
      }>;
    };

    expect(secondBody.lines[0]).toMatchObject({
      dispensingPointId: secondPointId,
      dispensingPointCode: secondSiteCode,
    });
  });
});
