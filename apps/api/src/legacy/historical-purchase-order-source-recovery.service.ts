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

import {
  DATABASE,
} from '../tokens';


type Database =
  ReturnType<
    typeof createDatabase
  >;

export type HistoricalPurchaseOrderRecoveryTx =
  Parameters<
    Parameters<
      Database['db']['transaction']
    >[0]
  >[0];


/**
 * ESP-016 historical boundary.
 *
 * Lee exclusivamente evidencia operacional histórica
 * todavía persistida en authorization_items y la convierte
 * en lineage moderno purchase_order_authorization_sources.
 *
 * NO crea inventory allocations.
 * NO decide estado operativo.
 * NO sustituye el allocator canónico.
 */
@Injectable()
export class HistoricalPurchaseOrderSourceRecoveryService {
  constructor(
    @Inject(DATABASE)
    private readonly database:
      Database,
  ) {}


  async recoverForPurchaseOrder(
    tx: HistoricalPurchaseOrderRecoveryTx,
    purchaseOrderId: string,
  ): Promise<void> {
    await this.recoverOn(
      tx,
      {
        purchaseOrderId,
        purchaseOrderCode:
          null,
        cursor:
          null,
        limit:
          1,
        requirePhysicalReceipt:
          false,
      },
    );
  }


  async recoverPage(
    options: {
      purchaseOrderCode:
        string | null;

      cursor:
        string | null;

      limit:
        number;
    },
  ): Promise<void> {
    await this.recoverOn(
      this.database.db,
      {
        purchaseOrderId:
          null,

        purchaseOrderCode:
          options.purchaseOrderCode,

        cursor:
          options.cursor,

        limit:
          options.limit,

        requirePhysicalReceipt:
          true,
      },
    );
  }


  private async recoverOn(
    connection:
      | HistoricalPurchaseOrderRecoveryTx
      | Database['db'],

    options: {
      purchaseOrderId:
        string | null;

      purchaseOrderCode:
        string | null;

      cursor:
        string | null;

      limit:
        number;

      requirePhysicalReceipt:
        boolean;
    },
  ): Promise<void> {
    const {
      purchaseOrderId,
      purchaseOrderCode,
      cursor,
      limit,
      requirePhysicalReceipt,
    } =
      options;


    await connection.execute(sql`
      with candidate_orders as (
        select
          po.id

        from
          purchase_orders po

        where
          (
            ${purchaseOrderId}::uuid
              is null

            or

            po.id =
              ${purchaseOrderId}::uuid
          )

          and (
            ${purchaseOrderCode}::text
              is null

            or

            po.purchase_order_code =
              ${purchaseOrderCode}
          )

          and (
            ${cursor}::uuid
              is null

            or

            po.id >
              ${cursor}::uuid
          )

          and (
            ${requirePhysicalReceipt}
              = false

            or

            exists (
              select
                1

              from
                purchase_order_receipts por

              join
                purchase_order_receipt_lines porl
                  on porl.receipt_id =
                     por.id

              where
                por.purchase_order_id =
                  po.id

                and porl.received_quantity >
                  0
            )

            or

            exists (
              select
                1

              from
                deliveries d

              join
                receipts r
                  on r.delivery_id =
                     d.id

              join
                receipt_lines rl
                  on rl.receipt_id =
                     r.id

              where
                d.purchase_order_id =
                  po.id

                and r.status =
                  'CONFIRMED'

                and rl.accepted_quantity >
                  0
            )
          )

          and exists (
            select
              1

            from
              authorization_items ai

            join
              purchase_order_lines pol
                on pol.purchase_order_id =
                   po.id

               and btrim(
                     pol.commercial_code
                   ) =
                   btrim(
                     ai.codigo_medicamento
                   )

            where
              po.purchase_order_code
                is not null

              and ai.orden_compra
                is not null

              and btrim(
                    ai.orden_compra
                  ) =
                  btrim(
                    po.purchase_order_code
                  )

              and btrim(
                    coalesce(
                      ai.source_data
                        ->> 'CANTIDAD',
                      ''
                    )
                  )
                  ~ '^[1-9][0-9]*$'
          )

        order by
          po.id asc

        limit
          ${limit}
      ),


      base as (
        select
          ai.id
            as authorization_item_id,

          pol.id
            as purchase_order_line_id,

          (
            ai.source_data
              ->> 'CANTIDAD'
          )::int
            as source_quantity_snapshot,

          ai.lugar_dispensacion,

          dp.code
            as dispensing_point_code,

          dp.name
            as dispensing_point_name,

          (
            ai.lugar_dispensacion
              is not null

            and (
              lower(
                btrim(
                  ai.lugar_dispensacion
                )
              ) =
              lower(
                btrim(
                  coalesce(
                    dp.code,
                    ''
                  )
                )
              )

              or

              lower(
                btrim(
                  ai.lugar_dispensacion
                )
              ) =
              lower(
                btrim(
                  coalesce(
                    dp.name,
                    ''
                  )
                )
              )
            )
          )
            as point_match

        from
          candidate_orders candidate

        join
          purchase_orders po
            on po.id =
               candidate.id

        join
          authorization_items ai
            on po.purchase_order_code
               is not null

           and ai.orden_compra
               is not null

           and btrim(
                 ai.orden_compra
               ) =
               btrim(
                 po.purchase_order_code
               )

        join
          purchase_order_lines pol
            on pol.purchase_order_id =
               po.id

           and btrim(
                 pol.commercial_code
               ) =
               btrim(
                 ai.codigo_medicamento
               )

        left join
          tariff_annex_products tap
            on tap.codigo_producto =
               pol.commercial_code

           and tap.active =
               true

        left join
          product_delivery_point_mappings mapped
            on pol.dispensing_point_id
               is null

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

        left join
          dispensing_points dp
            on dp.id =
               coalesce(
                 pol.dispensing_point_id,
                 mapped.dispensing_point_id
               )

        where
          btrim(
            coalesce(
              ai.source_data
                ->> 'CANTIDAD',
              ''
            )
          )
          ~ '^[1-9][0-9]*$'
      ),


      ranked as (
        select
          base.*,

          count(*) over (
            partition by
              authorization_item_id
          )
            as product_line_count,

          sum(
            case
              when point_match
                then 1
              else 0
            end
          ) over (
            partition by
              authorization_item_id
          )
            as point_match_count

        from
          base
      ),


      resolved as (
        select
          authorization_item_id,
          purchase_order_line_id,
          source_quantity_snapshot

        from
          ranked

        where
          product_line_count =
            1

          or (
            product_line_count >
              1

            and point_match_count =
              1

            and point_match =
              true
          )
      )


      insert into
        purchase_order_authorization_sources (
          purchase_order_line_id,
          authorization_item_id,
          projected_demand_line_id,
          projected_demand_revision,
          source_quantity_snapshot,
          provenance,
          evidence_at,
          created_at
        )

      select
        resolved.purchase_order_line_id,
        resolved.authorization_item_id,
        null,
        null,
        resolved.source_quantity_snapshot,
        'LEGACY_CURRENT_STATE',
        null,
        now()

      from
        resolved

      on conflict (
        purchase_order_line_id,
        authorization_item_id
      )
      do nothing
    `);
  }
}
