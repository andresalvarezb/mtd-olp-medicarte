import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

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
  ensureUser,
} from './helpers/auth';


const databaseUrl =
  process.env.DATABASE_URL
  ??
  'postgresql://authorization:authorization@localhost:25432/authorization_test_integration';

const apiUrl =
  process.env.API_URL
  ??
  'http://localhost:3003';

const database =
  new Client({
    connectionString:
      databaseUrl,
  });

const suffix =
  randomUUID()
    .slice(0, 8)
    .toUpperCase();

const CODE_A =
  `ME-A-${suffix}`;

const CODE_B =
  `ME-B-${suffix}`;

const OPERATOR_USERNAME =
  `manual-edit-${suffix.toLowerCase()}`;

let foundationUserId:
  string;

let mtdOperatorToken:
  string;

let medicarteToken:
  string;

let olpToken:
  string;

let provenanceBatchId:
  string;

let dispensingPointId:
  string;

let planningPeriodId:
  string;


function isoToday() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}


function addDays(
  days:
    number,
) {
  const value =
    new Date();

  value.setUTCDate(
    value.getUTCDate()
    +
    days,
  );

  return value
    .toISOString()
    .slice(0, 10);
}


async function apiCall(
  method:
    string,

  path:
    string,

  body:
    unknown,

  token:
    string = mtdOperatorToken,

  organizationId:
    string = ORGANIZATION_IDS.MTD,
) {
  return fetch(
    `${apiUrl}/api/v1${path}`,
    {
      method,

      headers: {
        authorization:
          `Bearer ${token}`,

        'content-type':
          'application/json',

        'x-organization-id':
          organizationId,
      },

      ...(
        body ===
          undefined
          ? {}
          : {
              body:
                JSON.stringify(
                  body,
                ),
            }
      ),
    },
  );
}


let authSequence =
  0;


async function createAuthorization(
  input?:
    Readonly<{
      commercialCode?:
        string;

      quantity?:
        number;

      moderatorFee?:
        string;

      validityEndDate?:
        string;
    }>,
) {
  authSequence +=
    1;

  const authorizationNumber =
    `ME-AUTH-${suffix}-${authSequence}`;

  const commercialCode =
    input?.commercialCode
    ??
    CODE_A;

  const quantity =
    input?.quantity
    ??
    30;

  const validityEndDate =
    input?.validityEndDate
    ??
    addDays(
      90,
    );

  const sourceData = {
    NUMERO_AUTORIZACION:
      authorizationNumber,

    CODIGO_COMERCIAL:
      commercialCode,

    ESTADO_AUTORIZACION:
      '5',

    CANTIDAD:
      String(
        quantity,
      ),

    FECHA_ASIGNACION:
      isoToday(),

    FECHA_FINAL_VIGENCIA:
      validityEndDate,

    VALOR_CUOTA_MODERADORA:
      input?.moderatorFee
      ??
      '15000',

    IDENTIFICACION_PACIENTE:
      `DOC-${suffix}-${authSequence}`,

    NOMBRE_PACIENTE:
      `Paciente Manual Edit ${authSequence}`,
  };

  const result =
    await database.query<{
      id:
        string;

      version:
        number;
    }>(
      `
        insert into authorization_items
        (
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
          tariff_rule_version,
          created_from_batch_id,
          updated_by
        )
        values
        (
          $1,
          $2,
          $3,
          $4::jsonb,
          '5',
          '',
          '',
          'ENABLED',
          'PBS',
          'NOT_APPLICABLE',
          'AUTHORIZATIONS_V1',
          'LISTED',
          now(),
          'TARIFF-ANNEX-1:1',
          $5,
          $6
        )
        returning
          id,
          version
      `,
      [
        authorizationNumber,
        commercialCode,
        `${authorizationNumber}|${commercialCode}`,
        JSON.stringify(
          sourceData,
        ),
        provenanceBatchId,
        foundationUserId,
      ],
    );

  const item =
    result.rows[0]!;

  await database.query(
    `
      insert into
        authorization_item_organizations
      (
        authorization_item_id,
        organization_id
      )
      values
      (
        $1,
        $2
      )
      on conflict do nothing
    `,
    [
      item.id,
      ORGANIZATION_IDS.MTD,
    ],
  );

  return {
    id:
      item.id,

    version:
      item.version,

    authorizationNumber,

    commercialCode,

    quantity,

    validityEndDate,
  };
}


async function createPurchaseOrder(
  input:
    Readonly<{
      authorizationItemId:
        string;

      commercialCode:
        string;

      quantity:
        number;

      acceptedByOlp?:
        boolean;
    }>,
) {
  const accepted =
    input.acceptedByOlp
    ??
    false;

  const order =
    await database.query<{
      id:
        string;
    }>(
      `
        insert into purchase_orders
        (
          purchase_order_code,
          planning_period_id,
          order_type,
          status,
          issued_at,
          issued_by,
          olp_accepted_at,
          olp_accepted_by,
          olp_committed_date,
          created_by,
          updated_by
        )
        values
        (
          $1,
          $2,
          'STANDARD',
          $3,
          now(),
          $4,
          $5,
          $6,
          $7,
          $4,
          $4
        )
        returning id
      `,
      [
        `ME-OC-${suffix}-${randomUUID().slice(0, 6)}`,
        planningPeriodId,
        accepted
          ? 'ACCEPTED'
          : 'DRAFT',
        foundationUserId,
        accepted
          ? new Date()
          : null,

        accepted
          ? foundationUserId
          : null,

        accepted
          ? '2042-06-10'
          : null,
      ],
    );

  const purchaseOrderId =
    order.rows[0]!.id;

  const line =
    await database.query<{
      id:
        string;
    }>(
      `
        insert into purchase_order_lines
        (
          purchase_order_id,
          commercial_code,
          provenance,
          product_description,
          dispensing_point_id,
          requested_quantity,
          requested_delivery_date,
          tariff_snapshot_provenance
        )
        values
        (
          $1,
          $2,
          'LEGACY_AUTHORIZATION',
          'Producto prueba manual edit',
          $3,
          $4,
          '2042-06-10',
          'LEGACY_UNRESOLVED'
        )
        returning id
      `,
      [
        purchaseOrderId,
        input.commercialCode,
        dispensingPointId,
        input.quantity,
      ],
    );

  const purchaseOrderLineId =
    line.rows[0]!.id;

  await database.query(
    `
      insert into
        purchase_order_authorization_sources
      (
        purchase_order_line_id,
        authorization_item_id,
        source_quantity_snapshot,
        provenance,
        evidence_at
      )
      values
      (
        $1,
        $2,
        $3,
        'LEGACY_DIRECT_ASSIGNMENT',
        now()
      )
    `,
    [
      purchaseOrderLineId,
      input.authorizationItemId,
      input.quantity,
    ],
  );

  return {
    purchaseOrderId,
    purchaseOrderLineId,
  };
}


async function createAllocation(
  input:
    Readonly<{
      authorizationItemId:
        string;

      authorizationVersion:
        number;

      purchaseOrderId:
        string;

      commercialCode:
        string;

      quantity:
        number;
    }>,
) {
  const batch =
    await database.query<{
      id:
        string;
    }>(
      `
        insert into
          inventory_allocation_batches
        (
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
        values
        (
          $1,
          'UI',
          'CONFIRMED',
          1,
          1,
          0,
          $2,
          $3,
          $4,
          $4,
          now()
        )
        returning id
      `,
      [
        ORGANIZATION_IDS.MTD,
        input.quantity,
        randomUUID(),
        foundationUserId,
      ],
    );

  const allocation =
    await database.query<{
      id:
        string;
    }>(
      `
        insert into
          inventory_authorization_allocations
        (
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
        values
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          0,
          0,
          'ALLOCATED',
          $8,
          $9,
          $9
        )
        returning id
      `,
      [
        batch.rows[0]!.id,
        ORGANIZATION_IDS.MTD,
        input.authorizationItemId,
        input.purchaseOrderId,
        input.commercialCode,
        dispensingPointId,
        input.quantity,
        input.authorizationVersion,
        foundationUserId,
      ],
    );

  return allocation.rows[0]!.id;
}


async function createDirectReceipt(
  purchaseOrderId:
    string,
) {
  const result =
    await database.query<{
      id:
        string;
    }>(
      `
        insert into
          purchase_order_receipts
        (
          purchase_order_id,
          confirmed_by,
          observation
        )
        values
        (
          $1,
          $2,
          'Gate manual authorization edit'
        )
        returning id
      `,
      [
        purchaseOrderId,
        foundationUserId,
      ],
    );

  return result.rows[0]!.id;
}


async function editAuthorization(
  input:
    Readonly<{
      id:
        string;

      expectedVersion:
        number;

      commercialCode:
        string;

      quantity:
        number;

      validityEndDate:
        string;

      token?:
        string;

      organizationId?:
        string;
    }>,
) {
  return apiCall(
    'PATCH',
    `/authorizations/${input.id}/manual-edit`,
    {
      commercialCode:
        input.commercialCode,

      quantity:
        input.quantity,

      validityEndDate:
        input.validityEndDate,

      expectedVersion:
        input.expectedVersion,
    },
    input.token
    ??
    mtdOperatorToken,
    input.organizationId
    ??
    ORGANIZATION_IDS.MTD,
  );
}


beforeAll(
  async () => {
    await database.connect();

    const admin =
      await database.query<{
        id:
          string;
      }>(
        `
          select id
          from users
          where username = 'foundation-admin'
        `,
      );

    foundationUserId =
      admin.rows[0]
        ?.id
      ??
      '';

    if (!foundationUserId) {
      throw new Error(
        'foundation-admin no disponible',
      );
    }


    const adminToken =
      await adminLogin();


    mtdOperatorToken =
      await ensureUser({
        adminToken,

        username:
          OPERATOR_USERNAME,

        displayName:
          'Manual Edit Operator',

        password:
          `ManualEdit-${suffix}-pw`,

        organizationId:
          ORGANIZATION_IDS.MTD,

        roleCode:
          'MTD_OPERATOR',
      });


    ({
      medicarteToken,
      olpToken,
    } =
      await ensureOperatorTokens());


    await database.query(
      `
        insert into tariff_annex_products
        (
          codigo_producto,
          tarifa_unidad,
          tarifa_unidad_canonical,
          descripcion_generica,
          descripcion_comercial,
          tipo_inclusion,
          minimum_quantity,
          active,
          organization_id,
          created_by,
          updated_by
        )
        values
        (
          $1,
          '1000',
          1000,
          'Producto A',
          'Producto A',
          'PBS',
          1,
          true,
          $3,
          $4,
          $4
        ),
        (
          $2,
          '2000',
          2000,
          'Producto B',
          'Producto B',
          'PBS',
          1,
          true,
          $3,
          $4,
          $4
        )
      `,
      [
        CODE_A,
        CODE_B,
        ORGANIZATION_IDS.MTD,
        foundationUserId,
      ],
    );


    const batch =
      await database.query<{
        id:
          string;
      }>(
        `
          insert into import_batches
          (
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
          values
          (
            $1,
            $2,
            $3,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            1,
            $4,
            1,
            'COMPLETED',
            20,
            20,
            now(),
            now()
          )
          returning id
        `,
        [
          ORGANIZATION_IDS.MTD,
          foundationUserId,
          `manual-edit-${suffix}.xlsx`,
          randomUUID()
            .replace(
              /-/g,
              '',
            )
            .padEnd(
              64,
              '0',
            )
            .slice(
              0,
              64,
            ),
        ],
      );

    provenanceBatchId =
      batch.rows[0]!.id;


    const point =
      await database.query<{
        id:
          string;
      }>(
        `
          insert into dispensing_points
          (
            organization_id,
            code,
            name,
            created_by
          )
          values
          (
            $1,
            $2,
            'Manual Edit Point',
            $3
          )
          returning id
        `,
        [
          ORGANIZATION_IDS.MEDICARTE,
          `ME-POINT-${suffix}`,
          foundationUserId,
        ],
      );

    dispensingPointId =
      point.rows[0]!.id;


    const period =
      await database.query<{
        id:
          string;
      }>(
        `
          insert into planning_periods
          (
            start_date,
            end_date,
            scheduling_cutoff_at,
            purchase_order_deadline_at,
            expected_delivery_date,
            created_by,
            updated_by
          )
          values
          (
            '2042-06-01',
            '2042-06-30',
            '2042-05-25T12:00:00-05:00',
            '2042-05-27T12:00:00-05:00',
            '2042-06-01',
            $1,
            $1
          )
          returning id
        `,
        [
          foundationUserId,
        ],
      );

    planningPeriodId =
      period.rows[0]!.id;
  },
);


afterAll(
  async () => {
    await database.query(
      'begin',
    );

    try {
      const authorizations =
        await database.query<{
          id:
            string;
        }>(
          `
            select id
            from authorization_items
            where numero_autorizacion like $1
          `,
          [
            `ME-AUTH-${suffix}-%`,
          ],
        );

      const authorizationIds =
        authorizations.rows.map(
          (row) =>
            row.id,
        );


      const purchaseOrders =
        await database.query<{
          id:
            string;
        }>(
          `
            select id
            from purchase_orders
            where purchase_order_code like $1
          `,
          [
            `ME-OC-${suffix}-%`,
          ],
        );

      const purchaseOrderIds =
        purchaseOrders.rows.map(
          (row) =>
            row.id,
        );


      let scheduleIds:
        string[] =
        [];

      let allocationBatchIds:
        string[] =
        [];


      if (
        authorizationIds.length >
        0
      ) {
        const schedules =
          await database.query<{
            id:
              string;
          }>(
            `
              select id
              from patient_schedules
              where authorization_item_id =
                any($1::uuid[])
            `,
            [
              authorizationIds,
            ],
          );

        scheduleIds =
          schedules.rows.map(
            (row) =>
              row.id,
          );


        const allocationBatches =
          await database.query<{
            id:
              string;
          }>(
            `
              select distinct
                batch_id as id

              from
                inventory_authorization_allocations

              where
                authorization_item_id =
                  any($1::uuid[])
            `,
            [
              authorizationIds,
            ],
          );

        allocationBatchIds =
          allocationBatches.rows.map(
            (row) =>
              row.id,
          );


        await database.query(
          `
            delete from
              authorization_fulfillment_lines

            where
              fulfillment_id in (
                select id
                from authorization_fulfillments
                where authorization_item_id =
                  any($1::uuid[])
              )
          `,
          [
            authorizationIds,
          ],
        );


        await database.query(
          `
            delete from
              authorization_fulfillments

            where
              authorization_item_id =
                any($1::uuid[])
          `,
          [
            authorizationIds,
          ],
        );


        await database.query(
          `
            delete from
              inventory_authorization_allocations

            where
              authorization_item_id =
                any($1::uuid[])
          `,
          [
            authorizationIds,
          ],
        );


        await database.query(
          `
            delete from
              purchase_order_authorization_sources

            where
              authorization_item_id =
                any($1::uuid[])
          `,
          [
            authorizationIds,
          ],
        );
      }


      if (
        scheduleIds.length >
        0
      ) {
        await database.query(
          `
            alter table
              patient_schedule_history

            disable trigger
              patient_schedule_history_no_delete
          `,
        );


        await database.query(
          `
            delete from
              patient_schedule_history

            where
              patient_schedule_id =
                any($1::uuid[])
          `,
          [
            scheduleIds,
          ],
        );


        await database.query(
          `
            delete from
              patient_schedules

            where
              id =
                any($1::uuid[])
          `,
          [
            scheduleIds,
          ],
        );


        await database.query(
          `
            alter table
              patient_schedule_history

            enable trigger
              patient_schedule_history_no_delete
          `,
        );
      }


      if (
        purchaseOrderIds.length >
        0
      ) {
        await database.query(
          `
            delete from
              purchase_order_receipt_lines

            where
              receipt_id in (
                select id
                from purchase_order_receipts
                where purchase_order_id =
                  any($1::uuid[])
              )
          `,
          [
            purchaseOrderIds,
          ],
        );


        await database.query(
          `
            delete from
              purchase_order_receipts

            where
              purchase_order_id =
                any($1::uuid[])
          `,
          [
            purchaseOrderIds,
          ],
        );


        await database.query(
          `
            delete from
              purchase_order_demand_allocations

            where
              purchase_order_line_id in (
                select id
                from purchase_order_lines
                where purchase_order_id =
                  any($1::uuid[])
              )
          `,
          [
            purchaseOrderIds,
          ],
        );


        await database.query(
          `
            delete from
              purchase_order_authorization_sources

            where
              purchase_order_line_id in (
                select id
                from purchase_order_lines
                where purchase_order_id =
                  any($1::uuid[])
              )
          `,
          [
            purchaseOrderIds,
          ],
        );


        await database.query(
          `
            delete from
              purchase_order_lines

            where
              purchase_order_id =
                any($1::uuid[])
          `,
          [
            purchaseOrderIds,
          ],
        );


        await database.query(
          `
            delete from
              purchase_orders

            where
              id =
                any($1::uuid[])
          `,
          [
            purchaseOrderIds,
          ],
        );
      }


      if (
        allocationBatchIds.length >
        0
      ) {
        await database.query(
          `
            delete from
              inventory_allocation_batches

            where
              id =
                any($1::uuid[])
          `,
          [
            allocationBatchIds,
          ],
        );
      }


      if (
        authorizationIds.length >
        0
      ) {
        /*
         * audit_events es append-only por diseño.
         *
         * Los eventos generados por este gate se conservan incluso
         * en la base efímera de integración. No tienen FK hacia
         * authorization_items porque resource_id es una referencia
         * de auditoría histórica.
         *
         * Sí retiramos invalidaciones realtime de prueba para no
         * contaminar otros gates del mismo proceso.
         */
        await database.query(
          `
            delete from
              outbox_events

            where
              payload -> 'resource' ->> 'id' =
                any($1::text[])
          `,
          [
            authorizationIds,
          ],
        );


        await database.query(
          `
            delete from
              authorization_item_organizations

            where
              authorization_item_id =
                any($1::uuid[])
          `,
          [
            authorizationIds,
          ],
        );


        await database.query(
          `
            delete from
              authorization_items

            where
              id =
                any($1::uuid[])
          `,
          [
            authorizationIds,
          ],
        );
      }


      await database.query(
        `
          delete from
            tariff_annex_products

          where
            codigo_producto =
              any($1::text[])
        `,
        [
          [
            CODE_A,
            CODE_B,
          ],
        ],
      );


      if (
        planningPeriodId
      ) {
        await database.query(
          `
            delete from planning_periods
            where id = $1
          `,
          [
            planningPeriodId,
          ],
        );
      }


      if (
        dispensingPointId
      ) {
        await database.query(
          `
            delete from dispensing_points
            where id = $1
          `,
          [
            dispensingPointId,
          ],
        );
      }


      if (
        provenanceBatchId
      ) {
        await database.query(
          `
            delete from import_batches
            where id = $1
          `,
          [
            provenanceBatchId,
          ],
        );
      }


      await database.query(
        'commit',
      );
    } catch (
      error
    ) {
      await database.query(
        'rollback',
      );

      throw error;
    } finally {
      await database.end();
    }
  },
);


describe(
  'Manual authorization edit',
  () => {
    it(
      'MTD_OPERATOR edita cantidad/vigencia y conserva cuota moderadora',
      async () => {
        const item =
          await createAuthorization({
            quantity:
              30,

            moderatorFee:
              '15000',
          });

        const nextValidity =
          addDays(
            120,
          );

        const response =
          await editAuthorization({
            id:
              item.id,

            expectedVersion:
              item.version,

            commercialCode:
              CODE_A,

            quantity:
              40,

            validityEndDate:
              nextValidity,
          });

        expect(
          response.status,
        ).toBe(
          200,
        );

        const row =
          await database.query<{
            codigo_medicamento:
              string;

            authorization_key:
              string;

            source_data:
              Record<
                string,
                unknown
              >;

            version:
              number;
          }>(
            `
              select
                codigo_medicamento,
                authorization_key,
                source_data,
                version

              from authorization_items
              where id = $1
            `,
            [
              item.id,
            ],
          );

        expect(
          row.rows[0],
        ).toMatchObject({
          codigo_medicamento:
            CODE_A,

          authorization_key:
            `${item.authorizationNumber}|${CODE_A}`,

          version:
            item.version
            +
            1,
        });

        expect(
          row.rows[0]
            ?.source_data
            ?.CANTIDAD,
        ).toBe(
          '40',
        );

        expect(
          row.rows[0]
            ?.source_data
            ?.FECHA_FINAL_VIGENCIA,
        ).toBe(
          nextValidity,
        );

        expect(
          row.rows[0]
            ?.source_data
            ?.VALOR_CUOTA_MODERADORA,
        ).toBe(
          '15000',
        );


        const detail =
          await apiCall(
            'GET',
            `/authorization-query/${item.id}`,
            undefined,
          );

        expect(
          detail.status,
        ).toBe(
          200,
        );

        const payload =
          await detail.json() as {
            moderatorFeeValue:
              string | null;

            version:
              number;
          };

        expect(
          payload.moderatorFeeValue,
        ).toBe(
          '15000',
        );

        expect(
          payload.version,
        ).toBe(
          item.version
          +
          1,
        );
      },
    );


    it(
      'cambia producto sin OC y conserva UUID',
      async () => {
        const item =
          await createAuthorization();

        const response =
          await editAuthorization({
            id:
              item.id,

            expectedVersion:
              item.version,

            commercialCode:
              CODE_B.toLowerCase(),

            quantity:
              30,

            validityEndDate:
              item.validityEndDate,
          });

        expect(
          response.status,
        ).toBe(
          200,
        );

        const row =
          await database.query<{
            id:
              string;

            codigo_medicamento:
              string;

            authorization_key:
              string;
          }>(
            `
              select
                id,
                codigo_medicamento,
                authorization_key

              from authorization_items
              where id = $1
            `,
            [
              item.id,
            ],
          );

        expect(
          row.rows[0],
        ).toEqual({
          id:
            item.id,

          codigo_medicamento:
            CODE_B,

          authorization_key:
            `${item.authorizationNumber}|${CODE_B}`,
        });
      },
    );


    it(
      'rechaza expectedVersion obsoleto',
      async () => {
        const item =
          await createAuthorization();

        const response =
          await editAuthorization({
            id:
              item.id,

            expectedVersion:
              999,

            commercialCode:
              CODE_A,

            quantity:
              30,

            validityEndDate:
              item.validityEndDate,
          });

        expect(
          response.status,
        ).toBe(
          409,
        );

        expect(
          (
            await response.json()
          ) as {
            code:
              string;
          },
        ).toMatchObject({
          code:
            'AUTHORIZATION_VERSION_CONFLICT',
        });
      },
    );


    it(
      'MEDICARTE y OLP no pueden editar',
      async () => {
        const item =
          await createAuthorization();

        for (
          const [
            token,
            organizationId,
          ]
          of [
            [
              medicarteToken,
              ORGANIZATION_IDS.MEDICARTE,
            ],
            [
              olpToken,
              ORGANIZATION_IDS.OLP,
            ],
          ] as const
        ) {
          const response =
            await editAuthorization({
              id:
                item.id,

              expectedVersion:
                item.version,

              commercialCode:
                CODE_A,

              quantity:
                30,

              validityEndDate:
                item.validityEndDate,

              token,

              organizationId,
            });

          expect(
            response.status,
          ).toBe(
            403,
          );
        }
      },
    );


    it(
      'OC solo MTD se reconcilia al cambiar producto',
      async () => {
        const item =
          await createAuthorization();

        const po =
          await createPurchaseOrder({
            authorizationItemId:
              item.id,

            commercialCode:
              CODE_A,

            quantity:
              30,

            acceptedByOlp:
              false,
          });

        const response =
          await editAuthorization({
            id:
              item.id,

            expectedVersion:
              item.version,

            commercialCode:
              CODE_B,

            quantity:
              30,

            validityEndDate:
              item.validityEndDate,
          });

        expect(
          response.status,
        ).toBe(
          200,
        );

        const lines =
          await database.query<{
            commercial_code:
              string;

            requested_quantity:
              number;
          }>(
            `
              select
                commercial_code,
                requested_quantity::int

              from purchase_order_lines
              where purchase_order_id = $1
              order by commercial_code
            `,
            [
              po.purchaseOrderId,
            ],
          );

        expect(
          lines.rows,
        ).toEqual([
          {
            commercial_code:
              CODE_B,

            requested_quantity:
              30,
          },
        ]);

        const source =
          await database.query<{
            source_quantity_snapshot:
              number;
          }>(
            `
              select
                poas.source_quantity_snapshot::int

              from
                purchase_order_authorization_sources poas

              join
                purchase_order_lines pol
                  on pol.id =
                     poas.purchase_order_line_id

              where
                poas.authorization_item_id = $1

                and
                pol.purchase_order_id = $2

                and
                pol.commercial_code = $3
            `,
            [
              item.id,
              po.purchaseOrderId,
              CODE_B,
            ],
          );

        expect(
          source.rows[0]
            ?.source_quantity_snapshot,
        ).toBe(
          30,
        );
      },
    );


    it(
      'OC aceptada por OLP queda histórica y no se reescribe',
      async () => {
        const item =
          await createAuthorization();

        const po =
          await createPurchaseOrder({
            authorizationItemId:
              item.id,

            commercialCode:
              CODE_A,

            quantity:
              30,

            acceptedByOlp:
              true,
          });

        const response =
          await editAuthorization({
            id:
              item.id,

            expectedVersion:
              item.version,

            commercialCode:
              CODE_B,

            quantity:
              30,

            validityEndDate:
              item.validityEndDate,
          });

        expect(
          response.status,
        ).toBe(
          200,
        );

        const line =
          await database.query<{
            commercial_code:
              string;

            requested_quantity:
              number;
          }>(
            `
              select
                commercial_code,
                requested_quantity::int

              from purchase_order_lines
              where id = $1
            `,
            [
              po.purchaseOrderLineId,
            ],
          );

        expect(
          line.rows[0],
        ).toEqual({
          commercial_code:
            CODE_A,

          requested_quantity:
            30,
        });


        const source =
          await database.query<{
            count:
              number;
          }>(
            `
              select
                count(*)::int as count

              from
                purchase_order_authorization_sources

              where
                purchase_order_line_id = $1

                and
                authorization_item_id = $2
            `,
            [
              po.purchaseOrderLineId,
              item.id,
            ],
          );

        expect(
          source.rows[0]
            ?.count,
        ).toBe(
          1,
        );


        const detail =
          await apiCall(
            'GET',
            `/authorization-query/${item.id}`,
            undefined,
          );

        expect(
          detail.status,
        ).toBe(
          200,
        );

        const payload =
          await detail.json() as {
            purchaseOrder:
              string | null;

            purchaseOrders:
              Array<{
                id:
                  string;
              }>;
          };

        expect(
          payload.purchaseOrders
            .map(
              (order) =>
                order.id,
            ),
        ).toContain(
          po.purchaseOrderId,
        );

        expect(
          payload.purchaseOrder,
        ).toBeNull();
      },
    );


    it(
      'recepción Medicarte no se reescribe y allocation anterior se libera',
      async () => {
        const item =
          await createAuthorization();

        const po =
          await createPurchaseOrder({
            authorizationItemId:
              item.id,

            commercialCode:
              CODE_A,

            quantity:
              30,

            acceptedByOlp:
              true,
          });

        const receiptId =
          await createDirectReceipt(
            po.purchaseOrderId,
          );

        const allocationId =
          await createAllocation({
            authorizationItemId:
              item.id,

            authorizationVersion:
              item.version,

            purchaseOrderId:
              po.purchaseOrderId,

            commercialCode:
              CODE_A,

            quantity:
              30,
          });

        const response =
          await editAuthorization({
            id:
              item.id,

            expectedVersion:
              item.version,

            commercialCode:
              CODE_B,

            quantity:
              30,

            validityEndDate:
              item.validityEndDate,
          });

        expect(
          response.status,
        ).toBe(
          200,
        );

        const allocation =
          await database.query<{
            commercial_code:
              string;

            allocated_quantity:
              number;

            released_quantity:
              number;

            status:
              string;
          }>(
            `
              select
                commercial_code,
                allocated_quantity::int,
                released_quantity::int,
                status

              from
                inventory_authorization_allocations

              where id = $1
            `,
            [
              allocationId,
            ],
          );

        expect(
          allocation.rows[0],
        ).toEqual({
          commercial_code:
            CODE_A,

          allocated_quantity:
            30,

          released_quantity:
            30,

          status:
            'RELEASED',
        });


        const receipt =
          await database.query<{
            count:
              number;
          }>(
            `
              select
                count(*)::int as count

              from purchase_order_receipts
              where id = $1
            `,
            [
              receiptId,
            ],
          );

        expect(
          receipt.rows[0]
            ?.count,
        ).toBe(
          1,
        );
      },
    );


    it(
      'aumento mantiene allocation existente y queda PARTIALLY_ASSIGNED',
      async () => {
        const item =
          await createAuthorization({
            quantity:
              30,
          });

        const po =
          await createPurchaseOrder({
            authorizationItemId:
              item.id,

            commercialCode:
              CODE_A,

            quantity:
              30,

            acceptedByOlp:
              true,
          });

        await createAllocation({
          authorizationItemId:
            item.id,

          authorizationVersion:
            item.version,

          purchaseOrderId:
            po.purchaseOrderId,

          commercialCode:
            CODE_A,

          quantity:
            30,
        });

        const response =
          await editAuthorization({
            id:
              item.id,

            expectedVersion:
              item.version,

            commercialCode:
              CODE_A,

            quantity:
              60,

            validityEndDate:
              item.validityEndDate,
          });

        expect(
          response.status,
        ).toBe(
          200,
        );

        const detail =
          await apiCall(
            'GET',
            `/authorization-query/${item.id}`,
            undefined,
          );

        expect(
          detail.status,
        ).toBe(
          200,
        );

        const payload =
          await detail.json() as {
            quantity:
              string | null;

            allocatedQuantity:
              number;

            remainingAssignedQuantity:
              number;

            operationalStatus:
              string;
          };

        expect(
          payload,
        ).toMatchObject({
          quantity:
            '60',

          allocatedQuantity:
            30,

          remainingAssignedQuantity:
            30,

          operationalStatus:
            'PARTIALLY_ASSIGNED',
        });
      },
    );


    it(
      'disminución libera únicamente el exceso',
      async () => {
        const item =
          await createAuthorization({
            quantity:
              30,
          });

        const po =
          await createPurchaseOrder({
            authorizationItemId:
              item.id,

            commercialCode:
              CODE_A,

            quantity:
              30,

            acceptedByOlp:
              true,
          });

        const allocationId =
          await createAllocation({
            authorizationItemId:
              item.id,

            authorizationVersion:
              item.version,

            purchaseOrderId:
              po.purchaseOrderId,

            commercialCode:
              CODE_A,

            quantity:
              30,
          });

        const response =
          await editAuthorization({
            id:
              item.id,

            expectedVersion:
              item.version,

            commercialCode:
              CODE_A,

            quantity:
              20,

            validityEndDate:
              item.validityEndDate,
          });

        expect(
          response.status,
        ).toBe(
          200,
        );

        const allocation =
          await database.query<{
            consumed_quantity:
              number;

            released_quantity:
              number;

            status:
              string;
          }>(
            `
              select
                consumed_quantity::int,
                released_quantity::int,
                status

              from
                inventory_authorization_allocations

              where id = $1
            `,
            [
              allocationId,
            ],
          );

        expect(
          allocation.rows[0],
        ).toEqual({
          consumed_quantity:
            0,

          released_quantity:
            10,

          status:
            'ALLOCATED',
        });
      },
    );


    it(
      'programación activa se sincroniza y conserva historia anterior',
      async () => {
        const item =
          await createAuthorization({
            quantity:
              30,
          });

        const schedule =
          await database.query<{
            id:
              string;
          }>(
            `
              insert into patient_schedules
              (
                authorization_item_id,
                planning_period_id,
                dispensing_point_id,
                commercial_code,
                scheduled_date,
                quantity,
                created_by,
                updated_by
              )
              values
              (
                $1,
                $2,
                $3,
                $4,
                '2042-06-05',
                30,
                $5,
                $5
              )
              returning id
            `,
            [
              item.id,
              planningPeriodId,
              dispensingPointId,
              CODE_A,
              foundationUserId,
            ],
          );

        const scheduleId =
          schedule.rows[0]!.id;

        await database.query(
          `
            insert into patient_schedule_history
            (
              patient_schedule_id,
              revision,
              authorization_item_id,
              planning_period_id,
              dispensing_point_id,
              commercial_code,
              scheduled_date,
              quantity,
              status,
              schedule_timing,
              change_type,
              changed_by,
              correlation_id
            )
            values
            (
              $1,
              1,
              $2,
              $3,
              $4,
              $5,
              '2042-06-05',
              30,
              'SCHEDULED',
              'ON_TIME',
              'CREATED',
              $6,
              $7
            )
          `,
          [
            scheduleId,
            item.id,
            planningPeriodId,
            dispensingPointId,
            CODE_A,
            foundationUserId,
            randomUUID(),
          ],
        );

        const response =
          await editAuthorization({
            id:
              item.id,

            expectedVersion:
              item.version,

            commercialCode:
              CODE_B,

            quantity:
              30,

            validityEndDate:
              item.validityEndDate,
          });

        expect(
          response.status,
        ).toBe(
          200,
        );

        const current =
          await database.query<{
            commercial_code:
              string;

            revision:
              number;
          }>(
            `
              select
                commercial_code,
                revision::int

              from patient_schedules
              where id = $1
            `,
            [
              scheduleId,
            ],
          );

        expect(
          current.rows[0],
        ).toEqual({
          commercial_code:
            CODE_B,

          revision:
            2,
        });


        const history =
          await database.query<{
            revision:
              number;

            commercial_code:
              string;
          }>(
            `
              select
                revision::int,
                commercial_code

              from patient_schedule_history
              where patient_schedule_id = $1
              order by revision
            `,
            [
              scheduleId,
            ],
          );

        expect(
          history.rows,
        ).toEqual([
          {
            revision:
              1,

            commercial_code:
              CODE_A,
          },
          {
            revision:
              2,

            commercial_code:
              CODE_B,
          },
        ]);
      },
    );


    it(
      'fulfillment bloquea cambio de producto, reducción inferior y vigencia anterior',
      async () => {
        const item =
          await createAuthorization({
            quantity:
              30,
          });

        await database.query(
          `
            insert into authorization_fulfillments
            (
              organization_id,
              authorization_item_id,
              fulfillment_type,
              effective_date,
              quantity,
              source,
              confirmed_by
            )
            values
            (
              $1,
              $2,
              'DELIVERY',
              $3,
              10,
              'UI',
              $4
            )
          `,
          [
            ORGANIZATION_IDS.MTD,
            item.id,
            isoToday(),
            foundationUserId,
          ],
        );


        const product =
          await editAuthorization({
            id:
              item.id,

            expectedVersion:
              item.version,

            commercialCode:
              CODE_B,

            quantity:
              30,

            validityEndDate:
              item.validityEndDate,
          });

        expect(
          product.status,
        ).toBe(
          409,
        );

        expect(
          (
            await product.json()
          ) as {
            code:
              string;
          },
        ).toMatchObject({
          code:
            'AUTHORIZATION_PRODUCT_ALREADY_FULFILLED',
        });


        const quantity =
          await editAuthorization({
            id:
              item.id,

            expectedVersion:
              item.version,

            commercialCode:
              CODE_A,

            quantity:
              5,

            validityEndDate:
              item.validityEndDate,
          });

        expect(
          quantity.status,
        ).toBe(
          409,
        );

        expect(
          (
            await quantity.json()
          ) as {
            code:
              string;
          },
        ).toMatchObject({
          code:
            'AUTHORIZATION_QUANTITY_BELOW_FULFILLED',
        });


        const validity =
          await editAuthorization({
            id:
              item.id,

            expectedVersion:
              item.version,

            commercialCode:
              CODE_A,

            quantity:
              30,

            validityEndDate:
              addDays(
                -1,
              ),
          });

        expect(
          validity.status,
        ).toBe(
          409,
        );

        expect(
          (
            await validity.json()
          ) as {
            code:
              string;
          },
        ).toMatchObject({
          code:
            'AUTHORIZATION_VALIDITY_BEFORE_FULFILLMENT',
        });
      },
    );
  },
);
