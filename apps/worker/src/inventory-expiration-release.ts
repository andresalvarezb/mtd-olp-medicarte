type QueryResult<
  Row extends Record<string, unknown>,
> = Readonly<{
  rows: Row[];
  rowCount: number | null;
}>;


type QueryClient = {
  query<
    Row extends Record<string, unknown> =
      Record<string, unknown>,
  >(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;

  release(): void;
};


type DatabaseLike =
  Readonly<{
    pool: Readonly<{
      connect():
        Promise<unknown>;
    }>;
  }>;


export type InventoryExpirationReleaseResult =
  Readonly<{
    expiredAuthorizations:
      number;

    releasedAllocations:
      number;

    releasedQuantity:
      number;

    clearedAuthorizations:
      number;
  }>;


/*
 * Regla:
 *
 * día 0: vence la autorización.
 *
 * días 1..5:
 *   la AUTO ya está vencida,
 *   pero conserva su reserva.
 *
 * día 6+:
 *   FECHA_FINAL_VIGENCIA < HOY - 5
 *
 *   se libera automáticamente el saldo:
 *
 *   allocated
 *   - consumed
 *   - released
 *
 * La allocation histórica NO se elimina.
 */
export async function runInventoryExpirationReleaseSweep(
  database: DatabaseLike,
  todayBogota: string,
): Promise<InventoryExpirationReleaseResult> {
  const client =
    (await database.pool.connect()) as QueryClient;

  try {
    await client.query(
      'BEGIN',
    );


    /*
     * Solo una instancia de worker puede ejecutar
     * el sweep al mismo tiempo.
     */
    const lock =
      await client.query<{
        locked: boolean;
      }>(
        `
          SELECT
            pg_try_advisory_xact_lock(
              hashtextextended(
                'inventory-expiration-release-sweep',
                0
              )
            )
              AS locked
        `,
      );

    if (
      lock.rows[0]?.locked
      !== true
    ) {
      await client.query(
        'ROLLBACK',
      );

      return {
        expiredAuthorizations:
          0,

        releasedAllocations:
          0,

        releasedQuantity:
          0,

        clearedAuthorizations:
          0,
      };
    }


    /*
     * A partir del día 6 libera automáticamente
     * el saldo activo.
     */
    const released =
      await client.query<{
        id: string;

        organization_id: string;

        authorization_item_id: string;

        purchase_order_id: string;

        commercial_code: string;

        released_now: number;
      }>(
        `
          WITH validity AS (
            SELECT
              ai.id,

              CASE
                WHEN
                  BTRIM(
                    COALESCE(
                      ai.source_data
                        ->> 'FECHA_FINAL_VIGENCIA',
                      ''
                    )
                  ) ~ '^[0-9]{8}$'

                  AND TO_CHAR(
                    TO_DATE(
                      BTRIM(
                        ai.source_data
                          ->> 'FECHA_FINAL_VIGENCIA'
                      ),
                      'YYYYMMDD'
                    ),
                    'YYYYMMDD'
                  )
                  =
                  BTRIM(
                    ai.source_data
                      ->> 'FECHA_FINAL_VIGENCIA'
                  )

                THEN TO_DATE(
                  BTRIM(
                    ai.source_data
                      ->> 'FECHA_FINAL_VIGENCIA'
                  ),
                  'YYYYMMDD'
                )


                WHEN
                  BTRIM(
                    COALESCE(
                      ai.source_data
                        ->> 'FECHA_FINAL_VIGENCIA',
                      ''
                    )
                  )
                  ~
                  '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'

                  AND TO_CHAR(
                    TO_DATE(
                      BTRIM(
                        ai.source_data
                          ->> 'FECHA_FINAL_VIGENCIA'
                      ),
                      'YYYY-MM-DD'
                    ),
                    'YYYY-MM-DD'
                  )
                  =
                  BTRIM(
                    ai.source_data
                      ->> 'FECHA_FINAL_VIGENCIA'
                  )

                THEN TO_DATE(
                  BTRIM(
                    ai.source_data
                      ->> 'FECHA_FINAL_VIGENCIA'
                  ),
                  'YYYY-MM-DD'
                )

                ELSE NULL
              END
                AS expiration_date

            FROM
              authorization_items ai
          ),

          eligible AS (
            SELECT
              iaa.id,

              (
                iaa.allocated_quantity
                -
                iaa.consumed_quantity
                -
                iaa.released_quantity
              )::int
                AS released_now

            FROM
              inventory_authorization_allocations iaa

            JOIN
              validity v
                ON v.id =
                   iaa.authorization_item_id

            WHERE
              iaa.status IN (
                'ALLOCATED',
                'PARTIALLY_CONSUMED'
              )

              AND (
                iaa.allocated_quantity
                -
                iaa.consumed_quantity
                -
                iaa.released_quantity
              ) > 0

              AND v.expiration_date
                IS NOT NULL

              AND v.expiration_date
                <
                (
                  $1::date
                  -
                  5
                )

            FOR UPDATE OF iaa
          )

          UPDATE
            inventory_authorization_allocations iaa

          SET
            released_quantity =
              iaa.allocated_quantity
              -
              iaa.consumed_quantity,

            status =
              'EXPIRED',

            updated_at =
              NOW()

          FROM
            eligible e

          WHERE
            iaa.id =
              e.id

          RETURNING
            iaa.id,

            iaa.organization_id,

            iaa.authorization_item_id,

            iaa.purchase_order_id,

            iaa.commercial_code,

            e.released_now
        `,
        [
          todayBogota,
        ],
      );


    const authorizationIds =
      [
        ...new Set(
          released.rows.map(
            (row) =>
              row.authorization_item_id,
          ),
        ),
      ];


    /*
     * La liberación afecta exclusivamente la reserva
     * de inventario.
     *
     * La relación histórica AUTO -> OC permanece
     * intacta y continúa consultándose desde
     * purchase_order_authorization_sources.
     */
    const clearedAuthorizations =
      0;


    /*
     * Trazabilidad del proceso automático.
     */
    for (
      const row of
      released.rows
    ) {
      await client.query(
        `
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
            'SYSTEM',
            NULL,
            $1,
            'INVENTORY_ALLOCATION_AUTO_RELEASED_EXPIRED',
            'inventory_authorization_allocation',
            $2,
            jsonb_build_object(
              'authorizationItemId',
                $3::text,

              'purchaseOrderId',
                $4::text,

              'commercialCode',
                $5::text,

              'releasedQuantity',
                $6::int,

              'graceDays',
                5,

              'effectiveDate',
                $7::text
            ),
            gen_random_uuid(),
            gen_random_uuid(),
            'SUCCESS'
          )
        `,
        [
          row.organization_id,
          row.id,
          row.authorization_item_id,
          row.purchase_order_id,
          row.commercial_code,
          Number(
            row.released_now,
          ),
          todayBogota,
        ],
      );
    }


    await client.query(
      'COMMIT',
    );

    return {
      expiredAuthorizations:
        authorizationIds.length,

      releasedAllocations:
        released.rowCount ?? 0,

      releasedQuantity:
        released.rows.reduce(
          (
            total,
            row,
          ) =>
            total
            +
            Number(
              row.released_now,
            ),
          0,
        ),

      clearedAuthorizations,
    };
  } catch (
    error
  ) {
    await client.query(
      'ROLLBACK',
    );

    throw error;
  } finally {
    client.release();
  }
}
