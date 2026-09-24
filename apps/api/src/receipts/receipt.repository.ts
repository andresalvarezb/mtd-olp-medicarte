import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import {
  derivePurchaseOrderReceiptStatus,
  deriveReceiptConformity,
  validateReceiptQuantities,
} from '@authorization/domain';
import type { Scope } from '../common/request-scope';
import { applyPointScope, lockActivePointGrants } from '../common/point-scope.sql';
import { DATABASE } from '../tokens';
import type {
  PurchaseOrderDirectReceiptRequest,
  ReceiptLineRequest,
  UpdateReceiptRequest,
} from '@authorization/contracts';
import { InventoryRepository } from '../inventory/inventory.repository';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
export type ReceiptOutcome =
  | { outcome: 'not_found' }
  | { outcome: 'version_conflict'; currentVersion: number };
type ReceiptViewRow = {
  id: string;
  delivery_id: string;
  status: string;
  conformity: string | null;
  received_at: string;
  confirmed_at: string | null;
  version: number;
  created_by: string;
  updated_by: string;
  line_id: string;
  delivery_line_id: string;
  dispatched_quantity: number;
  received_quantity: number;
  accepted_quantity: number;
  rejected_quantity: number;
  shortage_quantity: number;
  expected_lot_number: string;
  expected_expiration_date: string;
  received_lot_number: string | null;
  received_expiration_date: string | null;
  line_conformity: string | null;
  nonconformity_reason: string | null;
  observation: string | null;
};

@Injectable()
export class ReceiptRepository {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly inventory: InventoryRepository,
  ) {}

  async create(deliveryId: string, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      const delivery = await tx.execute<{ purchase_order_id: string; status: string }>(
        sql`select d.purchase_order_id,d.status from deliveries d where d.id=${deliveryId} for update`,
      );
      if (!delivery.rows[0]) throw new Error('RECEIPT_DELIVERY_NOT_FOUND');
      await this.lockDeliveryPoints(tx, deliveryId, scope);
      if (delivery.rows[0].status !== 'DISPATCHED')
        throw new Error('RECEIPT_DELIVERY_NOT_DISPATCHED');
      const found = await tx.execute<{ id: string }>(
        sql`select id from receipts where delivery_id=${deliveryId} and status='DRAFT' limit 1`,
      );
      const id =
        found.rows[0]?.id ??
        (
          await tx.execute<{ id: string }>(
            sql`insert into receipts (delivery_id,created_by,updated_by) values (${deliveryId},${scope.userId},${scope.userId}) returning id`,
          )
        ).rows[0]!.id;
      if (!found.rows[0]) {
        await tx.execute(
          sql`
            insert into receipt_lines (
              receipt_id,
              delivery_line_id,
              dispatched_quantity,
              received_quantity,
              accepted_quantity,
              rejected_quantity,
              shortage_quantity,
              expected_lot_number,
              expected_expiration_date
            )

            select
              ${id},
              dl.id,

              greatest(
                dl.quantity -
                coalesce(
                  (
                    select
                      sum(previous_rl.received_quantity)

                    from receipt_lines previous_rl

                    join receipts previous_r
                      on previous_r.id =
                         previous_rl.receipt_id

                    where
                      previous_rl.delivery_line_id =
                        dl.id

                      and previous_r.status =
                        'CONFIRMED'
                  ),
                  0
                ),
                0
              )::int,

              0,
              0,
              0,

              greatest(
                dl.quantity -
                coalesce(
                  (
                    select
                      sum(previous_rl.received_quantity)

                    from receipt_lines previous_rl

                    join receipts previous_r
                      on previous_r.id =
                         previous_rl.receipt_id

                    where
                      previous_rl.delivery_line_id =
                        dl.id

                      and previous_r.status =
                        'CONFIRMED'
                  ),
                  0
                ),
                0
              )::int,

              dl.lot_number,
              dl.expiration_date

            from delivery_lines dl

            where dl.delivery_id =
              ${deliveryId}
          `,
        );
        await this.audit(tx, scope, 'RECEIPT_CREATED', id, { deliveryId });
      }
      return this.findOn(tx, id, scope);
    });
  }

  async update(
    id: string,
    body: UpdateReceiptRequest,
    scope: Scope,
  ): Promise<ReceiptOutcome | object | null> {
    return this.database.db.transaction(async (tx) => {
      const receipt = await tx.execute<{ delivery_id: string; status: string; version: number }>(
        sql`select delivery_id,status,version from receipts where id=${id} for update`,
      );
      const row = receipt.rows[0];
      if (!row) return { outcome: 'not_found' };
      if (row.version !== body.expectedVersion)
        return { outcome: 'version_conflict', currentVersion: row.version };
      if (row.status !== 'DRAFT') throw new Error('RECEIPT_FROZEN');
      await this.lockDeliveryPoints(tx, row.delivery_id, scope);
      await this.replaceLines(tx, id, row.delivery_id, body.lines, scope);
      await tx.execute(
        sql`update receipts set received_at=coalesce(${body.receivedAt ?? null}::timestamptz,received_at),version=version+1,updated_at=now(),updated_by=${scope.userId} where id=${id}`,
      );
      await this.audit(tx, scope, 'RECEIPT_UPDATED', id, { lineCount: body.lines.length });
      return this.findOn(tx, id, scope);
    });
  }

  async confirm(
    id: string,
    expectedVersion: number,
    scope: Scope,
  ): Promise<ReceiptOutcome | object | null> {
    return this.database.db.transaction(async (tx) => {
      const receipt = await tx.execute<{
        delivery_id: string;
        status: string;
        version: number;
        received_date: string;
      }>(
        sql`select delivery_id,status,version,received_at::date received_date from receipts where id=${id} for update`,
      );
      const row = receipt.rows[0];
      if (!row) return { outcome: 'not_found' };
      if (row.version !== expectedVersion)
        return { outcome: 'version_conflict', currentVersion: row.version };
      if (row.status !== 'DRAFT') throw new Error('RECEIPT_FROZEN');
      await this.lockDeliveryPoints(tx, row.delivery_id, scope);
      const delivery = await tx.execute<{ purchase_order_id: string; status: string }>(
        sql`select purchase_order_id,status from deliveries where id=${row.delivery_id} for update`,
      );
      if (!delivery.rows[0]) throw new Error('RECEIPT_DELIVERY_NOT_FOUND');
      if (delivery.rows[0].status !== 'DISPATCHED')
        throw new Error('RECEIPT_DELIVERY_NOT_DISPATCHED');
      const lines = await tx.execute<{
        id: string;
        delivery_line_id: string;
        dispatched_quantity: number;
        received_quantity: number;
        accepted_quantity: number;
        rejected_quantity: number;
        expected_lot_number: string;
        expected_expiration_date: string;
        received_lot_number: string | null;
        received_expiration_date: string | null;
        nonconformity_reason: string | null;
      }>(
        sql`select id,delivery_line_id,dispatched_quantity,received_quantity,accepted_quantity,rejected_quantity,expected_lot_number,expected_expiration_date::text expected_expiration_date,received_lot_number,received_expiration_date::text received_expiration_date,nonconformity_reason from receipt_lines where receipt_id=${id} for update`,
      );
      if (!lines.rows.length) throw new Error('RECEIPT_LINES_REQUIRED');
      const deliveryLines = await tx.execute<{ count: number }>(
        sql`select count(*)::int count from delivery_lines where delivery_id=${row.delivery_id}`,
      );
      if (lines.rows.length !== (deliveryLines.rows[0]?.count ?? 0))
        throw new Error('RECEIPT_LINES_REQUIRED');
      const cumulative =
        await tx.execute<{
          delivery_line_id: string;
          dispatched_quantity: number;
          previously_received: number;
        }>(sql`
          select
            dl.id as delivery_line_id,
            dl.quantity::int
              as dispatched_quantity,

            coalesce(
              (
                select
                  sum(previous_rl.received_quantity)

                from receipt_lines previous_rl

                join receipts previous_r
                  on previous_r.id =
                     previous_rl.receipt_id

                where
                  previous_rl.delivery_line_id =
                    dl.id

                  and previous_r.status =
                    'CONFIRMED'

                  and previous_r.id <>
                    ${id}
              ),
              0
            )::int as previously_received

          from delivery_lines dl

          where dl.delivery_id =
            ${row.delivery_id}
        `);

      const cumulativeByLine =
        new Map(
          cumulative.rows.map(
            (item) => [
              item.delivery_line_id,
              item,
            ],
          ),
        );

      const conformities = lines.rows.map((line) => {
        const cumulativeLine =
          cumulativeByLine.get(
            line.delivery_line_id,
          );

        if (!cumulativeLine) {
          throw new Error(
            'RECEIPT_LINE_OUT_OF_SCOPE',
          );
        }

        if (
          cumulativeLine.previously_received +
            line.received_quantity >
          cumulativeLine.dispatched_quantity
        ) {
          throw new Error(
            'RECEIPT_OVER_RECEIVED',
          );
        }

        const error = validateReceiptQuantities({
          dispatched: line.dispatched_quantity,
          received: line.received_quantity,
          accepted: line.accepted_quantity,
          rejected: line.rejected_quantity,
        });
        if (error) throw new Error(error);
        if (
          line.accepted_quantity > 0 &&
          (!line.received_lot_number || !line.received_expiration_date)
        )
          throw new Error('RECEIPT_LOT_EXPIRATION_REQUIRED');
        if (line.accepted_quantity > 0 && line.received_expiration_date! < row.received_date)
          throw new Error('RECEIPT_EXPIRED_PRODUCT');
        const discrepancy =
          Boolean(line.nonconformity_reason) ||
          line.received_lot_number !== line.expected_lot_number ||
          line.received_expiration_date !== line.expected_expiration_date;
        const conformity = deriveReceiptConformity(
          {
            dispatched: line.dispatched_quantity,
            received: line.received_quantity,
            accepted: line.accepted_quantity,
            rejected: line.rejected_quantity,
          },
          discrepancy,
        );
        return { id: line.id, conformity };
      });
      for (const line of conformities)
        await tx.execute(
          sql`update receipt_lines set conformity=${line.conformity} where id=${line.id}`,
        );
      const overall = conformities.every((line) => line.conformity === 'CONFORMING')
        ? 'CONFORMING'
        : lines.rows.every((line) => line.accepted_quantity === 0)
          ? 'NON_CONFORMING'
          : 'PARTIALLY_CONFORMING';
      await tx.execute(
        sql`update receipts set status='CONFIRMED',conformity=${overall},confirmed_at=now(),version=version+1,updated_at=now(),updated_by=${scope.userId} where id=${id}`,
      );
      await this.inventory.recordConfirmedReceipt(
        tx,
        id,
        scope,
      );

      const completion =
        await tx.execute<{
          complete: boolean;
        }>(sql`
          select
            not exists (
              select 1

              from delivery_lines dl

              where
                dl.delivery_id =
                  ${row.delivery_id}

                and coalesce(
                  (
                    select
                      sum(confirmed_rl.received_quantity)

                    from receipt_lines confirmed_rl

                    join receipts confirmed_r
                      on confirmed_r.id =
                         confirmed_rl.receipt_id

                    where
                      confirmed_rl.delivery_line_id =
                        dl.id

                      and confirmed_r.status =
                        'CONFIRMED'
                  ),
                  0
                ) < dl.quantity
            ) as complete
        `);

      const deliveryStatus =
        completion.rows[0]?.complete
          ? 'RECEIVED'
          : 'DISPATCHED';

      await tx.execute(sql`
        update deliveries

        set
          status =
            ${deliveryStatus},

          version =
            version + 1,

          updated_at =
            now(),

          updated_by =
            ${scope.userId}

        where
          id =
            ${row.delivery_id}
      `);

      await this.deriveOrderStatus(
        tx,
        delivery.rows[0].purchase_order_id,
        scope.userId,
      );

      await this.audit(
        tx,
        scope,
        'RECEIPT_CONFIRMED',
        id,
        {
          conformity: overall,
          deliveryStatus,
        },
      );
      return this.findOn(tx, id, scope);
    });
  }


  async createPurchaseOrderReceipt(
    purchaseOrderId: string,
    body: PurchaseOrderDirectReceiptRequest,
    scope: Scope,
  ) {
    if (
      scope.organizationCode !==
      'MEDICARTE'
    ) {
      throw new Error(
        'DIRECT_RECEIPT_MEDICARTE_ONLY',
      );
    }

    return this.database.db.transaction(
      async (tx) => {
        const order =
          await tx.execute<{
            id: string;
            status: string;
            origin: string | null;
            olp_accepted_at: string | null;
          }>(sql`
            select
              id,
              status,
              origin,
              olp_accepted_at

            from purchase_orders

            where id =
                  ${purchaseOrderId}

            for update
          `);

        const orderRow =
          order.rows[0];

        if (!orderRow) {
          throw new Error(
            'DIRECT_RECEIPT_ORDER_NOT_FOUND',
          );
        }

        /*
         * LEGACY_BACKFILL identifica la procedencia de la OC.
         *
         * No impide continuar el ciclo cuando existe evidencia
         * operacional nueva. Una vez OLP aceptó la OC,
         * Medicarte puede registrar recepciones.
         *
         * El status técnico HISTORICAL_ONLY se conserva para
         * respetar purchase_orders_origin_shape_check.
         */

        if (
          !orderRow.olp_accepted_at
        ) {
          throw new Error(
            'DIRECT_RECEIPT_OLP_NOT_ACCEPTED',
          );
        }

        /*
         * El flujo nuevo de OC no puede mezclarse
         * con el flujo legacy de deliveries.
         */
        const legacy =
          await tx.execute<{
            found: boolean;
          }>(sql`
            select exists (
              select 1

              from deliveries

              where purchase_order_id =
                    ${purchaseOrderId}
            ) as found
          `);

        if (
          legacy.rows[0]?.found
        ) {
          throw new Error(
            'DIRECT_RECEIPT_LEGACY_FLOW_EXISTS',
          );
        }

        const ids =
          body.lines.map(
            (line) =>
              line.purchaseOrderLineId,
          );

        if (
          new Set(ids).size !==
          ids.length
        ) {
          throw new Error(
            'DIRECT_RECEIPT_LINE_DUPLICATE',
          );
        }

        const source =
          await tx.execute<{
            id: string;
            commercial_code: string;
            requested_quantity: number;
            accepted_quantity: number | null;
            olp_managed_quantity: number | null;
            dispensing_point_id: string | null;
          }>(sql`
            select
              pol.id,
              pol.commercial_code,
              pol.requested_quantity,
              pol.accepted_quantity,
              pol.olp_managed_quantity,

              coalesce(
                pol.dispensing_point_id,
                mapped.dispensing_point_id
              ) as dispensing_point_id

            from purchase_order_lines pol

            left join tariff_annex_products tap
              on tap.codigo_producto =
                 pol.commercial_code
             and tap.active = true

            left join product_delivery_point_mappings mapped
              on pol.dispensing_point_id is null

             and btrim(
                   coalesce(
                     tap.numero_expediente_invima,
                     ''
                   )
                 ) ~ '^[0-9]+$'

             and btrim(
                   coalesce(
                     tap.consecutivo_invima_presentacion,
                     ''
                   )
                 ) ~ '^[0-9]+$'

             and mapped.invima_record_normalized =
                 coalesce(
                   nullif(
                     ltrim(
                       btrim(
                         tap.numero_expediente_invima
                       ),
                       '0'
                     ),
                     ''
                   ),
                   '0'
                 )

             and mapped.invima_presentation_normalized =
                 coalesce(
                   nullif(
                     ltrim(
                       btrim(
                         tap.consecutivo_invima_presentacion
                       ),
                       '0'
                     ),
                     ''
                   ),
                   '0'
                 )

            where pol.purchase_order_id =
                  ${purchaseOrderId}

              and pol.id in (
                ${sql.join(
                  ids.map(
                    (id) =>
                      sql`${id}`,
                  ),
                  sql`,`,
                )}
              )

            for update of pol
          `);

        if (
          source.rows.length !==
          ids.length
        ) {
          throw new Error(
            'DIRECT_RECEIPT_LINE_NOT_FOUND',
          );
        }

        const points =
          source.rows.map(
            (line) =>
              line.dispensing_point_id,
          );

        if (
          points.some(
            (id) => !id,
          )
        ) {
          throw new Error(
            'DIRECT_RECEIPT_POINT_NOT_FOUND',
          );
        }

        await lockActivePointGrants(
          tx,
          scope,
          points as string[],
        );

        /*
         * Recibido acumulado por línea.
         * Cada confirmación previa sigue contando.
         */
        const cumulative =
          await tx.execute<{
            purchase_order_line_id: string;
            received: number;
          }>(sql`
            select
              porl.purchase_order_line_id,

              coalesce(
                sum(
                  porl.received_quantity
                ),
                0
              )::int as received

            from purchase_order_receipt_lines porl

            join purchase_order_receipts por
              on por.id =
                 porl.receipt_id

            where por.purchase_order_id =
                  ${purchaseOrderId}

            group by
              porl.purchase_order_line_id
          `);

        const receivedByLine =
          new Map(
            cumulative.rows.map(
              (row) => [
                row.purchase_order_line_id,
                Number(
                  row.received,
                ),
              ],
            ),
          );

        /*
         * El cliente solo informa cuánto llegó ahora.
         * El backend deriva si esa recepción completa
         * o deja pendiente la línea.
         */
        const normalized =
          body.lines.map(
            (input) => {
              const line =
                source.rows.find(
                  (candidate) =>
                    candidate.id ===
                    input.purchaseOrderLineId,
                );

              if (!line) {
                throw new Error(
                  'DIRECT_RECEIPT_LINE_NOT_FOUND',
                );
              }

              const already =
                receivedByLine.get(
                  line.id,
                ) ?? 0;

              const remaining =
                Number(
                  line.olp_managed_quantity ??
                  0,
                ) -
                already;

              if (
                remaining <= 0
              ) {
                throw new Error(
                  'DIRECT_RECEIPT_ALREADY_COMPLETE',
                );
              }

              if (
                input.receivedQuantity >
                remaining
              ) {
                throw new Error(
                  'DIRECT_RECEIPT_OVER_RECEIVED',
                );
              }

              return {
                purchaseOrderLineId:
                  input.purchaseOrderLineId,

                receivedQuantity:
                  input.receivedQuantity,

                outcome:
                  input.receivedQuantity ===
                  remaining
                    ? 'RECEIVED_COMPLETE' as const
                    : 'RECEIVED_PARTIAL' as const,
              };
            },
          );

        const receivedAt =
          body.receivedAt ??
          new Date().toISOString();

        const receipt =
          await tx.execute<{
            id: string;
          }>(sql`
            insert into purchase_order_receipts (
              purchase_order_id,
              received_at,
              confirmed_at,
              confirmed_by,
              observation
            )
            values (
              ${purchaseOrderId},
              ${receivedAt}::timestamptz,
              now(),
              ${scope.userId},
              ${body.observation ?? null}
            )
            returning id
          `);

        const receiptId =
          receipt.rows[0]!.id;

        for (
          const input of
          normalized
        ) {
          await tx.execute(sql`
            insert into purchase_order_receipt_lines (
              receipt_id,
              purchase_order_line_id,
              outcome,
              received_quantity,
              lot_number,
              expiration_date,
              observation
            )
            values (
              ${receiptId},
              ${input.purchaseOrderLineId},
              ${input.outcome},
              ${input.receivedQuantity},
              null,
              null,
              null
            )
          `);
        }

        /*
         * La recepción física es el momento autoritativo
         * para decidir qué autorizaciones de ESTA OC quedan
         * cubiertas.
         *
         * No depende del orden en que posteriormente un
         * usuario intente entregar/aplicar una autorización.
         */
        const automaticAllocation =
          await this.allocateDirectReceiptByAuthorizationUrgency(
            tx,
            purchaseOrderId,
            receiptId,
            scope,
          );


        /*
         * IMPORTANTE:
         *
         * No llamamos recordConfirmedPurchaseOrderReceipt()
         * porque esa ruta pertenece al ledger legacy basado
         * en inventory_lots.
         *
         * La nueva disponibilidad operacional por OC se
         * proyecta desde purchase_order_receipt_lines.
         */

        const totals =
          await tx.execute<{
            requested: number;
            received: number;
          }>(sql`
            select
              (
                select
                  coalesce(
                    sum(
                      coalesce(
                        olp_managed_quantity,
                        0
                      )
                    ),
                    0
                  )::int

                from purchase_order_lines

                where purchase_order_id =
                      ${purchaseOrderId}
              ) as requested,

              (
                select
                  coalesce(
                    sum(
                      porl.received_quantity
                    ),
                    0
                  )::int

                from purchase_order_receipt_lines porl

                join purchase_order_receipts por
                  on por.id =
                     porl.receipt_id

                where por.purchase_order_id =
                      ${purchaseOrderId}
              ) as received
          `);

        const total =
          totals.rows[0];

        const status =
          (
            total &&
            total.requested > 0 &&
            total.received >=
              total.requested
          )
            ? 'RECEIVED'
            : 'PARTIALLY_RECEIVED';

        await tx.execute(sql`
          update purchase_orders

          set
            status =
              case
                when origin =
                  'LEGACY_BACKFILL'
                  or status =
                  'HISTORICAL_ONLY'
                then
                  'HISTORICAL_ONLY'
                else
                  ${status}
              end,

            updated_at =
              now(),

            updated_by =
              ${scope.userId}

          where id =
                ${purchaseOrderId}
        `);

        await tx.execute(sql`
          insert into audit_events (
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
          values (
            'USER',
            ${scope.userId},
            ${scope.organizationId},
            'PURCHASE_ORDER_RECEIPT_CONFIRMED',
            'purchase_order_receipt',
            ${receiptId},
            ${JSON.stringify({
              purchaseOrderId,

              lineCount:
                normalized.length,

              receivedQuantity:
                normalized.reduce(
                  (
                    total,
                    line,
                  ) =>
                    total +
                    line.receivedQuantity,
                  0,
                ),

              purchaseOrderOrigin:
                orderRow.origin,

              historicalContinuation:
                orderRow.origin ===
                'LEGACY_BACKFILL',

              automaticAllocation,
            })}::jsonb,
            ${scope.correlationId},
            ${scope.correlationId},
            'SUCCESS'
          )
        `);

        return {
          id:
            receiptId,

          purchaseOrderId,

          receivedAt,

          confirmedAt:
            new Date().toISOString(),

          status,

          lines:
            normalized,
        };
      },
    );
  }



  /*
   * Asignación automática de inventario recibido
   * a las autorizaciones que originaron la OC.
   *
   * REGLA:
   *
   * 1. La asociación OC -> AUTO viene exclusivamente de
   *    purchase_order_authorization_sources.
   *
   * 2. La prioridad entre AUTO se determina por:
   *
   *    FECHA_FINAL_VIGENCIA ASC
   *    FECHA_ASIGNACION ASC
   *    authorization_key ASC
   *    authorization_item_id ASC
   *
   * 3. Una AUTO se asigna completa o no se asigna.
   *
   * 4. Una recepción posterior únicamente cubre AUTO
   *    todavía pendientes.
   *
   * 5. NO usa lotes ni fecha de vencimiento física
   *    del medicamento.
   */
  private async allocateDirectReceiptByAuthorizationUrgency(
    tx: Tx,
    purchaseOrderId: string,
    receiptId: string,
    scope: Scope,
  ) {
    /*
     * Identificar los pools afectados en ESTA recepción.
     *
     * Pool:
     * OC + producto + punto.
     */
    const pools =
      await tx.execute<{
        commercial_code: string;

        dispensing_point_id:
          string | null;

        received_now:
          number;
      }>(sql`
        select
          pol.commercial_code,

          coalesce(
            pol.dispensing_point_id,
            mapped.dispensing_point_id
          )
            as dispensing_point_id,

          sum(
            porl.received_quantity
          )::int
            as received_now

        from
          purchase_order_receipt_lines porl

        join purchase_order_lines pol
          on pol.id =
             porl.purchase_order_line_id

        left join tariff_annex_products tap
          on tap.codigo_producto =
             pol.commercial_code

         and tap.active =
             true

        left join product_delivery_point_mappings mapped
          on pol.dispensing_point_id
             is null

         and btrim(
               coalesce(
                 tap.numero_expediente_invima,
                 ''
               )
             ) ~ '^[0-9]+$'

         and btrim(
               coalesce(
                 tap.consecutivo_invima_presentacion,
                 ''
               )
             ) ~ '^[0-9]+$'

         and mapped.invima_record_normalized =
             coalesce(
               nullif(
                 ltrim(
                   btrim(
                     tap.numero_expediente_invima
                   ),
                   '0'
                 ),
                 ''
               ),
               '0'
             )

         and mapped.invima_presentation_normalized =
             coalesce(
               nullif(
                 ltrim(
                   btrim(
                     tap.consecutivo_invima_presentacion
                   ),
                   '0'
                 ),
                 ''
               ),
               '0'
             )

        where
          porl.receipt_id =
            ${receiptId}

          and porl.received_quantity >
            0

        group by
          pol.commercial_code,

          coalesce(
            pol.dispensing_point_id,
            mapped.dispensing_point_id
          )
      `);


    const assignments:
      Array<{
        authorizationItemId:
          string;

        authorizationKey:
          string;

        commercialCode:
          string;

        dispensingPointId:
          string;

        quantity:
          number;

        authorizationExpiration:
          string;

        authorizationAssignmentDate:
          string | null;
      }> =
      [];


    let totalAssigned =
      0;


    const allocationOwner =
      await tx.execute<{
        id: string;
      }>(sql`
        select
          id

        from
          organizations

        where code =
          'MTD'

        order by
          id

        limit 2
      `);


    if (
      allocationOwner.rows.length !==
      1
    ) {
      throw new Error(
        'DIRECT_RECEIPT_MTD_ORGANIZATION_NOT_FOUND',
      );
    }


    const allocationOrganizationId =
      allocationOwner.rows[0]!.id;


    for (
      const pool of
      pools.rows
    ) {
      if (
        !pool.dispensing_point_id
      ) {
        throw new Error(
          'DIRECT_RECEIPT_POINT_NOT_FOUND',
        );
      }

      const dispensingPointId =
        pool.dispensing_point_id;


      /*
       * Serialización por pool.
       *
       * Aunque la OC ya está bloqueada, este lock deja
       * explícita la frontera de concurrencia de inventario.
       */
      const lockKey =
        [
          'OC_AUTO_ALLOCATION',
          purchaseOrderId,
          pool.commercial_code,
          dispensingPointId,
        ].join(':');

      await tx.execute(sql`
        select
          pg_advisory_xact_lock(
            hashtextextended(
              ${lockKey},
              0
            )
          )
      `);


      /*
       * Resolver todas las líneas de la OC que pertenecen
       * al mismo producto + punto.
       */
      const poolLines =
        await tx.execute<{
          id: string;
        }>(sql`
          select
            pol.id

          from
            purchase_order_lines pol

          left join tariff_annex_products tap
            on tap.codigo_producto =
               pol.commercial_code

           and tap.active =
               true

          left join product_delivery_point_mappings mapped
            on pol.dispensing_point_id
               is null

           and btrim(
                 coalesce(
                   tap.numero_expediente_invima,
                   ''
                 )
               ) ~ '^[0-9]+$'

           and btrim(
                 coalesce(
                   tap.consecutivo_invima_presentacion,
                   ''
                 )
               ) ~ '^[0-9]+$'

           and mapped.invima_record_normalized =
               coalesce(
                 nullif(
                   ltrim(
                     btrim(
                       tap.numero_expediente_invima
                     ),
                     '0'
                   ),
                   ''
                 ),
                 '0'
               )

           and mapped.invima_presentation_normalized =
               coalesce(
                 nullif(
                   ltrim(
                     btrim(
                       tap.consecutivo_invima_presentacion
                     ),
                     '0'
                   ),
                   ''
                 ),
                 '0'
               )

          where
            pol.purchase_order_id =
              ${purchaseOrderId}

            and pol.commercial_code =
              ${pool.commercial_code}

            and coalesce(
                  pol.dispensing_point_id,
                  mapped.dispensing_point_id
                ) =
                ${dispensingPointId}

          order by
            pol.id

          for share of pol
        `);


      const poolLineIds =
        poolLines.rows.map(
          (line) =>
            line.id,
        );

      if (
        poolLineIds.length ===
        0
      ) {
        continue;
      }


      /*
       * Total recibido acumulado de este pool.
       *
       * No usamos únicamente lo recibido "ahora",
       * porque una segunda recepción debe continuar
       * donde terminó la primera.
       */
      const received =
        await tx.execute<{
          quantity: number;
        }>(sql`
          select
            coalesce(
              sum(
                porl.received_quantity
              ),
              0
            )::int
              as quantity

          from
            purchase_order_receipt_lines porl

          join purchase_order_receipts por
            on por.id =
               porl.receipt_id

          where
            por.purchase_order_id =
              ${purchaseOrderId}

            and porl.purchase_order_line_id
                in (
                  ${sql.join(
                    poolLineIds.map(
                      (id) =>
                        sql`${id}`,
                    ),
                    sql`,`,
                  )}
                )
        `);


      /*
       * Cantidad del pool que ya fue asociada
       * históricamente a autorizaciones.
       *
       * consumed_quantity NO libera capacidad:
       * una unidad ya consumida sigue correspondiendo
       * a una unidad recibida anteriormente.
       *
       * released_quantity sí la libera.
       */
      const allocationState =
        await tx.execute<{
          quantity: number;
        }>(sql`
          select
            coalesce(
              sum(
                greatest(
                  allocated_quantity
                  -
                  released_quantity,
                  0
                )
              ),
              0
            )::int
              as quantity

          from
            inventory_authorization_allocations

          where
            purchase_order_id =
              ${purchaseOrderId}

            and commercial_code =
              ${pool.commercial_code}

            and dispensing_point_id =
              ${dispensingPointId}
        `);


      const receivedQuantity =
        Number(
          received.rows[0]
            ?.quantity ??
          0,
        );

      const alreadyAssigned =
        Number(
          allocationState.rows[0]
            ?.quantity ??
          0,
        );

      let available =
        Math.max(
          receivedQuantity -
          alreadyAssigned,
          0,
        );

      if (
        available <=
        0
      ) {
        continue;
      }


      /*
       * Candidatas exclusivamente provenientes de ESTA OC.
       *
       * source_quantity_snapshot protege la cantidad
       * comprometida cuando se creó la OC.
       *
       * Si la cantidad actual de la AUTO disminuyó,
       * no asignamos por encima de la necesidad actual.
       *
       * Si aumentó, esta OC antigua tampoco cubre el aumento.
       */
      const candidates =
        await tx.execute<{
          authorization_item_id:
            string;

          authorization_key:
            string;

          authorization_version:
            number;

          required_quantity:
            number;

          expiration_date:
            string;

          assignment_date:
            string | null;
        }>(sql`
          with source_snapshot as (
            select
              poas.authorization_item_id,

              sum(
                poas.source_quantity_snapshot
              )::int
                as snapshot_quantity

            from
              purchase_order_authorization_sources poas

            where
              poas.purchase_order_line_id
                in (
                  ${sql.join(
                    poolLineIds.map(
                      (id) =>
                        sql`${id}`,
                    ),
                    sql`,`,
                  )}
                )

            group by
              poas.authorization_item_id
          ),


          candidates_normalized as (
            select
              ai.id
                as authorization_item_id,

              ai.authorization_key,

              ai.version
                as authorization_version,

              case
                when btrim(
                       coalesce(
                         ai.source_data
                           ->> 'CANTIDAD',
                         ''
                       )
                     )
                     ~ '^[1-9][0-9]*$'

                then least(
                  source_snapshot.snapshot_quantity,

                  (
                    ai.source_data
                      ->> 'CANTIDAD'
                  )::int
                )

                else
                  source_snapshot.snapshot_quantity
              end::int
                as required_quantity,


              /*
               * FECHA_FINAL_VIGENCIA:
               * soportar ambos formatos que ya maneja
               * el dominio histórico.
               */
              case
                when btrim(
                       coalesce(
                         ai.source_data
                           ->> 'FECHA_FINAL_VIGENCIA',
                         ''
                       )
                     )
                     ~ '^[0-9]{8}$'

                then to_date(
                  ai.source_data
                    ->> 'FECHA_FINAL_VIGENCIA',

                  'YYYYMMDD'
                )


                when btrim(
                       coalesce(
                         ai.source_data
                           ->> 'FECHA_FINAL_VIGENCIA',
                         ''
                       )
                     )
                     ~
                     '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'

                then to_date(
                  ai.source_data
                    ->> 'FECHA_FINAL_VIGENCIA',

                  'YYYY-MM-DD'
                )


                else
                  null
              end
                as expiration_date,


              /*
               * FECHA_ASIGNACION es únicamente
               * desempate secundario.
               */
              case
                when btrim(
                       coalesce(
                         ai.source_data
                           ->> 'FECHA_ASIGNACION',
                         ''
                       )
                     )
                     ~ '^[0-9]{8}$'

                then to_date(
                  ai.source_data
                    ->> 'FECHA_ASIGNACION',

                  'YYYYMMDD'
                )


                when btrim(
                       coalesce(
                         ai.source_data
                           ->> 'FECHA_ASIGNACION',
                         ''
                       )
                     )
                     ~
                     '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'

                then to_date(
                  ai.source_data
                    ->> 'FECHA_ASIGNACION',

                  'YYYY-MM-DD'
                )


                else
                  null
              end
                as assignment_date

            from
              source_snapshot

            join authorization_items ai
              on ai.id =
                 source_snapshot.authorization_item_id

            where
              ai.source_status_normalized =
                '5'

              and ai.enablement_status =
                'ENABLED'

              and not exists (
                select
                  1

                from
                  patient_applications pa

                where
                  pa.authorization_item_id =
                    ai.id

                  and pa.status =
                    'CONFIRMED'
              )
          )


          select
            candidate.authorization_item_id,

            candidate.authorization_key,

            candidate.authorization_version,

            candidate.required_quantity,

            candidate.expiration_date::text
              as expiration_date,

            candidate.assignment_date::text
              as assignment_date

          from
            candidates_normalized candidate

          where
            candidate.required_quantity >
              0

            and candidate.expiration_date
                is not null

            /*
             * Una AUTO vencida al momento de la
             * recepción no puede ganar asignación.
             */
            and candidate.expiration_date >=
              (
                now()
                at time zone
                'America/Bogota'
              )::date

            and not exists (
              select
                1

              from
                authorization_fulfillments af

              where
                af.authorization_item_id =
                  candidate.authorization_item_id
            )

            and not exists (
              select
                1

              from
                inventory_authorization_allocations iaa

              where
                iaa.authorization_item_id =
                  candidate.authorization_item_id

                and iaa.purchase_order_id =
                  ${purchaseOrderId}

                and iaa.commercial_code =
                  ${pool.commercial_code}

                and iaa.dispensing_point_id =
                  ${dispensingPointId}

                and (
                  iaa.allocated_quantity
                  -
                  iaa.released_quantity
                ) >
                0
            )

          order by
            /*
             * REGLA PRINCIPAL:
             * la AUTO con vencimiento más próximo
             * es la más urgente.
             */
            candidate.expiration_date
              asc,

            candidate.assignment_date
              asc nulls last,

            candidate.authorization_key
              asc,

            candidate.authorization_item_id
              asc
        `);


      /*
       * Whole-AUTO allocation.      /*
       * Whole-AUTO allocation.
       *
       * Si una AUTO necesita 2 y queda solo 1,
       * no se parte. Se evalúa la siguiente AUTO.
       */
      const planned:
        Array<{
          authorizationItemId:
            string;

          authorizationKey:
            string;

          authorizationVersion:
            number;

          quantity:
            number;

          expirationDate:
            string;

          assignmentDate:
            string | null;
        }> =
        [];


      for (
        const candidate of
        candidates.rows
      ) {
        const quantity =
          Number(
            candidate.required_quantity,
          );

        if (
          !Number.isInteger(
            quantity,
          ) ||
          quantity <=
            0
        ) {
          continue;
        }

        if (
          quantity >
          available
        ) {
          continue;
        }

        planned.push({
          authorizationItemId:
            candidate.authorization_item_id,

          authorizationKey:
            candidate.authorization_key,

          authorizationVersion:
            candidate.authorization_version,

          quantity,

          expirationDate:
            candidate.expiration_date,

          assignmentDate:
            candidate.assignment_date,
        });

        available -=
          quantity;

        if (
          available <=
          0
        ) {
          break;
        }
      }


      if (
        planned.length ===
        0
      ) {
        continue;
      }


      const poolAssigned =
        planned.reduce(
          (
            total,
            item,
          ) =>
            total +
            item.quantity,
          0,
        );


      /*
       * inventory_authorization_allocations exige batch.
       *
       * Reutilizamos source = UI porque el modelo actual
       * solamente permite UI/XLSX. Este batch es interno
       * y NO aparece en historial XLSX.
       */
      const batch =
        await tx.execute<{
          id: string;
        }>(sql`
          insert into
            inventory_allocation_batches
          (
            organization_id,
            source,
            import_batch_id,
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
            ${allocationOrganizationId},
            'UI',
            null,
            'CONFIRMED',
            ${planned.length},
            ${planned.length},
            0,
            ${poolAssigned},
            ${scope.correlationId},
            ${scope.userId},
            ${scope.userId},
            now()
          )
          returning
            id
        `);


      for (
        const item of
        planned
      ) {
        await tx.execute(sql`
          insert into
            inventory_authorization_allocations
          (
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
          values
          (
            ${batch.rows[0]!.id},
            null,
            ${allocationOrganizationId},
            ${item.authorizationItemId},
            ${purchaseOrderId},
            ${pool.commercial_code},
            ${dispensingPointId},
            ${item.quantity},
            0,
            0,
            'ALLOCATED',
            ${item.authorizationVersion},
            ${scope.userId},
            ${scope.userId}
          )
        `);


        assignments.push({
          authorizationItemId:
            item.authorizationItemId,

          authorizationKey:
            item.authorizationKey,

          commercialCode:
            pool.commercial_code,

          dispensingPointId,

          quantity:
            item.quantity,

          authorizationExpiration:
            item.expirationDate,

          authorizationAssignmentDate:
            item.assignmentDate,
        });

        totalAssigned +=
          item.quantity;
      }
    }


    const receivedNow =
      pools.rows.reduce(
        (
          total,
          pool,
        ) =>
          total +
          Number(
            pool.received_now,
          ),
        0,
      );


    return {
      strategy:
        'AUTHORIZATION_EXPIRATION_ASC',

      allocationOrganizationId,

      wholeAuthorization:
        true,

      receivedNow,

      assignedNow:
        totalAssigned,

      unassignedNow:
        Math.max(
          receivedNow -
          totalAssigned,
          0,
        ),

      assignments,
    };
  }


  list(scope: Scope, pending = false) {
    const filter = pending ? sql`d.status='DISPATCHED' and r.status='DRAFT'` : sql`true`;
    return this.database.db
      .execute<{
        id: string;
      }>(
        sql`select distinct r.id from receipts r join deliveries d on d.id=r.delivery_id join delivery_lines dl on dl.delivery_id=d.id join dispensing_points dp on dp.id=dl.dispensing_point_id where ${filter} and ${this.scopeFilter(scope)} and ${this.deliveryFullyInScope(scope)} order by r.id`,
      )
      .then((result) => Promise.all(result.rows.map((r) => this.find(r.id, scope))));
  }
  find(id: string, scope: Scope) {
    return this.findOn(this.database.db, id, scope);
  }

  async existsIgnoringPoint(id: string, scope: Scope): Promise<boolean> {
    const org =
      scope.organizationCode === 'OLP' ||
      scope.organizationCode === 'MEDICARTE' ||
      scope.organizationCode === 'MTD'
        ? sql`true`
        : sql`dp.organization_id=${scope.organizationId}`;
    const result = await this.database.db.execute<{ id: string }>(
      sql`select r.id from receipts r join deliveries d on d.id=r.delivery_id join delivery_lines dl on dl.delivery_id=d.id join dispensing_points dp on dp.id=dl.dispensing_point_id where r.id=${id} and ${org} limit 1`,
    );
    return Boolean(result.rows[0]);
  }

  private async replaceLines(
    tx: Tx,
    receiptId: string,
    deliveryId: string,
    lines: ReceiptLineRequest[],
    scope: Scope,
  ) {
    await tx.execute(sql`delete from receipt_lines where receipt_id=${receiptId}`);
    for (const line of lines) {
      const inserted = await tx.execute(
        sql`
          insert into receipt_lines (
            receipt_id,
            delivery_line_id,
            dispatched_quantity,
            received_quantity,
            accepted_quantity,
            rejected_quantity,
            shortage_quantity,
            expected_lot_number,
            expected_expiration_date,
            received_lot_number,
            received_expiration_date,
            nonconformity_reason,
            observation
          )

          select
            ${receiptId},
            dl.id,

            greatest(
              dl.quantity -
              coalesce(
                (
                  select
                    sum(previous_rl.received_quantity)

                  from receipt_lines previous_rl

                  join receipts previous_r
                    on previous_r.id =
                       previous_rl.receipt_id

                  where
                    previous_rl.delivery_line_id =
                      dl.id

                    and previous_r.status =
                      'CONFIRMED'
                ),
                0
              ),
              0
            )::int,

            ${line.receivedQuantity},
            ${line.acceptedQuantity},
            ${line.rejectedQuantity},

            greatest(
              dl.quantity -
              coalesce(
                (
                  select
                    sum(previous_rl.received_quantity)

                  from receipt_lines previous_rl

                  join receipts previous_r
                    on previous_r.id =
                       previous_rl.receipt_id

                  where
                    previous_rl.delivery_line_id =
                      dl.id

                    and previous_r.status =
                      'CONFIRMED'
                ),
                0
              ),
              0
            )::int -
              ${line.receivedQuantity},

            dl.lot_number,
            dl.expiration_date,
            ${line.receivedLotNumber ?? null},
            ${line.receivedExpirationDate ?? null},
            ${line.nonconformityReason ?? null},
            ${line.observation ?? null}

          from delivery_lines dl

          join deliveries d
            on d.id =
               dl.delivery_id

          join dispensing_points dp
            on dp.id =
               dl.dispensing_point_id

          where
            dl.id =
              ${line.deliveryLineId}

            and d.id =
              ${deliveryId}

            and ${this.scopeFilter(scope)}
        `,
      );
      if (inserted.rowCount !== 1) throw new Error('RECEIPT_LINE_OUT_OF_SCOPE');
    }
  }
  private async findOn(conn: Tx | Database['db'], id: string, scope: Scope) {
    const rows = await conn.execute<ReceiptViewRow>(
      sql`select r.*,d.purchase_order_id,dlr.id line_id,dlr.delivery_line_id,dlr.dispatched_quantity,dlr.received_quantity,dlr.accepted_quantity,dlr.rejected_quantity,dlr.shortage_quantity,dlr.expected_lot_number,dlr.expected_expiration_date,dlr.received_lot_number,dlr.received_expiration_date,dlr.conformity line_conformity,dlr.nonconformity_reason,dlr.observation from receipts r join deliveries d on d.id=r.delivery_id join receipt_lines dlr on dlr.receipt_id=r.id join delivery_lines dl on dl.id=dlr.delivery_line_id join dispensing_points dp on dp.id=dl.dispensing_point_id where r.id=${id} and ${this.scopeFilter(scope)} order by dlr.id`,
    );
    if (!rows.rows[0]) return null;
    const first = rows.rows[0];
    return {
      id: first.id,
      deliveryId: first.delivery_id,
      status: first.status,
      conformity: first.conformity,
      receivedAt: first.received_at,
      confirmedAt: first.confirmed_at,
      version: first.version,
      createdBy: first.created_by,
      updatedBy: first.updated_by,
      lines: rows.rows.map((line) => ({
        id: line.line_id,
        deliveryLineId: line.delivery_line_id,
        dispatchedQuantity: line.dispatched_quantity,
        receivedQuantity: line.received_quantity,
        acceptedQuantity: line.accepted_quantity,
        rejectedQuantity: line.rejected_quantity,
        shortageQuantity: line.shortage_quantity,
        expectedLotNumber: line.expected_lot_number,
        expectedExpirationDate: line.expected_expiration_date,
        receivedLotNumber: line.received_lot_number,
        receivedExpirationDate: line.received_expiration_date,
        conformity: line.line_conformity,
        nonconformityReason: line.nonconformity_reason,
        observation: line.observation,
      })),
    };
  }
  private async deriveOrderStatus(tx: Tx, orderId: string, userId: string) {
    const totals = await tx.execute<{
      requested: number;
      received: number;
    }>(sql`
        select
          (
            select
              coalesce(
                sum(
                  pol.requested_quantity
                ),
                0
              )::int

            from
              purchase_order_lines pol

            where
              pol.purchase_order_id =
                ${orderId}
          )
            as requested,

          (
            select
              coalesce(
                sum(
                  rl.received_quantity
                ),
                0
              )::int

            from
              receipt_lines rl

            join receipts r
              on r.id =
                 rl.receipt_id

             and r.status =
                 'CONFIRMED'

            join delivery_lines dl
              on dl.id =
                 rl.delivery_line_id

            join deliveries d
              on d.id =
                 dl.delivery_id

            where
              d.purchase_order_id =
                ${orderId}
          )
            as received
      `);

    const row = totals.rows[0];

    const status = derivePurchaseOrderReceiptStatus(row?.requested ?? 0, row?.received ?? 0);

    await tx.execute(sql`
      update
        purchase_orders

      set
        status =
          ${status},

        updated_at =
          now(),

        updated_by =
          ${userId}

      where
        id =
          ${orderId}
    `);

    return status;
  }

  private scopeFilter(scope: Scope) {
    const org =
      scope.organizationCode === 'OLP' ||
      scope.organizationCode === 'MEDICARTE' ||
      scope.organizationCode === 'MTD'
        ? sql`true`
        : sql`dp.organization_id=${scope.organizationId}`;
    return sql`${org} and ${applyPointScope(sql`dp.id`, scope)}`;
  }

  private deliveryFullyInScope(scope: Scope) {
    if (scope.pointAccessKind !== 'explicit') return sql`true`;
    return sql`not exists (
      select 1 from delivery_lines xdl
      where xdl.delivery_id = d.id
        and xdl.dispensing_point_id not in (
          select ups.dispensing_point_id from user_point_scopes ups
          where ups.user_id = ${scope.userId}::uuid and ups.revoked_at is null
        )
    )`;
  }

  private async lockDeliveryPoints(tx: Tx, deliveryId: string, scope: Scope): Promise<void> {
    const points = await tx.execute<{ dispensing_point_id: string }>(
      sql`select distinct dispensing_point_id from delivery_lines where delivery_id=${deliveryId}`,
    );
    await lockActivePointGrants(
      tx,
      scope,
      points.rows.map((row) => row.dispensing_point_id),
    );
  }
  private async audit(tx: Tx, scope: Scope, action: string, id: string, after: unknown) {
    await tx.execute(
      sql`insert into audit_events (actor_type,actor_id,organization_id,action,resource_type,resource_id,after,correlation_id,request_id,result) values ('USER',${scope.userId},${scope.organizationId},${action},'receipt',${id},${JSON.stringify(after)}::jsonb,${scope.correlationId},${scope.correlationId},'SUCCESS')`,
    );
  }
}
