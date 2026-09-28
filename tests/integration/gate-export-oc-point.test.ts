import {
  randomUUID,
} from 'node:crypto';

import * as XLSX from 'xlsx';

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
    .slice(
      0,
      8,
    )
    .toUpperCase();

const purchaseOrderCode =
  `EXPORT-POINT-${suffix}`;

const commercialCode =
  `EXP-PT-${suffix}`;

const pointCodeA =
  `EXP-PT-A-${suffix}`;

const pointCodeB =
  `EXP-PT-B-${suffix}`;

const pointNameA =
  `CIMA ${suffix}`;

const pointNameB =
  `MEDICARTE NORTE ${suffix}`;

const authorizationNumberA =
  `EXP-AUTO-A-${suffix}`;

const authorizationNumberB =
  `EXP-AUTO-B-${suffix}`;


let adminToken =
  '';

let userId =
  '';

let importBatchId =
  '';

let purchaseOrderId =
  '';

let lineIdA =
  '';

let lineIdB =
  '';

let authorizationIdA =
  '';

let authorizationIdB =
  '';

let pointIdA =
  '';

let pointIdB =
  '';


async function cleanup(): Promise<void> {
  await database.query(
    `
      delete from
        purchase_order_authorization_sources

      where
        purchase_order_line_id in (
          select id
          from purchase_order_lines
          where purchase_order_id in (
            select id
            from purchase_orders
            where purchase_order_code = $1
          )
        )
    `,
    [
      purchaseOrderCode,
    ],
  );


  await database.query(
    `
      delete from
        purchase_order_lines

      where
        purchase_order_id in (
          select id
          from purchase_orders
          where purchase_order_code = $1
        )
    `,
    [
      purchaseOrderCode,
    ],
  );


  await database.query(
    `
      delete from
        purchase_orders

      where
        purchase_order_code = $1
    `,
    [
      purchaseOrderCode,
    ],
  );


  await database.query(
    `
      delete from
        authorization_item_organizations

      where
        authorization_item_id in (
          select id
          from authorization_items
          where numero_autorizacion in (
            $1,
            $2
          )
        )
    `,
    [
      authorizationNumberA,
      authorizationNumberB,
    ],
  );


  await database.query(
    `
      delete from
        authorization_items

      where
        numero_autorizacion in (
          $1,
          $2
        )
    `,
    [
      authorizationNumberA,
      authorizationNumberB,
    ],
  );


  await database.query(
    `
      delete from
        import_batches

      where
        original_filename = $1
    `,
    [
      `export-point-${suffix}.xlsx`,
    ],
  );


  await database.query(
    `
      delete from
        inventory_locations

      where
        legacy_dispensing_point_id in (
          select id
          from dispensing_points
          where code in (
            $1,
            $2
          )
        )
    `,
    [
      pointCodeA,
      pointCodeB,
    ],
  );


  await database.query(
    `
      delete from
        dispensing_points

      where
        code in (
          $1,
          $2
        )
    `,
    [
      pointCodeA,
      pointCodeB,
    ],
  );
}


beforeAll(
  async () => {
    await database.connect();

    await cleanup();


    adminToken =
      await adminLogin();


    const user =
      await database.query<{
        id:
          string;
      }>(
        `
          select id
          from users
          where username =
            'foundation-admin'
        `,
      );

    userId =
      user.rows[0]!.id;


    const points =
      await database.query<{
        id:
          string;

        code:
          string;
      }>(
        `
          insert into dispensing_points
          (
            organization_id,
            code,
            name,
            active,
            created_by
          )
          values
          (
            $1,
            $2,
            $3,
            true,
            $6
          ),
          (
            $1,
            $4,
            $5,
            true,
            $6
          )
          returning
            id,
            code
        `,
        [
          ORGANIZATION_IDS.MEDICARTE,
          pointCodeA,
          pointNameA,
          pointCodeB,
          pointNameB,
          userId,
        ],
      );


    pointIdA =
      points.rows.find(
        (row) =>
          row.code ===
          pointCodeA,
      )!.id;

    pointIdB =
      points.rows.find(
        (row) =>
          row.code ===
          pointCodeB,
      )!.id;


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
            2,
            2,
            now(),
            now()
          )
          returning id
        `,
        [
          ORGANIZATION_IDS.MTD,
          userId,
          `export-point-${suffix}.xlsx`,
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

    importBatchId =
      batch.rows[0]!.id;


    const authorizations =
      await database.query<{
        id:
          string;

        numero_autorizacion:
          string;
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
            created_from_batch_id,
            updated_by
          )
          values
          (
            $1::text,
            $3::text,
            $1::text || '|' || $3::text,
            jsonb_build_object(
              'NUMERO_AUTORIZACION',
              $1::text,
              'CODIGO_COMERCIAL',
              $3::text,
              'CANTIDAD',
              '10'
            ),
            '5',
            '',
            '',
            'ENABLED',
            'PBS',
            'NOT_APPLICABLE',
            'EXPORT_POINT_TEST',
            'LISTED',
            $4,
            $5
          ),
          (
            $2::text,
            $3::text,
            $2::text || '|' || $3::text,
            jsonb_build_object(
              'NUMERO_AUTORIZACION',
              $2::text,
              'CODIGO_COMERCIAL',
              $3::text,
              'CANTIDAD',
              '20'
            ),
            '5',
            '',
            '',
            'ENABLED',
            'PBS',
            'NOT_APPLICABLE',
            'EXPORT_POINT_TEST',
            'LISTED',
            $4,
            $5
          )
          returning
            id,
            numero_autorizacion
        `,
        [
          authorizationNumberA,
          authorizationNumberB,
          commercialCode,
          importBatchId,
          userId,
        ],
      );


    authorizationIdA =
      authorizations.rows.find(
        (row) =>
          row.numero_autorizacion ===
          authorizationNumberA,
      )!.id;

    authorizationIdB =
      authorizations.rows.find(
        (row) =>
          row.numero_autorizacion ===
          authorizationNumberB,
      )!.id;


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
          $3
        ),
        (
          $2,
          $3
        )
        on conflict do nothing
      `,
      [
        authorizationIdA,
        authorizationIdB,
        ORGANIZATION_IDS.MTD,
      ],
    );


    const order =
      await database.query<{
        id:
          string;
      }>(
        `
          insert into purchase_orders
          (
            purchase_order_code,
            origin,
            legacy_assigned_at,
            legacy_assigned_by,
            status,
            created_by,
            updated_by
          )
          values
          (
            $1,
            'LEGACY_BACKFILL',
            now(),
            $2,
            'HISTORICAL_ONLY',
            $2,
            $2
          )
          returning id
        `,
        [
          purchaseOrderCode,
          userId,
        ],
      );

    purchaseOrderId =
      order.rows[0]!.id;


    const lines =
      await database.query<{
        id:
          string;

        dispensing_point_id:
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
            olp_managed_quantity,
            tariff_snapshot_provenance
          )
          values
          (
            $1,
            $2,
            'LEGACY_AUTHORIZATION',
            'Producto Export Point',
            $3,
            10,
            8,
            'LEGACY_UNRESOLVED'
          ),
          (
            $1,
            $2,
            'LEGACY_AUTHORIZATION',
            'Producto Export Point',
            $4,
            20,
            15,
            'LEGACY_UNRESOLVED'
          )
          returning
            id,
            dispensing_point_id
        `,
        [
          purchaseOrderId,
          commercialCode,
          pointIdA,
          pointIdB,
        ],
      );


    lineIdA =
      lines.rows.find(
        (row) =>
          row.dispensing_point_id ===
          pointIdA,
      )!.id;

    lineIdB =
      lines.rows.find(
        (row) =>
          row.dispensing_point_id ===
          pointIdB,
      )!.id;


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
          $3,
          10,
          'LEGACY_DIRECT_ASSIGNMENT',
          now()
        ),
        (
          $2,
          $4,
          20,
          'LEGACY_DIRECT_ASSIGNMENT',
          now()
        )
      `,
      [
        lineIdA,
        lineIdB,
        authorizationIdA,
        authorizationIdB,
      ],
    );
  },
);


afterAll(
  async () => {
    try {
      await cleanup();
    } finally {
      await database.end();
    }
  },
);


describe(
  'Exportar OC — punto por línea histórica',
  () => {
    it(
      'exporta PUNTO en OC_PRODUCTOS y separa mismo producto por punto',
      async () => {
        const response =
          await fetch(
            `${apiUrl}/api/v1/exportables/purchase-orders.xlsx`,
            {
              headers: {
                authorization:
                  `Bearer ${adminToken}`,

                'x-organization-id':
                  ORGANIZATION_IDS.MTD,
              },
            },
          );


        expect(
          response.status,
        ).toBe(
          200,
        );


        const workbook =
          XLSX.read(
            Buffer.from(
              await response.arrayBuffer(),
            ),
            {
              type:
                'buffer',
            },
          );


        const sheet =
          workbook.Sheets[
            'OC_PRODUCTOS'
          ]!;


        const matrix =
          XLSX.utils.sheet_to_json<
            unknown[]
          >(
            sheet,
            {
              header:
                1,
            },
          );


        expect(
          matrix[0],
        ).toEqual([
          'OC',
          'CODIGO_PRODUCTO',
          'PRODUCTO',
          'CANTIDAD_SOLICITADA',
          'CANTIDAD_OLP',
          'CANTIDAD_MEDICARTE',
          'PUNTO',
        ]);


        const rows =
          XLSX.utils.sheet_to_json<
            Record<
              string,
              unknown
            >
          >(
            sheet,
          )
            .filter(
              (row) =>
                row.OC ===
                purchaseOrderCode,
            )
            .sort(
              (
                left,
                right,
              ) =>
                String(
                  left.PUNTO,
                ).localeCompare(
                  String(
                    right.PUNTO,
                  ),
                ),
            );


        expect(
          rows,
        ).toHaveLength(
          2,
        );


        expect(
          rows.map(
            (row) => ({
              codigo:
                row.CODIGO_PRODUCTO,

              cantidad:
                row.CANTIDAD_SOLICITADA,

              olp:
                row.CANTIDAD_OLP,

              medicarte:
                row.CANTIDAD_MEDICARTE,

              punto:
                row.PUNTO,
            }),
          ),
        ).toEqual(
          [
            {
              codigo:
                commercialCode,

              cantidad:
                10,

              olp:
                8,

              medicarte:
                0,

              punto:
                pointNameA,
            },

            {
              codigo:
                commercialCode,

              cantidad:
                20,

              olp:
                15,

              medicarte:
                0,

              punto:
                pointNameB,
            },
          ].sort(
            (
              left,
              right,
            ) =>
              left.punto.localeCompare(
                right.punto,
              ),
          ),
        );
      },
    );


    it(
      'exporta en AUTO_RELACIONADAS el punto de la línea de OC',
      async () => {
        const response =
          await fetch(
            `${apiUrl}/api/v1/exportables/purchase-orders.xlsx`,
            {
              headers: {
                authorization:
                  `Bearer ${adminToken}`,

                'x-organization-id':
                  ORGANIZATION_IDS.MTD,
              },
            },
          );


        expect(
          response.status,
        ).toBe(
          200,
        );


        const workbook =
          XLSX.read(
            Buffer.from(
              await response.arrayBuffer(),
            ),
            {
              type:
                'buffer',
            },
          );


        const sheet =
          workbook.Sheets[
            'AUTO_RELACIONADAS'
          ]!;


        const matrix =
          XLSX.utils.sheet_to_json<
            unknown[]
          >(
            sheet,
            {
              header:
                1,
            },
          );


        expect(
          matrix[0],
        ).toEqual([
          'OC',
          'CLAVE_AUTO',
          'NUMERO_AUTORIZACION',
          'CODIGO_PRODUCTO',
          'CANTIDAD_AUTO',
          'CANTIDAD_APORTADA_A_OC',
          'PUNTO',
        ]);


        const rows =
          XLSX.utils.sheet_to_json<
            Record<
              string,
              unknown
            >
          >(
            sheet,
          )
            .filter(
              (row) =>
                row.OC ===
                purchaseOrderCode,
            )
            .sort(
              (
                left,
                right,
              ) =>
                String(
                  left.NUMERO_AUTORIZACION,
                ).localeCompare(
                  String(
                    right.NUMERO_AUTORIZACION,
                  ),
                ),
            );


        expect(
          rows,
        ).toHaveLength(
          2,
        );


        expect(
          rows,
        ).toEqual([
          expect.objectContaining({
            OC:
              purchaseOrderCode,

            CLAVE_AUTO:
              `${authorizationNumberA}|${commercialCode}`,

            NUMERO_AUTORIZACION:
              authorizationNumberA,

            CODIGO_PRODUCTO:
              commercialCode,

            CANTIDAD_AUTO:
              10,

            CANTIDAD_APORTADA_A_OC:
              10,

            PUNTO:
              pointNameA,
          }),

          expect.objectContaining({
            OC:
              purchaseOrderCode,

            CLAVE_AUTO:
              `${authorizationNumberB}|${commercialCode}`,

            NUMERO_AUTORIZACION:
              authorizationNumberB,

            CODIGO_PRODUCTO:
              commercialCode,

            CANTIDAD_AUTO:
              20,

            CANTIDAD_APORTADA_A_OC:
              20,

            PUNTO:
              pointNameB,
          }),
        ]);
      },
    );
  },
);
