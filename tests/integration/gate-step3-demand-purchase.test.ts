import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGANIZATION_IDS, adminLogin, ensureOperatorTokens } from './helpers/auth';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization_test_integration';

const apiUrl = process.env.API_URL ?? 'http://localhost:3004';

const database = new Client({
  connectionString: databaseUrl,
});

const suffix = randomUUID().slice(0, 8).toUpperCase();

const LIVE_CODE = `M3B-LIVE-${suffix}`;

const HISTORICAL_CODE = `M3B-HIST-${suffix}`;

const POINT_CODE = `M3B-PT-${suffix}`;

const LIVE_POINT_CODE = `M3B-LIVE-PT-${suffix}`;

const LIVE_INVIMA_RECORD = `9${suffix.replace(/\D/g, '').padEnd(11, '7').slice(0, 11)}`;

const LIVE_INVIMA_PRESENTATION = '1';

const PERIOD_START = '2099-03-01';

const PERIOD_END = '2099-03-07';

let adminToken = '';
let olpToken = '';
let foundationUserId = '';

let periodId = '';
let pointId = '';
let liveDeliveryPointId = '';

let liveDemandId = '';
let historicalDemandId = '';

let liveOrderId = '';
let liveOrderLineId = '';
let liveOrderVersion = 0;

async function api(
  method: string,
  path: string,
  body?: unknown,
  token = adminToken,
  organizationId = ORGANIZATION_IDS.MTD,
): Promise<Response> {
  return fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-organization-id': organizationId,
    },
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
        }),
  });
}

async function json<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }

  return payload as T;
}

async function cleanup(): Promise<void> {
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
    [PERIOD_START, PERIOD_END],
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
    [PERIOD_START, PERIOD_END],
  );

  await database.query(
    `delete from purchase_orders
      where planning_period_id in (
        select id
        from planning_periods
        where start_date = $1
          and end_date = $2
      )`,
    [PERIOD_START, PERIOD_END],
  );

  await database.query(
    `delete from demand_sources
      where projected_demand_line_id in (
        select pdl.id
        from projected_demand_lines pdl
        join planning_periods pp
          on pp.id =
             pdl.planning_period_id
        where pp.start_date = $1
          and pp.end_date = $2
      )`,
    [PERIOD_START, PERIOD_END],
  );

  await database.query(
    `delete from projected_demand_lines
      where planning_period_id in (
        select id
        from planning_periods
        where start_date = $1
          and end_date = $2
      )`,
    [PERIOD_START, PERIOD_END],
  );

  await database.query(
    `delete from product_delivery_point_mappings
      where dispensing_point_id in (
        select id
        from dispensing_points
        where code like 'M3B-LIVE-PT-%'
      )`,
  );

  await database.query(
    `delete from tariff_annex_products
      where codigo_producto like 'M3B-%'`,
  );

  await database.query(
    `delete from inventory_locations
      where legacy_dispensing_point_id in (
        select id
        from dispensing_points
        where code like 'M3B-LIVE-PT-%'
      )`,
  );

  await database.query(
    `delete from dispensing_points
      where code like 'M3B-LIVE-PT-%'`,
  );

  await database.query(
    `delete from dispensing_points
      where code like 'M3B-PT-%'`,
  );

  await database.query(
    `delete from planning_periods
      where start_date = $1
        and end_date = $2`,
    [PERIOD_START, PERIOD_END],
  );
}

beforeAll(async () => {
  await database.connect();

  await cleanup();

  adminToken = await adminLogin();

  ({ olpToken } = await ensureOperatorTokens());

  const user = await database.query<{
    id: string;
  }>(
    `select id
         from users
        where username =
              'foundation-admin'`,
  );

  foundationUserId = user.rows[0]!.id;

  const period = await database.query<{
    id: string;
  }>(
    `insert into planning_periods (
         start_date,
         end_date,
         scheduling_cutoff_at,
         purchase_order_deadline_at,
         expected_delivery_date,
         created_by,
         updated_by
       )
       values (
         $1,
         $2,
         '2099-02-27T23:59:00-05:00',
         '2099-02-28T23:59:00-05:00',
         '2099-03-08',
         $3,
         $3
       )
       returning id`,
    [PERIOD_START, PERIOD_END, foundationUserId],
  );

  periodId = period.rows[0]!.id;

  const point = await database.query<{
    id: string;
  }>(
    `insert into dispensing_points (
         organization_id,
         code,
         name,
         created_by
       )
       values (
         $1,
         $2,
         'Macro 3B historical point',
         $3
       )
       returning id`,
    [ORGANIZATION_IDS.MTD, POINT_CODE, foundationUserId],
  );

  pointId = point.rows[0]!.id;

  liveDeliveryPointId = (
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
         'Macro 3B live Medicarte point',
         true,
         $3
       )
       returning id`,
      [ORGANIZATION_IDS.MEDICARTE, LIVE_POINT_CODE, foundationUserId],
    )
  ).rows[0]!.id;

  for (const [code, rate] of [
    [LIVE_CODE, '123.45'],
    [HISTORICAL_CODE, '77.00'],
  ] as const) {
    await database.query(
      `insert into tariff_annex_products (
         codigo_producto,
         tarifa_unidad,
         tarifa_unidad_canonical,
         descripcion_generica,
         descripcion_comercial,
         consecutivo_invima_presentacion,
         tipo_inclusion,
         active,
         organization_id,
         created_by,
         updated_by
       )
       values (
         $1,
         $2::varchar,
         $2::numeric,
         'Producto Macro 3B',
         'Producto Macro 3B',
         'PRESENTACION-M3B',
         'PBS',
         true,
         $3,
         $4,
         $4
       )`,
      [code, rate, ORGANIZATION_IDS.MTD, foundationUserId],
    );
  }

  await database.query(
    `update tariff_annex_products
        set numero_expediente_invima=$1,
            consecutivo_invima_presentacion=$2
      where codigo_producto=$3`,
    [LIVE_INVIMA_RECORD, LIVE_INVIMA_PRESENTATION, LIVE_CODE],
  );

  await database.query(
    `insert into product_delivery_point_mappings (
       invima_record_normalized,
       invima_presentation_normalized,
       source_cum_code,
       service_model,
       source_site_name,
       dispensing_point_id,
       created_by,
       updated_by
     )
     values (
       $1,
       $2,
       $3,
       'FIXTURE',
       'Macro 3B live Medicarte point',
       $4,
       $5,
       $5
     )`,
    [
      LIVE_INVIMA_RECORD,
      LIVE_INVIMA_PRESENTATION,
      `${LIVE_INVIMA_RECORD}-01`,
      liveDeliveryPointId,
      foundationUserId,
    ],
  );

  const live = await database.query<{
    id: string;
  }>(
    `insert into projected_demand_lines (
         planning_period_id,
         dispensing_point_id,
         commercial_code,
         projected_quantity,
         regular_quantity,
         late_quantity,
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
         $3,
         $3
       )
       returning id`,
    [periodId, LIVE_CODE, foundationUserId],
  );

  liveDemandId = live.rows[0]!.id;

  const historical = await database.query<{
    id: string;
  }>(
    `insert into projected_demand_lines (
         planning_period_id,
         dispensing_point_id,
         commercial_code,
         projected_quantity,
         regular_quantity,
         late_quantity,
         created_by,
         updated_by
       )
       values (
         $1,
         $2,
         $3,
         7,
         7,
         0,
         $4,
         $4
       )
       returning id`,
    [periodId, pointId, HISTORICAL_CODE, foundationUserId],
  );

  historicalDemandId = historical.rows[0]!.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await database.end();
  }
});

describe('Macro 3B — demand to purchase order without point/date prerequisite', () => {
  it('exposes live authorization demand and does not mix historical point demand', async () => {
    const response = await api('GET', `/purchase-demand/available?planningPeriodId=${periodId}`);

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      items: Array<{
        id: string;
        commercialCode: string;
        regularAvailable: number;
      }>;
    };

    expect(body.items).toHaveLength(1);

    expect(body.items[0]).toMatchObject({
      id: liveDemandId,
      commercialCode: LIVE_CODE,
      regularAvailable: 10,
    });

    expect(body.items.some((item) => item.id === historicalDemandId)).toBe(false);
  });

  it('creates MTD purchase order directly from point-null demand without requested delivery date', async () => {
    const response = await api('POST', '/purchase-orders', {
      planningPeriodId: periodId,
      orderType: 'STANDARD',
      purchaseOrderCode: `OC-M3B-${suffix}`,
      lines: [
        {
          projectedDemandLineId: liveDemandId,
          expectedDemandRevision: 1,
          requestedQuantity: 6,
          demandBucket: 'REGULAR',
        },
      ],
    });

    expect(response.status).toBe(201);

    const order = (await response.json()) as {
      id: string;
      status: string;
      version: number;
      lines: Array<{
        id: string;
        commercialCode: string;
        dispensingPointId: string | null;
        dispensingPointCode: string | null;
        dispensingPointName: string | null;
        requestedDeliveryDate: string | null;
        compensarUnitRateSnapshot: string;
        allocatedQuantity: number;
      }>;
    };

    liveOrderId = order.id;

    liveOrderVersion = order.version;

    liveOrderLineId = order.lines[0]!.id;

    expect(order.status).toBe('DRAFT');

    expect(order.lines[0]).toMatchObject({
      commercialCode: LIVE_CODE,
      dispensingPointId: liveDeliveryPointId,
      dispensingPointCode: LIVE_POINT_CODE,
      requestedDeliveryDate: null,
      compensarUnitRateSnapshot: '123.45',
      allocatedQuantity: 6,
    });

    const persisted = await database.query<{
      dispensing_point_id: string | null;
      requested_delivery_date: string | null;
    }>(
      `select
               dispensing_point_id,
               requested_delivery_date::text
             from purchase_order_lines
            where id = $1`,
      [liveOrderLineId],
    );

    expect(persisted.rows[0]).toEqual({
      dispensing_point_id: liveDeliveryPointId,
      requested_delivery_date: null,
    });

    const allocation = await database.query<{
      projected_demand_line_id: string;
      allocated_quantity: number;
    }>(
      `select
               projected_demand_line_id,
               allocated_quantity
             from purchase_order_demand_allocations
            where purchase_order_line_id =
                  $1`,
      [liveOrderLineId],
    );

    expect(allocation.rows[0]).toEqual({
      projected_demand_line_id: liveDemandId,
      allocated_quantity: 6,
    });
  });

  it('keeps effective PO coverage and allows OLP review without clinical or point/date dependency', async () => {
    const issued = await json<{
      version: number;
      status: string;
    }>(
      await api('POST', `/purchase-orders/${liveOrderId}/issue`, {
        expectedVersion: liveOrderVersion,
      }),
    );

    expect(issued.status).toBe('ISSUED');

    const supplier = await json<{
      lines: Array<{
        id: string;
        dispensingPointId: string | null;
        requestedDeliveryDate: string | null;
        patientDocument?: string;
        authorizationNumber?: string;
      }>;
    }>(
      await api(
        'GET',
        `/supplier/purchase-orders/${liveOrderId}`,
        undefined,
        olpToken,
        ORGANIZATION_IDS.OLP,
      ),
    );

    expect(supplier.lines[0]).toMatchObject({
      id: liveOrderLineId,
      dispensingPointId: liveDeliveryPointId,
      requestedDeliveryDate: null,
    });

    expect(supplier.lines[0]).not.toHaveProperty('patientDocument');

    expect(supplier.lines[0]).not.toHaveProperty('authorizationNumber');

    const reviewed = await json<{
      version: number;
    }>(
      await api(
        'POST',
        `/supplier/purchase-orders/${liveOrderId}/lines/${liveOrderLineId}/review`,
        {
          expectedVersion: issued.version,
          acceptedQuantity: 6,
          supplierUnitCost: 90,
        },
        olpToken,
        ORGANIZATION_IDS.OLP,
      ),
    );

    const completed = await json<{
      status: string;
    }>(
      await api(
        'POST',
        `/supplier/purchase-orders/${liveOrderId}/complete-review`,
        {
          expectedVersion: reviewed.version,
        },
        olpToken,
        ORGANIZATION_IDS.OLP,
      ),
    );

    expect(completed.status).toBe('ACCEPTED');

    const available = await json<{
      items: Array<{
        id: string;
        regularAvailable: number;
      }>;
    }>(await api('GET', `/purchase-demand/available?planningPeriodId=${periodId}`));

    expect(available.items.find((item) => item.id === liveDemandId)).toMatchObject({
      regularAvailable: 4,
    });
  });

  it('preserves historical point-based demand compatibility', async () => {
    const response = await api('POST', '/purchase-orders', {
      planningPeriodId: periodId,
      orderType: 'STANDARD',
      purchaseOrderCode: `OC-M3B-HIST-${suffix}`,
      lines: [
        {
          projectedDemandLineId: historicalDemandId,
          expectedDemandRevision: 1,
          requestedQuantity: 2,
          requestedDeliveryDate: '2099-03-08',
          demandBucket: 'REGULAR',
        },
      ],
    });

    expect(response.status).toBe(201);

    const order = (await response.json()) as {
      lines: Array<{
        dispensingPointId: string | null;
        requestedDeliveryDate: string | null;
      }>;
    };

    expect(order.lines[0]).toMatchObject({
      dispensingPointId: pointId,
      requestedDeliveryDate: '2099-03-08',
    });
  });
});
