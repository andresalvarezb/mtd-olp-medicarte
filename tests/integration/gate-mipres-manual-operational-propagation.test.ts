import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as XLSX from 'xlsx';

import { createDatabase } from '@authorization/database';

import { currentBogotaDate } from '@authorization/domain';

import type { Scope } from '../../apps/api/src/common/request-scope';

import { AuthorizationFulfillmentRepository } from '../../apps/api/src/fulfillments/authorization-fulfillment.repository';

import { InventoryAvailabilityRepository } from '../../apps/api/src/inventory/inventory-availability.repository';

import { PurchaseOrderImportService } from '../../apps/api/src/purchase-orders/purchase-order-import.service';

import { ORGANIZATION_IDS, adminLogin } from './helpers/auth';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:25432/authorization_test_integration';

const apiUrl = process.env.API_URL ?? 'http://localhost:3003';

const database = createDatabase(databaseUrl);

const suffix = randomUUID().slice(0, 8).toUpperCase();

const product = `W4-PROD-${suffix}`;

const pendingNumber = `W4-PEND-${suffix}`;

const enabledNumber = `W4-ENA-${suffix}`;

const disabledNumber = `W4-DIS-${suffix}`;

const poPrefix = `W4-PO-${suffix}`;

let token = '';

let adminId = '';

let batchId = '';

let pendingId = '';

let enabledId = '';

let disabledId = '';

function scope(): Scope {
  return {
    organizationId: ORGANIZATION_IDS.MTD,

    organizationCode: 'MTD',

    userId: adminId,

    correlationId: randomUUID(),

    readSensitive: true,

    isFoundationAdmin: true,

    canCrossOrganizationOperationalExport: true,

    pointAccessKind: 'unrestricted',
  };
}

function randomSha(): string {
  return (randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')).slice(0, 64);
}

async function insertAuthorization(number: string): Promise<string> {
  const result = await database.pool.query<{
    id: string;
  }>(
    `
        insert into authorization_items (
          numero_autorizacion,
          codigo_medicamento,
          authorization_key,
          source_data,
          source_status_normalized,
          source_prescripcion_normalized,
          no_prescripcion,
          enablement_status,
          coverage_type,
          direction_status,
          coverage_rule_version,
          tariff_membership_status,
          tariff_membership_evaluated_at,
          created_from_batch_id
        )
        values (
          $1,
          $2,
          $3,
          $4::jsonb,
          '5',
          '9999999999999',
          '9999999999',
          'ENABLED',
          'NO_PBS',
          'CONFIRMED',
          'W4',
          'LISTED',
          now(),
          $5
        )
        returning id
      `,
    [
      number,

      product,

      `${number}:${product}`,

      JSON.stringify({
        NUMERO_AUTORIZACION: number,

        CODIGO_COMERCIAL: product,

        CANTIDAD: '1',

        FECHA_ASIGNACION: currentBogotaDate(),

        FECHA_FINAL_VIGENCIA: '2099-12-31',

        IDENTIFICACION_PACIENTE: `DOC-${number}`,

        NOMBRE_PACIENTE: `Paciente ${number}`,
      }),

      batchId,
    ],
  );

  const id = result.rows[0]!.id;

  await database.pool.query(
    `
      insert into
        authorization_item_organizations (
          authorization_item_id,
          organization_id
        )
      values (
        $1,
        $2
      )
      on conflict do nothing
    `,
    [id, ORGANIZATION_IDS.MTD],
  );

  return id;
}

async function setDecision(
  id: string,

  decision: 'MANUALLY_ENABLED' | 'MANUALLY_DISABLED',

  concept: string,
): Promise<void> {
  const metadata = await database.pool.query<{
    column_name: string;
  }>(
    `
        select
          column_name
        from
          information_schema.columns
        where
          table_schema =
            'public'
          and
          table_name =
            'authorization_items'
          and
          column_name like
            'mipres_manual%'
        order by
          column_name
      `,
  );

  const columns = metadata.rows.map((row) => row.column_name);

  const conceptColumn = columns.find((column) => column.includes('concept'));

  if (
    !columns.includes('mipres_manual_decision') ||
    !columns.includes('mipres_manual_version') ||
    !conceptColumn ||
    !/^[a-z0-9_]+$/i.test(conceptColumn)
  ) {
    throw new Error(`W4_MANUAL_COLUMNS_INVALID:${JSON.stringify(columns)}`);
  }

  const assignments = [
    'mipres_manual_decision = $2',
    'mipres_manual_version = 1',
    `${conceptColumn} = $3`,
  ];

  const values: unknown[] = [id, decision, concept];

  const noteColumn = columns.find((column) => column.includes('note'));

  if (noteColumn && /^[a-z0-9_]+$/i.test(noteColumn)) {
    assignments.push(`${noteColumn} = null`);
  }

  await database.pool.query(
    `
      update
        authorization_items
      set
        ${assignments.join(',\n        ')}
      where
        id = $1
    `,
    values,
  );
}

async function persistedState(id: string) {
  const result = await database.pool.query<{
    direction_status: string;

    mipres_manual_decision: string;
  }>(
    `
        select
          direction_status,
          mipres_manual_decision
        from
          authorization_items
        where
          id = $1
      `,
    [id],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error('W4_AUTHORIZATION_NOT_FOUND');
  }

  return row;
}

async function readAuthorization(number: string) {
  const response = await fetch(
    `${apiUrl}/api/v1/authorization-query?authorizationNumber=${encodeURIComponent(number)}`,
    {
      headers: {
        authorization: `Bearer ${token}`,

        'x-organization-id': ORGANIZATION_IDS.MTD,
      },
    },
  );

  const payload = (await response.json()) as {
    items?: Array<Record<string, unknown>>;
  };

  expect(response.status, JSON.stringify(payload)).toBe(200);

  const row = payload.items?.find((candidate) => candidate.authorizationNumber === number);

  expect(row).toBeDefined();

  return row!;
}

function workbook(
  number: string,

  purchaseOrder: string,
): Buffer {
  const service = new PurchaseOrderImportService(database, undefined as never);

  const book = XLSX.read(service.buildTemplate(), {
    type: 'buffer',
  });

  const sheet = book.Sheets['ORDENES_COMPRA']!;

  XLSX.utils.sheet_add_aoa(
    sheet,

    [['', `${number}:${product}`, purchaseOrder, product, 1]],

    {
      origin: -1,
    },
  );

  return XLSX.write(book, {
    type: 'buffer',

    bookType: 'xlsx',
  }) as Buffer;
}

async function purchase(
  number: string,

  purchaseOrder: string,
) {
  const buffer = workbook(number, purchaseOrder);

  const service = new PurchaseOrderImportService(database, undefined as never);

  return service.import(
    {
      originalname: `${purchaseOrder}.xlsx`,

      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

      size: buffer.length,

      buffer,
    },

    scope(),
  );
}

beforeAll(async () => {
  token = await adminLogin();

  const user = await database.pool.query<{
    id: string;
  }>(
    `
          select
            id
          from
            users
          where
            username =
              'foundation-admin'
        `,
  );

  adminId = user.rows[0]?.id ?? '';

  if (!adminId) {
    throw new Error('W4_FOUNDATION_ADMIN_NOT_FOUND');
  }

  const batch = await database.pool.query<{
    id: string;
  }>(
    `
          insert into import_batches (
            organization_id,
            created_by,
            original_filename,
            mime_type,
            size_bytes,
            sha256,
            processor_version,
            status,
            total_rows,
            confirmed_rows,
            completed_at,
            confirmed_at
          )
          values (
            $1,
            $2,
            $3,
            'application/json',
            1,
            $4,
            1,
            'COMPLETED',
            3,
            3,
            now(),
            now()
          )
          returning id
        `,
    [ORGANIZATION_IDS.MTD, adminId, `w4-${suffix}.json`, randomSha()],
  );

  batchId = batch.rows[0]!.id;

  pendingId = await insertAuthorization(pendingNumber);

  enabledId = await insertAuthorization(enabledNumber);

  disabledId = await insertAuthorization(disabledNumber);

  await setDecision(enabledId, 'MANUALLY_ENABLED', 'MIPRES_SUPPORT_VALIDATED');

  await setDecision(disabledId, 'MANUALLY_DISABLED', 'DIRECTION_DOES_NOT_MATCH');
}, 30_000);

afterAll(async () => {
  const ids = [pendingId, enabledId, disabledId].filter(Boolean);

  if (ids.length > 0) {
    await database.pool.query(
      `
          delete from
            authorization_item_organizations
          where
            authorization_item_id =
              any($1::uuid[])
        `,
      [ids],
    );

    await database.pool.query(
      `
          delete from
            authorization_items
          where
            id =
              any($1::uuid[])
        `,
      [ids],
    );
  }

  if (batchId) {
    await database.pool.query(
      `
          delete from
            import_batches
          where
            id = $1
        `,
      [batchId],
    );
  }

  await database.pool.end();
});

describe('W4 MIPRES manual operational propagation', () => {
  it('keeps CONFIRMED evidence separate from pending decision', async () => {
    const state = await persistedState(pendingId);

    expect(state).toEqual({
      direction_status: 'CONFIRMED',

      mipres_manual_decision: 'PENDING_MANUAL_ENABLEMENT',
    });

    const item = await readAuthorization(pendingNumber);

    expect(item).toMatchObject({
      mipresManualDecision: 'PENDING_MANUAL_ENABLEMENT',

      initialValidationStatus: 'PENDING',
    });
  });

  it('MANUALLY_ENABLED passes MIPRES while preserving evidence', async () => {
    const state = await persistedState(enabledId);

    expect(state).toEqual({
      direction_status: 'CONFIRMED',

      mipres_manual_decision: 'MANUALLY_ENABLED',
    });

    const item = await readAuthorization(enabledNumber);

    expect(item).toMatchObject({
      mipresManualDecision: 'MANUALLY_ENABLED',

      initialValidationStatus: 'PASSED',
    });
  });

  it('MANUALLY_DISABLED blocks while preserving CONFIRMED evidence', async () => {
    const state = await persistedState(disabledId);

    expect(state).toEqual({
      direction_status: 'CONFIRMED',

      mipres_manual_decision: 'MANUALLY_DISABLED',
    });

    const item = await readAuthorization(disabledNumber);

    expect(item).toMatchObject({
      mipresManualDecision: 'MANUALLY_DISABLED',

      initialValidationStatus: 'FAILED',
    });
  });

  it('direct purchase order rejects pending and disabled', async () => {
    const pending = await purchase(pendingNumber, `${poPrefix}-P`);

    expect(pending.results[0]).toMatchObject({
      status: 'REJECTED',

      errorCode: 'PURCHASE_ORDER_DESTINATION_NOT_ENABLED',
    });

    const disabled = await purchase(disabledNumber, `${poPrefix}-D`);

    expect(disabled.results[0]).toMatchObject({
      status: 'REJECTED',

      errorCode: 'PURCHASE_ORDER_DESTINATION_NOT_ENABLED',
    });

    const enabled = await purchase(enabledNumber, `${poPrefix}-E`);

    expect(enabled.results[0]?.errorCode).not.toBe('PURCHASE_ORDER_DESTINATION_NOT_ENABLED');
  });

  it('inventory blocks pending and disabled while enabled reaches schedule gate', async () => {
    const repository = new InventoryAvailabilityRepository(database);

    await expect(
      repository.assignBatch(
        scope(),

        [
          {
            authorizationKey: `${pendingNumber}:${product}`,

            purchaseOrderCode: `${poPrefix}-IP`,

            quantity: 1,
          },
        ],

        'UI',
      ),
    ).rejects.toThrow('INVENTORY_ALLOCATION_AUTHORIZATION_NOT_FOUND');

    await expect(
      repository.assignBatch(
        scope(),

        [
          {
            authorizationKey: `${disabledNumber}:${product}`,

            purchaseOrderCode: `${poPrefix}-ID`,

            quantity: 1,
          },
        ],

        'UI',
      ),
    ).rejects.toThrow('INVENTORY_ALLOCATION_AUTHORIZATION_NOT_FOUND');

    await expect(
      repository.assignBatch(
        scope(),

        [
          {
            authorizationKey: `${enabledNumber}:${product}`,

            purchaseOrderCode: `${poPrefix}-IE`,

            quantity: 1,
          },
        ],

        'UI',
      ),
    ).rejects.toThrow('INVENTORY_ALLOCATION_SCHEDULE_REQUIRED');
  });

  it('fulfillment blocks pending and disabled while enabled reaches allocation gate', async () => {
    const repository = new AuthorizationFulfillmentRepository(database);

    const request = {
      purchaseOrderCode: `${poPrefix}-FULFILL`,

      fulfillmentType: 'APPLICATION' as const,

      effectiveDate: currentBogotaDate(),

      quantity: 1,
    };

    await expect(repository.fulfill(pendingId, request, scope())).rejects.toThrow(
      'AUTHORIZATION_FULFILLMENT_AUTHORIZATION_NOT_ELIGIBLE',
    );

    await expect(repository.fulfill(disabledId, request, scope())).rejects.toThrow(
      'AUTHORIZATION_FULFILLMENT_AUTHORIZATION_NOT_ELIGIBLE',
    );

    await expect(repository.fulfill(enabledId, request, scope())).rejects.toMatchObject({
      code: 'AUTHORIZATION_FULFILLMENT_ALLOCATION_REQUIRED',

      message: 'La autorización no tiene inventario asignado pendiente de consumo.',
    });
  });
});
