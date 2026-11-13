import { Inject, Injectable } from '@nestjs/common';

import { sql } from 'drizzle-orm';

import type { createDatabase } from '@authorization/database';
import { AUTHORIZATION_ANNULMENT_EVIDENCE_KEY } from '@authorization/domain';

import type { Scope } from '../common/request-scope';
import { applyPointScope, lockActivePointGrants } from '../common/point-scope.sql';

import { DATABASE } from '../tokens';
import { REALTIME_AUDIENCE, realtimeInvalidationSql } from '../common/realtime-outbox';
import type {
  AutomaticAssignmentOutcome,
  AutomaticReconciliationOptions,
  AutomaticReconciliationProductResult,
} from './inventory-availability-reconciliation.contract';

import {
  calculateAssignableAvailability,
  calculateUncommittedPurchaseBalance,
} from './inventory-availability-balance';
import {
  planAutomaticAssignments,
  type AutomaticAssignmentCandidate,
  type AutomaticAssignmentSource,
} from './inventory-availability-auto-planner';

import type { InventoryAvailabilityImportRow } from './inventory-availability-xlsx';

type Database = ReturnType<typeof createDatabase>;

type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];

export type InventoryAvailabilityTransaction = Tx;

export type AutomaticAssignmentTrigger =
  | 'STOCK_BECAME_AVAILABLE'
  | 'RESERVATION_RELEASED'
  | 'AUTHORIZATION_ENABLED'
  | 'AVAILABILITY_RECONCILIATION';

type AutomaticAssignmentFilters = Readonly<{
  commercialCodes: readonly string[];
  dispensingPointIds?: readonly string[];
}>;

type AutomaticCandidateRow = Readonly<{
  id: string;
  authorization_key: string;
  commercial_code: string;
  validity_end_date: string;
  pending_quantity: number;
}>;

type AutomaticAvailabilitySourceRow = AutomaticAssignmentSource & Readonly<{
  sourceKind: 'DIRECT' | 'LEDGER';
}>;

type AllocationBatchSource = 'UI' | 'XLSX' | 'AUTO';

const POINT_RESOLUTION_ERRORS = new Set([
  'INVENTORY_ALLOCATION_SCHEDULE_POINT_AMBIGUOUS',
  'INVENTORY_ALLOCATION_PATIENT_POINT_AMBIGUOUS',
  'INVENTORY_ALLOCATION_PRODUCT_POINT_AMBIGUOUS',
  'INVENTORY_ALLOCATION_POINT_REQUIRED',
  'INVENTORY_ALLOCATION_POINT_INACTIVE',
  'INVENTORY_ALLOCATION_POINT_OUT_OF_SCOPE',
]);

const AUTOMATIC_ASSIGNMENT_RETRYABLE_ERRORS = new Set([
  'INVENTORY_ALLOCATION_INSUFFICIENT',
  'INVENTORY_ALLOCATION_EXCEEDS_AUTHORIZATION_PENDING',
  'INVENTORY_ALLOCATION_AUTHORIZATION_NOT_FOUND',
  'INVENTORY_ALLOCATION_POINT_INACTIVE',
  'INVENTORY_ALLOCATION_POINT_OUT_OF_SCOPE',
]);

export type AvailabilityFilters = Readonly<{
  search?: string;
  purchaseOrder?: string;
  dispensingPoint?: string;
  limit?: number;

  /*
   * Uso interno exclusivo de exportación.
   * Nunca proviene directamente del query HTTP.
   */
  exportAll?: boolean;
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

    const limitSql =
      filters.exportAll
        ? sql``
        : sql`
            LIMIT
              ${limit}
          `;

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

    /*
     * COMPENSAR OBSERVER
     * ==================
     *
     * La disponibilidad visible debe provenir de OC
     * relacionadas con autorizaciones de COMPENSAR.
     *
     * No concede ninguna capacidad de asignación.
     */
    if (
      scope.organizationCode ===
      'COMPENSAR'
    ) {
      conditions.push(
        sql`
          exists (
            select
              1

            from
              purchase_order_lines
                scoped_pol

            join
              purchase_order_authorization_sources
                scoped_poas
                on scoped_poas.purchase_order_line_id =
                   scoped_pol.id

            join
              authorization_item_organizations
                scoped_aio
                on scoped_aio.authorization_item_id =
                   scoped_poas.authorization_item_id

            where
              scoped_pol.purchase_order_id =
                po.id

              and scoped_aio.organization_id =
                ${scope.organizationId}::uuid
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

        assigned_quantity:
          number;
        global_received_quantity: number;
        global_fulfilled_quantity: number;
        global_assigned_quantity: number;
        active_commitment_quantity: number;
        historical_annulment_released_quantity: number;
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
                    tap.descripcion_generica,
                    tap.descripcion_comercial,
                    pol.product_description,
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
           * Recepción directa quantity-only.
           *
           * purchase_order_receipt_lines es la evidencia
           * física moderna. No requiere inventory_lots
           * ni inventory_movements.
           */
          SELECT DISTINCT
            por.purchase_order_id,

            pol.commercial_code,

            pol.dispensing_point_id

          FROM
            purchase_order_receipt_lines porl

          JOIN
            purchase_order_receipts por
              ON por.id =
                 porl.receipt_id

          JOIN
            purchase_order_lines pol
              ON pol.id =
                 porl.purchase_order_line_id

          WHERE
            porl.received_quantity >
              0

            AND pol.dispensing_point_id
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
           * Flujo moderno quantity-only:
           *
           * una cantidad confirmada por MEDICARTE
           * en purchase_order_receipt_lines ES
           * existencia física operacional.
           *
           * No inventamos lote ni vencimiento.
           */
          SELECT
            por.purchase_order_id,

            pol.commercial_code,

            COALESCE(
              pol.dispensing_point_id,
              mapping.dispensing_point_id
            )
              AS dispensing_point_id,

            SUM(
              porl.received_quantity
            )::int
              AS quantity

          FROM
            purchase_order_receipt_lines porl

          JOIN
            purchase_order_receipts por
              ON por.id =
                 porl.receipt_id

          JOIN
            purchase_order_lines pol
              ON pol.id =
                 porl.purchase_order_line_id

          /* Un solo mapping por producto: evitar duplicar el recibido
             cuando hay múltiples filas de anexo tarifario. */
          LEFT JOIN LATERAL (
            SELECT (ARRAY_AGG(DISTINCT m.dispensing_point_id))[1] AS dispensing_point_id
            FROM tariff_annex_products tap
            JOIN product_delivery_point_mappings m
              ON m.invima_record_normalized =
                 COALESCE(NULLIF(LTRIM(BTRIM(tap.numero_expediente_invima), '0'), ''), '0')
             AND m.invima_presentation_normalized =
                 COALESCE(NULLIF(LTRIM(BTRIM(tap.consecutivo_invima_presentacion), '0'), ''), '0')
            WHERE tap.codigo_producto = pol.commercial_code
              AND tap.active = TRUE
              AND BTRIM(COALESCE(tap.numero_expediente_invima, '')) ~ '^[0-9]+$'
              AND BTRIM(COALESCE(tap.consecutivo_invima_presentacion, '')) ~ '^[0-9]+$'
            HAVING COUNT(DISTINCT m.dispensing_point_id) = 1
          ) mapping ON pol.dispensing_point_id IS NULL

          WHERE
            porl.received_quantity >
              0

          GROUP BY
            por.purchase_order_id,
            pol.commercial_code,
            COALESCE(
              pol.dispensing_point_id,
              mapping.dispensing_point_id
            )


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

            AND NOT EXISTS (
              SELECT 1 FROM purchase_order_receipt_lines direct_porl
              JOIN purchase_order_receipts direct_por ON direct_por.id = direct_porl.receipt_id
              JOIN purchase_order_lines direct_pol ON direct_pol.id = direct_porl.purchase_order_line_id
              WHERE direct_por.purchase_order_id = d.purchase_order_id
                AND direct_pol.commercial_code = dl.commercial_code
                AND direct_porl.received_quantity > 0
            )

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
        ),

        assigned AS (
          SELECT
            iaa.purchase_order_id,

            iaa.commercial_code,

            iaa.dispensing_point_id,

            COALESCE(
              SUM(
                GREATEST(
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
              AS assigned_quantity

          FROM
            inventory_authorization_allocations iaa

          WHERE
            iaa.status IN (
              'ALLOCATED',
              'PARTIALLY_CONSUMED'
            )

          GROUP BY
            iaa.purchase_order_id,
            iaa.commercial_code,
            iaa.dispensing_point_id
        ),

        received_global AS (
          SELECT purchase_order_id, commercial_code,
                 SUM(received_quantity)::int AS quantity
          FROM received
          GROUP BY purchase_order_id, commercial_code
        ),
        fulfilled_global AS (
          SELECT purchase_order_id, commercial_code,
                 SUM(fulfilled_quantity)::int AS quantity
          FROM fulfilled
          GROUP BY purchase_order_id, commercial_code
        ),
        assigned_global AS (
          SELECT purchase_order_id, commercial_code,
                 SUM(assigned_quantity)::int AS quantity
          FROM assigned
          GROUP BY purchase_order_id, commercial_code
        ),
        active_source_by_auth AS (
          SELECT pol.purchase_order_id, pol.commercial_code,
                 poas.authorization_item_id,
                 SUM(poas.source_quantity_snapshot)::int AS quantity
          FROM purchase_order_authorization_sources poas
          JOIN purchase_order_lines pol
            ON pol.id = poas.purchase_order_line_id
          WHERE poas.released_at IS NULL
          GROUP BY pol.purchase_order_id, pol.commercial_code,
                   poas.authorization_item_id
        ),
        active_allocation_by_auth AS (
          SELECT iaa.purchase_order_id, iaa.commercial_code,
                 iaa.authorization_item_id,
                 SUM(GREATEST(
                   iaa.allocated_quantity
                   - iaa.consumed_quantity
                   - iaa.released_quantity, 0
                 ))::int AS quantity
          FROM inventory_authorization_allocations iaa
          WHERE iaa.status IN ('ALLOCATED', 'PARTIALLY_CONSUMED')
          GROUP BY iaa.purchase_order_id, iaa.commercial_code,
                   iaa.authorization_item_id
        ),
        purchase_commitments AS (
          SELECT
            COALESCE(src.purchase_order_id, res.purchase_order_id)
              AS purchase_order_id,
            COALESCE(src.commercial_code, res.commercial_code)
              AS commercial_code,
            SUM(GREATEST(
              COALESCE(src.quantity, 0),
              COALESCE(res.quantity, 0)
            ))::int AS active_commitment_quantity
          FROM active_source_by_auth src
          FULL OUTER JOIN active_allocation_by_auth res
            ON res.purchase_order_id = src.purchase_order_id
           AND res.commercial_code = src.commercial_code
           AND res.authorization_item_id = src.authorization_item_id
          GROUP BY
            COALESCE(src.purchase_order_id, res.purchase_order_id),
            COALESCE(src.commercial_code, res.commercial_code)
        ),
        annulment_history AS (
          SELECT pol.purchase_order_id, pol.commercial_code,
                 SUM(poas.source_quantity_snapshot)::int
                   AS historical_annulment_released_quantity
          FROM purchase_order_authorization_sources poas
          JOIN purchase_order_lines pol
            ON pol.id = poas.purchase_order_line_id
          JOIN authorization_items ai
            ON ai.id = poas.authorization_item_id
          WHERE poas.released_at IS NOT NULL
            AND ai.annulled_at IS NOT NULL
            AND poas.released_at >= ai.annulled_at
          GROUP BY pol.purchase_order_id, pol.commercial_code
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
            AS fulfilled_quantity,

          COALESCE(
            assigned.assigned_quantity,
            0
          )::int
            AS assigned_quantity,

          COALESCE(received_global.quantity, 0)::int AS global_received_quantity,
          COALESCE(fulfilled_global.quantity, 0)::int AS global_fulfilled_quantity,
          COALESCE(assigned_global.quantity, 0)::int AS global_assigned_quantity,
          COALESCE(pc.active_commitment_quantity, 0)::int AS active_commitment_quantity,
          COALESCE(ah.historical_annulment_released_quantity, 0)::int AS historical_annulment_released_quantity

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


        LEFT JOIN
          assigned
            ON assigned.purchase_order_id =
               ppp.purchase_order_id

           AND assigned.commercial_code =
               ppp.commercial_code

           AND assigned.dispensing_point_id
               IS NOT DISTINCT FROM
               ppp.dispensing_point_id

        LEFT JOIN received_global
          ON received_global.purchase_order_id = ppp.purchase_order_id
         AND received_global.commercial_code = ppp.commercial_code

        LEFT JOIN fulfilled_global
          ON fulfilled_global.purchase_order_id = ppp.purchase_order_id
         AND fulfilled_global.commercial_code = ppp.commercial_code

        LEFT JOIN assigned_global
          ON assigned_global.purchase_order_id = ppp.purchase_order_id
         AND assigned_global.commercial_code = ppp.commercial_code


        LEFT JOIN purchase_commitments pc
          ON pc.purchase_order_id = ppp.purchase_order_id
         AND pc.commercial_code = ppp.commercial_code

        LEFT JOIN annulment_history ah
          ON ah.purchase_order_id = ppp.purchase_order_id
         AND ah.commercial_code = ppp.commercial_code

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

        ${limitSql}
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

            const assignedQuantity =
              Math.max(
                row.assigned_quantity,
                0,
              );

            const availableQuantity =
              calculateAssignableAvailability(
                receivedQuantity,
                fulfilledQuantity,
                assignedQuantity,
                Math.max(Number(row.global_received_quantity), 0),
                Math.max(Number(row.global_fulfilled_quantity), 0),
                Math.max(Number(row.global_assigned_quantity), 0),
              );

            const pendingReceiptQuantity =
              Math.max(
                requestedQuantity -
                receivedQuantity,
                0,
              );

            // Saldo global de OC/producto; no sumar entre puntos.
            const activeCommitmentQuantity =
              Math.max(Number(row.active_commitment_quantity), 0);

            const historicalAnnulmentReleasedQuantity =
              Math.max(Number(row.historical_annulment_released_quantity), 0);

            const purchaseCommitmentAvailableQuantity =
              calculateUncommittedPurchaseBalance(
                requestedQuantity,
                Math.max(Number(row.global_received_quantity), 0),
                activeCommitmentQuantity,
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

              assignedQuantity,

              availableQuantity,

              pendingReceiptQuantity,
              activeCommitmentQuantity,
              purchaseCommitmentAvailableQuantity,
              historicalAnnulmentReleasedQuantity,
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
      return this.assignBatchInTx(tx, scope, requests, source, importBatchId);
    });
  }

  /** Discover received products, not AUTO-OC commercial links. Physical balances are rechecked below. */
  async listAutomaticReconciliationProducts(options: AutomaticReconciliationOptions) {
    const filter = options.commercialCodes
      ? sql`AND received.commercial_code IN (${sql.join(options.commercialCodes.map((code) => sql`${code}`), sql`, `)})`
      : sql``;
    const cursor = options.cursor
      ? sql`AND received.commercial_code COLLATE "C" > ${options.cursor} COLLATE "C"`
      : sql``;
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '15000'`);
      const result = await tx.execute<{ commercial_code: string }>(sql`
        WITH received AS (
          SELECT pol.commercial_code
          FROM purchase_order_receipt_lines porl
          JOIN purchase_order_receipts por ON por.id = porl.receipt_id
          JOIN purchase_order_lines pol ON pol.id = porl.purchase_order_line_id
          JOIN purchase_orders po ON po.id = por.purchase_order_id
          WHERE por.confirmed_at IS NOT NULL AND porl.received_quantity > 0
            AND po.status NOT IN ('CANCELLED', 'REJECTED')
          UNION
          SELECT dl.commercial_code
          FROM inventory_movements im
          JOIN receipt_lines rl ON rl.id = im.source_id
          JOIN receipts r ON r.id = rl.receipt_id
          JOIN delivery_lines dl ON dl.id = rl.delivery_line_id
          JOIN deliveries d ON d.id = dl.delivery_id
          JOIN purchase_orders po ON po.id = d.purchase_order_id
          WHERE im.movement_type = 'RECEIPT' AND im.source_type = 'RECEIPT_LINE'
            AND im.quantity_delta > 0 AND r.status = 'CONFIRMED'
            AND po.status NOT IN ('CANCELLED', 'REJECTED')
        )
        SELECT DISTINCT received.commercial_code COLLATE "C" AS commercial_code
        FROM received
        WHERE received.commercial_code IS NOT NULL
          AND BTRIM(received.commercial_code) <> ''
          ${filter} ${cursor}
        ORDER BY commercial_code
        LIMIT ${options.limit + 1}
      `);
      const commercialCodes = result.rows.slice(0, options.limit).map((row) => row.commercial_code);
      const hasMore = result.rows.length > options.limit;
      return {
        commercialCodes,
        hasMore,
        nextCursor: hasMore ? commercialCodes[commercialCodes.length - 1] ?? null : null,
      };
    }, { accessMode: 'read only' });
  }

  async reconcileAutomaticProduct(
    scope: Scope,
    commercialCode: string,
    options: AutomaticReconciliationOptions,
  ): Promise<AutomaticReconciliationProductResult> {
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '15000'`);
      await tx.execute(sql`SET LOCAL lock_timeout = '2000'`);
      if (!options.dryRun) {
        // This additional lock coordinates reconcilers only. Existing receipt/assignment
        // locks remain authoritative and are still acquired by assignBatchInTx().
        const lock = await tx.execute<{ locked: boolean }>(sql`
          SELECT pg_try_advisory_xact_lock(hashtextextended(
            ${`AUTO_AVAILABILITY_RECONCILIATION:${commercialCode}`}, 0::bigint
          )) AS locked
        `);
        if (lock.rows[0]?.locked !== true) {
          return {
            status: 'BUSY',
            result: { assignedQuantity: 0, assignedAuthorizationKeys: [], unmatchedStock: [] },
          };
        }
      }
      const result = await this.assignAutomaticallyInTx(tx, scope, 'AVAILABILITY_RECONCILIATION', {
        commercialCodes: [commercialCode],
        ...(options.dispensingPointIds ? { dispensingPointIds: options.dispensingPointIds } : {}),
      }, {
        dryRun: options.dryRun,
        deadlineAtMs: Date.now() + 20_000,
      });
      return {
        status: options.dryRun ? 'PREVIEWED' : result.assignedQuantity > 0 ? 'ASSIGNED' : 'UNCHANGED',
        result,
      };
    }, {
      accessMode: options.dryRun ? 'read only' : 'read write',
      isolationLevel: options.dryRun ? 'repeatable read' : 'read committed',
    });
  }

  async assignAutomaticallyInTx(
    tx: InventoryAvailabilityTransaction,
    scope: Scope,
    trigger: AutomaticAssignmentTrigger,
    filters: AutomaticAssignmentFilters,
    options: Readonly<{ dryRun?: boolean; deadlineAtMs?: number }> = {},
  ): Promise<AutomaticAssignmentOutcome> {
    const checkBudget = () => {
      if (options.deadlineAtMs !== undefined && Date.now() > options.deadlineAtMs) {
        throw new Error('INVENTORY_AUTO_RECONCILIATION_PLANNING_TIMEOUT');
      }
    };
    const commercialCodes = [...new Set(filters.commercialCodes.map((code) => code.trim()).filter(Boolean))];
    if (commercialCodes.length === 0) {
      return { assignedQuantity: 0, assignedAuthorizationKeys: [], unmatchedStock: [] };
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      checkBudget();
      const sourceRows = await this.loadAutomaticAvailabilitySources(
        tx,
        scope,
        commercialCodes,
        filters.dispensingPointIds,
      );
      if (sourceRows.length === 0) {
        return { assignedQuantity: 0, assignedAuthorizationKeys: [], unmatchedStock: [] };
      }
      const rawCandidates = await this.loadAutomaticCandidates(tx, scope, commercialCodes);

      const unresolvedPointCounts = new Map<string, number>();
      const candidates: AutomaticAssignmentCandidate[] = [];
      for (const candidate of rawCandidates) {
        checkBudget();
        let dispensingPointId: string;
        try {
          dispensingPointId = await this.resolveAuthorizationDispensingPoint(
            tx,
            candidate.id,
            candidate.commercial_code,
          );
        } catch (error) {
          if (!(error instanceof Error) || !POINT_RESOLUTION_ERRORS.has(error.message)) throw error;
          unresolvedPointCounts.set(
            candidate.commercial_code,
            (unresolvedPointCounts.get(candidate.commercial_code) ?? 0) + 1,
          );
          continue;
        }

        const allowedPoint = await tx.execute<{ allowed: boolean }>(sql`
          select ${applyPointScope(sql`${dispensingPointId}::uuid`, scope)} as allowed
        `);
        if (allowedPoint.rows[0]?.allowed !== true) continue;

        candidates.push({
          authorizationKey: candidate.authorization_key,
          commercialCode: candidate.commercial_code,
          dispensingPointId,
          validityEndDate: candidate.validity_end_date,
          pendingQuantity: Number(candidate.pending_quantity),
        });
      }

      const cappedSources: AutomaticAssignmentSource[] = sourceRows.map((source) => ({
        purchaseOrderCode: source.purchaseOrderCode,
        purchaseOrderId: source.purchaseOrderId,
        commercialCode: source.commercialCode,
        dispensingPointId: source.dispensingPointId,
        availableQuantity: source.availableQuantity,
        expirationDate: source.expirationDate,
        receivedAt: source.receivedAt,
      }));
      const plan = planAutomaticAssignments(candidates, cappedSources);
      const unmatchedStock = plan.unmatchedStock.map((unmatched) => ({
        ...unmatched,
        reason:
          unmatched.reason === 'NO_ELIGIBLE_AUTHORIZATION' &&
          (unresolvedPointCounts.get(unmatched.commercialCode) ?? 0) > 0
            ? 'NO_MATCHING_POINT' as const
            : unmatched.reason,
      }));

      checkBudget();
      // Return before audit, SAVEPOINT or assignment. The caller also enforces READ ONLY.
      if (options.dryRun === true) {
        return {
          dryRun: true,
          assignedQuantity: 0,
          assignedAuthorizationKeys: [],
          plannedQuantity: plan.requests.reduce((total, request) => total + request.quantity, 0),
          plannedAuthorizationKeys: plan.assignedAuthorizationKeys,
          requests: plan.requests,
          unmatchedStock,
        };
      }

      if (plan.requests.length === 0) {
        for (const unmatched of unmatchedStock) {
          await this.auditAutomaticUnassigned(tx, scope, trigger, unmatched, {
            candidateCount: rawCandidates.filter((candidate) => candidate.commercial_code === unmatched.commercialCode)
              .length,
            unresolvedPointCount: unresolvedPointCounts.get(unmatched.commercialCode) ?? 0,
          });
        }
        return { assignedQuantity: 0, assignedAuthorizationKeys: [], unmatchedStock };
      }

      await tx.execute(sql`SAVEPOINT inventory_auto_assignment`);
      try {
        const assigned = await this.assignBatchInTx(
          tx,
          scope,
          plan.requests,
          'AUTO',
          null,
          {
            trigger,
            assignedAuthorizationKeys: plan.assignedAuthorizationKeys,
          },
        );
        await tx.execute(sql`RELEASE SAVEPOINT inventory_auto_assignment`);

        for (const unmatched of unmatchedStock) {
          await this.auditAutomaticUnassigned(tx, scope, trigger, unmatched, {
            candidateCount: rawCandidates.filter((candidate) => candidate.commercial_code === unmatched.commercialCode)
              .length,
            unresolvedPointCount: unresolvedPointCounts.get(unmatched.commercialCode) ?? 0,
          });
        }

        return {
          batchId: assigned.id,
          assignedQuantity: assigned.allocatedQuantity,
          assignedAuthorizationKeys: plan.assignedAuthorizationKeys,
          unmatchedStock,
        };
      } catch (error) {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT inventory_auto_assignment`);
        await tx.execute(sql`RELEASE SAVEPOINT inventory_auto_assignment`);
        const retryable =
          error instanceof Error &&
          (AUTOMATIC_ASSIGNMENT_RETRYABLE_ERRORS.has(error.message) ||
            error.name === 'PointAccessDeniedError');
        if (retryable && attempt === 0) continue;
        if (!retryable) throw error;

        const groups = new Map<string, { commercialCode: string; dispensingPointId: string; quantity: number }>();
        for (const source of cappedSources) {
          const key = `${source.commercialCode}\u0000${source.dispensingPointId}`;
          const current = groups.get(key);
          groups.set(key, {
            commercialCode: source.commercialCode,
            dispensingPointId: source.dispensingPointId,
            quantity: (current?.quantity ?? 0) + source.availableQuantity,
          });
        }
        const unmatchedStock = [...groups.values()].map((unmatched) => ({
          ...unmatched,
          reason: 'NO_COMPLETE_AUTHORIZATION' as const,
        }));
        for (const unmatched of unmatchedStock) {
          await this.auditAutomaticUnassigned(tx, scope, trigger, {
            ...unmatched,
          }, {
            reasonDetail: 'CONCURRENT_REVALIDATION_FAILED',
          });
        }
        return { assignedQuantity: 0, assignedAuthorizationKeys: [], unmatchedStock };
      }
    }

    return { assignedQuantity: 0, assignedAuthorizationKeys: [], unmatchedStock: [] };
  }

  private async assignBatchInTx(
    tx: Tx,
    scope: Scope,
    requests: readonly AllocationRequest[],
    source: AllocationBatchSource,
    importBatchId: string | null = null,
    auditDetails: Readonly<Record<string, unknown>> = {},
  ) {
    await this.reconcileIneligibleTx(tx, scope);
    const allowSharedMedicarteAuthorization = source === 'AUTO' && scope.organizationCode === 'MEDICARTE';

    const initiallyResolved: ResolvedAssignment[] = [];
    for (const request of requests) {
      initiallyResolved.push(
        await this.resolveAssignment(tx, scope, request, false, allowSharedMedicarteAuthorization),
      );
    }

    initiallyResolved.sort((left, right) =>
      [left.purchaseOrderId, left.commercialCode, left.dispensingPointId, left.authorizationItemId]
        .join(':')
        .localeCompare(
          [right.purchaseOrderId, right.commercialCode, right.dispensingPointId, right.authorizationItemId].join(':'),
        ),
    );

    const batch = await tx.execute<{ id: string }>(sql`
      INSERT INTO inventory_allocation_batches (
        organization_id, source, import_batch_id, status, total_rows, valid_rows,
        invalid_rows, allocated_quantity, correlation_id, created_by
      )
      VALUES (
        ${scope.organizationId}, ${source}, ${importBatchId}, 'PREPARED',
        ${requests.length}, ${requests.length}, 0, 0, ${scope.correlationId}, ${scope.userId}
      )
      RETURNING id
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
        allowSharedMedicarteAuthorization,
      );
      await this.insertAllocation(tx, scope, batchId, resolved);
      allocatedQuantity += resolved.requestedQuantity;
    }

    await tx.execute(sql`
      UPDATE inventory_allocation_batches
      SET status = 'CONFIRMED', allocated_quantity = ${allocatedQuantity},
          confirmed_by = ${scope.userId}, confirmed_at = NOW(), version = version + 1
      WHERE id = ${batchId}
    `);

    await this.audit(tx, scope, 'INVENTORY_AVAILABILITY_ASSIGNED', batchId, {
      source,
      rows: requests.length,
      allocatedQuantity,
      ...auditDetails,
    });

    return { id: batchId, source, rows: requests.length, allocatedQuantity, status: 'CONFIRMED' as const };
  }

  private async loadAutomaticCandidates(
    tx: Tx,
    scope: Scope,
    commercialCodes: readonly string[],
  ): Promise<AutomaticCandidateRow[]> {
    const codes = sql.join(commercialCodes.map((code) => sql`${code}`), sql`, `);
    const authorizationScope = scope.organizationCode === 'MEDICARTE'
      ? sql`TRUE`
      : sql`EXISTS (
          SELECT 1
          FROM authorization_item_organizations aio
          WHERE aio.authorization_item_id = ai.id
            AND aio.organization_id = ${scope.organizationId}
        )`;
    const result = await tx.execute<AutomaticCandidateRow>(sql`
      WITH candidates AS (
        SELECT
          ai.id,
          ai.authorization_key,
          ai.codigo_medicamento AS commercial_code,
          ai.version AS authorization_version,
          CASE
            WHEN BTRIM(COALESCE(ai.source_data ->> 'CANTIDAD', '')) ~ '^[0-9]+$'
              THEN (ai.source_data ->> 'CANTIDAD')::int
            ELSE 0
          END AS authorized_quantity,
          CASE
            WHEN BTRIM(COALESCE(ai.source_data ->> 'FECHA_FINAL_VIGENCIA', '')) ~ '^[0-9]{8}$'
              THEN CASE
                WHEN SUBSTRING(BTRIM(ai.source_data ->> 'FECHA_FINAL_VIGENCIA') FROM 1 FOR 4)::int BETWEEN 1 AND 9999
                  AND SUBSTRING(BTRIM(ai.source_data ->> 'FECHA_FINAL_VIGENCIA') FROM 5 FOR 2)::int BETWEEN 1 AND 12
                  AND SUBSTRING(BTRIM(ai.source_data ->> 'FECHA_FINAL_VIGENCIA') FROM 7 FOR 2)::int BETWEEN 1 AND 31
                  AND TO_CHAR(TO_DATE(BTRIM(ai.source_data ->> 'FECHA_FINAL_VIGENCIA'), 'YYYYMMDD'), 'YYYYMMDD') = BTRIM(ai.source_data ->> 'FECHA_FINAL_VIGENCIA')
                  THEN TO_DATE(BTRIM(ai.source_data ->> 'FECHA_FINAL_VIGENCIA'), 'YYYYMMDD')
                ELSE NULL
              END
            WHEN BTRIM(COALESCE(ai.source_data ->> 'FECHA_FINAL_VIGENCIA', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              THEN CASE
                WHEN SUBSTRING(BTRIM(ai.source_data ->> 'FECHA_FINAL_VIGENCIA') FROM 1 FOR 4)::int BETWEEN 1 AND 9999
                  AND SUBSTRING(BTRIM(ai.source_data ->> 'FECHA_FINAL_VIGENCIA') FROM 6 FOR 2)::int BETWEEN 1 AND 12
                  AND SUBSTRING(BTRIM(ai.source_data ->> 'FECHA_FINAL_VIGENCIA') FROM 9 FOR 2)::int BETWEEN 1 AND 31
                  AND TO_CHAR(TO_DATE(BTRIM(ai.source_data ->> 'FECHA_FINAL_VIGENCIA'), 'YYYY-MM-DD'), 'YYYY-MM-DD') = BTRIM(ai.source_data ->> 'FECHA_FINAL_VIGENCIA')
                  THEN TO_DATE(BTRIM(ai.source_data ->> 'FECHA_FINAL_VIGENCIA'), 'YYYY-MM-DD')
                ELSE NULL
              END
            ELSE NULL
          END AS validity_end_date
        FROM authorization_items ai
        WHERE ai.codigo_medicamento IN (${codes})
          AND ai.source_status_normalized = '5'
          AND ai.enablement_status = 'ENABLED'
          AND ai.annulled_at IS NULL
          AND NOT (
            COALESCE(
              ai.source_data -> ${AUTHORIZATION_ANNULMENT_EVIDENCE_KEY},
              'null'::jsonb
            ) NOT IN ('null'::jsonb, 'false'::jsonb, '""'::jsonb, '0'::jsonb)
          )
          AND (
            (ai.coverage_type = 'PBS' AND ai.direction_status = 'NOT_APPLICABLE')
            OR (ai.coverage_type = 'NO_PBS' AND ai.mipres_manual_decision = 'MANUALLY_ENABLED')
          )
          AND ${authorizationScope}
          AND NOT EXISTS (
            SELECT 1
            FROM patient_applications pa
            WHERE pa.authorization_item_id = ai.id
              AND pa.status = 'CONFIRMED'
          )
      ),
      authorization_progress AS (
        SELECT
          candidate.id,
          GREATEST(
            COALESCE((
              SELECT SUM(GREATEST(allocated_quantity - released_quantity, 0))
              FROM inventory_authorization_allocations
              WHERE authorization_item_id = candidate.id
                AND status IN ('ALLOCATED', 'PARTIALLY_CONSUMED', 'CONSUMED')
            ), 0),
            COALESCE((
              SELECT SUM(quantity)
              FROM authorization_fulfillments
              WHERE authorization_item_id = candidate.id
            ), 0)
          )::int AS allocated_quantity
        FROM candidates candidate
      )
      SELECT
        candidate.id,
        candidate.authorization_key,
        candidate.commercial_code,
        candidate.validity_end_date::text AS validity_end_date,
        GREATEST(candidate.authorized_quantity - progress.allocated_quantity, 0)::int AS pending_quantity
      FROM candidates candidate
      JOIN authorization_progress progress ON progress.id = candidate.id
      WHERE candidate.validity_end_date >= (NOW() AT TIME ZONE 'America/Bogota')::date
        AND candidate.authorized_quantity > progress.allocated_quantity
      ORDER BY candidate.validity_end_date ASC, candidate.authorization_key ASC
    `);

    return result.rows;
  }

  private async loadAutomaticAvailabilitySources(
    tx: Tx,
    scope: Scope,
    commercialCodes: readonly string[],
    dispensingPointIds?: readonly string[],
  ): Promise<AutomaticAvailabilitySourceRow[]> {
    if (dispensingPointIds && dispensingPointIds.length === 0) return [];

    const codes = sql.join(commercialCodes.map((code) => sql`${code}`), sql`, `);
    const points = dispensingPointIds
      ? sql`AND dp.id IN (${sql.join(
          [...new Set(dispensingPointIds)].map((pointId) => sql`${pointId}::uuid`),
          sql`, `,
        )})`
      : sql``;
    const pointScope = applyPointScope(sql`dp.id`, scope);
    const result = await tx.execute<{
      purchase_order_code: string;
      purchase_order_id: string;
      commercial_code: string;
      dispensing_point_id: string;
      available_quantity: number;
      expiration_date: string | null;
      received_at: string | Date | null;
      source_kind: 'DIRECT' | 'LEDGER';
    }>(sql`
      WITH direct_receipts AS (
        SELECT
          po.id AS purchase_order_id,
          po.purchase_order_code,
          pol.commercial_code,
          COALESCE(pol.dispensing_point_id, mapping.dispensing_point_id) AS dispensing_point_id,
          SUM(porl.received_quantity)::int AS received_quantity,
          MIN(porl.expiration_date)::text AS expiration_date,
          MIN(por.received_at)::text AS received_at,
          'DIRECT'::varchar AS source_kind
        FROM purchase_order_receipt_lines porl
        JOIN purchase_order_receipts por ON por.id = porl.receipt_id
        JOIN purchase_order_lines pol ON pol.id = porl.purchase_order_line_id
        JOIN purchase_orders po ON po.id = por.purchase_order_id
        LEFT JOIN LATERAL (
          SELECT (ARRAY_AGG(DISTINCT m.dispensing_point_id))[1] AS dispensing_point_id
          FROM tariff_annex_products tap
          JOIN product_delivery_point_mappings m
            ON m.invima_record_normalized =
               COALESCE(NULLIF(LTRIM(BTRIM(tap.numero_expediente_invima), '0'), ''), '0')
           AND m.invima_presentation_normalized =
               COALESCE(NULLIF(LTRIM(BTRIM(tap.consecutivo_invima_presentacion), '0'), ''), '0')
          WHERE tap.codigo_producto = pol.commercial_code
            AND tap.active = TRUE
            AND BTRIM(COALESCE(tap.numero_expediente_invima, '')) ~ '^[0-9]+$'
            AND BTRIM(COALESCE(tap.consecutivo_invima_presentacion, '')) ~ '^[0-9]+$'
          HAVING COUNT(DISTINCT m.dispensing_point_id) = 1
        ) mapping ON pol.dispensing_point_id IS NULL
        WHERE po.status NOT IN ('CANCELLED', 'REJECTED')
          AND po.purchase_order_code IS NOT NULL
          AND pol.commercial_code IN (${codes})
          AND por.confirmed_at IS NOT NULL
          AND porl.received_quantity > 0
          AND (porl.expiration_date IS NULL OR porl.expiration_date >= (NOW() AT TIME ZONE 'America/Bogota')::date)
          AND COALESCE(pol.dispensing_point_id, mapping.dispensing_point_id) IS NOT NULL
        GROUP BY po.id, po.purchase_order_code, pol.commercial_code,
                 COALESCE(pol.dispensing_point_id, mapping.dispensing_point_id)
      ),
      ledger_receipts AS (
        SELECT
          d.purchase_order_id,
          po.purchase_order_code,
          dl.commercial_code,
          il.dispensing_point_id,
          SUM(im.quantity_delta)::int AS received_quantity,
          MIN(il.expiration_date)::text AS expiration_date,
          MIN(r.received_at)::text AS received_at,
          'LEDGER'::varchar AS source_kind
        FROM inventory_movements im
        JOIN inventory_lots il ON il.id = im.inventory_lot_id
        JOIN receipt_lines rl ON rl.id = im.source_id
        JOIN receipts r ON r.id = rl.receipt_id AND r.status = 'CONFIRMED'
        JOIN delivery_lines dl ON dl.id = rl.delivery_line_id
        JOIN deliveries d ON d.id = dl.delivery_id
        JOIN purchase_orders po ON po.id = d.purchase_order_id
        WHERE po.status NOT IN ('CANCELLED', 'REJECTED')
          AND po.purchase_order_code IS NOT NULL
          AND dl.commercial_code IN (${codes})
          AND im.movement_type = 'RECEIPT'
          AND im.source_type = 'RECEIPT_LINE'
          AND im.quantity_delta > 0
          AND il.expiration_date >= (NOW() AT TIME ZONE 'America/Bogota')::date
          AND NOT EXISTS (
            SELECT 1
            FROM purchase_order_receipt_lines direct_porl
            JOIN purchase_order_receipts direct_por ON direct_por.id = direct_porl.receipt_id
            JOIN purchase_order_lines direct_pol ON direct_pol.id = direct_porl.purchase_order_line_id
            WHERE direct_por.purchase_order_id = d.purchase_order_id
              AND direct_pol.commercial_code = dl.commercial_code
              AND direct_por.confirmed_at IS NOT NULL
              AND direct_porl.received_quantity > 0
          )
        GROUP BY d.purchase_order_id, po.purchase_order_code, dl.commercial_code, il.dispensing_point_id
      ),
      receipt_sources AS (
        SELECT * FROM direct_receipts
        UNION ALL
        SELECT * FROM ledger_receipts
      ),
      global_balances AS (
        SELECT
          source.purchase_order_id,
          source.commercial_code,
          GREATEST(
            SUM(source.received_quantity)
              - COALESCE((
                  SELECT SUM(fulfillment.quantity)
                  FROM authorization_fulfillment_lines fulfillment
                  WHERE fulfillment.purchase_order_id = source.purchase_order_id
                    AND fulfillment.commercial_code = source.commercial_code
                ), 0)
              - COALESCE((
                  SELECT SUM(GREATEST(allocation.allocated_quantity - allocation.consumed_quantity - allocation.released_quantity, 0))
                  FROM inventory_authorization_allocations allocation
                  WHERE allocation.purchase_order_id = source.purchase_order_id
                    AND allocation.commercial_code = source.commercial_code
                    AND allocation.status IN ('ALLOCATED', 'PARTIALLY_CONSUMED')
                ), 0),
            0
          )::int AS global_available_quantity
        FROM receipt_sources source
        GROUP BY source.purchase_order_id, source.commercial_code
      ),
      source_balances AS (
        SELECT
          source.*,
          GREATEST(
            source.received_quantity
              - COALESCE((
                  SELECT SUM(fulfillment.quantity)
                  FROM authorization_fulfillment_lines fulfillment
                  WHERE fulfillment.purchase_order_id = source.purchase_order_id
                    AND fulfillment.commercial_code = source.commercial_code
                    AND fulfillment.dispensing_point_id = source.dispensing_point_id
                ), 0)
              - COALESCE((
                  SELECT SUM(GREATEST(allocation.allocated_quantity - allocation.consumed_quantity - allocation.released_quantity, 0))
                  FROM inventory_authorization_allocations allocation
                  WHERE allocation.purchase_order_id = source.purchase_order_id
                    AND allocation.commercial_code = source.commercial_code
                    AND allocation.dispensing_point_id = source.dispensing_point_id
                    AND allocation.status IN ('ALLOCATED', 'PARTIALLY_CONSUMED')
                ), 0),
            0
          )::int AS point_available_quantity,
          global.global_available_quantity,
          CASE WHEN source.source_kind = 'LEDGER' THEN GREATEST(
            COALESCE((
              SELECT SUM(usable.usable_balance)
              FROM inventory_usable_lots usable
              WHERE usable.commercial_code = source.commercial_code
                AND usable.dispensing_point_id = source.dispensing_point_id
            ), 0)
              - COALESCE((
                  SELECT SUM(GREATEST(allocation.allocated_quantity - allocation.consumed_quantity - allocation.released_quantity, 0))
                  FROM inventory_authorization_allocations allocation
                  WHERE allocation.commercial_code = source.commercial_code
                    AND allocation.dispensing_point_id = source.dispensing_point_id
                    AND allocation.status IN ('ALLOCATED', 'PARTIALLY_CONSUMED')
                ), 0),
            0
          )::int ELSE NULL END AS legacy_physical_available_quantity
        FROM receipt_sources source
        JOIN global_balances global
          ON global.purchase_order_id = source.purchase_order_id
         AND global.commercial_code = source.commercial_code
      ),
      physical_caps AS (
        SELECT
          source_balances.*,
          CASE WHEN source_kind = 'LEDGER' THEN LEAST(
            point_available_quantity,
            GREATEST(
              legacy_physical_available_quantity
                - COALESCE(SUM(point_available_quantity) FILTER (WHERE source_kind = 'LEDGER') OVER (
                    PARTITION BY commercial_code, dispensing_point_id
                    ORDER BY expiration_date ASC NULLS LAST, received_at ASC,
                             purchase_order_code ASC, purchase_order_id ASC
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                  ), 0),
              0
            )
          ) ELSE point_available_quantity END AS physical_point_available_quantity
        FROM source_balances
      ),
      globally_capped AS (
        SELECT
          physical_caps.*,
          LEAST(
            physical_point_available_quantity,
            GREATEST(
              global_available_quantity
                - COALESCE(SUM(physical_point_available_quantity) OVER (
                    PARTITION BY purchase_order_id, commercial_code
                    ORDER BY expiration_date ASC NULLS LAST, received_at ASC,
                             purchase_order_code ASC, dispensing_point_id ASC
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                  ), 0),
              0
            )
          )::int AS available_quantity
        FROM physical_caps
      )
      SELECT
        capped.purchase_order_code,
        capped.purchase_order_id,
        capped.commercial_code,
        capped.dispensing_point_id,
        capped.available_quantity,
        capped.expiration_date,
        capped.received_at,
        capped.source_kind
      FROM globally_capped capped
      JOIN dispensing_points dp ON dp.id = capped.dispensing_point_id
      JOIN organizations point_organization ON point_organization.id = dp.organization_id
      WHERE capped.available_quantity > 0
        AND dp.active = TRUE
        AND point_organization.code = 'MEDICARTE'
        AND ${pointScope}
        ${points}
      ORDER BY capped.expiration_date ASC NULLS LAST, capped.received_at ASC,
               capped.purchase_order_code ASC, capped.dispensing_point_id ASC
    `);

    return result.rows.map((row) => ({
      purchaseOrderCode: row.purchase_order_code,
      purchaseOrderId: row.purchase_order_id,
      commercialCode: row.commercial_code,
      dispensingPointId: row.dispensing_point_id,
      availableQuantity: Number(row.available_quantity),
      expirationDate: row.expiration_date,
      receivedAt: row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at,
      sourceKind: row.source_kind,
    }));
  }

  private async resolveAuthorizationDispensingPoint(
    tx: Tx,
    authorizationItemId: string,
    commercialCode: string,
  ): Promise<string> {
    const scheduled = await tx.execute<{ dispensing_point_id: string }>(sql`
      SELECT DISTINCT ps.dispensing_point_id
      FROM patient_schedules ps
      WHERE ps.authorization_item_id = ${authorizationItemId}
        AND ps.status IN ('SCHEDULED', 'RESCHEDULED')
      LIMIT 2
    `);
    if (scheduled.rows.length > 1) throw new Error('INVENTORY_ALLOCATION_SCHEDULE_POINT_AMBIGUOUS');
    let dispensingPointId = scheduled.rows[0]?.dispensing_point_id;

    if (!dispensingPointId) {
      const defaults = await tx.execute<{ dispensing_point_id: string }>(sql`
        SELECT DISTINCT pdp.dispensing_point_id
        FROM authorization_items ai
        JOIN patient_default_dispensing_points pdp
          ON pdp.patient_document = COALESCE(
            NULLIF(BTRIM(ai.source_data ->> 'IDENTIFICACION_PACIENTE'), ''),
            NULLIF(BTRIM(ai.source_data ->> 'NUM_DOCUMENTO'), '')
          )
         AND pdp.active = TRUE
        WHERE ai.id = ${authorizationItemId}
        LIMIT 2
      `);
      if (defaults.rows.length > 1) throw new Error('INVENTORY_ALLOCATION_PATIENT_POINT_AMBIGUOUS');
      dispensingPointId = defaults.rows[0]?.dispensing_point_id;
    }

    if (!dispensingPointId) {
      const mappings = await tx.execute<{ dispensing_point_id: string }>(sql`
        SELECT DISTINCT mapping.dispensing_point_id
        FROM tariff_annex_products tap
        JOIN product_delivery_point_mappings mapping
          ON mapping.invima_record_normalized =
             COALESCE(NULLIF(LTRIM(BTRIM(tap.numero_expediente_invima), '0'), ''), '0')
         AND mapping.invima_presentation_normalized =
             COALESCE(NULLIF(LTRIM(BTRIM(tap.consecutivo_invima_presentacion), '0'), ''), '0')
        WHERE tap.codigo_producto = ${commercialCode}
          AND tap.active = TRUE
          AND BTRIM(COALESCE(tap.numero_expediente_invima, '')) ~ '^[0-9]+$'
          AND BTRIM(COALESCE(tap.consecutivo_invima_presentacion, '')) ~ '^[0-9]+$'
        LIMIT 2
      `);
      if (mappings.rows.length > 1) throw new Error('INVENTORY_ALLOCATION_PRODUCT_POINT_AMBIGUOUS');
      dispensingPointId = mappings.rows[0]?.dispensing_point_id;
    }

    if (!dispensingPointId) throw new Error('INVENTORY_ALLOCATION_POINT_REQUIRED');

    const point = await tx.execute<{ active: boolean; organization_code: string }>(sql`
      SELECT dp.active, organization.code AS organization_code
      FROM dispensing_points dp
      JOIN organizations organization ON organization.id = dp.organization_id
      WHERE dp.id = ${dispensingPointId}
    `);
    if (point.rows[0]?.active !== true) throw new Error('INVENTORY_ALLOCATION_POINT_INACTIVE');
    if (point.rows[0]?.organization_code !== 'MEDICARTE') {
      throw new Error('INVENTORY_ALLOCATION_POINT_OUT_OF_SCOPE');
    }
    return dispensingPointId;
  }

  private async auditAutomaticUnassigned(
    tx: Tx,
    scope: Scope,
    trigger: AutomaticAssignmentTrigger,
    unmatched: Readonly<{
      commercialCode: string;
      dispensingPointId: string;
      quantity: number;
      reason: string;
    }>,
    details: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO audit_events (
        actor_type, actor_id, organization_id, action, resource_type, resource_id,
        after, correlation_id, request_id, result
      )
      VALUES (
        'USER', ${scope.userId}, ${scope.organizationId},
        'INVENTORY_AVAILABILITY_AUTO_SKIPPED', 'inventory_availability_auto',
        gen_random_uuid()::text,
        ${JSON.stringify({ trigger, ...unmatched, ...details })}::jsonb,
        ${scope.correlationId}, ${scope.correlationId}, 'SUCCESS'
      )
    `);
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
    allowSharedMedicarteAuthorization = false,
  ): Promise<ResolvedAssignment> {
    if (request.quantity <= 0) {
      throw new Error('INVENTORY_ALLOCATION_QUANTITY_INVALID');
    }

    const authorizationSql = lock ? sql`FOR UPDATE` : sql``;
    const authorizationScope = allowSharedMedicarteAuthorization && scope.organizationCode === 'MEDICARTE'
      ? sql`TRUE`
      : sql`EXISTS (
          SELECT 1
          FROM authorization_item_organizations aio
          WHERE aio.authorization_item_id = ai.id
            AND aio.organization_id = ${scope.organizationId}
        )`;

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

          AND ai.annulled_at IS NULL

          AND NOT (
            COALESCE(
              ai.source_data -> ${AUTHORIZATION_ANNULMENT_EVIDENCE_KEY},
              'null'::jsonb
            ) NOT IN ('null'::jsonb, 'false'::jsonb, '""'::jsonb, '0'::jsonb)
          )

          AND ai.source_status_normalized =
              '5'

          AND ai.enablement_status =
              'ENABLED'

          AND (
            (
              ai.coverage_type =
                'PBS'

              AND ai.direction_status =
                'NOT_APPLICABLE'
            )

            OR

            (
              ai.coverage_type =
                'NO_PBS'

              AND ai.mipres_manual_decision =
                'MANUALLY_ENABLED'
            )
          )

          AND ${authorizationScope}

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
    const dispensingPointId = await this.resolveAuthorizationDispensingPoint(
      tx,
      auth.id,
      auth.commercial_code,
    );

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
      await lockActivePointGrants(tx, scope, [dispensingPointId]);

      // GLOBAL primero: mismo lock que importador de OC existente.
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(
          ${`OC_PRODUCT_ALLOCATION:${order.id}:${auth.commercial_code}`}, 0::bigint
        ))
      `);
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(
          ${[order.id, auth.commercial_code, dispensingPointId].join(':')}, 0::bigint
        ))
      `);
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(
          ${`OC_AUTO_ALLOCATION:${order.id}:${auth.commercial_code}:${dispensingPointId}`}, 0::bigint
        ))
      `);
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(
          ${`INVENTORY_PHYSICAL:${auth.commercial_code}:${dispensingPointId}`}, 0::bigint
        ))
      `);
    }

    /*
     * Una entrega histórica puede existir sin allocation vigente. No
     * reservar nuevamente unidades ya atendidas de esa AUTO.
     */
    const authorizationAllocated = await tx.execute<{
      quantity: number;
    }>(sql`
      SELECT GREATEST(
        COALESCE((
          SELECT SUM(GREATEST(allocated_quantity - released_quantity, 0))
          FROM inventory_authorization_allocations
          WHERE authorization_item_id = ${auth.id}
            AND status IN ('ALLOCATED', 'PARTIALLY_CONSUMED', 'CONSUMED')
        ), 0),
        COALESCE((
          SELECT SUM(quantity)
          FROM authorization_fulfillments
          WHERE authorization_item_id = ${auth.id}
        ), 0)
      )::int AS quantity
    `);

    const authorizationPending = Math.max(
      auth.authorized_quantity - (authorizationAllocated.rows[0]?.quantity ?? 0),
      0,
    );

    if (request.quantity > authorizationPending) {
      throw new Error('INVENTORY_ALLOCATION_EXCEEDS_AUTHORIZATION_PENDING');
    }

    /*
     * Fuente canónica: recepción moderna quantity-only + movimientos
     * históricos RECEIPT (sin duplicar aplicaciones ni crear lotes).
     * El límite global incluye TODAS las sedes de la misma OC/producto.
     */
    const availability = await tx.execute<{
      point_available_quantity: number;
      global_available_quantity: number;
      has_direct_receipt: boolean;
    }>(sql`
      WITH receipt_events AS (
        SELECT por.purchase_order_id,
               pol.commercial_code,
               COALESCE(pol.dispensing_point_id, mapping.dispensing_point_id)
                 AS dispensing_point_id,
               SUM(porl.received_quantity)::int AS quantity
        FROM purchase_order_receipt_lines porl
        JOIN purchase_order_receipts por ON por.id = porl.receipt_id
        JOIN purchase_order_lines pol ON pol.id = porl.purchase_order_line_id
        LEFT JOIN LATERAL (
          SELECT (ARRAY_AGG(DISTINCT m.dispensing_point_id))[1] AS dispensing_point_id
          FROM tariff_annex_products tap
          JOIN product_delivery_point_mappings m
            ON m.invima_record_normalized =
               COALESCE(NULLIF(LTRIM(BTRIM(tap.numero_expediente_invima), '0'), ''), '0')
           AND m.invima_presentation_normalized =
               COALESCE(NULLIF(LTRIM(BTRIM(tap.consecutivo_invima_presentacion), '0'), ''), '0')
          WHERE tap.codigo_producto = pol.commercial_code
            AND tap.active = true
            AND BTRIM(COALESCE(tap.numero_expediente_invima, '')) ~ '^[0-9]+$'
            AND BTRIM(COALESCE(tap.consecutivo_invima_presentacion, '')) ~ '^[0-9]+$'
          HAVING COUNT(DISTINCT m.dispensing_point_id) = 1
        ) mapping ON pol.dispensing_point_id IS NULL
        WHERE por.purchase_order_id = ${order.id}
          AND pol.commercial_code = ${auth.commercial_code}
          AND porl.received_quantity > 0
        GROUP BY por.purchase_order_id, pol.commercial_code,
                 COALESCE(pol.dispensing_point_id, mapping.dispensing_point_id)

        UNION ALL

        SELECT d.purchase_order_id, dl.commercial_code,
               il.dispensing_point_id, SUM(im.quantity_delta)::int
        FROM inventory_movements im
        JOIN inventory_lots il ON il.id = im.inventory_lot_id
        JOIN receipt_lines rl ON rl.id = im.source_id
        JOIN delivery_lines dl ON dl.id = rl.delivery_line_id
        JOIN deliveries d ON d.id = dl.delivery_id
        WHERE d.purchase_order_id = ${order.id}
          AND dl.commercial_code = ${auth.commercial_code}
          AND im.movement_type = 'RECEIPT'
          AND im.source_type = 'RECEIPT_LINE'
          AND NOT EXISTS (
            select 1 from purchase_order_receipt_lines direct_porl
            join purchase_order_receipts direct_por
              on direct_por.id = direct_porl.receipt_id
            join purchase_order_lines direct_pol
              on direct_pol.id = direct_porl.purchase_order_line_id
            where direct_por.purchase_order_id = d.purchase_order_id
              and direct_pol.commercial_code = dl.commercial_code
              and direct_porl.received_quantity > 0
          )

          AND im.quantity_delta > 0
          AND il.expiration_date >= (NOW() AT TIME ZONE 'America/Bogota')::date
        GROUP BY d.purchase_order_id, dl.commercial_code, il.dispensing_point_id
      ),
      receipts AS (
        SELECT COALESCE(SUM(quantity) FILTER
                 (WHERE dispensing_point_id = ${dispensingPointId}), 0)::int AS at_point,
               COALESCE(SUM(quantity), 0)::int AS total
        FROM receipt_events
      ),
      fulfillments AS (
        SELECT COALESCE(SUM(quantity) FILTER
                 (WHERE dispensing_point_id = ${dispensingPointId}), 0)::int AS at_point,
               COALESCE(SUM(quantity), 0)::int AS total
        FROM authorization_fulfillment_lines
        WHERE purchase_order_id = ${order.id}
          AND commercial_code = ${auth.commercial_code}
      ),
      reservations AS (
        SELECT COALESCE(SUM(GREATEST(allocated_quantity - consumed_quantity - released_quantity, 0))
                 FILTER (WHERE dispensing_point_id = ${dispensingPointId}), 0)::int AS at_point,
               COALESCE(SUM(GREATEST(allocated_quantity - consumed_quantity - released_quantity, 0)), 0)::int AS total
        FROM inventory_authorization_allocations
        WHERE purchase_order_id = ${order.id}
          AND commercial_code = ${auth.commercial_code}
          AND status IN ('ALLOCATED', 'PARTIALLY_CONSUMED')
      )
      SELECT GREATEST(receipts.at_point - fulfillments.at_point - reservations.at_point, 0)::int
               AS point_available_quantity,
             GREATEST(receipts.total - fulfillments.total - reservations.total, 0)::int
               AS global_available_quantity,
             EXISTS (
               SELECT 1 FROM purchase_order_receipt_lines porl
               JOIN purchase_order_receipts por ON por.id = porl.receipt_id
               JOIN purchase_order_lines pol ON pol.id = porl.purchase_order_line_id
               WHERE por.purchase_order_id = ${order.id}
                 AND pol.commercial_code = ${auth.commercial_code}
                 AND porl.received_quantity > 0
             ) AS has_direct_receipt
      FROM receipts, fulfillments, reservations
    `);

    let pointAvailable = Number(availability.rows[0]?.point_available_quantity ?? 0);
    if (!availability.rows[0]?.has_direct_receipt) {
      /* Ledger histórico: respetar balance físico FEFO actualizado. */
      const physical = await tx.execute<{ physical_available_quantity: number }>(sql`
        SELECT GREATEST(
          COALESCE((
            SELECT SUM(usable_balance) FROM inventory_usable_lots
            WHERE commercial_code = ${auth.commercial_code}
              AND dispensing_point_id = ${dispensingPointId}
          ), 0)
          - COALESCE((
            SELECT SUM(GREATEST(allocated_quantity - consumed_quantity - released_quantity, 0))
            FROM inventory_authorization_allocations
            WHERE commercial_code = ${auth.commercial_code}
              AND dispensing_point_id = ${dispensingPointId}
              AND status IN ('ALLOCATED', 'PARTIALLY_CONSUMED')
          ), 0), 0
        )::int AS physical_available_quantity
      `);
      pointAvailable = Math.min(
        pointAvailable,
        Number(physical.rows[0]?.physical_available_quantity ?? 0),
      );
    }
    const purchaseOrderAvailable = Math.min(
      pointAvailable,
      Number(availability.rows[0]?.global_available_quantity ?? 0),
    );

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

  private reconcileIneligibleTx(
    tx: Tx,
    scope: Scope,
  ): Promise<number> {
    /*
     * Hook transaccional conservado intencionalmente.
     *
     * La política actual de retención no ejecuta
     * ninguna escritura durante la reconciliación.
     */
    void tx;
    void scope;

    /*
     * RESERVATION RETENTION POLICY
     * ============================
     *
     * Una reserva ya materializada permanece
     * asociada a su AUTO hasta:
     *
     * 1. consumo real por entrega/aplicación; o
     * 2. reasignación explícita y atómica.
     *
     * NO liberan una reserva:
     *
     * - vencimiento;
     * - cambio de source_status;
     * - cambio de enablement_status;
     * - cancelación/rechazo administrativo de OC;
     * - patient_application CONFIRMED.
     *
     * patient_application CONFIRMED consume
     * allocations en PatientApplicationRepository.
     *
     * Este reconciliador no modifica inventario.
     */
    return Promise.resolve(0);
  }

  private errorMessage(code: string) {
    const messages: Record<string, string> = {
      INVENTORY_ALLOCATION_AUTHORIZATION_NOT_FOUND:
        'La clave de autorización no existe, no está vigente o ya fue aplicada.',

      INVENTORY_ALLOCATION_AUTHORIZATION_AMBIGUOUS:
        'La clave de autorización no identifica un único registro.',

      INVENTORY_ALLOCATION_POINT_REQUIRED: 'La autorización no tiene un punto de dispensación resoluble.',
      INVENTORY_ALLOCATION_POINT_INACTIVE: 'El punto de dispensación no existe o está inactivo.',
      INVENTORY_ALLOCATION_POINT_OUT_OF_SCOPE: 'El punto de dispensación no pertenece a la organización activa.',
      INVENTORY_ALLOCATION_SCHEDULE_POINT_AMBIGUOUS: 'La autorización tiene programaciones activas en varios puntos.',
      INVENTORY_ALLOCATION_PATIENT_POINT_AMBIGUOUS: 'El paciente tiene múltiples puntos habituales activos.',
      INVENTORY_ALLOCATION_PRODUCT_POINT_AMBIGUOUS: 'El producto tiene varios puntos posibles.',

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

    await tx.execute(
      realtimeInvalidationSql({
        organizationCodes: REALTIME_AUDIENCE.INVENTORY,
        topics: ['INVENTORY', 'AUTHORIZATIONS', 'DASHBOARD'],
        correlationId: scope.correlationId,
      }),
    );
  }
}
