import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ORGANIZATION_IDS, adminLogin } from './helpers/auth';

const ESP014_AUTHORIZATIONS_TEMPLATE_VERSION = 'ESP014_AUTHORIZATIONS_V1';

const AUTHORIZATION_IMPORT_COLUMNS = [
  'CODEPS',
  'NUMERO_AUTORIZACION',
  'TIPO_IDENTIFICACION',
  'IDENTIFICACION_PACIENTE',
  'NOMBRE_PACIENTE',
  'NUMERO_TELEFONO',
  'CPRG',
  'CDGN001',
  'COD_CUPS_PRINCIPAL',
  'CUPS_PRINCIPAL',
  'CODIGO_COMERCIAL',
  'CUMS',
  'NIT_PRESTADOR',
  'NOMBRE_PRESTADOR',
  'COD_CUPS_AUTORIZADO',
  'CUPS_AUTORIZADO',
  'CANTIDAD',
  'DOSIS',
  'FECHA_ASIGNACION',
  'FECHA_FINAL_VIGENCIA',
  'ESTADO_AUTORIZACION',
  'OBS_AUTORIZACION',
  'MEDICO_REMITENTE',
  'CMNT',
  'IDENTIFICADOR_FUENTE',
  'FPRO',
  'VALOR_CUOTA_MODERADORA',
  'NUMERO_PRESCRIPCION',
] as const;

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization_test_integration';

const apiUrl = process.env.API_URL ?? 'http://localhost:3004';
const database = new Client({ connectionString: databaseUrl });

const suffix = randomUUID().slice(0, 8).toUpperCase();

const CODE_INSERT = `M2CD-INSERT-${suffix}`;
const CODE_NOOP = `M2CD-NOOP-${suffix}`;
const CODE_UPDATE = `M2CD-UPDATE-${suffix}`;
const CODE_LOCK = `M2CD-LOCK-${suffix}`;
const CODE_CANCELLED = `M2CD-CANCEL-${suffix}`;
const CODE_REJECTED = `M2CD-REJECT-${suffix}`;

const AUTH_INSERT = `M2CD-AUTH-INSERT-${suffix}`;
const AUTH_NOOP = `M2CD-AUTH-NOOP-${suffix}`;
const AUTH_UPDATE = `M2CD-AUTH-UPDATE-${suffix}`;
const AUTH_LOCK = `M2CD-AUTH-LOCK-${suffix}`;
const AUTH_CANCELLED = `M2CD-AUTH-CANCEL-${suffix}`;
const AUTH_REJECTED = `M2CD-AUTH-REJECT-${suffix}`;

const BLOCKING_PO_STATUSES = [
  'DRAFT',
  'ISSUED',
  'UNDER_OLP_REVIEW',
  'ACCEPTED',
  'PARTIALLY_ACCEPTED',
  'IN_FULFILLMENT',
  'PARTIALLY_DISPATCHED',
  'FULLY_DISPATCHED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
] as const;

let adminToken = '';
let foundationUserId = '';

type Job = {
  id: string;
  status: string;
  validRows: number;
  invalidRows: number;
  succeededRows: number;
  failedRows: number;
};

type ImportRow = {
  validationStatus: string;
  executionStatus: string;
  errorCode: string | null;
  entityReference: string | null;
};

type AuthorizationSnapshot = {
  id: string;
  version: number;
  updated_at: Date;
  updated_by: string | null;
  last_load_id: string | null;
  source_data: Record<string, unknown>;
};

function buildAuthorizationWorkbook(input: {
  authorizationNumber: string;
  commercialCode: string;
  quantity?: number;
  workbookNonce: string;
}): Buffer {
  const workbook = XLSX.utils.book_new();

  workbook.Props = {
    Title: 'Macro 2 authorization reload gate',
    Comments: input.workbookNonce,
  };

  const values: Record<string, unknown> = {
    CODEPS: 'EPS001',
    NUMERO_AUTORIZACION: input.authorizationNumber,
    TIPO_IDENTIFICACION: 'CC',
    IDENTIFICACION_PACIENTE: `DOC-${suffix}`,
    NOMBRE_PACIENTE: 'Paciente Macro 2C 2D',
    NUMERO_TELEFONO: '3000000000',
    CPRG: 'CPRG',
    CDGN001: 'CDGN001',
    COD_CUPS_PRINCIPAL: 'CUPS001',
    CUPS_PRINCIPAL: 'CUPS PRINCIPAL',
    CODIGO_COMERCIAL: input.commercialCode,
    CUMS: 'CUMS001',
    NIT_PRESTADOR: '900000000',
    NOMBRE_PRESTADOR: 'PRESTADOR TEST',
    COD_CUPS_AUTORIZADO: 'CUPSA001',
    CUPS_AUTORIZADO: 'CUPS AUTORIZADO',
    CANTIDAD: input.quantity ?? 2,
    DOSIS: '1',
    FECHA_ASIGNACION: '2026-09-18',
    FECHA_FINAL_VIGENCIA: '2099-12-31',
    ESTADO_AUTORIZACION: 'VIGENTE',
    OBS_AUTORIZACION: '',
    MEDICO_REMITENTE: 'MEDICO TEST',
    CMNT: '',
    IDENTIFICADOR_FUENTE: `SRC-${suffix}`,
    FPRO: '',
    VALOR_CUOTA_MODERADORA: '0',
    NUMERO_PRESCRIPCION: '',
  };

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [...AUTHORIZATION_IMPORT_COLUMNS],
      AUTHORIZATION_IMPORT_COLUMNS.map((column) => values[column] ?? ''),
    ]),
    'Autorizaciones',
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['KEY', 'VALUE'],
      ['templateVersion', ESP014_AUTHORIZATIONS_TEMPLATE_VERSION],
      ['importType', 'AUTHORIZATIONS'],
    ]),
    'METADATA',
  );

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
}

async function uploadAuthorization(input: {
  authorizationNumber: string;
  commercialCode: string;
  filename: string;
  quantity?: number;
  workbookNonce: string;
}): Promise<Response> {
  const buffer = buildAuthorizationWorkbook({
    authorizationNumber: input.authorizationNumber,
    commercialCode: input.commercialCode,
    quantity: input.quantity,
    workbookNonce: input.workbookNonce,
  });

  const form = new FormData();

  form.append(
    'file',
    new Blob([new Uint8Array(buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    input.filename,
  );

  return fetch(`${apiUrl}/api/v1/bulk-imports/authorizations/upload`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'x-organization-id': ORGANIZATION_IDS.MTD,
    },
    body: form,
  });
}

async function confirm(jobId: string): Promise<Response> {
  return fetch(`${apiUrl}/api/v1/bulk-imports/${jobId}/confirm`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
      'x-organization-id': ORGANIZATION_IDS.MTD,
    },
    body: JSON.stringify({}),
  });
}

async function rows(jobId: string): Promise<ImportRow[]> {
  const response = await fetch(`${apiUrl}/api/v1/bulk-imports/${jobId}/rows?filter=ALL`, {
    headers: {
      authorization: `Bearer ${adminToken}`,
      'x-organization-id': ORGANIZATION_IDS.MTD,
    },
  });

  expect(response.status).toBe(200);

  const payload = (await response.json()) as {
    items: ImportRow[];
  };

  return payload.items;
}

async function uploadAndConfirm(input: {
  authorizationNumber: string;
  commercialCode: string;
  filename: string;
  quantity?: number;
  workbookNonce: string;
}): Promise<{
  uploaded: Job;
  confirmed: Job;
  rows: ImportRow[];
}> {
  const uploadResponse = await uploadAuthorization(input);

  expect(uploadResponse.status).toBe(202);

  const uploaded = (await uploadResponse.json()) as Job;

  expect(uploaded.status).toBe('READY');
  expect(uploaded.validRows).toBe(1);
  expect(uploaded.invalidRows).toBe(0);

  const confirmResponse = await confirm(uploaded.id);

  expect(confirmResponse.status).toBe(200);

  const confirmed = (await confirmResponse.json()) as Job;
  const importRows = await rows(uploaded.id);

  return {
    uploaded,
    confirmed,
    rows: importRows,
  };
}

async function seedTariffProduct(code: string): Promise<void> {
  await database.query(
    `insert into tariff_annex_products (
       codigo_producto,
       tarifa_unidad,
       tarifa_unidad_canonical,
       descripcion_generica,
       descripcion_comercial,
       laboratorio,
       tipo_inclusion,
       active,
       organization_id,
       created_by,
       updated_by,
       version
     )
     values (
       $1,
       '1000',
       1000,
       'PRODUCTO MACRO 2C 2D',
       'PRODUCTO MACRO 2C 2D',
       'LAB TEST',
       'PBS',
       true,
       $2,
       $3,
       $3,
       1
     )`,
    [code, ORGANIZATION_IDS.MTD, foundationUserId],
  );
}

async function snapshot(
  authorizationNumber: string,
  commercialCode: string,
): Promise<AuthorizationSnapshot> {
  const result = await database.query<AuthorizationSnapshot>(
    `select
       id,
       version,
       updated_at,
       updated_by,
       last_load_id,
       source_data
     from authorization_items
     where numero_autorizacion = $1
       and codigo_medicamento = $2`,
    [authorizationNumber, commercialCode],
  );

  expect(result.rows).toHaveLength(1);

  return result.rows[0]!;
}

async function createPurchaseOrderFixture(input: {
  authorizationItemId: string;
  commercialCode: string;
  tag: string;
  month: number;
  status: string;
}): Promise<string> {
  const month = String(input.month).padStart(2, '0');

  const point = await database.query<{ id: string }>(
    `insert into dispensing_points (
       organization_id,
       code,
       name,
       created_by
     )
     values ($1, $2, $3, $4)
     returning id`,
    [
      ORGANIZATION_IDS.MEDICARTE,
      `M2CD-PT-${input.tag}-${suffix}`,
      `Macro 2C 2D ${input.tag}`,
      foundationUserId,
    ],
  );

  const pointId = point.rows[0]!.id;

  const period = await database.query<{ id: string }>(
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
       $1::date,
       $2::date,
       $3::timestamptz,
       $4::timestamptz,
       $5::date,
       $6,
       $6
     )
     returning id`,
    [
      `2097-${month}-01`,
      `2097-${month}-07`,
      `2097-${month}-03T23:00:00-05:00`,
      `2097-${month}-04T23:00:00-05:00`,
      `2097-${month}-08`,
      foundationUserId,
    ],
  );

  const periodId = period.rows[0]!.id;

  const demandLine = await database.query<{ id: string }>(
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
       $2,
       $3,
       2,
       2,
       0,
       'OPEN',
       1,
       $4,
       $4
     )
     returning id`,
    [periodId, pointId, input.commercialCode, foundationUserId],
  );

  const demandLineId = demandLine.rows[0]!.id;

  await database.query(
    `insert into demand_sources (
       projected_demand_line_id,
       authorization_item_id,
       loaded_at,
       quantity,
       planning_period_id,
       dispensing_point_id,
       commercial_code,
       schedule_timing,
       late_handling,
       demand_bucket
     )
     values (
       $1,
       $2,
       now(),
       2,
       $3,
       $4,
       $5,
       'ON_TIME',
       null,
       'REGULAR'
     )`,
    [demandLineId, input.authorizationItemId, periodId, pointId, input.commercialCode],
  );

  const order = await database.query<{ id: string }>(
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
       $3,
       $4,
       $4
     )
     returning id`,
    [`M2CD-PO-${input.tag}-${suffix}`, periodId, input.status, foundationUserId],
  );

  const orderId = order.rows[0]!.id;

  const orderLine = await database.query<{ id: string }>(
    `insert into purchase_order_lines (
       purchase_order_id,
       commercial_code,
       product_description,
       presentation,
       dispensing_point_id,
       requested_quantity,
       requested_delivery_date,
       compensar_unit_rate_snapshot,
       projected_demand_line_id,
       projected_demand_revision,
       demand_bucket
     )
     values (
       $1,
       $2,
       'PRODUCTO MACRO 2C 2D',
       'TEST',
       $3,
       2,
       $4::date,
       '1000',
       $5,
       1,
       'REGULAR'
     )
     returning id`,
    [orderId, input.commercialCode, pointId, `2097-${month}-08`, demandLineId],
  );

  const orderLineId = orderLine.rows[0]!.id;

  await database.query(
    `insert into purchase_order_demand_allocations (
       purchase_order_line_id,
       projected_demand_line_id,
       projected_demand_revision,
       demand_bucket,
       allocated_quantity
     )
     values (
       $1,
       $2,
       1,
       'REGULAR',
       2
     )`,
    [orderLineId, demandLineId],
  );

  await database.query(
    `insert into purchase_order_authorization_sources (
       purchase_order_line_id,
       authorization_item_id,
       projected_demand_line_id,
       projected_demand_revision,
       source_quantity_snapshot
     )
     values (
       $1,
       $2,
       $3,
       1,
       2
     )`,
    [orderLineId, input.authorizationItemId, demandLineId],
  );

  return orderId;
}

async function cleanup(): Promise<void> {
  await database.query(
    `delete from purchase_order_demand_allocations
      where purchase_order_line_id in (
        select pol.id
        from purchase_order_lines pol
        join purchase_orders po
          on po.id = pol.purchase_order_id
        where po.purchase_order_code like 'M2CD-PO-%'
      )`,
  );

  await database.query(
    `delete from purchase_order_lines
      where purchase_order_id in (
        select id
        from purchase_orders
        where purchase_order_code like 'M2CD-PO-%'
      )`,
  );

  await database.query(
    `delete from purchase_orders
      where purchase_order_code like 'M2CD-PO-%'`,
  );

  await database.query(
    `delete from demand_sources
      where commercial_code like 'M2CD-%'
         or authorization_item_id in (
           select id
           from authorization_items
           where numero_autorizacion like 'M2CD-AUTH-%'
         )`,
  );

  await database.query(
    `delete from projected_demand_lines
      where commercial_code like 'M2CD-%'`,
  );

  await database.query(
    `delete from authorization_item_organizations
      where authorization_item_id in (
        select id
        from authorization_items
        where numero_autorizacion like 'M2CD-AUTH-%'
      )`,
  );

  await database.query(
    `delete from authorization_items
      where numero_autorizacion like 'M2CD-AUTH-%'`,
  );

  await database.query(
    `delete from bulk_import_jobs
      where original_filename like 'm2cd-%'`,
  );

  await database.query(
    `delete from import_batches
      where original_filename like 'm2cd-%'`,
  );

  await database.query(
    `delete from dispensing_points
      where code like 'M2CD-PT-%'`,
  );

  await database.query(
    `delete from planning_periods
      where created_by = $1
        and start_date between '2097-01-01' and '2097-12-31'`,
    [foundationUserId],
  );

  await database.query(
    `delete from tariff_annex_products
      where codigo_producto like 'M2CD-%'`,
  );
}

beforeAll(async () => {
  await database.connect();

  const admin = await database.query<{ id: string }>(
    `select id
     from users
     where username = 'foundation-admin'`,
  );

  foundationUserId = admin.rows[0]?.id ?? '';

  if (!foundationUserId) {
    throw new Error('Foundation admin is unavailable');
  }

  await cleanup();

  adminToken = await adminLogin();
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await database.end();
  }
});

describe('Macro 2 / 2C + 2D — smart reload + purchase order lineage', () => {
  it('1. identidad nueva hace INSERT con version inicial 1', async () => {
    await seedTariffProduct(CODE_INSERT);

    const result = await uploadAndConfirm({
      authorizationNumber: AUTH_INSERT,
      commercialCode: CODE_INSERT,
      filename: `m2cd-insert-${suffix}.xlsx`,
      workbookNonce: randomUUID(),
    });

    expect(result.confirmed.succeededRows).toBe(1);
    expect(result.confirmed.failedRows).toBe(0);
    expect(result.rows[0]?.executionStatus).toBe('SUCCEEDED');

    const item = await snapshot(AUTH_INSERT, CODE_INSERT);

    expect(item.version).toBe(1);
    expect(Number(item.source_data.CANTIDAD)).toBe(2);
  });

  it('2. recarga semánticamente idéntica es NO_OP real aunque cambie metadata del archivo', async () => {
    await seedTariffProduct(CODE_NOOP);

    const first = await uploadAndConfirm({
      authorizationNumber: AUTH_NOOP,
      commercialCode: CODE_NOOP,
      filename: `m2cd-noop-a-${suffix}.xlsx`,
      workbookNonce: `A-${randomUUID()}`,
    });

    expect(first.confirmed.succeededRows).toBe(1);

    const before = await snapshot(AUTH_NOOP, CODE_NOOP);

    const second = await uploadAndConfirm({
      authorizationNumber: AUTH_NOOP,
      commercialCode: CODE_NOOP,
      filename: `m2cd-noop-b-${suffix}.xlsx`,
      workbookNonce: `B-${randomUUID()}`,
    });

    expect(second.confirmed.succeededRows).toBe(1);
    expect(second.confirmed.failedRows).toBe(0);

    const after = await snapshot(AUTH_NOOP, CODE_NOOP);

    expect(after.id).toBe(before.id);
    expect(after.version).toBe(before.version);
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
    expect(after.updated_by).toBe(before.updated_by);
    expect(after.last_load_id).toBe(before.last_load_id);
    expect(after.source_data).toEqual(before.source_data);
  });

  it('3. cambio semántico libre hace UPDATE conservando id e incrementando version', async () => {
    await seedTariffProduct(CODE_UPDATE);

    const first = await uploadAndConfirm({
      authorizationNumber: AUTH_UPDATE,
      commercialCode: CODE_UPDATE,
      filename: `m2cd-update-a-${suffix}.xlsx`,
      quantity: 2,
      workbookNonce: `A-${randomUUID()}`,
    });

    expect(first.confirmed.succeededRows).toBe(1);

    const before = await snapshot(AUTH_UPDATE, CODE_UPDATE);

    const second = await uploadAndConfirm({
      authorizationNumber: AUTH_UPDATE,
      commercialCode: CODE_UPDATE,
      filename: `m2cd-update-b-${suffix}.xlsx`,
      quantity: 5,
      workbookNonce: `B-${randomUUID()}`,
    });

    expect(second.confirmed.succeededRows).toBe(1);
    expect(second.confirmed.failedRows).toBe(0);

    const after = await snapshot(AUTH_UPDATE, CODE_UPDATE);

    expect(after.id).toBe(before.id);
    expect(after.version).toBe(before.version + 1);
    expect(after.last_load_id).not.toBe(before.last_load_id);
    expect(Number(after.source_data.CANTIDAD)).toBe(5);
  });

  it('4. una OC efectiva permite UPDATE y conserva el lineage histórico', async () => {
    await seedTariffProduct(
      CODE_LOCK,
    );

    const initial =
      await uploadAndConfirm({
        authorizationNumber:
          AUTH_LOCK,
        commercialCode:
          CODE_LOCK,
        filename:
          `m2cd-lock-initial-${suffix}.xlsx`,
        quantity:
          2,
        workbookNonce:
          randomUUID(),
      });

    expect(
      initial.confirmed
        .succeededRows,
    ).toBe(1);

    const before =
      await snapshot(
        AUTH_LOCK,
        CODE_LOCK,
      );

    const orderId =
      await createPurchaseOrderFixture({
        authorizationItemId:
          before.id,
        commercialCode:
          CODE_LOCK,
        tag:
          'LOCK',
        month:
          7,
        status:
          'DRAFT',
      });

    const lineageBefore =
      await database.query<{
        count:
          number;
      }>(
        `select count(*)::int count
         from purchase_order_authorization_sources source
         join purchase_order_lines pol
           on pol.id = source.purchase_order_line_id
         where source.authorization_item_id = $1
           and pol.purchase_order_id = $2`,
        [
          before.id,
          orderId,
        ],
      );

    expect(
      lineageBefore
        .rows[0]
        ?.count,
    ).toBe(1);

    /*
     * El lineage de la OC debe ser suficiente por sí mismo.
     * demand_sources/projection son estado vivo y se eliminan a propósito.
     */
    const liveDemand =
      await database.query<{
        projected_demand_line_id:
          string;
      }>(
        `select projected_demand_line_id
         from purchase_order_lines
         where purchase_order_id = $1
         limit 1`,
        [orderId],
      );

    const liveDemandLineId =
      liveDemand.rows[0]!
        .projected_demand_line_id;

    await database.query(
      `delete from demand_sources
       where projected_demand_line_id = $1`,
      [
        liveDemandLineId,
      ],
    );

    await database.query(
      `delete from projected_demand_lines
       where id = $1`,
      [
        liveDemandLineId,
      ],
    );

    for (
      const [
        index,
        status,
      ] of
        BLOCKING_PO_STATUSES
          .entries()
    ) {
      await database.query(
        `update purchase_orders
         set status = $1
         where id = $2`,
        [
          status,
          orderId,
        ],
      );

      const beforeAttempt =
        await snapshot(
          AUTH_LOCK,
          CODE_LOCK,
        );

      const quantity =
        5 +
        index;

      const attempt =
        await uploadAndConfirm({
          authorizationNumber:
            AUTH_LOCK,
          commercialCode:
            CODE_LOCK,
          filename:
            `m2cd-lock-${status.toLowerCase()}-${suffix}.xlsx`,
          quantity,
          workbookNonce:
            `${status}-${randomUUID()}`,
        });

      expect(
        attempt.confirmed
          .succeededRows,
      ).toBe(1);

      expect(
        attempt.confirmed
          .failedRows,
      ).toBe(0);

      expect(
        attempt.rows,
      ).toHaveLength(1);

      expect(
        attempt.rows[0]
          ?.executionStatus,
      ).toBe(
        'SUCCEEDED',
      );

      expect(
        attempt.rows[0]
          ?.errorCode,
      ).toBeNull();

      const after =
        await snapshot(
          AUTH_LOCK,
          CODE_LOCK,
        );

      expect(
        after.id,
      ).toBe(
        before.id,
      );

      expect(
        after.version,
      ).toBe(
        beforeAttempt.version +
          1,
      );

      expect(
        Number(
          after
            .source_data
            .CANTIDAD,
        ),
      ).toBe(
        quantity,
      );

      const lineage =
        await database.query<{
          count:
            number;
        }>(
          `select count(*)::int count
           from purchase_order_authorization_sources source
           join purchase_order_lines pol
             on pol.id = source.purchase_order_line_id
           where source.authorization_item_id = $1
             and pol.purchase_order_id = $2`,
          [
            before.id,
            orderId,
          ],
        );

      expect(
        lineage
          .rows[0]
          ?.count,
      ).toBe(1);

      const order =
        await database.query<{
          status:
            string;
        }>(
          `select status
           from purchase_orders
           where id = $1`,
          [
            orderId,
          ],
        );

      expect(
        order.rows[0]
          ?.status,
      ).toBe(
        status,
      );
    }
  });

  it('5. CANCELLED libera la autorización para UPDATE', async () => {
    await seedTariffProduct(CODE_CANCELLED);

    const initial = await uploadAndConfirm({
      authorizationNumber: AUTH_CANCELLED,
      commercialCode: CODE_CANCELLED,
      filename: `m2cd-cancel-initial-${suffix}.xlsx`,
      quantity: 2,
      workbookNonce: randomUUID(),
    });

    expect(initial.confirmed.succeededRows).toBe(1);

    const before = await snapshot(AUTH_CANCELLED, CODE_CANCELLED);

    await createPurchaseOrderFixture({
      authorizationItemId: before.id,
      commercialCode: CODE_CANCELLED,
      tag: 'CANCEL',
      month: 8,
      status: 'CANCELLED',
    });

    const changed = await uploadAndConfirm({
      authorizationNumber: AUTH_CANCELLED,
      commercialCode: CODE_CANCELLED,
      filename: `m2cd-cancel-update-${suffix}.xlsx`,
      quantity: 5,
      workbookNonce: randomUUID(),
    });

    expect(changed.confirmed.succeededRows).toBe(1);
    expect(changed.confirmed.failedRows).toBe(0);

    const after = await snapshot(AUTH_CANCELLED, CODE_CANCELLED);

    expect(after.id).toBe(before.id);
    expect(after.version).toBe(before.version + 1);
    expect(Number(after.source_data.CANTIDAD)).toBe(5);
  });

  it('6. REJECTED libera la autorización para UPDATE', async () => {
    await seedTariffProduct(CODE_REJECTED);

    const initial = await uploadAndConfirm({
      authorizationNumber: AUTH_REJECTED,
      commercialCode: CODE_REJECTED,
      filename: `m2cd-reject-initial-${suffix}.xlsx`,
      quantity: 2,
      workbookNonce: randomUUID(),
    });

    expect(initial.confirmed.succeededRows).toBe(1);

    const before = await snapshot(AUTH_REJECTED, CODE_REJECTED);

    await createPurchaseOrderFixture({
      authorizationItemId: before.id,
      commercialCode: CODE_REJECTED,
      tag: 'REJECT',
      month: 9,
      status: 'REJECTED',
    });

    const changed = await uploadAndConfirm({
      authorizationNumber: AUTH_REJECTED,
      commercialCode: CODE_REJECTED,
      filename: `m2cd-reject-update-${suffix}.xlsx`,
      quantity: 5,
      workbookNonce: randomUUID(),
    });

    expect(changed.confirmed.succeededRows).toBe(1);
    expect(changed.confirmed.failedRows).toBe(0);

    const after = await snapshot(AUTH_REJECTED, CODE_REJECTED);

    expect(after.id).toBe(before.id);
    expect(after.version).toBe(before.version + 1);
    expect(Number(after.source_data.CANTIDAD)).toBe(5);
  });

  it('7. AUTO sin producto en AT se persiste como NOT_LISTED + UNCLASSIFIED', async () => {
    const code =
      `M2CD-NOTLISTED-${suffix}`;

    const authorization =
      `M2CD-AUTH-NOTLISTED-${suffix}`;

    const result =
      await uploadAndConfirm({
        authorizationNumber:
          authorization,
        commercialCode:
          code,
        filename:
          `m2cd-notlisted-${suffix}.xlsx`,
        quantity:
          2,
        workbookNonce:
          randomUUID(),
      });

    expect(
      result.confirmed
        .succeededRows,
    ).toBe(1);

    expect(
      result.confirmed
        .failedRows,
    ).toBe(0);

    const stored =
      await database.query<{
        coverage_type:
          string;

        direction_status:
          string;

        tariff_membership_status:
          string;
      }>(
        `select
           coverage_type,
           direction_status,
           tariff_membership_status
         from authorization_items
         where numero_autorizacion = $1
           and codigo_medicamento = $2`,
        [
          authorization,
          code,
        ],
      );

    expect(
      stored.rows,
    ).toHaveLength(1);

    expect(
      stored.rows[0],
    ).toMatchObject({
      coverage_type:
        'UNCLASSIFIED',

      direction_status:
        'PENDING',

      tariff_membership_status:
        'NOT_LISTED',
    });
  });

  it('8. AUTO NO PBS se persiste y queda pendiente de direccionamiento', async () => {
    const code =
      `M2CD-NOPBS-${suffix}`;

    const authorization =
      `M2CD-AUTH-NOPBS-${suffix}`;

    await seedTariffProduct(
      code,
    );

    await database.query(
      `update tariff_annex_products
       set tipo_inclusion = 'NO_PBS'
       where codigo_producto = $1`,
      [
        code,
      ],
    );

    const result =
      await uploadAndConfirm({
        authorizationNumber:
          authorization,
        commercialCode:
          code,
        filename:
          `m2cd-nopbs-${suffix}.xlsx`,
        quantity:
          2,
        workbookNonce:
          randomUUID(),
      });

    expect(
      result.confirmed
        .succeededRows,
    ).toBe(1);

    const stored =
      await database.query<{
        coverage_type:
          string;

        direction_status:
          string;

        tariff_membership_status:
          string;
      }>(
        `select
           coverage_type,
           direction_status,
           tariff_membership_status
         from authorization_items
         where numero_autorizacion = $1
           and codigo_medicamento = $2`,
        [
          authorization,
          code,
        ],
      );

    expect(
      stored.rows[0],
    ).toMatchObject({
      coverage_type:
        'NO_PBS',

      direction_status:
        'PENDING',

      tariff_membership_status:
        'LISTED',
    });
  });

});
