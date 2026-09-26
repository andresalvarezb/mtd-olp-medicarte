import {
  randomUUID,
} from 'node:crypto';

import {
  Client,
  Pool,
} from 'pg';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import {
  runInventoryExpirationReleaseSweep,
} from '../../apps/worker/src/inventory-expiration-release';

import {
  ORGANIZATION_IDS,
  adminLogin,
} from './helpers/auth';


type Json =
  Record<string, unknown>;


const databaseUrl =
  process.env.DATABASE_URL!;

const databaseName =
  new URL(
    databaseUrl,
  ).pathname.replace(
    /^\/+/,
    '',
  );

const apiUrl =
  process.env.API_URL ??
  'http://127.0.0.1:8018';

const database =
  new Client({
    connectionString:
      databaseUrl,
  });

const sweepDatabase = {
  pool:
    new Pool({
      connectionString:
        databaseUrl,
    }),
};

const suffix =
  randomUUID()
    .slice(
      0,
      8,
    )
    .toUpperCase();

const PRODUCT =
  `EXP-${suffix}`;

const PO_CODE =
  `EXP-PO-${suffix}`;

const POINT_CODE =
  `EXP-PT-${suffix}`;

const AUTO_NUMBER =
  `EXP-AUTO-${suffix}`;

const AUTHORIZATION_KEY =
  `${AUTO_NUMBER}:${PRODUCT}`;


let adminToken = '';

let foundationUserId = '';

let pointId = '';

let purchaseOrderId = '';

let purchaseOrderLineId = '';

let authorizationItemId = '';

let allocationId = '';

let receiptId = '';


function object(
  value: unknown,
): Json {
  return (
    typeof value ===
      'object'
    &&
    value !== null
    &&
    !Array.isArray(
      value,
    )
  )
    ? value as Json
    : {};
}


function numberField(
  value: Json,
  key: string,
) {
  const raw =
    value[key];

  if (
    typeof raw ===
    'number'
  ) {
    return raw;
  }

  if (
    typeof raw ===
      'string'
    &&
    raw.trim() !==
      ''
  ) {
    return Number(
      raw,
    );
  }

  return NaN;
}


function bogotaToday() {
  return new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone:
        'America/Bogota',

      year:
        'numeric',

      month:
        '2-digit',

      day:
        '2-digit',
    },
  ).format(
    new Date(),
  );
}


function plusDays(
  value: string,
  days: number,
) {
  const date =
    new Date(
      `${value}T12:00:00Z`,
    );

  date.setUTCDate(
    date.getUTCDate()
    +
    days,
  );

  return date
    .toISOString()
    .slice(
      0,
      10,
    );
}


function compactDate(
  value: string,
) {
  return value.replace(
    /-/g,
    '',
  );
}


async function request(
  method: string,
  path: string,
) {
  const response =
    await fetch(
      `${apiUrl}/api/v1${path}`,
      {
        method,

        headers: {
          authorization:
            `Bearer ${adminToken}`,

          'x-organization-id':
            ORGANIZATION_IDS.MTD,
        },
      },
    );

  let parsed:
    unknown = {};

  try {
    parsed =
      await response.json();
  } catch {
    parsed = {};
  }

  return {
    status:
      response.status,

    body:
      object(
        parsed,
      ),
  };
}


async function inventory() {
  const response =
    await request(
      'GET',
      `/inventory/availability?purchaseOrder=${encodeURIComponent(
        PO_CODE,
      )}&limit=20`,
    );

  expect(
    response.status,
    JSON.stringify(
      response.body,
    ),
  ).toBe(
    200,
  );

  const items =
    Array.isArray(
      response.body.items,
    )
      ? response.body.items
      : [];

  const row =
    items
      .map(
        object,
      )
      .find(
        (candidate) =>
          candidate.purchaseOrderCode ===
            PO_CODE
          &&
          candidate.commercialCode ===
            PRODUCT,
      );

  expect(
    row,
  ).toBeDefined();

  return row!;
}


async function setExpiration(
  offsetDays: number,
) {
  await database.query(
    `
      UPDATE
        authorization_items

      SET
        source_data =
          jsonb_set(
            source_data,
            '{FECHA_FINAL_VIGENCIA}',
            to_jsonb($2::text),
            true
          ),

        updated_at =
          NOW()

      WHERE
        id =
          $1
    `,
    [
      authorizationItemId,

      compactDate(
        plusDays(
          bogotaToday(),
          offsetDays,
        ),
      ),
    ],
  );
}


async function allocationSnapshot() {
  const result =
    await database.query<{
      allocated_quantity:
        number;

      consumed_quantity:
        number;

      released_quantity:
        number;

      status:
        string;
    }>(
      `
        SELECT
          allocated_quantity,
          consumed_quantity,
          released_quantity,
          status

        FROM
          inventory_authorization_allocations

        WHERE
          id =
            $1
      `,
      [
        allocationId,
      ],
    );

  return result.rows[0]!;
}


beforeAll(
  async () => {
    if (
      !/^authorization_e2e_\d{14}$/.test(
        databaseName,
      )
    ) {
      throw new Error(
        `SAFETY_STOP:${databaseName}`,
      );
    }

    await database.connect();

    const health =
      await fetch(
        `${apiUrl}/api/v1/health`,
      );

    expect(
      health.status,
    ).toBe(
      200,
    );

    adminToken =
      await adminLogin();


    const user =
      await database.query<{
        id: string;
      }>(
        `
          SELECT id
          FROM users
          WHERE username =
            'foundation-admin'
          LIMIT 1
        `,
      );

    foundationUserId =
      user.rows[0]?.id ??
      '';

    if (
      !foundationUserId
    ) {
      throw new Error(
        'FOUNDATION_ADMIN_NOT_FOUND',
      );
    }


    const sourceBatch =
      await database.query<{
        id: string;
      }>(
        `
          SELECT id
          FROM import_batches
          ORDER BY created_at
          LIMIT 1
        `,
      );

    const sourceBatchId =
      sourceBatch.rows[0]?.id;

    if (
      !sourceBatchId
    ) {
      throw new Error(
        'SOURCE_IMPORT_BATCH_NOT_FOUND',
      );
    }


    const point =
      await database.query<{
        id: string;
      }>(
        `
          INSERT INTO
            dispensing_points (
              organization_id,
              code,
              name,
              active,
              created_by
            )

          VALUES (
            $1,
            $2,
            $3,
            true,
            $4
          )

          RETURNING id
        `,
        [
          ORGANIZATION_IDS.MEDICARTE,
          POINT_CODE,
          `Punto Expiration E2E ${suffix}`,
          foundationUserId,
        ],
      );

    pointId =
      point.rows[0]!.id;


    const po =
      await database.query<{
        id: string;
      }>(
        `
          INSERT INTO
            purchase_orders (
              purchase_order_code,
              origin,
              legacy_assigned_at,
              legacy_assigned_by,
              status,
              version,
              created_by,
              updated_by
            )

          VALUES (
            $1,
            'LEGACY_BACKFILL',
            NOW(),
            $2,
            'HISTORICAL_ONLY',
            1,
            $2,
            $2
          )

          RETURNING id
        `,
        [
          PO_CODE,
          foundationUserId,
        ],
      );

    purchaseOrderId =
      po.rows[0]!.id;


    const line =
      await database.query<{
        id: string;
      }>(
        `
          INSERT INTO
            purchase_order_lines (
              purchase_order_id,
              commercial_code,
              provenance,
              product_description,
              dispensing_point_id,
              requested_quantity,
              tariff_snapshot_provenance
            )

          VALUES (
            $1,
            $2,
            'LEGACY_AUTHORIZATION',
            'Producto Expiration E2E',
            $3,
            10,
            'LEGACY_UNRESOLVED'
          )

          RETURNING id
        `,
        [
          purchaseOrderId,
          PRODUCT,
          pointId,
        ],
      );

    purchaseOrderLineId =
      line.rows[0]!.id;


    const authorization =
      await database.query<{
        id: string;
      }>(
        `
          INSERT INTO
            authorization_items (
              numero_autorizacion,
              codigo_medicamento,
              authorization_key,
              source_data,
              source_status_normalized,
              enablement_status,
              coverage_type,
              direction_status,
              operation_status,
              process_status,
              coverage_rule_version,
              orden_compra,
              tariff_membership_status,
              created_from_batch_id,
              updated_by
            )

          VALUES (
            $1,
            $2,
            $3,
            $4::jsonb,
            '5',
            'ENABLED',
            'PBS',
            'NOT_APPLICABLE',
            'READY_TO_DISPENSE',
            'PENDIENTE_DISPENSACION',
            'E2E-EXPIRATION-1',
            $5,
            'LISTED',
            $6,
            $7
          )

          RETURNING id
        `,
        [
          AUTO_NUMBER,
          PRODUCT,
          AUTHORIZATION_KEY,

          JSON.stringify({
            CANTIDAD:
              '5',

            FECHA_ASIGNACION:
              compactDate(
                plusDays(
                  bogotaToday(),
                  -20,
                ),
              ),

            FECHA_FINAL_VIGENCIA:
              compactDate(
                plusDays(
                  bogotaToday(),
                  -5,
                ),
              ),
          }),

          PO_CODE,
          sourceBatchId,
          foundationUserId,
        ],
      );

    authorizationItemId =
      authorization.rows[0]!.id;


    await database.query(
      `
        INSERT INTO
          authorization_item_organizations (
            authorization_item_id,
            organization_id
          )

        VALUES (
          $1,
          $2
        )
      `,
      [
        authorizationItemId,
        ORGANIZATION_IDS.MTD,
      ],
    );


    await database.query(
      `
        INSERT INTO
          purchase_order_authorization_sources (
            purchase_order_line_id,
            authorization_item_id,
            source_quantity_snapshot,
            provenance,
            evidence_at
          )

        VALUES (
          $1,
          $2,
          5,
          'LEGACY_DIRECT_ASSIGNMENT',
          NOW()
        )
      `,
      [
        purchaseOrderLineId,
        authorizationItemId,
      ],
    );


    const receipt =
      await database.query<{
        id: string;
      }>(
        `
          INSERT INTO
            purchase_order_receipts (
              purchase_order_id,
              received_at,
              confirmed_at,
              confirmed_by,
              observation
            )

          VALUES (
            $1,
            NOW(),
            NOW(),
            $2,
            'E2E automatic expiration release'
          )

          RETURNING id
        `,
        [
          purchaseOrderId,
          foundationUserId,
        ],
      );

    receiptId =
      receipt.rows[0]!.id;


    await database.query(
      `
        INSERT INTO
          purchase_order_receipt_lines (
            receipt_id,
            purchase_order_line_id,
            outcome,
            received_quantity,
            observation
          )

        VALUES (
          $1,
          $2,
          'RECEIVED_COMPLETE',
          10,
          'E2E automatic expiration release'
        )
      `,
      [
        receiptId,
        purchaseOrderLineId,
      ],
    );


    const allocationBatch =
      await database.query<{
        id: string;
      }>(
        `
          INSERT INTO
            inventory_allocation_batches (
              organization_id,
              source,
              status,
              total_rows,
              valid_rows,
              invalid_rows,
              allocated_quantity,
              correlation_id,
              created_by,
              confirmed_by,
              confirmed_at
            )

          VALUES (
            $1,
            'UI',
            'CONFIRMED',
            1,
            1,
            0,
            5,
            $2,
            $3,
            $3,
            NOW()
          )

          RETURNING id
        `,
        [
          ORGANIZATION_IDS.MTD,
          randomUUID(),
          foundationUserId,
        ],
      );


    const allocation =
      await database.query<{
        id: string;
      }>(
        `
          INSERT INTO
            inventory_authorization_allocations (
              batch_id,
              organization_id,
              authorization_item_id,
              purchase_order_id,
              commercial_code,
              dispensing_point_id,
              allocated_quantity,
              consumed_quantity,
              released_quantity,
              status,
              authorization_version,
              created_by,
              updated_by
            )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            5,
            0,
            0,
            'ALLOCATED',
            1,
            $7,
            $7
          )

          RETURNING id
        `,
        [
          allocationBatch.rows[0]!.id,
          ORGANIZATION_IDS.MTD,
          authorizationItemId,
          purchaseOrderId,
          PRODUCT,
          pointId,
          foundationUserId,
        ],
      );

    allocationId =
      allocation.rows[0]!.id;
  },
  30_000,
);


afterAll(
  async () => {
    await database.end();

    await sweepDatabase.pool.end();
  },
);


describe(
  'Vencimiento automatico -> Disponible sin asignar',
  () => {
    it(
      'conserva reserva hasta dia 5 y la libera automaticamente en dia 6',
      async () => {
        const today =
          bogotaToday();


        /*
         * Día 5.
         */
        const before =
          await inventory();

        expect(
          numberField(
            before,
            'receivedQuantity',
          ),
        ).toBe(
          10,
        );

        expect(
          numberField(
            before,
            'assignedQuantity',
          ),
        ).toBe(
          5,
        );

        expect(
          numberField(
            before,
            'availableQuantity',
          ),
        ).toBe(
          5,
        );


        const day5 =
          await runInventoryExpirationReleaseSweep(
            sweepDatabase,
            today,
          );

        expect(
          day5.releasedAllocations,
        ).toBe(
          0,
        );

        expect(
          day5.releasedQuantity,
        ).toBe(
          0,
        );

        expect(
          await allocationSnapshot(),
        ).toMatchObject({
          allocated_quantity:
            5,

          consumed_quantity:
            0,

          released_quantity:
            0,

          status:
            'ALLOCATED',
        });


        const day5Authorization =
          await database.query<{
            orden_compra:
              string | null;
          }>(
            `
              SELECT
                orden_compra

              FROM
                authorization_items

              WHERE
                id =
                  $1
            `,
            [
              authorizationItemId,
            ],
          );

        expect(
          day5Authorization
            .rows[0]
            ?.orden_compra,
        ).toBe(
          PO_CODE,
        );


        /*
         * Simular día 6:
         * la fecha final ahora está 6 días atrás.
         */
        await setExpiration(
          -6,
        );


        const day6 =
          await runInventoryExpirationReleaseSweep(
            sweepDatabase,
            today,
          );

        expect(
          day6.releasedAllocations,
        ).toBe(
          1,
        );

        expect(
          day6.releasedQuantity,
        ).toBe(
          5,
        );

        expect(
          day6.clearedAuthorizations,
        ).toBe(
          1,
        );


        /*
         * La allocation permanece como evidencia,
         * pero ya no existe saldo asignado activo.
         */
        expect(
          await allocationSnapshot(),
        ).toMatchObject({
          allocated_quantity:
            5,

          consumed_quantity:
            0,

          released_quantity:
            5,

          status:
            'EXPIRED',
        });


        /*
         * La AUTO pierde la OC operacional.
         *
         * El código del medicamento NO se borra:
         * identifica el producto autorizado,
         * no la reserva.
         */
        const authorizationAfter =
          await database.query<{
            orden_compra:
              string | null;

            codigo_medicamento:
              string;
          }>(
            `
              SELECT
                orden_compra,
                codigo_medicamento

              FROM
                authorization_items

              WHERE
                id =
                  $1
            `,
            [
              authorizationItemId,
            ],
          );

        expect(
          authorizationAfter
            .rows[0]
            ?.orden_compra,
        ).toBeNull();

        expect(
          authorizationAfter
            .rows[0]
            ?.codigo_medicamento,
        ).toBe(
          PRODUCT,
        );


        /*
         * Las unidades regresan al pool fungible.
         */
        const after =
          await inventory();

        expect(
          numberField(
            after,
            'receivedQuantity',
          ),
        ).toBe(
          10,
        );

        expect(
          numberField(
            after,
            'fulfilledQuantity',
          ),
        ).toBe(
          0,
        );

        expect(
          numberField(
            after,
            'assignedQuantity',
          ),
        ).toBe(
          0,
        );

        expect(
          numberField(
            after,
            'availableQuantity',
          ),
        ).toBe(
          10,
        );


        /*
         * Recepción física intacta.
         */
        const receipt =
          await database.query<{
            received:
              number;
          }>(
            `
              SELECT
                COALESCE(
                  SUM(
                    received_quantity
                  ),
                  0
                )::int
                  AS received

              FROM
                purchase_order_receipt_lines

              WHERE
                receipt_id =
                  $1
            `,
            [
              receiptId,
            ],
          );

        expect(
          receipt.rows[0]
            ?.received,
        ).toBe(
          10,
        );


        /*
         * Auditoría SYSTEM.
         */
        const audit =
          await database.query<{
            action:
              string;

            released:
              string | null;
          }>(
            `
              SELECT
                action,

                after
                  ->> 'releasedQuantity'
                  AS released

              FROM
                audit_events

              WHERE
                resource_id =
                  $1

                AND action =
                  'INVENTORY_ALLOCATION_AUTO_RELEASED_EXPIRED'
            `,
            [
              allocationId,
            ],
          );

        expect(
          audit.rows,
        ).toHaveLength(
          1,
        );

        expect(
          audit.rows[0],
        ).toMatchObject({
          action:
            'INVENTORY_ALLOCATION_AUTO_RELEASED_EXPIRED',

          released:
            '5',
        });


        /*
         * Segundo sweep = idempotente.
         */
        const duplicate =
          await runInventoryExpirationReleaseSweep(
            sweepDatabase,
            today,
          );

        expect(
          duplicate.releasedAllocations,
        ).toBe(
          0,
        );

        const auditAfterRetry =
          await database.query<{
            total:
              number;
          }>(
            `
              SELECT
                COUNT(*)::int
                  AS total

              FROM
                audit_events

              WHERE
                resource_id =
                  $1

                AND action =
                  'INVENTORY_ALLOCATION_AUTO_RELEASED_EXPIRED'
            `,
            [
              allocationId,
            ],
          );

        expect(
          auditAfterRetry
            .rows[0]
            ?.total,
        ).toBe(
          1,
        );
      },
      60_000,
    );
  },
);
