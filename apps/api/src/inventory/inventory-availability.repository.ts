import { Inject, Injectable } from '@nestjs/common';

import { sql } from 'drizzle-orm';

import type { createDatabase } from '@authorization/database';

import type { Scope } from '../common/request-scope';

import { DATABASE } from '../tokens';

import type { InventoryAvailabilityImportRow } from './inventory-availability-xlsx';

type Database = ReturnType<typeof createDatabase>;

type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];

export type AvailabilityFilters = Readonly<{
  search?: string;
  purchaseOrder?: string;
  dispensingPoint?: string;
  limit?: number;
}>;

export type AllocationRequest = Readonly<{
  authorizationKey: string;
  purchaseOrderCode: string;
  quantity: number;
  sourceImportRowId?: string | null;
}>;

type ResolvedAssignment = Readonly<{
  authorizationItemId: string;
  authorizationKey: string;
  authorizationVersion: number;

  purchaseOrderId: string;
  purchaseOrderCode: string;

  commercialCode: string;

  dispensingPointId: string;

  requestedQuantity: number;

  authorizationPendingQuantity: number;

  purchaseOrderAvailableQuantity: number;

  sourceImportRowId: string | null;
}>;

type ValidatedImportRow = InventoryAvailabilityImportRow & {
  authorizationItemId: string | null;

  authorizationVersion: number | null;

  purchaseOrderId: string | null;

  commercialCode: string | null;

  dispensingPointId: string | null;

  availableQuantity: number | null;

  validationStatus: 'VALID' | 'INVALID';

  errorCode: string | null;

  errorMessage: string | null;
};

@Injectable()
export class InventoryAvailabilityRepository {
  constructor(
    @Inject(DATABASE)
    private readonly database: Database,
  ) {}

  async list(scope: Scope, filters: AvailabilityFilters) {

    const limit =
      Math.min(
        Math.max(
          filters.limit ?? 100,
          1,
        ),
        500,
      );

    const conditions = [
      sql`
        po.status NOT IN (
          'CANCELLED',
          'REJECTED'
        )
      `,
    ];

    /*
     * MEDICARTE solo consulta inventario de OC que
     * ya fueron aceptadas por OLP y únicamente de
     * sus puntos explícitamente autorizados.
     */
    if (
      scope.organizationCode ===
      'MEDICARTE'
    ) {
      conditions.push(
        sql`
          po.olp_accepted_at
            IS NOT NULL
        `,
      );

      conditions.push(
        sql`
          ppp.dispensing_point_id IN (
            SELECT
              ups.dispensing_point_id

            FROM
              user_point_scopes ups

            WHERE
              ups.user_id =
                ${scope.userId}::uuid

              AND ups.revoked_at
                IS NULL
          )
        `,
      );
    }

    if (filters.search) {
      const search =
        `%${filters.search.trim()}%`;

      conditions.push(sql`
        (
          ppp.commercial_code
            ILIKE ${search}

          OR

          COALESCE(
            ppp.product_description,
            ''
          )
            ILIKE ${search}
        )
      `);
    }

    if (filters.purchaseOrder) {
      const purchaseOrder =
        `%${filters.purchaseOrder.trim()}%`;

      conditions.push(sql`
        COALESCE(
          ppp.purchase_order_code,
          ''
        )
          ILIKE ${purchaseOrder}
      `);
    }

    if (filters.dispensingPoint) {
      const dispensingPoint =
        `%${filters.dispensingPoint.trim()}%`;

      conditions.push(sql`
        COALESCE(
          dp.code,
          ''
        )
          ILIKE ${dispensingPoint}
      `);
    }


    const result =
      await this.database.db.execute<{
        purchase_order_id: string;

        purchase_order_code: string;

        commercial_code: string;

        product_description:
          string | null;

        dispensing_point_id:
          string | null;

        dispensing_point_code:
          string | null;

        requested_quantity:
          number;

        received_quantity:
          number;

        fulfilled_quantity:
          number;
      }>(sql`
        WITH
        po_products AS (
          /*
           * Total solicitado por:
           *
           * OC + producto.
           *
           * La línea logística puede estar fragmentada,
           * pero Disponibilidad debe consolidarla.
           */
          SELECT
            po.id
              AS purchase_order_id,

            po.purchase_order_code,

            pol.commercial_code,

            COALESCE(
              SUM(
                pol.requested_quantity
              ),
              0
            )::int
              AS requested_quantity,

            MAX(
              NULLIF(
                BTRIM(
                  COALESCE(
                    pol.product_description,
                    tap.descripcion_comercial,
                    tap.descripcion_generica,
                    ''
                  )
                ),
                ''
              )
            )
              AS product_description

          FROM
            purchase_orders po

          JOIN
            purchase_order_lines pol
              ON pol.purchase_order_id =
                 po.id

          LEFT JOIN
            tariff_annex_products tap
              ON tap.codigo_producto =
                 pol.commercial_code

             AND tap.active =
                 true

          GROUP BY
            po.id,
            po.purchase_order_code,
            pol.commercial_code
        ),


        operational_point_candidates AS (
          /*
           * El punto operacional real tiene prioridad
           * sobre cualquier mapping vigente.
           */

          SELECT DISTINCT
            pol.purchase_order_id,

            pol.commercial_code,

            pol.dispensing_point_id

          FROM
            purchase_order_lines pol

          WHERE
            pol.dispensing_point_id
              IS NOT NULL


          UNION


          SELECT DISTINCT
            d.purchase_order_id,

            dl.commercial_code,

            dl.dispensing_point_id

          FROM
            deliveries d

          JOIN
            delivery_lines dl
              ON dl.delivery_id =
                 d.id

          WHERE
            dl.dispensing_point_id
              IS NOT NULL


          UNION


          SELECT DISTINCT
            iaa.purchase_order_id,

            iaa.commercial_code,

            iaa.dispensing_point_id

          FROM
            inventory_authorization_allocations iaa

          WHERE
            iaa.dispensing_point_id
              IS NOT NULL


          UNION


          /*
           * Recepción directa de OC.
           *
           * El movimiento de inventario existe únicamente
           * después de una recepción efectivamente confirmada.
           */
          SELECT DISTINCT
            por.purchase_order_id,

            pol.commercial_code,

            il.dispensing_point_id

          FROM
            inventory_movements im

          JOIN
            inventory_lots il
              ON il.id =
                 im.inventory_lot_id

          JOIN
            purchase_order_receipt_lines porl
              ON porl.id =
                 im.source_id

          JOIN
            purchase_order_receipts por
              ON por.id =
                 porl.receipt_id

          JOIN
            purchase_order_lines pol
              ON pol.id =
                 porl.purchase_order_line_id

          WHERE
            im.movement_type =
              'RECEIPT'

            AND im.source_type =
              'PURCHASE_ORDER_RECEIPT_LINE'

            AND il.dispensing_point_id
              IS NOT NULL
        ),


        canonical_point_candidates AS (
          /*
           * Si aún no hay un hecho operacional,
           * usamos el mapping canónico:
           *
           * producto
           * -> Anexo Tarifario
           * -> INVIMA/presentación
           * -> punto Medicarte.
           */
          SELECT DISTINCT
            pp.purchase_order_id,

            pp.commercial_code,

            mapping.dispensing_point_id

          FROM
            po_products pp

          JOIN
            tariff_annex_products tap
              ON tap.codigo_producto =
                 pp.commercial_code

             AND tap.active =
                 true

          JOIN
            product_delivery_point_mappings mapping
              ON BTRIM(
                   COALESCE(
                     tap.numero_expediente_invima,
                     ''
                   )
                 ) ~ '^[0-9]+$'

             AND BTRIM(
                   COALESCE(
                     tap.consecutivo_invima_presentacion,
                     ''
                   )
                 ) ~ '^[0-9]+$'

             AND mapping.invima_record_normalized =
                 COALESCE(
                   NULLIF(
                     LTRIM(
                       BTRIM(
                         tap.numero_expediente_invima
                       ),
                       '0'
                     ),
                     ''
                   ),
                   '0'
                 )

             AND mapping.invima_presentation_normalized =
                 COALESCE(
                   NULLIF(
                     LTRIM(
                       BTRIM(
                         tap.consecutivo_invima_presentacion
                       ),
                       '0'
                     ),
                     ''
                   ),
                   '0'
                 )

          WHERE
            NOT EXISTS (
              SELECT
                1

              FROM
                operational_point_candidates opc

              WHERE
                opc.purchase_order_id =
                  pp.purchase_order_id

                AND opc.commercial_code =
                  pp.commercial_code
            )
        ),


        point_candidates AS (
          SELECT
            purchase_order_id,
            commercial_code,
            dispensing_point_id

          FROM
            operational_point_candidates


          UNION


          SELECT
            purchase_order_id,
            commercial_code,
            dispensing_point_id

          FROM
            canonical_point_candidates
        ),


        po_product_points AS (
          /*
           * Grain definitivo:
           *
           * OC + producto + punto.
           */
          SELECT
            pp.purchase_order_id,

            pp.purchase_order_code,

            pp.commercial_code,

            pp.requested_quantity,

            MAX(
              pp.product_description
            )
              AS product_description,

            pc.dispensing_point_id

          FROM
            po_products pp

          LEFT JOIN
            point_candidates pc
              ON pc.purchase_order_id =
                 pp.purchase_order_id

             AND pc.commercial_code =
                 pp.commercial_code

          GROUP BY
            pp.purchase_order_id,
            pp.purchase_order_code,
            pp.commercial_code,
            pp.requested_quantity,
            pc.dispensing_point_id
        ),


        receipt_events AS (
          /*
           * Flujo actual:
           * recepción directa de la OC.
           */
          SELECT
            por.purchase_order_id,

            pol.commercial_code,

            il.dispensing_point_id,

            SUM(
              im.quantity_delta
            )::int
              AS quantity

          FROM
            inventory_movements im

          JOIN
            inventory_lots il
              ON il.id =
                 im.inventory_lot_id

          JOIN
            purchase_order_receipt_lines porl
              ON porl.id =
                 im.source_id

          JOIN
            purchase_order_receipts por
              ON por.id =
                 porl.receipt_id

          JOIN
            purchase_order_lines pol
              ON pol.id =
                 porl.purchase_order_line_id

          WHERE
            im.movement_type =
              'RECEIPT'

            AND im.source_type =
              'PURCHASE_ORDER_RECEIPT_LINE'

            AND im.quantity_delta >
              0

            AND il.expiration_date >=
              (
                NOW()
                AT TIME ZONE
                'America/Bogota'
              )::date

          GROUP BY
            por.purchase_order_id,
            pol.commercial_code,
            il.dispensing_point_id


          UNION ALL


          /*
           * Compatibilidad histórica:
           * delivery -> receipt.
           */
          SELECT
            d.purchase_order_id,

            dl.commercial_code,

            il.dispensing_point_id,

            SUM(
              im.quantity_delta
            )::int
              AS quantity

          FROM
            inventory_movements im

          JOIN
            inventory_lots il
              ON il.id =
                 im.inventory_lot_id

          JOIN
            receipt_lines rl
              ON rl.id =
                 im.source_id

          JOIN
            delivery_lines dl
              ON dl.id =
                 rl.delivery_line_id

          JOIN
            deliveries d
              ON d.id =
                 dl.delivery_id

          WHERE
            im.movement_type =
              'RECEIPT'

            AND im.source_type =
              'RECEIPT_LINE'

            AND im.quantity_delta >
              0

            AND il.expiration_date >=
              (
                NOW()
                AT TIME ZONE
                'America/Bogota'
              )::date

          GROUP BY
            d.purchase_order_id,
            dl.commercial_code,
            il.dispensing_point_id
        ),


        received AS (
          SELECT
            purchase_order_id,

            commercial_code,

            dispensing_point_id,

            COALESCE(
              SUM(
                quantity
              ),
              0
            )::int
              AS received_quantity

          FROM
            receipt_events

          GROUP BY
            purchase_order_id,
            commercial_code,
            dispensing_point_id
        ),


        fulfilled AS (
          /*
           * Solo cuenta una Entrega/Aplicación
           * realmente confirmada.
           *
           * No usa cantidad reservada ni asignada.
           */
          SELECT
            afl.purchase_order_id,

            afl.commercial_code,

            afl.dispensing_point_id,

            COALESCE(
              SUM(
                afl.quantity
              ),
              0
            )::int
              AS fulfilled_quantity

          FROM
            authorization_fulfillment_lines afl

          GROUP BY
            afl.purchase_order_id,
            afl.commercial_code,
            afl.dispensing_point_id
        )


        SELECT
          ppp.purchase_order_id,

          COALESCE(
            ppp.purchase_order_code,
            ppp.purchase_order_id::text
          )
            AS purchase_order_code,

          ppp.commercial_code,

          ppp.product_description,

          ppp.dispensing_point_id,

          dp.code
            AS dispensing_point_code,

          COALESCE(
            ppp.requested_quantity,
            0
          )::int
            AS requested_quantity,

          COALESCE(
            received.received_quantity,
            0
          )::int
            AS received_quantity,

          COALESCE(
            fulfilled.fulfilled_quantity,
            0
          )::int
            AS fulfilled_quantity

        FROM
          po_product_points ppp

        JOIN
          purchase_orders po
            ON po.id =
               ppp.purchase_order_id

        LEFT JOIN
          dispensing_points dp
            ON dp.id =
               ppp.dispensing_point_id

        LEFT JOIN
          received
            ON received.purchase_order_id =
               ppp.purchase_order_id

           AND received.commercial_code =
               ppp.commercial_code

           AND received.dispensing_point_id
               IS NOT DISTINCT FROM
               ppp.dispensing_point_id

        LEFT JOIN
          fulfilled
            ON fulfilled.purchase_order_id =
               ppp.purchase_order_id

           AND fulfilled.commercial_code =
               ppp.commercial_code

           AND fulfilled.dispensing_point_id
               IS NOT DISTINCT FROM
               ppp.dispensing_point_id

        WHERE
          ${sql.join(
            conditions,
            sql` AND `,
          )}

        ORDER BY
          ppp.commercial_code,
          purchase_order_code,
          dispensing_point_code
            NULLS LAST,
          ppp.purchase_order_id

        LIMIT
          ${limit}
      `);


    return {
      items:
        result.rows.map(
          (row) => {
            const requestedQuantity =
              Math.max(
                row.requested_quantity,
                0,
              );

            const receivedQuantity =
              Math.max(
                row.received_quantity,
                0,
              );

            const fulfilledQuantity =
              Math.max(
                row.fulfilled_quantity,
                0,
              );

            /*
             * Pool fungible:
             *
             * no existe reserva previa por paciente.
             */
            const availableQuantity =
              Math.max(
                receivedQuantity -
                fulfilledQuantity,
                0,
              );

            const pendingReceiptQuantity =
              Math.max(
                requestedQuantity -
                receivedQuantity,
                0,
              );

            return {
              purchaseOrderId:
                row.purchase_order_id,

              purchaseOrderCode:
                row.purchase_order_code,

              commercialCode:
                row.commercial_code,

              productDescription:
                row.product_description,

              dispensingPointId:
                row.dispensing_point_id,

              dispensingPointCode:
                row.dispensing_point_code,

              requestedQuantity,

              receivedQuantity,

              fulfilledQuantity,

              availableQuantity,

              pendingReceiptQuantity,
            };
          },
        ),
    };
  }


  async listImports(scope: Scope, limit = 50) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);

    const result = await this.database.db.execute<{
      id: string;
      status: string;
      total_rows: number;
      valid_rows: number;
      invalid_rows: number;
      allocated_quantity: number;
      original_filename: string | null;
      created_at: Date | string;
      confirmed_at: Date | string | null;
    }>(sql`
        SELECT
          iab.id,
          iab.status,
          iab.total_rows,
          iab.valid_rows,
          iab.invalid_rows,
          iab.allocated_quantity,
          ib.original_filename,
          iab.created_at,
          iab.confirmed_at

        FROM
          inventory_allocation_batches iab

        LEFT JOIN
          import_batches ib
            ON ib.id =
               iab.import_batch_id

        WHERE
          iab.organization_id =
            ${scope.organizationId}

          AND iab.source =
            'XLSX'

        ORDER BY
          iab.created_at DESC,
          iab.id DESC

        LIMIT
          ${safeLimit}
      `);

    return {
      items: result.rows.map((row) => ({
        id: row.id,

        status: row.status,

        totalRows: row.total_rows,

        validRows: row.valid_rows,

        invalidRows: row.invalid_rows,

        allocatedQuantity: row.allocated_quantity,

        originalFilename: row.original_filename ?? 'Archivo XLSX',

        createdAt:
          row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),

        confirmedAt: row.confirmed_at
          ? row.confirmed_at instanceof Date
            ? row.confirmed_at.toISOString()
            : String(row.confirmed_at)
          : null,
      })),
    };
  }

  async assignBatch(
    scope: Scope,
    requests: readonly AllocationRequest[],
    source: 'UI' | 'XLSX',
    importBatchId: string | null = null,
  ) {
    return this.database.db.transaction(async (tx) => {
      await this.reconcileIneligibleTx(tx, scope);

      const initiallyResolved: ResolvedAssignment[] = [];

      for (const request of requests) {
        initiallyResolved.push(await this.resolveAssignment(tx, scope, request, false));
      }

      initiallyResolved.sort((left, right) =>
        [
          left.purchaseOrderId,
          left.commercialCode,
          left.dispensingPointId,
          left.authorizationItemId,
        ]
          .join(':')
          .localeCompare(
            [
              right.purchaseOrderId,
              right.commercialCode,
              right.dispensingPointId,
              right.authorizationItemId,
            ].join(':'),
          ),
      );

      const batch = await tx.execute<{
        id: string;
      }>(sql`
            INSERT INTO
              inventory_allocation_batches (
                organization_id,
                source,
                import_batch_id,
                status,
                total_rows,
                valid_rows,
                invalid_rows,
                allocated_quantity,
                correlation_id,
                created_by
              )

            VALUES (
              ${scope.organizationId},
              ${source},
              ${importBatchId},
              'PREPARED',
              ${requests.length},
              ${requests.length},
              0,
              0,
              ${scope.correlationId},
              ${scope.userId}
            )

            RETURNING
              id
          `);

      const batchId = batch.rows[0]!.id;

      let allocatedQuantity = 0;

      for (const initial of initiallyResolved) {
        const resolved = await this.resolveAssignment(
          tx,
          scope,
          {
            authorizationKey: initial.authorizationKey,

            purchaseOrderCode: initial.purchaseOrderCode,

            quantity: initial.requestedQuantity,

            sourceImportRowId: initial.sourceImportRowId,
          },
          true,
        );

        await this.insertAllocation(tx, scope, batchId, resolved);

        allocatedQuantity += resolved.requestedQuantity;
      }

      await tx.execute(sql`
          UPDATE
            inventory_allocation_batches

          SET
            status =
              'CONFIRMED',

            allocated_quantity =
              ${allocatedQuantity},

            confirmed_by =
              ${scope.userId},

            confirmed_at =
              NOW(),

            version =
              version + 1

          WHERE
            id =
              ${batchId}
        `);

      await this.audit(tx, scope, 'INVENTORY_AVAILABILITY_ASSIGNED', batchId, {
        source,
        rows: requests.length,
        allocatedQuantity,
      });

      return {
        id: batchId,

        source,

        rows: requests.length,

        allocatedQuantity,

        status: 'CONFIRMED',
      };
    });
  }

  async prepareImport(
    scope: Scope,
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      sha256: string;
      content: Buffer;
    },
    rows: readonly InventoryAvailabilityImportRow[],
  ) {
    return this.database.db.transaction(async (tx) => {
      await this.reconcileIneligibleTx(tx, scope);

      const duplicate = await tx.execute<{
        id: string;
      }>(sql`
            SELECT
              iab.id

            FROM
              inventory_allocation_batches iab

            JOIN
              import_batches ib
                ON ib.id =
                   iab.import_batch_id

            WHERE
              iab.organization_id =
                ${scope.organizationId}

              AND ib.sha256 =
                ${file.sha256}

              AND iab.status IN (
                'PREPARED',
                'CONFIRMED'
              )

            LIMIT 1
          `);

      if (duplicate.rows[0]) {
        throw new Error('INVENTORY_ALLOCATION_DUPLICATE_IMPORT');
      }

      const validated: ValidatedImportRow[] = [];

      for (const row of rows) {
        validated.push(await this.validateImportRow(tx, scope, row));
      }

      const cumulative = new Map<string, number>();

      const withBatchValidation = validated.map((row): ValidatedImportRow => {
        if (
          row.validationStatus !== 'VALID' ||
          !row.purchaseOrderId ||
          !row.commercialCode ||
          !row.dispensingPointId ||
          row.availableQuantity === null
        ) {
          return row;
        }

        const key = [row.purchaseOrderId, row.commercialCode, row.dispensingPointId].join(':');

        const previous = cumulative.get(key) ?? 0;

        const next = previous + row.requestedQuantity;

        if (next > row.availableQuantity) {
          return {
            ...row,

            validationStatus: 'INVALID',

            errorCode: 'INVENTORY_ALLOCATION_INSUFFICIENT',

            errorMessage: 'La suma del archivo supera la disponibilidad de esta OC.',
          };
        }

        cumulative.set(key, next);

        return row;
      });

      const validRows = withBatchValidation.filter(
        (row) => row.validationStatus === 'VALID',
      ).length;

      const invalidRows = withBatchValidation.length - validRows;

      const ready = validRows > 0 && invalidRows === 0;

      const importBatch = await tx.execute<{
        id: string;
      }>(sql`
            INSERT INTO
              import_batches (
                organization_id,
                created_by,
                original_filename,
                mime_type,
                size_bytes,
                sha256,
                processor_version,
                status,
                total_rows,
                valid_rows,
                rejected_rows
              )

            VALUES (
              ${scope.organizationId},
              ${scope.userId},
              ${file.originalname},
              ${file.mimetype},
              ${file.size},
              ${file.sha256},
              1,
              ${ready ? 'READY_TO_CONFIRM' : 'FAILED'},
              ${withBatchValidation.length},
              ${validRows},
              ${invalidRows}
            )

            RETURNING
              id
          `);

      const importBatchId = importBatch.rows[0]!.id;

      await tx.execute(sql`
          INSERT INTO
            import_source_files (
              import_batch_id,
              original_filename,
              mime_type,
              size_bytes,
              sha256,
              content,
              processed_at
            )

          VALUES (
            ${importBatchId},
            ${file.originalname},
            ${file.mimetype},
            ${file.size},
            ${file.sha256},
            ${file.content},
            NOW()
          )
        `);

      const allocationBatch = await tx.execute<{
        id: string;
      }>(sql`
            INSERT INTO
              inventory_allocation_batches (
                organization_id,
                source,
                import_batch_id,
                status,
                total_rows,
                valid_rows,
                invalid_rows,
                correlation_id,
                created_by
              )

            VALUES (
              ${scope.organizationId},
              'XLSX',
              ${importBatchId},
              ${ready ? 'PREPARED' : 'FAILED'},
              ${withBatchValidation.length},
              ${validRows},
              ${invalidRows},
              ${scope.correlationId},
              ${scope.userId}
            )

            RETURNING
              id
          `);

      const batchId = allocationBatch.rows[0]!.id;

      for (const row of withBatchValidation) {
        await tx.execute(sql`
            INSERT INTO
              inventory_allocation_import_rows (
                batch_id,
                row_number,
                authorization_key,
                purchase_order_code,
                requested_quantity,
                resolved_authorization_item_id,
                resolved_purchase_order_id,
                commercial_code,
                expected_authorization_version,
                validation_status,
                execution_status,
                error_code,
                error_message,
                raw_payload
              )

            VALUES (
              ${batchId},
              ${row.rowNumber},
              ${row.authorizationKey},
              ${row.purchaseOrderCode},
              ${row.requestedQuantity},
              ${row.authorizationItemId},
              ${row.purchaseOrderId},
              ${row.commercialCode},
              ${row.authorizationVersion},
              ${row.validationStatus},
              'PENDING',
              ${row.errorCode},
              ${row.errorMessage},
              ${JSON.stringify(row.rawPayload)}::jsonb
            )
          `);
      }

      return {
        id: batchId,

        importBatchId,

        status: ready ? 'PREPARED' : 'FAILED',

        totalRows: withBatchValidation.length,

        validRows,

        invalidRows,

        rows: withBatchValidation.map((row) => ({
          rowNumber: row.rowNumber,

          authorizationKey: row.authorizationKey,

          purchaseOrderCode: row.purchaseOrderCode,

          requestedQuantity: row.requestedQuantity,

          commercialCode: row.commercialCode,

          validationStatus: row.validationStatus,

          errorCode: row.errorCode,

          errorMessage: row.errorMessage,
        })),
      };
    });
  }

  async importDetail(scope: Scope, batchId: string) {
    const batch = await this.database.db.execute<{
      id: string;
      status: string;
      total_rows: number;
      valid_rows: number;
      invalid_rows: number;
      allocated_quantity: number;
    }>(sql`
        SELECT
          id,
          status,
          total_rows,
          valid_rows,
          invalid_rows,
          allocated_quantity

        FROM
          inventory_allocation_batches

        WHERE
          id =
            ${batchId}

          AND organization_id =
            ${scope.organizationId}
      `);

    const current = batch.rows[0];

    if (!current) {
      return null;
    }

    const rows = await this.database.db.execute<{
      row_number: number;
      authorization_key: string;
      purchase_order_code: string;
      requested_quantity: number;
      commercial_code: string | null;
      validation_status: string;
      execution_status: string;
      error_code: string | null;
      error_message: string | null;
    }>(sql`
        SELECT
          row_number,
          authorization_key,
          purchase_order_code,
          requested_quantity,
          commercial_code,
          validation_status,
          execution_status,
          error_code,
          error_message

        FROM
          inventory_allocation_import_rows

        WHERE
          batch_id =
            ${batchId}

        ORDER BY
          row_number
      `);

    return {
      id: current.id,

      status: current.status,

      totalRows: current.total_rows,

      validRows: current.valid_rows,

      invalidRows: current.invalid_rows,

      allocatedQuantity: current.allocated_quantity,

      rows: rows.rows.map((row) => ({
        rowNumber: row.row_number,

        authorizationKey: row.authorization_key,

        purchaseOrderCode: row.purchase_order_code,

        requestedQuantity: row.requested_quantity,

        commercialCode: row.commercial_code,

        validationStatus: row.validation_status,

        executionStatus: row.execution_status,

        errorCode: row.error_code,

        errorMessage: row.error_message,
      })),
    };
  }

  async confirmImport(scope: Scope, batchId: string) {
    return this.database.db.transaction(async (tx) => {
      await this.reconcileIneligibleTx(tx, scope);

      const batchResult = await tx.execute<{
        id: string;
        import_batch_id: string;
        status: string;
        invalid_rows: number;
      }>(sql`
            SELECT
              id,
              import_batch_id,
              status,
              invalid_rows

            FROM
              inventory_allocation_batches

            WHERE
              id =
                ${batchId}

              AND organization_id =
                  ${scope.organizationId}

              AND source =
                  'XLSX'

            FOR UPDATE
          `);

      const batch = batchResult.rows[0];

      if (!batch) {
        throw new Error('INVENTORY_ALLOCATION_BATCH_NOT_FOUND');
      }

      if (batch.invalid_rows > 0) {
        throw new Error('INVENTORY_ALLOCATION_IMPORT_INVALID_ROWS');
      }

      if (batch.status !== 'PREPARED') {
        throw new Error('INVENTORY_ALLOCATION_BATCH_FROZEN');
      }

      const rowResult = await tx.execute<{
        id: string;
        authorization_key: string;
        purchase_order_code: string;
        requested_quantity: number;
      }>(sql`
            SELECT
              id,
              authorization_key,
              purchase_order_code,
              requested_quantity

            FROM
              inventory_allocation_import_rows

            WHERE
              batch_id =
                ${batchId}

              AND validation_status =
                  'VALID'

            ORDER BY
              purchase_order_code,
              authorization_key,
              row_number

            FOR UPDATE
          `);

      const initiallyResolved: ResolvedAssignment[] = [];

      for (const row of rowResult.rows) {
        initiallyResolved.push(
          await this.resolveAssignment(
            tx,
            scope,
            {
              authorizationKey: row.authorization_key,

              purchaseOrderCode: row.purchase_order_code,

              quantity: row.requested_quantity,

              sourceImportRowId: row.id,
            },
            false,
          ),
        );
      }

      initiallyResolved.sort((left, right) =>
        [
          left.purchaseOrderId,
          left.commercialCode,
          left.dispensingPointId,
          left.authorizationItemId,
        ]
          .join(':')
          .localeCompare(
            [
              right.purchaseOrderId,
              right.commercialCode,
              right.dispensingPointId,
              right.authorizationItemId,
            ].join(':'),
          ),
      );

      let allocatedQuantity = 0;

      for (const initial of initiallyResolved) {
        const resolved = await this.resolveAssignment(
          tx,
          scope,
          {
            authorizationKey: initial.authorizationKey,

            purchaseOrderCode: initial.purchaseOrderCode,

            quantity: initial.requestedQuantity,

            sourceImportRowId: initial.sourceImportRowId,
          },
          true,
        );

        await this.insertAllocation(tx, scope, batchId, resolved);

        allocatedQuantity += resolved.requestedQuantity;

        if (resolved.sourceImportRowId) {
          await tx.execute(sql`
              UPDATE
                inventory_allocation_import_rows

              SET
                execution_status =
                  'APPLIED',

                executed_at =
                  NOW()

              WHERE
                id =
                  ${resolved.sourceImportRowId}
            `);
        }
      }

      await tx.execute(sql`
          UPDATE
            inventory_allocation_batches

          SET
            status =
              'CONFIRMED',

            allocated_quantity =
              ${allocatedQuantity},

            confirmed_by =
              ${scope.userId},

            confirmed_at =
              NOW(),

            version =
              version + 1

          WHERE
            id =
              ${batchId}
        `);

      await tx.execute(sql`
          UPDATE
            import_batches

          SET
            status =
              'COMPLETED',

            confirmed_rows =
              ${rowResult.rows.length},

            confirmed_at =
              NOW(),

            completed_at =
              NOW()

          WHERE
            id =
              ${batch.import_batch_id}
        `);

      return {
        id: batchId,

        status: 'CONFIRMED',

        rows: rowResult.rows.length,

        allocatedQuantity,
      };
    });
  }

  async reconcile(scope: Scope) {
    return this.database.db.transaction(async (tx) => ({
      released: await this.reconcileIneligibleTx(tx, scope),
    }));
  }

  private async validateImportRow(
    tx: Tx,
    scope: Scope,
    row: InventoryAvailabilityImportRow,
  ): Promise<ValidatedImportRow> {
    try {
      const resolved = await this.resolveAssignment(
        tx,
        scope,
        {
          authorizationKey: row.authorizationKey,

          purchaseOrderCode: row.purchaseOrderCode,

          quantity: row.requestedQuantity,
        },
        false,
      );

      return {
        ...row,

        authorizationItemId: resolved.authorizationItemId,

        authorizationVersion: resolved.authorizationVersion,

        purchaseOrderId: resolved.purchaseOrderId,

        commercialCode: resolved.commercialCode,

        dispensingPointId: resolved.dispensingPointId,

        availableQuantity: resolved.purchaseOrderAvailableQuantity,

        validationStatus: 'VALID',

        errorCode: null,

        errorMessage: null,
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'INVENTORY_ALLOCATION_INVALID';

      return {
        ...row,

        authorizationItemId: null,

        authorizationVersion: null,

        purchaseOrderId: null,

        commercialCode: null,

        dispensingPointId: null,

        availableQuantity: null,

        validationStatus: 'INVALID',

        errorCode: code,

        errorMessage: this.errorMessage(code),
      };
    }
  }

  private async resolveAssignment(
    tx: Tx,
    scope: Scope,
    request: AllocationRequest,
    lock: boolean,
  ): Promise<ResolvedAssignment> {
    if (request.quantity <= 0) {
      throw new Error('INVENTORY_ALLOCATION_QUANTITY_INVALID');
    }

    const authorizationSql = lock ? sql`FOR UPDATE` : sql``;

    const authorization = await tx.execute<{
      id: string;
      authorization_key: string;
      commercial_code: string;
      authorization_version: number;
      authorized_quantity: number;
    }>(sql`
        SELECT
          ai.id,

          ai.authorization_key,

          ai.codigo_medicamento
            AS commercial_code,

          ai.version
            AS authorization_version,

          CASE
            WHEN BTRIM(
              COALESCE(
                ai.source_data
                  ->> 'CANTIDAD',
                ''
              )
            ) ~ '^[0-9]+$'
            THEN (
              ai.source_data
                ->> 'CANTIDAD'
            )::int

            ELSE 0
          END
            AS authorized_quantity

        FROM
          authorization_items ai

        WHERE
          ai.authorization_key =
            ${request.authorizationKey}

          AND ai.source_status_normalized =
              '5'

          AND ai.enablement_status =
              'ENABLED'

          AND EXISTS (
            SELECT
              1

            FROM
              authorization_item_organizations aio

            WHERE
              aio.authorization_item_id =
                ai.id

              AND aio.organization_id =
                ${scope.organizationId}
          )

          AND NOT EXISTS (
            SELECT
              1

            FROM
              patient_applications pa

            WHERE
              pa.authorization_item_id =
                ai.id

              AND pa.status =
                'CONFIRMED'
          )

          AND (
            CASE
              WHEN BTRIM(
                COALESCE(
                  ai.source_data
                    ->> 'FECHA_FINAL_VIGENCIA',
                  ''
                )
              ) ~ '^[0-9]{8}$'
              THEN TO_DATE(
                ai.source_data
                  ->> 'FECHA_FINAL_VIGENCIA',
                'YYYYMMDD'
              )

              WHEN BTRIM(
                COALESCE(
                  ai.source_data
                    ->> 'FECHA_FINAL_VIGENCIA',
                  ''
                )
              )
                ~
                '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              THEN TO_DATE(
                ai.source_data
                  ->> 'FECHA_FINAL_VIGENCIA',
                'YYYY-MM-DD'
              )

              ELSE NULL
            END
          )
          >=
          (
            NOW()
            AT TIME ZONE
            'America/Bogota'
          )::date

        LIMIT 2

        ${authorizationSql}
      `);

    if (authorization.rows.length === 0) {
      throw new Error('INVENTORY_ALLOCATION_AUTHORIZATION_NOT_FOUND');
    }

    if (authorization.rows.length > 1) {
      throw new Error('INVENTORY_ALLOCATION_AUTHORIZATION_AMBIGUOUS');
    }

    const auth = authorization.rows[0]!;

    const schedule = await tx.execute<{
      dispensing_point_id: string;
    }>(sql`
        SELECT
          ps.dispensing_point_id

        FROM
          patient_schedules ps

        WHERE
          ps.authorization_item_id =
            ${auth.id}

          AND ps.status IN (
            'SCHEDULED',
            'RESCHEDULED'
          )

        ORDER BY
          ps.scheduled_date DESC,
          ps.revision DESC,
          ps.created_at DESC,
          ps.id DESC

        LIMIT 1
      `);

    const dispensingPointId = schedule.rows[0]?.dispensing_point_id;

    if (!dispensingPointId) {
      throw new Error('INVENTORY_ALLOCATION_SCHEDULE_REQUIRED');
    }

    const orderSql = lock ? sql`FOR UPDATE` : sql``;

    const purchaseOrder = await tx.execute<{
      id: string;
      purchase_order_code: string;
    }>(sql`
        SELECT
          po.id,

          po.purchase_order_code

        FROM
          purchase_orders po

        WHERE
          po.purchase_order_code =
            ${request.purchaseOrderCode}

          AND po.status
            NOT IN (
              'CANCELLED',
              'REJECTED'
            )

          AND EXISTS (
            SELECT
              1

            FROM
              purchase_order_lines pol

            WHERE
              pol.purchase_order_id =
                po.id

              AND pol.commercial_code =
                ${auth.commercial_code}
          )

        LIMIT 2

        ${orderSql}
      `);

    if (purchaseOrder.rows.length === 0) {
      throw new Error('INVENTORY_ALLOCATION_OC_PRODUCT_NOT_FOUND');
    }

    if (purchaseOrder.rows.length > 1) {
      throw new Error('INVENTORY_ALLOCATION_OC_AMBIGUOUS');
    }

    const order = purchaseOrder.rows[0]!;

    if (lock) {
      await tx.execute(sql`
        SELECT
          pg_advisory_xact_lock(
            hashtextextended(
              ${[order.id, auth.commercial_code, dispensingPointId].join(':')},
              0::bigint
            )
          )
      `);
    }

    const authorizationAllocated = await tx.execute<{
      quantity: number;
    }>(sql`
        SELECT
          COALESCE(
            SUM(
              GREATEST(
                allocated_quantity
                -
                released_quantity,
                0
              )
            ),
            0
          )::int
            AS quantity

        FROM
          inventory_authorization_allocations

        WHERE
          authorization_item_id =
            ${auth.id}

          AND status IN (
            'ALLOCATED',
            'PARTIALLY_CONSUMED',
            'CONSUMED'
          )
      `);

    const authorizationPending = Math.max(
      auth.authorized_quantity - (authorizationAllocated.rows[0]?.quantity ?? 0),
      0,
    );

    if (request.quantity > authorizationPending) {
      throw new Error('INVENTORY_ALLOCATION_EXCEEDS_AUTHORIZATION_PENDING');
    }

    const received = await tx.execute<{
      quantity: number;
    }>(sql`
        SELECT
          COALESCE(
            SUM(
              rl.accepted_quantity
            ),
            0
          )::int
            AS quantity

        FROM
          receipts r

        JOIN
          receipt_lines rl
            ON rl.receipt_id =
               r.id

        JOIN
          delivery_lines dl
            ON dl.id =
               rl.delivery_line_id

        JOIN
          deliveries d
            ON d.id =
               dl.delivery_id

        WHERE
          r.status =
            'CONFIRMED'

          AND d.purchase_order_id =
            ${order.id}

          AND dl.commercial_code =
            ${auth.commercial_code}

          AND dl.dispensing_point_id =
            ${dispensingPointId}

          AND rl.accepted_quantity
            >
            0

          AND rl.received_expiration_date
            >=
            (
              NOW()
              AT TIME ZONE
              'America/Bogota'
            )::date
      `);

    const allocationState = await tx.execute<{
      consumed: number;
      assigned: number;
    }>(sql`
        SELECT
          COALESCE(
            SUM(
              consumed_quantity
            ),
            0
          )::int
            AS consumed,

          COALESCE(
            SUM(
              CASE
                WHEN status IN (
                  'ALLOCATED',
                  'PARTIALLY_CONSUMED'
                )
                THEN GREATEST(
                  allocated_quantity
                  -
                  consumed_quantity
                  -
                  released_quantity,
                  0
                )

                ELSE 0
              END
            ),
            0
          )::int
            AS assigned

        FROM
          inventory_authorization_allocations

        WHERE
          purchase_order_id =
            ${order.id}

          AND commercial_code =
            ${auth.commercial_code}

          AND dispensing_point_id =
            ${dispensingPointId}
      `);

    const physical = await tx.execute<{
      usable: number;
      reserved: number;
    }>(sql`
        SELECT
          COALESCE(
            (
              SELECT
                SUM(
                  iul.usable_balance
                )::int

              FROM
                inventory_usable_lots iul

              WHERE
                iul.commercial_code =
                  ${auth.commercial_code}

                AND iul.dispensing_point_id =
                  ${dispensingPointId}
            ),
            0
          )
            AS usable,

          COALESCE(
            (
              SELECT
                SUM(
                  GREATEST(
                    iaa.allocated_quantity
                    -
                    iaa.consumed_quantity
                    -
                    iaa.released_quantity,
                    0
                  )
                )::int

              FROM
                inventory_authorization_allocations iaa

              WHERE
                iaa.commercial_code =
                  ${auth.commercial_code}

                AND iaa.dispensing_point_id =
                  ${dispensingPointId}

                AND iaa.status IN (
                  'ALLOCATED',
                  'PARTIALLY_CONSUMED'
                )
            ),
            0
          )
            AS reserved
      `);

    const receivedQuantity = received.rows[0]?.quantity ?? 0;

    const consumedQuantity = allocationState.rows[0]?.consumed ?? 0;

    const assignedQuantity = allocationState.rows[0]?.assigned ?? 0;

    const logicalAvailable = Math.max(receivedQuantity - consumedQuantity - assignedQuantity, 0);

    const physicalAvailable = Math.max(
      (physical.rows[0]?.usable ?? 0) - (physical.rows[0]?.reserved ?? 0),
      0,
    );

    const purchaseOrderAvailable = Math.min(logicalAvailable, physicalAvailable);

    if (request.quantity > purchaseOrderAvailable) {
      throw new Error('INVENTORY_ALLOCATION_INSUFFICIENT');
    }

    return {
      authorizationItemId: auth.id,

      authorizationKey: auth.authorization_key,

      authorizationVersion: auth.authorization_version,

      purchaseOrderId: order.id,

      purchaseOrderCode: order.purchase_order_code,

      commercialCode: auth.commercial_code,

      dispensingPointId,

      requestedQuantity: request.quantity,

      authorizationPendingQuantity: authorizationPending,

      purchaseOrderAvailableQuantity: purchaseOrderAvailable,

      sourceImportRowId: request.sourceImportRowId ?? null,
    };
  }

  private async insertAllocation(
    tx: Tx,
    scope: Scope,
    batchId: string,
    resolved: ResolvedAssignment,
  ) {
    await tx.execute(sql`
      INSERT INTO
        inventory_authorization_allocations (
          batch_id,
          source_import_row_id,
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
        ${batchId},
        ${resolved.sourceImportRowId},
        ${scope.organizationId},
        ${resolved.authorizationItemId},
        ${resolved.purchaseOrderId},
        ${resolved.commercialCode},
        ${resolved.dispensingPointId},
        ${resolved.requestedQuantity},
        0,
        0,
        'ALLOCATED',
        ${resolved.authorizationVersion},
        ${scope.userId},
        ${scope.userId}
      )
    `);
  }

  private async reconcileIneligibleTx(tx: Tx, scope: Scope) {
    const released = await tx.execute<{
      id: string;
    }>(sql`
        UPDATE
          inventory_authorization_allocations iaa

        SET
          released_quantity =
            GREATEST(
              iaa.allocated_quantity
              -
              iaa.consumed_quantity,
              0
            ),

          status =
            CASE
              WHEN (
                CASE
                  WHEN BTRIM(
                    COALESCE(
                      ai.source_data
                        ->> 'FECHA_FINAL_VIGENCIA',
                      ''
                    )
                  ) ~ '^[0-9]{8}$'
                  THEN TO_DATE(
                    ai.source_data
                      ->> 'FECHA_FINAL_VIGENCIA',
                    'YYYYMMDD'
                  )

                  WHEN BTRIM(
                    COALESCE(
                      ai.source_data
                        ->> 'FECHA_FINAL_VIGENCIA',
                      ''
                    )
                  )
                    ~
                    '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                  THEN TO_DATE(
                    ai.source_data
                      ->> 'FECHA_FINAL_VIGENCIA',
                    'YYYY-MM-DD'
                  )

                  ELSE NULL
                END
              )
              <
              (
                NOW()
                AT TIME ZONE
                'America/Bogota'
              )::date

              THEN
                'EXPIRED'

              ELSE
                'RELEASED'
            END,

          updated_by =
            ${scope.userId},

          updated_at =
            NOW()

        FROM
          authorization_items ai,
          purchase_orders po

        WHERE
          iaa.authorization_item_id =
            ai.id

          AND iaa.purchase_order_id =
            po.id

          AND iaa.organization_id =
            ${scope.organizationId}

          AND iaa.status IN (
            'ALLOCATED',
            'PARTIALLY_CONSUMED'
          )

          AND (
            ai.source_status_normalized
              <>
              '5'

            OR

            ai.enablement_status
              <>
              'ENABLED'

            OR

            po.status IN (
              'CANCELLED',
              'REJECTED'
            )

            OR

            (
              CASE
                WHEN BTRIM(
                  COALESCE(
                    ai.source_data
                      ->> 'FECHA_FINAL_VIGENCIA',
                    ''
                  )
                ) ~ '^[0-9]{8}$'
                THEN TO_DATE(
                  ai.source_data
                    ->> 'FECHA_FINAL_VIGENCIA',
                  'YYYYMMDD'
                )

                WHEN BTRIM(
                  COALESCE(
                    ai.source_data
                      ->> 'FECHA_FINAL_VIGENCIA',
                    ''
                  )
                )
                  ~
                  '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                THEN TO_DATE(
                  ai.source_data
                    ->> 'FECHA_FINAL_VIGENCIA',
                  'YYYY-MM-DD'
                )

                ELSE NULL
              END
            )
            <
            (
              NOW()
              AT TIME ZONE
              'America/Bogota'
            )::date

            OR

            EXISTS (
              SELECT
                1

              FROM
                patient_applications pa

              WHERE
                pa.authorization_item_id =
                  ai.id

                AND pa.status =
                  'CONFIRMED'
            )
          )

        RETURNING
          iaa.id
      `);

    return released.rows.length;
  }

  private errorMessage(code: string) {
    const messages: Record<string, string> = {
      INVENTORY_ALLOCATION_AUTHORIZATION_NOT_FOUND:
        'La clave de autorización no existe, no está vigente o ya fue aplicada.',

      INVENTORY_ALLOCATION_AUTHORIZATION_AMBIGUOUS:
        'La clave de autorización no identifica un único registro.',

      INVENTORY_ALLOCATION_SCHEDULE_REQUIRED: 'La autorización no tiene una programación activa.',

      INVENTORY_ALLOCATION_OC_PRODUCT_NOT_FOUND:
        'La OC no contiene el producto correspondiente a la autorización.',

      INVENTORY_ALLOCATION_OC_AMBIGUOUS: 'El código de OC no identifica una única orden.',

      INVENTORY_ALLOCATION_EXCEEDS_AUTHORIZATION_PENDING:
        'La cantidad supera el pendiente de la autorización.',

      INVENTORY_ALLOCATION_INSUFFICIENT:
        'La OC no tiene disponibilidad suficiente para asignar esta cantidad.',
    };

    return messages[code] ?? code;
  }

  private async audit(tx: Tx, scope: Scope, action: string, id: string, after: unknown) {
    await tx.execute(sql`
      INSERT INTO
        audit_events (
          actor_type,
          actor_id,
          organization_id,
          action,
          resource_type,
          resource_id,
          after,
          correlation_id,
          request_id,
          result
        )

      VALUES (
        'USER',
        ${scope.userId},
        ${scope.organizationId},
        ${action},
        'inventory_availability',
        ${id},
        ${JSON.stringify(after)}::jsonb,
        ${scope.correlationId},
        ${scope.correlationId},
        'SUCCESS'
      )
    `);
  }
}
