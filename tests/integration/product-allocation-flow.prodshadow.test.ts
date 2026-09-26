import {
  randomUUID,
} from 'node:crypto';

import {
  Client,
} from 'pg';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import {
  ORGANIZATION_IDS,
  adminLogin,
  ensureOperatorTokens,
  grantMedicarteOperatorPoints,
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

const suffix =
  randomUUID()
    .slice(
      0,
      8,
    )
    .toUpperCase();

const PRODUCT =
  `ALLOC-${suffix}`;

const PO_CODE =
  `ALLOC-PO-${suffix}`;

const POINT_CODE =
  `ALLOC-PT-${suffix}`;

const AUTO_A =
  `A-${suffix}`;

const AUTO_B =
  `B-${suffix}`;

const AUTO_C =
  `C-${suffix}`;


let adminToken = '';
let olpToken = '';
let medicarteToken = '';

let foundationUserId = '';
let pointId = '';
let purchaseOrderId = '';
let purchaseOrderLineId = '';

let authAId = '';
let authBId = '';
let authCId = '';

let poVersion = 1;


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
    date.getUTCDate() +
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


function object(
  value: unknown,
): Json {
  return (
    typeof value ===
      'object' &&
    value !== null &&
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
      'string' &&
    raw.trim() !==
      ''
  ) {
    return Number(
      raw,
    );
  }

  return NaN;
}


async function request(
  method: string,
  path: string,
  token: string,
  organizationId: string,
  body?: unknown,
) {
  const response =
    await fetch(
      `${apiUrl}/api/v1${path}`,
      {
        method,

        headers: {
          authorization:
            `Bearer ${token}`,

          'x-organization-id':
            organizationId,

          ...(body === undefined
            ? {}
            : {
                'content-type':
                  'application/json',
              }),
        },

        ...(body === undefined
          ? {}
          : {
              body:
                JSON.stringify(
                  body,
                ),
            }),
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
      medicarteToken,
      ORGANIZATION_IDS.MEDICARTE,
    );

  expect(
    response.status,
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
            PO_CODE &&
          candidate.commercialCode ===
            PRODUCT,
      );

  expect(
    row,
  ).toBeDefined();

  return row!;
}


async function operationalStatus(
  id: string,
  actor:
    'MTD' | 'MEDICARTE' =
      'MEDICARTE',
) {
  const isMtd =
    actor ===
    'MTD';

  const response =
    await request(
      'GET',
      `/authorization-query/${id}`,
      isMtd
        ? adminToken
        : medicarteToken,
      isMtd
        ? ORGANIZATION_IDS.MTD
        : ORGANIZATION_IDS.MEDICARTE,
    );

  expect(
    response.status,
    JSON.stringify(
      response.body,
    ),
  ).toBe(
    200,
  );

  return String(
    response.body
      .operationalStatus,
  );
}


async function allocationSnapshot() {
  const result =
    await database.query<{
      numero_autorizacion:
        string;

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
        select
          ai.numero_autorizacion,

          iaa.allocated_quantity,

          iaa.consumed_quantity,

          iaa.released_quantity,

          iaa.status

        from
          inventory_authorization_allocations iaa

        join
          authorization_items ai
            on ai.id =
               iaa.authorization_item_id

        where
          iaa.purchase_order_id =
            $1

        order by
          ai.numero_autorizacion
      `,
      [
        purchaseOrderId,
      ],
    );

  return result.rows;
}


async function seedAuthorization(
  input: {
    number: string;
    quantity: number;
    expiration: string;
  },
) {
  const batch =
    await database.query<{
      id: string;
    }>(
      `
        select id

        from import_batches

        order by created_at

        limit 1
      `,
    );

  const batchId =
    batch.rows[0]?.id;

  if (!batchId) {
    throw new Error(
      'E2E_IMPORT_BATCH_NOT_FOUND',
    );
  }

  const assignmentDate =
    compactDate(
      plusDays(
        bogotaToday(),
        -1,
      ),
    );

  const result =
    await database.query<{
      id: string;
    }>(
      `
        insert into authorization_items (
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
        values (
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
          'E2E-ALLOCATION-1',
          $5,
          'LISTED',
          $6,
          $7
        )
        returning id
      `,
      [
        input.number,
        PRODUCT,
        `${input.number}:${PRODUCT}`,

        JSON.stringify({
          CANTIDAD:
            String(
              input.quantity,
            ),

          FECHA_ASIGNACION:
            assignmentDate,

          FECHA_FINAL_VIGENCIA:
            compactDate(
              input.expiration,
            ),

          NOMBRE_PACIENTE:
            `Paciente ${input.number}`,

          IDENTIFICACION_PACIENTE:
            `DOC-${input.number}`,
        }),

        PO_CODE,
        batchId,
        foundationUserId,
      ],
    );

  return result.rows[0]!.id;
}


async function attachAuthorization(
  id: string,
  quantity: number,
) {
  await database.query(
    `
      insert into
        purchase_order_authorization_sources (
          purchase_order_line_id,
          authorization_item_id,
          source_quantity_snapshot,
          provenance,
          evidence_at
        )
      values (
        $1,
        $2,
        $3,
        'LEGACY_DIRECT_ASSIGNMENT',
        now()
      )
    `,
    [
      purchaseOrderLineId,
      id,
      quantity,
    ],
  );
}


async function fulfill(
  authorizationItemId:
    string,
) {
  return request(
    'POST',
    `/medicarte/authorizations/${authorizationItemId}/fulfill`,
    medicarteToken,
    ORGANIZATION_IDS.MEDICARTE,
    {
      purchaseOrderCode:
        PO_CODE,

      fulfillmentType:
        'APPLICATION',

      effectiveDate:
        bogotaToday(),
    },
  );
}


async function receive(
  quantity:
    number,
) {
  return request(
    'POST',
    `/medicarte/purchase-orders/${purchaseOrderId}/receipts`,
    medicarteToken,
    ORGANIZATION_IDS.MEDICARTE,
    {
      receivedAt:
        `${bogotaToday()}T10:00:00-05:00`,

      observation:
        `E2E recepción ${quantity}`,

      lines: [
        {
          purchaseOrderLineId,

          receivedQuantity:
            quantity,
        },
      ],
    },
  );
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

    ({
      olpToken,
      medicarteToken,
    } =
      await ensureOperatorTokens());

    const user =
      await database.query<{
        id: string;
      }>(
        `
          select id

          from users

          where username =
            'foundation-admin'

          limit 1
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


    const point =
      await database.query<{
        id: string;
      }>(
        `
          insert into dispensing_points (
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
          returning id
        `,
        [
          ORGANIZATION_IDS.MEDICARTE,
          POINT_CODE,
          `Punto Allocation E2E ${suffix}`,
          foundationUserId,
        ],
      );

    pointId =
      point.rows[0]!.id;

    await grantMedicarteOperatorPoints(
      database,
      [
        pointId,
      ],
    );


    const purchaseOrder =
      await database.query<{
        id: string;
      }>(
        `
          insert into purchase_orders (
            purchase_order_code,
            origin,
            legacy_assigned_at,
            legacy_assigned_by,
            status,
            version,
            created_by,
            updated_by
          )
          values (
            $1,
            'LEGACY_BACKFILL',
            now(),
            $2,
            'HISTORICAL_ONLY',
            1,
            $2,
            $2
          )
          returning id
        `,
        [
          PO_CODE,
          foundationUserId,
        ],
      );

    purchaseOrderId =
      purchaseOrder.rows[0]!.id;


    const line =
      await database.query<{
        id: string;
      }>(
        `
          insert into purchase_order_lines (
            purchase_order_id,
            commercial_code,
            provenance,
            product_description,
            dispensing_point_id,
            requested_quantity,
            tariff_snapshot_provenance
          )
          values (
            $1,
            $2,
            'LEGACY_AUTHORIZATION',
            'Producto Allocation E2E',
            $3,
            4,
            'LEGACY_UNRESOLVED'
          )
          returning id
        `,
        [
          purchaseOrderId,
          PRODUCT,
          pointId,
        ],
      );

    purchaseOrderLineId =
      line.rows[0]!.id;


    /*
     * Orden deliberado:
     *
     * A = 2 unidades, vence primero.
     * B = 1 unidad, vence después.
     * C = 1 unidad, vence último.
     *
     * Primera recepción = 1:
     * A no cabe completa -> debe saltarse -> gana B.
     */
    authAId =
      await seedAuthorization({
        number:
          AUTO_A,

        quantity:
          2,

        expiration:
          plusDays(
            bogotaToday(),
            5,
          ),
      });

    authBId =
      await seedAuthorization({
        number:
          AUTO_B,

        quantity:
          1,

        expiration:
          plusDays(
            bogotaToday(),
            10,
          ),
      });

    authCId =
      await seedAuthorization({
        number:
          AUTO_C,

        quantity:
          1,

        expiration:
          plusDays(
            bogotaToday(),
            15,
          ),
      });


    await attachAuthorization(
      authAId,
      2,
    );

    await attachAuthorization(
      authBId,
      1,
    );

    await attachAuthorization(
      authCId,
      1,
    );
  },
  30_000,
);


afterAll(
  async () => {
    await database.end();
  },
);


describe(
  'OC -> recepción -> inventario -> allocation -> aplicación',
  () => {
    it(
      'ejecuta todo el flujo quantity-only sin doble consumo',
      async () => {
        /*
         * 1. Antes de OLP/recepción:
         * tener OC NO significa tener inventario.
         */
        /*
         * Antes de la aceptación OLP, MEDICARTE
         * todavía no tiene visibilidad operacional
         * sobre estas AUTO.
         *
         * MTD sí puede comprobar que ambas parten
         * de UNASSIGNED.
         */
        expect(
          await operationalStatus(
            authAId,
            'MTD',
          ),
        ).toBe(
          'UNASSIGNED',
        );

        expect(
          await operationalStatus(
            authBId,
            'MTD',
          ),
        ).toBe(
          'UNASSIGNED',
        );


        /*
         * 2. OLP gestiona 3 de 4.
         */
        const firstManagement =
          await request(
            'POST',
            `/supplier/purchase-orders/${purchaseOrderId}/accept`,
            olpToken,
            ORGANIZATION_IDS.OLP,
            {
              expectedVersion:
                poVersion,

              committedDate:
                bogotaToday(),

              observation:
                'E2E gestión parcial 3/4',

              lines: [
                {
                  purchaseOrderLineId,

                  managedQuantity:
                    3,
                },
              ],
            },
          );

        expect(
          firstManagement.status,
          JSON.stringify(
            firstManagement.body,
          ),
        ).toBe(
          200,
        );

        poVersion =
          numberField(
            firstManagement.body,
            'version',
          );

        expect(
          Number.isInteger(
            poVersion,
          ),
        ).toBe(
          true,
        );


        const managed3 =
          await database.query<{
            requested_quantity:
              number;

            olp_managed_quantity:
              number;
          }>(
            `
              select
                requested_quantity,
                olp_managed_quantity

              from purchase_order_lines

              where id =
                $1
            `,
            [
              purchaseOrderLineId,
            ],
          );

        expect(
          managed3.rows[0],
        ).toMatchObject({
          requested_quantity:
            4,

          olp_managed_quantity:
            3,
        });


        /*
         * 3. Medicarte recibe 1.
         */
        const receipt1 =
          await receive(
            1,
          );

        expect(
          receipt1.status,
          JSON.stringify(
            receipt1.body,
          ),
        ).toBe(
          201,
        );


        /*
         * 4. El inventario moderno debe ver esa unidad.
         */
        const inventory1 =
          await inventory();

        expect(
          numberField(
            inventory1,
            'receivedQuantity',
          ),
        ).toBe(
          1,
        );

        expect(
          numberField(
            inventory1,
            'fulfilledQuantity',
          ),
        ).toBe(
          0,
        );

        expect(
          numberField(
            inventory1,
            'assignedQuantity',
          ),
        ).toBe(
          1,
        );

        expect(
          numberField(
            inventory1,
            'availableQuantity',
          ),
        ).toBe(
          0,
        );


        /*
         * 5. Whole-AUTO:
         * A requiere 2 y no cabe.
         * B requiere 1 y sí cabe.
         */
        const allocations1 =
          await allocationSnapshot();

        expect(
          allocations1,
        ).toHaveLength(
          1,
        );

        expect(
          allocations1[0],
        ).toMatchObject({
          numero_autorizacion:
            AUTO_B,

          allocated_quantity:
            1,

          consumed_quantity:
            0,

          released_quantity:
            0,

          status:
            'ALLOCATED',
        });

        expect(
          await operationalStatus(
            authBId,
          ),
        ).toBe(
          'ASSIGNED',
        );

        expect(
          await operationalStatus(
            authAId,
          ),
        ).toBe(
          'UNASSIGNED',
        );


        /*
         * 6. Aplicar B consume exactamente la allocation.
         */
        const fulfillB =
          await fulfill(
            authBId,
          );

        expect(
          [
            200,
            201,
          ],
          JSON.stringify(
            fulfillB.body,
          ),
        ).toContain(
          fulfillB.status,
        );

        expect(
          await operationalStatus(
            authBId,
          ),
        ).toBe(
          'CLOSED',
        );


        const inventoryAfterB =
          await inventory();

        expect(
          numberField(
            inventoryAfterB,
            'receivedQuantity',
          ),
        ).toBe(
          1,
        );

        expect(
          numberField(
            inventoryAfterB,
            'fulfilledQuantity',
          ),
        ).toBe(
          1,
        );

        expect(
          numberField(
            inventoryAfterB,
            'availableQuantity',
          ),
        ).toBe(
          0,
        );


        /*
         * 7. No puede consumirse dos veces.
         */
        const duplicateB =
          await fulfill(
            authBId,
          );

        expect(
          [
            400,
            409,
          ],
        ).toContain(
          duplicateB.status,
        );


        /*
         * 8. OLP agrega 1.
         * Acumulado 4/4.
         */
        const secondManagement =
          await request(
            'POST',
            `/supplier/purchase-orders/${purchaseOrderId}/accept`,
            olpToken,
            ORGANIZATION_IDS.OLP,
            {
              expectedVersion:
                poVersion,

              committedDate:
                bogotaToday(),

              observation:
                'E2E gestión adicional +1',

              lines: [
                {
                  purchaseOrderLineId,

                  managedQuantity:
                    1,
                },
              ],
            },
          );

        expect(
          secondManagement.status,
          JSON.stringify(
            secondManagement.body,
          ),
        ).toBe(
          200,
        );

        poVersion =
          numberField(
            secondManagement.body,
            'version',
          );


        const managed4 =
          await database.query<{
            olp_managed_quantity:
              number;
          }>(
            `
              select
                olp_managed_quantity

              from purchase_order_lines

              where id =
                $1
            `,
            [
              purchaseOrderLineId,
            ],
          );

        expect(
          managed4.rows[0]
            ?.olp_managed_quantity,
        ).toBe(
          4,
        );


        /*
         * 9. Segunda recepción +2.
         * Recibido acumulado = 3.
         *
         * La unidad ya consumida por B sigue ocupando
         * una de esas tres unidades físicas.
         *
         * Quedan 2 -> debe asignarse A completa.
         */
        const receipt2 =
          await receive(
            2,
          );

        expect(
          receipt2.status,
          JSON.stringify(
            receipt2.body,
          ),
        ).toBe(
          201,
        );


        const inventory3 =
          await inventory();

        expect(
          numberField(
            inventory3,
            'receivedQuantity',
          ),
        ).toBe(
          3,
        );

        expect(
          numberField(
            inventory3,
            'fulfilledQuantity',
          ),
        ).toBe(
          1,
        );

        expect(
          numberField(
            inventory3,
            'assignedQuantity',
          ),
        ).toBe(
          2,
        );

        expect(
          numberField(
            inventory3,
            'availableQuantity',
          ),
        ).toBe(
          0,
        );


        const allocations2 =
          await allocationSnapshot();

        const allocationA =
          allocations2.find(
            (row) =>
              row.numero_autorizacion ===
              AUTO_A,
          );

        expect(
          allocationA,
        ).toMatchObject({
          allocated_quantity:
            2,

          consumed_quantity:
            0,

          status:
            'ALLOCATED',
        });

        expect(
          await operationalStatus(
            authAId,
          ),
        ).toBe(
          'ASSIGNED',
        );


        /*
         * 10. Aplicar A consume 2.
         */
        const fulfillA =
          await fulfill(
            authAId,
          );

        expect(
          [
            200,
            201,
          ],
          JSON.stringify(
            fulfillA.body,
          ),
        ).toContain(
          fulfillA.status,
        );

        expect(
          await operationalStatus(
            authAId,
          ),
        ).toBe(
          'CLOSED',
        );


        /*
         * 11. Última recepción +1.
         * Recibido acumulado = 4.
         * Debe asignar C.
         */
        const receipt3 =
          await receive(
            1,
          );

        expect(
          receipt3.status,
          JSON.stringify(
            receipt3.body,
          ),
        ).toBe(
          201,
        );

        expect(
          await operationalStatus(
            authCId,
          ),
        ).toBe(
          'ASSIGNED',
        );


        /*
         * 12. Aplicar C.
         */
        const fulfillC =
          await fulfill(
            authCId,
          );

        expect(
          [
            200,
            201,
          ],
          JSON.stringify(
            fulfillC.body,
          ),
        ).toContain(
          fulfillC.status,
        );

        expect(
          await operationalStatus(
            authCId,
          ),
        ).toBe(
          'CLOSED',
        );


        /*
         * 13. Inventario final.
         */
        const inventoryFinal =
          await inventory();

        expect(
          numberField(
            inventoryFinal,
            'requestedQuantity',
          ),
        ).toBe(
          4,
        );

        expect(
          numberField(
            inventoryFinal,
            'receivedQuantity',
          ),
        ).toBe(
          4,
        );

        expect(
          numberField(
            inventoryFinal,
            'fulfilledQuantity',
          ),
        ).toBe(
          4,
        );

        expect(
          numberField(
            inventoryFinal,
            'availableQuantity',
          ),
        ).toBe(
          0,
        );

        expect(
          numberField(
            inventoryFinal,
            'pendingReceiptQuantity',
          ),
        ).toBe(
          0,
        );


        /*
         * 14. Ledger lógico final.
         */
        const final =
          await database.query<{
            requested:
              number;

            managed:
              number;

            received:
              number;

            allocated:
              number;

            consumed:
              number;

            active_balance:
              number;

            fulfillments:
              number;

            fulfillment_lines:
              number;

            direct_lines_without_lot:
              number;
          }>(
            `
              select
                pol.requested_quantity::int
                  as requested,

                coalesce(
                  pol.olp_managed_quantity,
                  0
                )::int
                  as managed,

                (
                  select
                    coalesce(
                      sum(
                        porl.received_quantity
                      ),
                      0
                    )::int

                  from
                    purchase_order_receipt_lines porl

                  join
                    purchase_order_receipts por
                      on por.id =
                         porl.receipt_id

                  where
                    por.purchase_order_id =
                      po.id
                )
                  as received,

                (
                  select
                    coalesce(
                      sum(
                        iaa.allocated_quantity
                        -
                        iaa.released_quantity
                      ),
                      0
                    )::int

                  from
                    inventory_authorization_allocations iaa

                  where
                    iaa.purchase_order_id =
                      po.id
                )
                  as allocated,

                (
                  select
                    coalesce(
                      sum(
                        iaa.consumed_quantity
                      ),
                      0
                    )::int

                  from
                    inventory_authorization_allocations iaa

                  where
                    iaa.purchase_order_id =
                      po.id
                )
                  as consumed,

                (
                  select
                    coalesce(
                      sum(
                        greatest(
                          iaa.allocated_quantity
                          -
                          iaa.consumed_quantity
                          -
                          iaa.released_quantity,
                          0
                        )
                      ),
                      0
                    )::int

                  from
                    inventory_authorization_allocations iaa

                  where
                    iaa.purchase_order_id =
                      po.id
                )
                  as active_balance,

                (
                  select
                    count(*)::int

                  from
                    authorization_fulfillments af

                  where
                    af.authorization_item_id in (
                      $2,
                      $3,
                      $4
                    )
                )
                  as fulfillments,

                (
                  select
                    count(*)::int

                  from
                    authorization_fulfillment_lines afl

                  join
                    authorization_fulfillments af
                      on af.id =
                         afl.fulfillment_id

                  where
                    af.authorization_item_id in (
                      $2,
                      $3,
                      $4
                    )
                )
                  as fulfillment_lines,

                (
                  select
                    count(*)::int

                  from
                    authorization_fulfillment_lines afl

                  join
                    authorization_fulfillments af
                      on af.id =
                         afl.fulfillment_id

                  where
                    af.authorization_item_id in (
                      $2,
                      $3,
                      $4
                    )

                    and afl.inventory_lot_id
                      is null

                    and afl.lot_number
                      is null

                    and afl.expiration_date
                      is null
                )
                  as direct_lines_without_lot

              from
                purchase_orders po

              join
                purchase_order_lines pol
                  on pol.purchase_order_id =
                     po.id

              where
                po.id =
                  $1
            `,
            [
              purchaseOrderId,
              authAId,
              authBId,
              authCId,
            ],
          );


        expect(
          final.rows[0],
        ).toEqual({
          requested:
            4,

          managed:
            4,

          received:
            4,

          allocated:
            4,

          consumed:
            4,

          active_balance:
            0,

          fulfillments:
            3,

          fulfillment_lines:
            3,

          direct_lines_without_lot:
            3,
        });


        /*
         * 15. Filtro operacional CLOSED debe encontrar
         * exactamente las tres AUTO del escenario.
         */
        const closed =
          await request(
            'GET',
            `/authorization-query?commercialCode=${encodeURIComponent(
              PRODUCT,
            )}&operationalStatus=CLOSED&page=1&limit=20`,
            medicarteToken,
            ORGANIZATION_IDS.MEDICARTE,
          );

        expect(
          closed.status,
        ).toBe(
          200,
        );

        const closedItems =
          Array.isArray(
            closed.body.items,
          )
            ? closed.body.items
            : [];

        expect(
          closedItems,
        ).toHaveLength(
          3,
        );


        /*
         * Invariantes finales.
         */
        const row =
          final.rows[0]!;

        expect(
          row.managed <=
            row.requested,
        ).toBe(
          true,
        );

        expect(
          row.received <=
            row.managed,
        ).toBe(
          true,
        );

        expect(
          row.consumed <=
            row.received,
        ).toBe(
          true,
        );
      },
      60_000,
    );
  },
);
