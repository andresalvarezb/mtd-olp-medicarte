import {
  Inject,
  Injectable,
} from '@nestjs/common';

import {
  sql,
} from 'drizzle-orm';

import type {
  createDatabase,
} from '@authorization/database';

import type {
  FulfillAuthorizationRequest,
} from '@authorization/contracts';

import {
  assertAuthorizationFulfillment,
  currentBogotaDate,
  evaluateAuthorizationOperationalWindow,
  parseAuthorizationExpiration,
} from '@authorization/domain';

import type {
  Scope,
} from '../common/request-scope';

import {
  lockActivePointGrants,
} from '../common/point-scope.sql';

import { DATABASE } from '../tokens';
import { REALTIME_AUDIENCE, realtimeInvalidationSql } from '../common/realtime-outbox';

import {
  resolveAuthorizationFulfillmentInventoryMode,
  type AuthorizationFulfillmentInventoryMode,
} from './authorization-fulfillment-inventory-mode';


type Database =
  ReturnType<
    typeof createDatabase
  >;

type Tx =
  Parameters<
    Parameters<
      Database['db']['transaction']
    >[0]
  >[0];

type AuthorizationRow = {
  id: string;
  commercial_code: string;
  authorized_quantity: number;
  expiration_raw: string | null;
  assignment_raw: string | null;
  enablement_status: string;
};

type AllocationRow = {
  id: string;
  purchase_order_id: string;
  purchase_order_code: string | null;
  commercial_code: string;
  dispensing_point_id: string;
  allocated_quantity: number;
  consumed_quantity: number;
  released_quantity: number;
};

type LotRow = {
  id: string;
  lot_number: string;
  expiration_date: string;
  balance: number;
};

@Injectable()
export class AuthorizationFulfillmentRepository {
  constructor(
    @Inject(DATABASE)
    private readonly database:
      Database,
  ) {}

  async fulfill(
    authorizationItemId: string,
    body: FulfillAuthorizationRequest,
    scope: Scope,
    source: 'UI' | 'XLSX' = 'UI',
  ) {
    return this.database.db.transaction(
      async (tx) => {
        const authorization =
          await this.lockAuthorization(
            tx,
            authorizationItemId,
            scope,
            body.purchaseOrderCode,
          );


        if (!authorization) {
          return {
            outcome:
              'not_found' as const,
          };
        }


        /*
         * Cantidad acumulada ya atendida.
         *
         * La existencia de un fulfillment ya NO
         * implica cierre.
         */
        const fulfillmentTotals =
          (
            await tx.execute<{
              fulfilled_quantity:
                number;
            }>(sql`
              select
                coalesce(
                  sum(
                    quantity
                  ),
                  0
                )::int
                  as fulfilled_quantity

              from
                authorization_fulfillments

              where
                authorization_item_id =
                  ${authorizationItemId}
            `)
          ).rows[0];


        const fulfilledQuantity =
          Number(
            fulfillmentTotals
              ?.fulfilled_quantity
            ??
            0,
          );


        const remainingAuthorizedQuantity =
          Math.max(
            authorization.authorized_quantity
            -
            fulfilledQuantity,
            0,
          );


        /*
         * patient_applications permanece como flujo
         * histórico separado durante STEP 2.
         *
         * Si existe una aplicación legacy confirmada,
         * evitamos mezclar ambos caminos hasta la
         * reconciliación integral de STEP 3.
         */
        const previousApplication =
          (
            await tx.execute<{
              id: string;
            }>(sql`
              select
                id

              from
                patient_applications

              where
                authorization_item_id =
                  ${authorizationItemId}

                and status =
                  'CONFIRMED'

              limit 1
            `)
          ).rows[0];


        if (
          previousApplication
        ) {
          throw new Error(
            'AUTHORIZATION_FULFILLMENT_ALREADY_APPLIED',
          );
        }


        /*
         * Solo se bloquean las allocations correspondientes
         * a la AUTO + OC indicada.
         */
        const allocations =
          await this.lockAllocations(
            tx,
            authorizationItemId,
            body.purchaseOrderCode,
          );


        const pointIds =
          new Set(
            allocations.map(
              (row) =>
                row.dispensing_point_id,
            ),
          );


        /*
         * Saldo REAL asignado pendiente.
         *
         * No se exige que cubra toda la cantidad original
         * de la AUTO. Solo debe cubrir body.quantity.
         */
        const assignedQuantity =
          allocations.reduce(
            (
              total,
              row,
            ) =>
              total
              +
              Math.max(
                row.allocated_quantity
                -
                row.consumed_quantity
                -
                row.released_quantity,
                0,
              ),
            0,
          );


        const todayBogota =
          currentBogotaDate();

        const operationalWindow =
          evaluateAuthorizationOperationalWindow({
            assignmentDate:
              authorization.assignment_raw,

            expirationDate:
              authorization.expiration_raw,

            todayBogota,
          });

        /*
         * El vencimiento impide nuevas asignaciones, pero no invalida
         * una reserva física que ya pertenece a esta AUTO.
         *
         * INVALID_DATE y OUTSIDE_HORIZON continúan bloqueando.
         */
        const retainedExpiredAllocation =
          operationalWindow.status ===
            'EXPIRED'
          &&
          assignedQuantity >
            0;

        if (
          authorization.enablement_status !==
            'ENABLED' ||
          (
            !operationalWindow.eligible &&
            !retainedExpiredAllocation
          )
        ) {
          throw new Error(
            'AUTHORIZATION_FULFILLMENT_AUTHORIZATION_NOT_ELIGIBLE',
          );
        }

        const expiration =
          parseAuthorizationExpiration(
            authorization.expiration_raw,
          );

        assertAuthorizationFulfillment({
          effectiveDate:
            body.effectiveDate,

          validityEndDate:
            expiration,

          todayBogota,

          requestedQuantity:
            body.quantity,

          remainingAuthorizedQuantity,

          assignedQuantity,

          pointCount:
            pointIds.size,

          alreadyClosed:
            remainingAuthorizedQuantity <=
              0,
        });

        if (
          allocations.some(
            (row) =>
              row.commercial_code !==
              authorization.commercial_code,
          )
        ) {
          throw new Error(
            'AUTHORIZATION_FULFILLMENT_PRODUCT_MISMATCH',
          );
        }

        const dispensingPointId =
          [...pointIds][0]!;

        await lockActivePointGrants(
          tx,
          scope,
          [
            dispensingPointId,
          ],
        );

        /*
         * La asignación ya fue decidida al confirmar
         * la recepción de MEDICARTE.
         *
         * Fulfillment NO puede volver a escoger una AUTO.
         *
         * DIRECT_RECEIPT:
         *   purchase_order_receipt_lines es la autoridad
         *   de existencia quantity-only.
         *
         * LOT_LEDGER:
         *   conserva la arquitectura histórica FEFO.
         */
        const inventoryMode =
          await this.resolveInventoryMode(
            tx,
            allocations,
          );

        const lots =
          inventoryMode ===
          'LOT_LEDGER'
            ? await this.lockFefoLots(
                tx,
                authorization.commercial_code,
                dispensingPointId,
                body.effectiveDate,
              )
            : [];

        if (
          inventoryMode ===
          'LOT_LEDGER'
        ) {
          const physicalAvailable =
            lots.reduce(
              (
                total,
                lot,
              ) =>
                total +
                Math.max(
                  lot.balance,
                  0,
                ),
              0,
            );

          if (
            physicalAvailable <
            body.quantity
          ) {
            throw new Error(
              'AUTHORIZATION_FULFILLMENT_INSUFFICIENT_INVENTORY',
            );
          }
        }

        const inserted =
          (
            await tx.execute<{
              id: string;
              confirmed_at: Date | string;
            }>(sql`
              insert into
                authorization_fulfillments
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
                ${scope.organizationId},
                ${authorizationItemId},
                ${body.fulfillmentType},
                ${body.effectiveDate}::date,
                ${body.quantity},
                ${source},
                ${scope.userId}
              )
              returning
                id,
                confirmed_at
            `)
          ).rows[0]!;

        let remainingToConsume =
          body.quantity;


        if (
          inventoryMode ===
          'DIRECT_RECEIPT'
        ) {
          /*
           * Quantity-only:
           * consume exactamente body.quantity.
           *
           * Puede dejar la allocation en
           * PARTIALLY_CONSUMED.
           */
          for (
            const allocation
            of allocations
          ) {
            if (
              remainingToConsume <=
              0
            ) {
              break;
            }


            const outstanding =
              Math.max(
                allocation.allocated_quantity
                -
                allocation.consumed_quantity
                -
                allocation.released_quantity,
                0,
              );


            const quantity =
              Math.min(
                outstanding,
                remainingToConsume,
              );


            if (
              quantity <=
              0
            ) {
              continue;
            }


            await tx.execute(sql`
              insert into
                authorization_fulfillment_lines
              (
                fulfillment_id,
                inventory_authorization_allocation_id,
                purchase_order_id,
                inventory_lot_id,
                commercial_code,
                dispensing_point_id,
                lot_number,
                expiration_date,
                quantity
              )

              values
              (
                ${inserted.id},
                ${allocation.id},
                ${allocation.purchase_order_id},
                null,
                ${authorization.commercial_code},
                ${dispensingPointId},
                null,
                null,
                ${quantity}
              )
            `);


            await tx.execute(sql`
              update
                inventory_authorization_allocations

              set
                consumed_quantity =
                  consumed_quantity
                  +
                  ${quantity},

                status =
                  case
                    when
                      consumed_quantity
                      +
                      ${quantity}
                      +
                      released_quantity
                      >=
                      allocated_quantity

                    then
                      'CONSUMED'

                    else
                      'PARTIALLY_CONSUMED'
                  end,

                updated_by =
                  ${scope.userId},

                updated_at =
                  now()

              where
                id =
                  ${allocation.id}
            `);


            remainingToConsume -=
              quantity;
          }

        } else {
          /*
           * LOT_LEDGER:
           * misma semántica parcial,
           * conservando FEFO.
           */
          let lotIndex =
            0;

          let lotRemaining =
            lots[0]?.balance
            ??
            0;


          for (
            const allocation
            of allocations
          ) {
            if (
              remainingToConsume <=
              0
            ) {
              break;
            }


            const outstanding =
              Math.max(
                allocation.allocated_quantity
                -
                allocation.consumed_quantity
                -
                allocation.released_quantity,
                0,
              );


            const allocationToConsume =
              Math.min(
                outstanding,
                remainingToConsume,
              );


            let allocationRemaining =
              allocationToConsume;


            while (
              allocationRemaining >
              0
            ) {
              const lot =
                lots[
                  lotIndex
                ];


              if (!lot) {
                throw new Error(
                  'AUTHORIZATION_FULFILLMENT_INSUFFICIENT_INVENTORY',
                );
              }


              if (
                lotRemaining <=
                0
              ) {
                lotIndex +=
                  1;

                lotRemaining =
                  lots[
                    lotIndex
                  ]?.balance
                  ??
                  0;

                continue;
              }


              const quantity =
                Math.min(
                  allocationRemaining,
                  lotRemaining,
                );


              const line =
                (
                  await tx.execute<{
                    id: string;
                  }>(sql`
                    insert into
                      authorization_fulfillment_lines
                    (
                      fulfillment_id,
                      inventory_authorization_allocation_id,
                      purchase_order_id,
                      inventory_lot_id,
                      commercial_code,
                      dispensing_point_id,
                      lot_number,
                      expiration_date,
                      quantity
                    )

                    values
                    (
                      ${inserted.id},
                      ${allocation.id},
                      ${allocation.purchase_order_id},
                      ${lot.id},
                      ${authorization.commercial_code},
                      ${dispensingPointId},
                      ${lot.lot_number},
                      ${lot.expiration_date}::date,
                      ${quantity}
                    )

                    returning
                      id
                  `)
                ).rows[0]!;


              const movementType =
                body.fulfillmentType ===
                  'APPLICATION'
                  ? 'FULFILLMENT_APPLICATION'
                  : 'FULFILLMENT_DELIVERY';


              await tx.execute(sql`
                insert into
                  inventory_movements
                (
                  inventory_lot_id,
                  movement_type,
                  quantity_delta,
                  source_type,
                  source_id,
                  occurred_at,
                  created_by,
                  metadata
                )

                values
                (
                  ${lot.id},
                  ${movementType},
                  ${-quantity},
                  'AUTH_FULFILLMENT_LINE',
                  ${line.id},
                  (
                    ${body.effectiveDate}::date
                    ::timestamp

                    at time zone
                      'America/Bogota'
                  ),
                  ${scope.userId},
                  ${JSON.stringify({
                    authorizationItemId,

                    fulfillmentId:
                      inserted.id,

                    fulfillmentType:
                      body.fulfillmentType,

                    source,
                  })}::jsonb
                )
              `);


              allocationRemaining -=
                quantity;

              lotRemaining -=
                quantity;
            }


            if (
              allocationToConsume >
              0
            ) {
              await tx.execute(sql`
                update
                  inventory_authorization_allocations

                set
                  consumed_quantity =
                    consumed_quantity
                    +
                    ${allocationToConsume},

                  status =
                    case
                      when
                        consumed_quantity
                        +
                        ${allocationToConsume}
                        +
                        released_quantity
                        >=
                        allocated_quantity

                      then
                        'CONSUMED'

                      else
                        'PARTIALLY_CONSUMED'
                    end,

                  updated_by =
                    ${scope.userId},

                  updated_at =
                    now()

                where
                  id =
                    ${allocation.id}
              `);
            }


            remainingToConsume -=
              allocationToConsume;
          }
        }


        if (
          remainingToConsume !==
          0
        ) {
          throw new Error(
            'AUTHORIZATION_FULFILLMENT_INSUFFICIENT_INVENTORY',
          );
        }


        await tx.execute(sql`
          insert into audit_events
          (
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
          values
          (
            'USER',
            ${scope.userId},
            ${scope.organizationId},
            'AUTHORIZATION_FULFILLMENT_CONFIRMED',
            'authorization_fulfillment',
            ${inserted.id},
            ${JSON.stringify({
              authorizationItemId,
              fulfillmentType:
                body.fulfillmentType,
              effectiveDate:
                body.effectiveDate,
              quantity:
                body.quantity,
              dispensingPointId,
              source,
              inventoryMode,
            })}::jsonb,
            ${scope.correlationId},
            ${scope.correlationId},
            'SUCCESS'
          )
        `);


        // REALTIME-2-W1-FULFILLMENT
        await tx.execute(
          realtimeInvalidationSql({
            organizationCodes: REALTIME_AUDIENCE.INVENTORY,
            topics: ['AUTHORIZATIONS', 'INVENTORY', 'DASHBOARD'],
            correlationId: scope.correlationId,
          }),
        );


        return {
          id:
            inserted.id,

          authorizationItemId,

          fulfillmentType:
            body.fulfillmentType,

          effectiveDate:
            body.effectiveDate,

          quantity:
            body.quantity,

          dispensingPointId,

          purchaseOrders:
            [
              ...new Set(
                allocations.map(
                  (row) =>
                    row.purchase_order_code ??
                    row.purchase_order_id,
                ),
              ),
            ],

          confirmedAt:
            inserted.confirmed_at
              instanceof Date
              ? inserted.confirmed_at
                  .toISOString()
              : new Date(
                  inserted.confirmed_at,
                ).toISOString(),
        };
      },
    );
  }

  private async lockAuthorization(
    tx: Tx,
    authorizationItemId: string,
    scope: Scope,
    purchaseOrderCode: string,
  ): Promise<
    AuthorizationRow | undefined
  > {
    const visibility =
      scope.organizationCode === 'MTD'
        ? sql`true`

        : scope.organizationCode ===
            'MEDICARTE'
          ? sql`
              exists (
                select 1

                from
                  purchase_order_authorization_sources poas

                join purchase_order_lines pol
                  on pol.id =
                     poas.purchase_order_line_id

                join purchase_orders po
                  on po.id =
                     pol.purchase_order_id

                where
                  poas.authorization_item_id =
                    i.id

                  and po.purchase_order_code =
                    ${purchaseOrderCode}

                  and po.status not in (
                    'CANCELLED',
                    'REJECTED'
                  )
              )
            `

          : sql`
              exists (
                select 1

                from
                  authorization_item_organizations aio

                where
                  aio.authorization_item_id =
                    i.id

                  and aio.organization_id =
                    ${scope.organizationId}
              )
            `;

    return (
      await tx.execute<AuthorizationRow>(
        sql`
          select
            i.id,

            i.codigo_medicamento
              as commercial_code,

            case
              when
                btrim(
                  coalesce(
                    i.source_data
                      ->>
                      'CANTIDAD',
                    ''
                  )
                ) ~ '^[0-9]+$'
              then
                (
                  i.source_data
                    ->>
                    'CANTIDAD'
                )::int
              else
                0
            end
              as authorized_quantity,

            i.source_data
              ->>
              'FECHA_FINAL_VIGENCIA'
              as expiration_raw,

            i.source_data
              ->>
              'FECHA_ASIGNACION'
              as assignment_raw,

            i.enablement_status

          from
            authorization_items i

          where
            i.id =
              ${authorizationItemId}

            and ${visibility}

          for update
        `,
      )
    ).rows[0];
  }

  private async resolveInventoryMode(
    tx: Tx,
    allocations: AllocationRow[],
  ): Promise<
    AuthorizationFulfillmentInventoryMode
  > {
    const purchaseOrderIds =
      [
        ...new Set(
          allocations.map(
            (row) =>
              row.purchase_order_id,
          ),
        ),
      ];

    const commercialCodes =
      [
        ...new Set(
          allocations.map(
            (row) =>
              row.commercial_code,
          ),
        ),
      ];

    if (
      purchaseOrderIds.length === 0 ||
      commercialCodes.length !== 1
    ) {
      throw new Error(
        'AUTHORIZATION_FULFILLMENT_ALLOCATION_REQUIRED',
      );
    }

    const commercialCode =
      commercialCodes[0]!;

    const flow =
      await tx.execute<{
        has_direct_receipt: boolean;
        has_legacy_delivery: boolean;
      }>(sql`
        select
          exists (
            select
              1

            from
              purchase_order_receipts por

            join
              purchase_order_receipt_lines porl
                on porl.receipt_id =
                   por.id

            join
              purchase_order_lines pol
                on pol.id =
                   porl.purchase_order_line_id

            where
              por.purchase_order_id in (
                ${sql.join(
                  purchaseOrderIds.map(
                    (id) =>
                      sql`${id}`,
                  ),
                  sql`,`,
                )}
              )

              and pol.commercial_code =
                ${commercialCode}

              and porl.received_quantity >
                0
          )
            as has_direct_receipt,

          exists (
            select
              1

            from
              deliveries d

            join
              delivery_lines dl
                on dl.delivery_id =
                   d.id

            where
              d.purchase_order_id in (
                ${sql.join(
                  purchaseOrderIds.map(
                    (id) =>
                      sql`${id}`,
                  ),
                  sql`,`,
                )}
              )

              and dl.commercial_code =
                ${commercialCode}
          )
            as has_legacy_delivery
      `);

    return (
      resolveAuthorizationFulfillmentInventoryMode({
        hasDirectReceipt:
          Boolean(
            flow.rows[0]
              ?.has_direct_receipt,
          ),

        hasLegacyDelivery:
          Boolean(
            flow.rows[0]
              ?.has_legacy_delivery,
          ),
      })
    );
  }


  private async lockAllocations(
    tx: Tx,
    authorizationItemId: string,
    purchaseOrderCode: string,
  ): Promise<AllocationRow[]> {
    return (
      await tx.execute<AllocationRow>(
        sql`
          select
            iaa.id,

            iaa.purchase_order_id,

            po.purchase_order_code,

            iaa.commercial_code,

            iaa.dispensing_point_id,

            iaa.allocated_quantity,

            iaa.consumed_quantity,

            iaa.released_quantity

          from
            inventory_authorization_allocations iaa

          join purchase_orders po
            on po.id =
               iaa.purchase_order_id

          where
            iaa.authorization_item_id =
              ${authorizationItemId}

            and po.purchase_order_code =
              ${purchaseOrderCode}

            and iaa.status in (
              'ALLOCATED',
              'PARTIALLY_CONSUMED'
            )

            and (
              iaa.allocated_quantity
              -
              iaa.consumed_quantity
              -
              iaa.released_quantity
            ) > 0

          order by
            iaa.created_at,
            iaa.id

          for update of iaa
        `,
      )
    ).rows;
  }

  private async lockFefoLots(
    tx: Tx,
    commercialCode: string,
    dispensingPointId: string,
    effectiveDate: string,
  ): Promise<LotRow[]> {
    /*
     * Para cierres históricos necesitamos dos garantías:
     *
     * 1. el lote tenía saldo en la fecha efectiva;
     * 2. ese consumo histórico tampoco puede llevar
     *    el saldo actual a negativo.
     *
     * Por eso el saldo utilizable es:
     *
     * min(saldo_en_fecha, saldo_actual)
     */
    return (
      await tx.execute<LotRow>(
        sql`
          select
            l.id,

            l.lot_number,

            l.expiration_date::text,

            least(
              balances.current_balance,
              balances.effective_balance
            )::int
              as balance

          from
            inventory_lots l

          cross join lateral (
            select
              coalesce(
                sum(
                  m.quantity_delta
                ),
                0
              )::int
                as current_balance,

              coalesce(
                sum(
                  m.quantity_delta
                )
                filter (
                  where
                    m.occurred_at
                    <
                    (
                      (
                        ${effectiveDate}::date
                        +
                        1
                      )::timestamp
                      at time zone
                      'America/Bogota'
                    )
                ),
                0
              )::int
                as effective_balance

            from
              inventory_movements m

            where
              m.inventory_lot_id =
                l.id
          ) balances

          where
            l.commercial_code =
              ${commercialCode}

            and l.dispensing_point_id =
              ${dispensingPointId}

            and l.expiration_date >=
              ${effectiveDate}::date

            and least(
              balances.current_balance,
              balances.effective_balance
            ) > 0

          order by
            l.expiration_date,
            l.lot_number,
            l.id

          for update of l
        `,
      )
    ).rows;
  }

}
