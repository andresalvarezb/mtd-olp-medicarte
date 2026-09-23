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
  parseAuthorizationExpiration,
} from '@authorization/domain';

import type {
  Scope,
} from '../common/request-scope';

import {
  applyPointScope,
  lockActivePointGrants,
} from '../common/point-scope.sql';

import {
  DATABASE,
} from '../tokens';

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
  expiration_raw: string | null;
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

        const existing =
          (
            await tx.execute<{
              id: string;
            }>(sql`
              select id
              from authorization_fulfillments
              where authorization_item_id =
                ${authorizationItemId}
              limit 1
            `)
          ).rows[0];

        const previousApplication =
          (
            await tx.execute<{
              id: string;
            }>(sql`
              select id
              from patient_applications
              where authorization_item_id =
                ${authorizationItemId}
                and status = 'CONFIRMED'
              limit 1
            `)
          ).rows[0];

        if (previousApplication) {
          throw new Error(
            'AUTHORIZATION_FULFILLMENT_ALREADY_APPLIED',
          );
        }

        await this.ensureAutomaticAllocation(
          tx,
          authorizationItemId,
          authorization.commercial_code,
          body.purchaseOrderCode,
          body.effectiveDate,
          scope,
        );

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

        const assignedQuantity =
          allocations.reduce(
            (
              total,
              row,
            ) =>
              total +
              Math.max(
                row.allocated_quantity -
                  row.consumed_quantity -
                  row.released_quantity,
                0,
              ),
            0,
          );

        const expiration =
          parseAuthorizationExpiration(
            authorization.expiration_raw,
          );

        assertAuthorizationFulfillment({
          effectiveDate:
            body.effectiveDate,

          validityEndDate:
            expiration,

          todayBogota:
            currentBogotaDate(),

          assignedQuantity,

          pointCount:
            pointIds.size,

          alreadyClosed:
            Boolean(existing),
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

        const lots =
          await this.lockFefoLots(
            tx,
            authorization.commercial_code,
            dispensingPointId,
            body.effectiveDate,
          );

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
          assignedQuantity
        ) {
          throw new Error(
            'AUTHORIZATION_FULFILLMENT_INSUFFICIENT_INVENTORY',
          );
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
                ${assignedQuantity},
                ${source},
                ${scope.userId}
              )
              returning
                id,
                confirmed_at
            `)
          ).rows[0]!;

        let lotIndex = 0;
        let lotRemaining =
          lots[0]?.balance ?? 0;

        for (
          const allocation
          of allocations
        ) {
          let allocationRemaining =
            Math.max(
              allocation.allocated_quantity -
                allocation.consumed_quantity -
                allocation.released_quantity,
              0,
            );

          while (
            allocationRemaining > 0
          ) {
            const lot =
              lots[lotIndex];

            if (!lot) {
              throw new Error(
                'AUTHORIZATION_FULFILLMENT_INSUFFICIENT_INVENTORY',
              );
            }

            if (lotRemaining <= 0) {
              lotIndex += 1;

              lotRemaining =
                lots[lotIndex]
                  ?.balance ?? 0;

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
                  returning id
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

          await tx.execute(sql`
            update
              inventory_authorization_allocations

            set
              consumed_quantity =
                consumed_quantity
                +
                ${Math.max(
                  allocation.allocated_quantity -
                    allocation.consumed_quantity -
                    allocation.released_quantity,
                  0,
                )},

              status =
                'CONSUMED',

              updated_by =
                ${scope.userId},

              updated_at =
                now()

            where
              id =
                ${allocation.id}
          `);
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
                assignedQuantity,
              dispensingPointId,
              source,
            })}::jsonb,
            ${scope.correlationId},
            ${scope.correlationId},
            'SUCCESS'
          )
        `);

        return {
          id:
            inserted.id,

          authorizationItemId,

          fulfillmentType:
            body.fulfillmentType,

          effectiveDate:
            body.effectiveDate,

          quantity:
            assignedQuantity,

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

            i.source_data
              ->>
              'FECHA_FINAL_VIGENCIA'
              as expiration_raw

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

  private async ensureAutomaticAllocation(
    tx: Tx,
    authorizationItemId: string,
    commercialCode: string,
    purchaseOrderCode: string,
    effectiveDate: string,
    scope: Scope,
  ): Promise<void> {
    const existing =
      await tx.execute<{
        id: string;
      }>(sql`
        select
          iaa.id

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

        limit 1

        for update of iaa
      `);

    if (
      existing.rows[0]
    ) {
      return;
    }


    const source =
      await tx.execute<{
        purchase_order_id: string;
        purchase_order_code: string;
        authorization_version: number;
        required_quantity: number;
        dispensing_point_id: string | null;
      }>(sql`
        select
          po.id
            as purchase_order_id,

          po.purchase_order_code,

          ai.version
            as authorization_version,

          sum(
            poas.source_quantity_snapshot
          )::int
            as required_quantity,

          (
            select
              ps.dispensing_point_id

            from
              patient_schedules ps

            where
              ps.authorization_item_id =
                ai.id

              and ps.status in (
                'SCHEDULED',
                'RESCHEDULED'
              )

            order by
              ps.scheduled_date desc,
              ps.revision desc,
              ps.created_at desc,
              ps.id desc

            limit 1
          )
            as dispensing_point_id

        from
          purchase_order_authorization_sources poas

        join purchase_order_lines pol
          on pol.id =
             poas.purchase_order_line_id

        join purchase_orders po
          on po.id =
             pol.purchase_order_id

        join authorization_items ai
          on ai.id =
             poas.authorization_item_id

        where
          poas.authorization_item_id =
            ${authorizationItemId}

          and po.purchase_order_code =
            ${purchaseOrderCode}

          and pol.commercial_code =
            ${commercialCode}

          and po.status not in (
            'CANCELLED',
            'REJECTED'
          )

        group by
          po.id,
          po.purchase_order_code,
          ai.id,
          ai.version

        limit 2
      `);

    if (
      source.rows.length !==
      1
    ) {
      throw new Error(
        'AUTHORIZATION_FULFILLMENT_OC_NOT_ELIGIBLE',
      );
    }

    const target =
      source.rows[0]!;

    if (
      !target.dispensing_point_id
    ) {
      throw new Error(
        'AUTHORIZATION_FULFILLMENT_SCHEDULE_REQUIRED',
      );
    }

    if (
      target.required_quantity <=
      0
    ) {
      throw new Error(
        'AUTHORIZATION_FULFILLMENT_QUANTITY_INVALID',
      );
    }


    /*
     * Serializa:
     * OC + producto + punto.
     *
     * Dos usuarios pueden intentar consumir la última unidad
     * al mismo tiempo; solamente uno debe ganar.
     */
    const poolLockKey =
      [
        'OC_POOL',
        target.purchase_order_id,
        commercialCode,
        target.dispensing_point_id,
      ].join(':');

    await tx.execute(sql`
      select
        pg_advisory_xact_lock(
          hashtextextended(
            ${poolLockKey},
            0
          )
        )
    `);


    /*
     * Revalidar después del advisory lock.
     */
    const duplicate =
      await tx.execute<{
        id: string;
      }>(sql`
        select
          iaa.id

        from
          inventory_authorization_allocations iaa

        where
          iaa.authorization_item_id =
            ${authorizationItemId}

          and iaa.purchase_order_id =
            ${target.purchase_order_id}

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

        limit 1

        for update
      `);

    if (
      duplicate.rows[0]
    ) {
      return;
    }


    /*
     * Cantidad efectivamente recibida para esta OC/producto/punto.
     *
     * Se usa el ledger físico (inventory_movements) porque incluye
     * tanto la recepción histórica delivery/receipt como la recepción
     * directa de la OC.
     */
    const received =
      await tx.execute<{
        quantity: number;
      }>(sql`
        with received_sources as (
          select
            im.quantity_delta
              as quantity

          from
            inventory_movements im

          join inventory_lots il
            on il.id =
               im.inventory_lot_id

          join purchase_order_receipt_lines porl
            on porl.id =
               im.source_id

          join purchase_order_receipts por
            on por.id =
               porl.receipt_id

          join purchase_order_lines pol
            on pol.id =
               porl.purchase_order_line_id

          where
            im.movement_type =
              'RECEIPT'

            and im.source_type =
              'PURCHASE_ORDER_RECEIPT_LINE'

            and por.purchase_order_id =
              ${target.purchase_order_id}

            and pol.commercial_code =
              ${commercialCode}

            and il.dispensing_point_id =
              ${target.dispensing_point_id}

            and il.expiration_date >=
              ${effectiveDate}::date

          union all

          select
            im.quantity_delta
              as quantity

          from
            inventory_movements im

          join inventory_lots il
            on il.id =
               im.inventory_lot_id

          join receipt_lines rl
            on rl.id =
               im.source_id

          join delivery_lines dl
            on dl.id =
               rl.delivery_line_id

          join deliveries d
            on d.id =
               dl.delivery_id

          where
            im.movement_type =
              'RECEIPT'

            and im.source_type =
              'RECEIPT_LINE'

            and d.purchase_order_id =
              ${target.purchase_order_id}

            and dl.commercial_code =
              ${commercialCode}

            and il.dispensing_point_id =
              ${target.dispensing_point_id}

            and il.expiration_date >=
              ${effectiveDate}::date
        )

        select
          coalesce(
            sum(quantity),
            0
          )::int
            as quantity

        from
          received_sources
      `);


    const allocationState =
      await tx.execute<{
        consumed: number;
        assigned: number;
      }>(sql`
        select
          coalesce(
            sum(
              consumed_quantity
            ),
            0
          )::int
            as consumed,

          coalesce(
            sum(
              case
                when status in (
                  'ALLOCATED',
                  'PARTIALLY_CONSUMED'
                )
                then greatest(
                  allocated_quantity
                  -
                  consumed_quantity
                  -
                  released_quantity,
                  0
                )
                else 0
              end
            ),
            0
          )::int
            as assigned

        from
          inventory_authorization_allocations

        where
          purchase_order_id =
            ${target.purchase_order_id}

          and commercial_code =
            ${commercialCode}

          and dispensing_point_id =
            ${target.dispensing_point_id}
      `);


    const receivedQuantity =
      received.rows[0]?.quantity ??
      0;

    const consumedQuantity =
      allocationState.rows[0]?.consumed ??
      0;

    const assignedQuantity =
      allocationState.rows[0]?.assigned ??
      0;

    const availableQuantity =
      Math.max(
        receivedQuantity
        -
        consumedQuantity
        -
        assignedQuantity,
        0,
      );


    /*
     * Regla crítica:
     * jamás reservar ni consumir parcialmente una autorización.
     */
    if (
      availableQuantity <
      target.required_quantity
    ) {
      throw new Error(
        'AUTHORIZATION_FULFILLMENT_INSUFFICIENT_OC_POOL',
      );
    }


    /*
     * Se conserva la tabla histórica de allocations como ledger
     * interno, pero ya no requiere cargue manual.
     *
     * El batch se genera automáticamente y no aparece en el
     * historial XLSX porque source = UI.
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
          ${scope.organizationId},
          'UI',
          null,
          'CONFIRMED',
          1,
          1,
          0,
          ${target.required_quantity},
          ${scope.correlationId},
          ${scope.userId},
          ${scope.userId},
          now()
        )
        returning
          id
      `);


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
        ${scope.organizationId},
        ${authorizationItemId},
        ${target.purchase_order_id},
        ${commercialCode},
        ${target.dispensing_point_id},
        ${target.required_quantity},
        0,
        0,
        'ALLOCATED',
        ${target.authorization_version},
        ${scope.userId},
        ${scope.userId}
      )
    `);
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
