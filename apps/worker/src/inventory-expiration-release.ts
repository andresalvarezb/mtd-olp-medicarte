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
 * POLITICA VIGENTE
 * =================
 *
 * EXPIRED es informativo.
 *
 * El vencimiento:
 *
 * - NO libera inventory_authorization_allocations;
 * - NO incrementa released_quantity;
 * - NO devuelve producto al disponible;
 * - NO rompe AUTO -> OC;
 * - NO impide entregar/aplicar;
 * - NO impide reasignar si se cumplen las demás reglas.
 *
 * La reserva solo sale de la AUTO mediante:
 *
 * 1. consumo real; o
 * 2. reasignación explícita y atómica.
 *
 * Este proceso conserva únicamente la invalidación
 * temporal de los read models.
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
     * Evita invalidaciones concurrentes duplicadas.
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
      lock.rows[0]?.locked !==
        true
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
     * La vigencia depende del día actual.
     *
     * Aunque no exista mutación de inventario,
     * los consumidores deben refrescar el estado
     * IN_WINDOW / EXPIRED / OUTSIDE_HORIZON.
     */
    await client.query(
      `
        INSERT INTO outbox_events (
          event_type,
          version,
          payload,
          correlation_id,
          organization_id,
          idempotency_key
        )

        SELECT
          'realtime.invalidate',
          1,

          jsonb_build_object(
            'topics',
              jsonb_build_array(
                'AUTHORIZATIONS',
                'DASHBOARD'
              ),

            'resource',
              jsonb_build_object(
                'type',
                  'authorization_validity_date',

                'id',
                  $1::text
              )
          ),

          gen_random_uuid(),
          o.id,

          'realtime:validity:'
            || $1::text
            || ':'
            || o.id::text

        FROM
          organizations o

        WHERE
          o.active =
            true

          AND o.code IN (
            'MTD',
            'MEDICARTE'
          )

        ON CONFLICT (
          idempotency_key
        )
        DO NOTHING
      `,
      [
        todayBogota,
      ],
    );


    await client.query(
      'COMMIT',
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
