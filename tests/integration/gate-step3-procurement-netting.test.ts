import { randomUUID } from 'node:crypto';

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

const product = `M3D-${suffix}`;

const pointCode = `M3D-POINT-${suffix}`;

let adminToken = '';
let userId = '';
let periodId = '';
let demandLineId = '';
let pointId = '';
let locationId = '';
let currentLotId = '';
let expiredLotId = '';
let openOrderId = '';
let openOrderLineId = '';

async function api(method: string, path: string, body?: unknown) {
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

async function available() {
  const response = await api('GET', `/purchase-demand/available?planningPeriodId=${periodId}`);

  expect(response.status).toBe(200);

  const payload = (await response.json()) as
    | {
        items?: Array<Record<string, unknown>>;
      }
    | Array<Record<string, unknown>>;

  const items = Array.isArray(payload) ? payload : (payload.items ?? []);

  const row = items.find((item) => item.commercialCode === product);

  expect(row).toBeDefined();

  return row!;
}

describe('Macro 3D — fungible procurement netting', () => {
  beforeAll(async () => {
    await database.connect();

    adminToken = await adminLogin();

    userId = (
      await database.query<{
        id: string;
      }>(
        `select id
             from users
             where username=
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
               '2299-01-01',
               '2299-01-07',
               '2298-12-20T08:00:00Z',
               '2298-12-25T08:00:00Z',
               '2299-01-01',
               'PURCHASING',
               $1,
               $1
             )
             returning id`,
        [userId],
      )
    ).rows[0]!.id;

    pointId = (
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
               $3,
               true,
               $4
             )
             returning id`,
        [ORGANIZATION_IDS.MTD, pointCode, `Macro 3D ${suffix}`, userId],
      )
    ).rows[0]!.id;

    locationId = (
      await database.query<{
        id: string;
      }>(
        `select id
             from inventory_locations
             where legacy_dispensing_point_id=
                   $1`,
        [pointId],
      )
    ).rows[0]!.id;

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
               25,
               20,
               5,
               'OPEN',
               1,
               $3,
               $3
             )
             returning id`,
        [periodId, product, userId],
      )
    ).rows[0]!.id;

    await database.query(
      `insert into tariff_annex_products (
           codigo_producto,
           tarifa_unidad,
           tarifa_unidad_canonical,
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
           '100.00',
           100.0000,
           'Macro 3 product',
           'Macro 3 product',
           'PBS',
           true,
           $2,
           $3,
           $3
         )`,
      [product, ORGANIZATION_IDS.MTD, userId],
    );

    currentLotId = (
      await database.query<{
        id: string;
      }>(
        `insert into inventory_lots (
               commercial_code,
               inventory_location_id,
               dispensing_point_id,
               lot_number,
               expiration_date
             )
             values (
               $1,
               $2,
               $3,
               $4,
               '2299-12-31'
             )
             returning id`,
        [product, locationId, pointId, `CURRENT-${suffix}`],
      )
    ).rows[0]!.id;

    await database.query(
      `insert into inventory_movements (
           inventory_lot_id,
           movement_type,
           quantity_delta,
           source_type,
           source_id,
           occurred_at,
           created_by
         )
         values (
           $1,
           'ADJUSTMENT',
           6,
           'MACRO3D_FIXTURE',
           $2,
           now(),
           $3
         )`,
      [currentLotId, randomUUID(), userId],
    );

    expiredLotId = (
      await database.query<{
        id: string;
      }>(
        `insert into inventory_lots (
               commercial_code,
               inventory_location_id,
               dispensing_point_id,
               lot_number,
               expiration_date
             )
             values (
               $1,
               $2,
               $3,
               $4,
               '2000-01-01'
             )
             returning id`,
        [product, locationId, pointId, `EXPIRED-${suffix}`],
      )
    ).rows[0]!.id;

    await database.query(
      `insert into inventory_movements (
           inventory_lot_id,
           movement_type,
           quantity_delta,
           source_type,
           source_id,
           occurred_at,
           created_by
         )
         values (
           $1,
           'ADJUSTMENT',
           100,
           'MACRO3D_FIXTURE',
           $2,
           now(),
           $3
         )`,
      [expiredLotId, randomUUID(), userId],
    );

    openOrderId = (
      await database.query<{
        id: string;
      }>(
        `insert into purchase_orders (
               purchase_order_code,
               planning_period_id,
               order_type,
               status,
               created_by,
               updated_by
             )
             values (
               $1,
               $2,
               'STANDARD',
               'DRAFT',
               $3,
               $3
             )
             returning id`,
        [`M3D-OPEN-${suffix}`, periodId, userId],
      )
    ).rows[0]!.id;

    openOrderLineId = (
      await database.query<{
        id: string;
      }>(
        `insert into purchase_order_lines (
               purchase_order_id,
               commercial_code,
               product_description,
               presentation,
               dispensing_point_id,
               requested_quantity,
               accepted_quantity,
               requested_delivery_date,
               compensar_unit_rate_snapshot,
               supplier_unit_cost,
               projected_demand_line_id,
               projected_demand_revision,
               demand_bucket
             )
             values (
               $1,
               $2,
               'Macro 3D',
               'Macro 3D',
               null,
               4,
               null,
               null,
               '100.00',
               null,
               $3,
               1,
               'REGULAR'
             )
             returning id`,
        [openOrderId, product, demandLineId],
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    try {
      await database.query(
        `delete from purchase_order_authorization_sources
           where purchase_order_line_id=$1`,
        [openOrderLineId],
      );

      await database.query(
        `delete from purchase_order_demand_allocations
           where purchase_order_line_id=$1`,
        [openOrderLineId],
      );

      await database.query(
        `delete from purchase_order_lines
           where purchase_order_id=$1`,
        [openOrderId],
      );

      await database.query(
        `delete from purchase_orders
           where id=$1`,
        [openOrderId],
      );

      await database.query(
        `delete from inventory_movements
           where inventory_lot_id in (
             $1,
             $2
           )`,
        [currentLotId, expiredLotId],
      );

      await database.query(
        `delete from inventory_lots
           where id in (
             $1,
             $2
           )`,
        [currentLotId, expiredLotId],
      );

      await database.query(
        `delete from projected_demand_lines
           where id=$1`,
        [demandLineId],
      );

      await database.query(
        `delete from tariff_annex_products
           where codigo_producto=$1`,
        [product],
      );

      await database.query(
        `delete from dispensing_points
           where id=$1`,
        [pointId],
      );

      await database.query(
        `delete from inventory_locations
           where id=$1`,
        [locationId],
      );

      await database.query(
        `delete from planning_periods
           where id=$1`,
        [periodId],
      );
    } finally {
      await database.end();
    }
  });

  it('aggregates only positive non-expired stock across physical locations', async () => {
    const stock = await database.query<{
      usable_quantity: number;
    }>(
      `select usable_quantity
             from inventory_usable_by_product
             where commercial_code=$1`,
      [product],
    );

    expect(stock.rows[0]?.usable_quantity).toBe(6);

    const open = await database.query<{
      open_quantity: number;
    }>(
      `select open_quantity
             from purchase_open_coverage_by_product
             where commercial_code=$1`,
      [product],
    );

    expect(open.rows[0]?.open_quantity).toBe(4);
  });

  it('nets current demand by usable stock and open PO coverage', async () => {
    const row = await available();

    expect(row.regularAvailable).toBe(10);

    expect(row.lateAvailable).toBe(5);
  });

  it('rejects purchase quantity above fungible net requirement', async () => {
    const response = await api('POST', '/purchase-orders', {
      planningPeriodId: periodId,
      orderType: 'STANDARD',
      purchaseOrderCode: `M3D-EXCESS-${suffix}`,
      lines: [
        {
          projectedDemandLineId: demandLineId,
          expectedDemandRevision: 1,
          requestedQuantity: 11,
          demandBucket: 'REGULAR',
        },
      ],
    });

    expect(response.status).toBe(409);

    const body = JSON.stringify(await response.json());

    expect(body).toContain('PURCHASE_ORDER_DEMAND_EXCEEDS_AVAILABLE');
  });

  it('does not double count a received PO as both coverage and inventory', async () => {
    await database.query(
      `update purchase_orders
           set status='RECEIVED'
           where id=$1`,
      [openOrderId],
    );

    await database.query(
      `insert into inventory_movements (
             inventory_lot_id,
             movement_type,
             quantity_delta,
             source_type,
             source_id,
             occurred_at,
             created_by
           )
           values (
             $1,
             'ADJUSTMENT',
             4,
             'MACRO3D_RECEIVED_FIXTURE',
             $2,
             now(),
             $3
           )`,
      [currentLotId, randomUUID(), userId],
    );

    const stock = await database.query<{
      usable_quantity: number;
    }>(
      `select usable_quantity
             from inventory_usable_by_product
             where commercial_code=$1`,
      [product],
    );

    expect(stock.rows[0]?.usable_quantity).toBe(10);

    const open = await database.query<{
      count: number;
    }>(
      `select count(*)::int count
             from purchase_open_coverage_by_product
             where commercial_code=$1`,
      [product],
    );

    expect(open.rows[0]?.count).toBe(0);

    const row = await available();

    expect(row.regularAvailable).toBe(10);

    expect(row.lateAvailable).toBe(5);
  });
});
