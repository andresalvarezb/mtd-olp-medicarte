import {
  randomUUID,
} from 'node:crypto';

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

  on?(event: 'error', listener: (error: Error) => void): unknown;
  removeListener?(event: 'error', listener: (error: Error) => void): unknown;

  release(error?: Error | boolean): void;
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

    releasedPurchaseOrderSources:
      number;

    releasedPurchaseSourceSnapshotQuantity:
      number;

    clearedAuthorizations:
      number;
  }>;


type ExpiringAuthorization = Readonly<{
  id: string;
  expiration_raw: string | null;
}>;


type InventoryAllocation = Readonly<{
  id: string;
  organization_id: string;
  allocated_quantity: number;
  consumed_quantity: number;
  released_quantity: number;
  status: string;
}>;


type PurchaseOrderSource = Readonly<{
  id: string;
  purchase_order_line_id: string;
  source_quantity_snapshot: number;
}>;


function isStrictIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed =
    new Date(
      value + 'T00:00:00.000Z',
    );

  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}


function normalizeAuthorizationExpiration(
  value: unknown,
): string | null {
  if (
    typeof value !==
    'string'
  ) {
    return null;
  }

  const raw =
    value.trim();

  if (!raw) {
    return null;
  }

  const compact =
    /^(\d{4})(\d{2})(\d{2})$/.exec(
      raw,
    );

  if (compact) {
    const normalized =
      compact[1]
      + '-'
      + compact[2]
      + '-'
      + compact[3];

    return isStrictIsoDate(normalized)
      ? normalized
      : null;
  }

  const iso =
    /^(\d{4}-\d{2}-\d{2})/.exec(
      raw,
    );

  if (iso) {
    return isStrictIsoDate(iso[1]!)
      ? iso[1]!
      : null;
  }

  return null;
}


function subtractCalendarDays(
  value: string,
  days: number,
): string {
  const [
    year,
    month,
    day,
  ] =
    value
      .split('-')
      .map(Number);

  return new Date(
    Date.UTC(
      year!,
      month! - 1,
      day! - days,
    ),
  )
    .toISOString()
    .slice(
      0,
      10,
    );
}


/*
 * Desde el sexto día posterior al vencimiento, libera las reservas y fuentes
 * activas únicamente cuando no hay atención confirmada. Las filas históricas de OC,
 * asignaciones, recepciones y consumos se conservan.
 */
export async function runInventoryExpirationReleaseSweep(
  database: DatabaseLike,
  todayBogota: string,
): Promise<InventoryExpirationReleaseResult> {
  const client =
    (await database.pool.connect()) as QueryClient;
  let connectionError: Error | boolean | undefined;
  let transactionOpen = false;
  const onClientError = (error: Error) => {
    connectionError = error;
  };
  client.on?.('error', onClientError);

  const begin = async () => {
    await client.query('BEGIN');
    transactionOpen = true;
  };
  const commit = async () => {
    await client.query('COMMIT');
    transactionOpen = false;
  };
  const rollback = async (): Promise<boolean> => {
    if (!transactionOpen) return true;
    try {
      await client.query('ROLLBACK');
      return true;
    } catch {
      connectionError = true;
      return false;
    } finally {
      transactionOpen = false;
    }
  };

  try {
    await begin();

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
      await commit();

      return {
        expiredAuthorizations: 0,
        releasedAllocations: 0,
        releasedQuantity: 0,
        releasedPurchaseOrderSources: 0,
        releasedPurchaseSourceSnapshotQuantity: 0,
        clearedAuthorizations: 0,
      };
    }

    const releaseCutoffDate =
      subtractCalendarDays(
        todayBogota,
        5,
      );

    let expiredAuthorizations = 0;
    let releasedAllocations = 0;
    let releasedQuantity = 0;
    let releasedPurchaseOrderSources = 0;
    let releasedPurchaseSourceSnapshotQuantity = 0;
    let clearedAuthorizations = 0;

    /*
     * La comparación es de fecha calendario Bogotá. La normalización cubre
     * los formatos compactos e ISO usados por las cargas de autorizaciones.
     */
    const candidates =
      await client.query<ExpiringAuthorization>(
        `
          WITH linked_authorizations AS (
            SELECT DISTINCT
              iaa.authorization_item_id

            FROM
              inventory_authorization_allocations iaa

            WHERE
              iaa.status IN (
                'ALLOCATED',
                'PARTIALLY_CONSUMED',
                'EXPIRED'
              )

              AND iaa.allocated_quantity >
                iaa.consumed_quantity + iaa.released_quantity

            UNION

            SELECT
              poas.authorization_item_id

            FROM
              purchase_order_authorization_sources poas

            WHERE
              poas.released_at IS NULL
          ),

          authorization_dates AS (
            SELECT
              ai.id,
              ai.source_data ->> 'FECHA_FINAL_VIGENCIA'
                AS expiration_raw,
              CASE
                WHEN ai.source_data ->> 'FECHA_FINAL_VIGENCIA'
                  ~ '^[0-9]{8}$'
                THEN
                  substring(ai.source_data ->> 'FECHA_FINAL_VIGENCIA', 1, 4)
                  || '-'
                  || substring(ai.source_data ->> 'FECHA_FINAL_VIGENCIA', 5, 2)
                  || '-'
                  || substring(ai.source_data ->> 'FECHA_FINAL_VIGENCIA', 7, 2)

                WHEN ai.source_data ->> 'FECHA_FINAL_VIGENCIA'
                  ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                THEN
                  substring(ai.source_data ->> 'FECHA_FINAL_VIGENCIA', 1, 10)

                ELSE NULL
              END
                AS expiration_date

            FROM
              linked_authorizations linked

            JOIN
              authorization_items ai
                ON ai.id = linked.authorization_item_id

            WHERE
              ai.annulled_at IS NULL

              AND ai.source_status_normalized <> 'ANULADA'

              AND NOT (
                ai.source_data ? '__mtdAnnulment'
              )
          )

          SELECT
            id,
            expiration_raw

          FROM
            authorization_dates

          WHERE
            expiration_date < $1::text

            AND NOT (
              EXISTS (
                SELECT 1
                FROM authorization_fulfillments af
                WHERE af.authorization_item_id = authorization_dates.id
                  AND af.quantity > 0
                  AND af.confirmed_at IS NOT NULL
              )
              OR EXISTS (
                SELECT 1
                FROM patient_applications pa
                JOIN patient_application_lines pal
                  ON pal.patient_application_id = pa.id
                WHERE pa.authorization_item_id = authorization_dates.id
                  AND pa.status = 'CONFIRMED'
                  AND pa.confirmed_by IS NOT NULL
                  AND pa.confirmed_at IS NOT NULL
                  AND pal.quantity > 0
              )
              OR EXISTS (
                SELECT 1
                FROM inventory_authorization_allocations iaa
                WHERE iaa.authorization_item_id = authorization_dates.id
                  AND iaa.consumed_quantity > 0
              )
            )

          ORDER BY
            id
        `,
        [
          releaseCutoffDate,
        ],
      );

    await commit();

    for (
      const candidate of
      candidates.rows
    ) {
      const expirationDate =
        normalizeAuthorizationExpiration(
          candidate.expiration_raw,
        );

      if (
        expirationDate === null
        ||
        expirationDate >= releaseCutoffDate
      ) {
        continue;
      }

      await begin();
      const previousCounts = {
        expiredAuthorizations,
        releasedAllocations,
        releasedQuantity,
        releasedPurchaseOrderSources,
        releasedPurchaseSourceSnapshotQuantity,
        clearedAuthorizations,
      };

      try {

      /*
       * El importador bloquea primero las OC. Mantener ese orden evita que
       * el worker invierta los locks al competir con una reasignación.
       */
      await client.query(
        `
          SELECT
            po.id

          FROM
            purchase_orders po

          WHERE
            EXISTS (
              SELECT
                1

              FROM
                inventory_authorization_allocations iaa

              WHERE
                iaa.authorization_item_id = $1

                AND iaa.purchase_order_id = po.id
            )

            OR EXISTS (
              SELECT
                1

              FROM
                purchase_order_authorization_sources poas

              JOIN
                purchase_order_lines pol
                  ON pol.id = poas.purchase_order_line_id

              WHERE
                poas.authorization_item_id = $1

                AND pol.purchase_order_id = po.id
            )

          ORDER BY
            po.id

          FOR UPDATE OF po NOWAIT
        `,
        [
          candidate.id,
        ],
      );

      const authorization =
        await client.query<{
          id: string;
          expiration_raw: string | null;
        }>(
          `
            SELECT
              id,
              source_data ->> 'FECHA_FINAL_VIGENCIA'
                AS expiration_raw

            FROM
              authorization_items

            WHERE
              id = $1

              AND annulled_at IS NULL

              AND source_status_normalized <> 'ANULADA'

              AND NOT (
                source_data ? '__mtdAnnulment'
              )

            FOR UPDATE NOWAIT
          `,
          [
            candidate.id,
          ],
        );

      const lockedAuthorization =
        authorization.rows[0];

      const lockedExpiration =
        normalizeAuthorizationExpiration(
          lockedAuthorization?.expiration_raw,
        );

      if (
        !lockedAuthorization
        ||
        lockedExpiration === null
        ||
        lockedExpiration >= releaseCutoffDate
      ) {
        await commit();
        continue;
      }

      const attentionEvidence = await client.query<{ has_confirmed_attention: boolean }>(
        `
          SELECT
            EXISTS (
              SELECT 1
              FROM authorization_fulfillments af
              WHERE af.authorization_item_id = $1
                AND af.quantity > 0
                AND af.confirmed_at IS NOT NULL
            )
            OR EXISTS (
              SELECT 1
              FROM patient_applications pa
              JOIN patient_application_lines pal
                ON pal.patient_application_id = pa.id
              WHERE pa.authorization_item_id = $1
                AND pa.status = 'CONFIRMED'
                AND pa.confirmed_by IS NOT NULL
                AND pa.confirmed_at IS NOT NULL
                AND pal.quantity > 0
            )
            OR EXISTS (
              SELECT 1
              FROM inventory_authorization_allocations iaa
              WHERE iaa.authorization_item_id = $1
                AND iaa.consumed_quantity > 0
            )
              AS has_confirmed_attention
        `,
        [candidate.id],
      );

      if (attentionEvidence.rows[0]?.has_confirmed_attention === true) {
        await commit();
        continue;
      }

      const allocations =
        await client.query<InventoryAllocation>(
          `
            SELECT
              id,
              organization_id,
              allocated_quantity,
              consumed_quantity,
              released_quantity,
              status

            FROM
              inventory_authorization_allocations

            WHERE
              authorization_item_id = $1

              AND status IN (
                'ALLOCATED',
                'PARTIALLY_CONSUMED',
                'EXPIRED'
              )

              AND allocated_quantity >
                consumed_quantity + released_quantity

            ORDER BY
              id

            FOR UPDATE NOWAIT
          `,
          [
            candidate.id,
          ],
        );

      const sources =
        await client.query<PurchaseOrderSource>(
          `
            SELECT
              id,
              purchase_order_line_id,
              source_quantity_snapshot

            FROM
              purchase_order_authorization_sources

            WHERE
              authorization_item_id = $1

              AND released_at IS NULL

            ORDER BY
              purchase_order_line_id

            FOR UPDATE NOWAIT
          `,
          [
            candidate.id,
          ],
        );

      const releasePurchaseSources = true;

      if (
        allocations.rows.length === 0
        && (sources.rows.length === 0 || !releasePurchaseSources)
      ) {
        await commit();
        continue;
      }

      const correlationId =
        randomUUID();

      const requestId =
        'expiration-sweep:'
        + todayBogota
        + ':'
        + candidate.id;

      const auditEvents: Array<{
        action: string;
        resourceType: string;
        resourceId: string;
        before: Record<string, unknown>;
        after: Record<string, unknown>;
      }> = [];

      if (
        allocations.rows.length > 0
      ) {
        const allocationIds =
          allocations.rows.map(
            (allocation) =>
              allocation.id,
          );

        const released =
          await client.query<{
            id: string;
          }>(
            `
              UPDATE
                inventory_authorization_allocations

              SET
                released_quantity =
                  allocated_quantity - consumed_quantity,

                status = 'RELEASED',

                updated_at = now()

              WHERE
                id = ANY($1::uuid[])

                AND allocated_quantity >
                  consumed_quantity + released_quantity

              RETURNING
                id
            `,
            [
              allocationIds,
            ],
          );

        if (
          released.rows.length !==
          allocations.rows.length
        ) {
          throw new Error(
            'INVENTORY_EXPIRATION_ALLOCATION_RELEASE_CONFLICT',
          );
        }

        for (
          const allocation of
          allocations.rows
        ) {
          const quantity =
            Number(allocation.allocated_quantity)
            - Number(allocation.consumed_quantity)
            - Number(allocation.released_quantity);

          releasedAllocations += 1;
          releasedQuantity += quantity;

          auditEvents.push({
            action:
              'INVENTORY_ALLOCATION_AUTO_RELEASED_EXPIRED',
            resourceType:
              'inventory_authorization_allocation',
            resourceId:
              allocation.id,
            before: {
              allocatedQuantity:
                Number(allocation.allocated_quantity),
              consumedQuantity:
                Number(allocation.consumed_quantity),
              releasedQuantity:
                Number(allocation.released_quantity),
              status:
                allocation.status,
            },
            after: {
              allocatedQuantity:
                Number(allocation.allocated_quantity),
              consumedQuantity:
                Number(allocation.consumed_quantity),
              releasedQuantity:
                Number(allocation.allocated_quantity)
                - Number(allocation.consumed_quantity),
              releasedThisRun:
                quantity,
              status:
                'RELEASED',
              reason:
                'AUTHORIZATION_EXPIRED',
              expirationDate:
                lockedExpiration,
            },
          });
        }
      }

      if (
        sources.rows.length > 0
        && releasePurchaseSources
      ) {
        const sourceIds =
          sources.rows.map(
            (source) =>
              source.id,
          );

        const released =
          await client.query<{
            id: string;
            released_at: string;
          }>(
            `
              UPDATE
                purchase_order_authorization_sources

              SET
                released_at = now(),
                released_by = NULL,
                released_by_type = 'SYSTEM'

              WHERE id = ANY($1::uuid[])

                AND released_at IS NULL

              RETURNING
                id,
                released_at::text
            `,
            [
              sourceIds,
            ],
          );

        if (
          released.rows.length !==
          sources.rows.length
        ) {
          throw new Error(
            'PURCHASE_ORDER_SOURCE_EXPIRATION_RELEASE_CONFLICT',
          );
        }

        const releasedAtById =
          new Map(
            released.rows.map(
              (source) => [
                source.id,
                source.released_at,
              ],
            ),
          );

        releasedPurchaseOrderSources +=
          sources.rows.length;

        releasedPurchaseSourceSnapshotQuantity +=
          sources.rows.reduce(
            (total, source) =>
              total
              + Number(source.source_quantity_snapshot),
            0,
          );

        clearedAuthorizations += 1;

        for (
          const source of
          sources.rows
        ) {
          auditEvents.push({
            action:
              'PURCHASE_ORDER_SOURCE_AUTO_RELEASED_EXPIRED',
            resourceType:
              'purchase_order_authorization_source',
            resourceId:
              source.id,
            before: {
              sourceQuantitySnapshot:
                Number(source.source_quantity_snapshot),
              releasedAt:
                null,
            },
            after: {
              sourceQuantitySnapshot:
                Number(source.source_quantity_snapshot),
              releasedAt:
                releasedAtById.get(
                  source.id,
                ),
              releasedByType:
                'SYSTEM',
              reason:
                'AUTHORIZATION_EXPIRED',
              expirationDate:
                lockedExpiration,
            },
          });
        }
      }

      const auditOrganization =
        await client.query<{
          organization_id: string;
        }>(
          `
            SELECT
              aio.organization_id

            FROM
              authorization_item_organizations aio

            JOIN
              organizations o
                ON o.id = aio.organization_id

            WHERE
              aio.authorization_item_id = $1

              AND o.active = true

              AND o.code IN (
                'MTD',
                'MEDICARTE'
              )

            ORDER BY
              CASE
                WHEN o.code = 'MTD' THEN 0
                ELSE 1
              END,
              aio.organization_id

            LIMIT 1
          `,
          [
            candidate.id,
          ],
        );

      await client.query(
        `
          INSERT INTO audit_events (
            actor_type,
            actor_id,
            organization_id,
            action,
            resource_type,
            resource_id,
            before,
            after,
            correlation_id,
            request_id,
            result
          )

          SELECT
            'SYSTEM',
            NULL,
            $1,
            event ->> 'action',
            event ->> 'resourceType',
            event ->> 'resourceId',
            event -> 'before',
            event -> 'after',
            $2,
            $3,
            'SUCCESS'

          FROM
            jsonb_array_elements($4::jsonb) event
        `,
        [
          auditOrganization.rows[0]?.organization_id ?? null,
          correlationId,
          requestId,
          JSON.stringify(auditEvents),
        ],
      );

      const organizations =
        await client.query<{
          organization_id: string;
        }>(
          `
            SELECT
              aio.organization_id

            FROM
              authorization_item_organizations aio

            JOIN
              organizations o
                ON o.id = aio.organization_id

            WHERE
              aio.authorization_item_id = $1

              AND o.active = true

              AND o.code IN (
                'MTD',
                'MEDICARTE'
              )

            ORDER BY
              aio.organization_id
          `,
          [
            candidate.id,
          ],
        );

      for (
        const organization of
        organizations.rows
      ) {
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

            VALUES (
              'realtime.invalidate',
              1,
              $1::jsonb,
              $2,
              $3,
              $4
            )

            ON CONFLICT (
              idempotency_key
            )

            DO NOTHING
          `,
          [
            JSON.stringify({
              topics: [
                'AUTHORIZATIONS',
                'PURCHASE_ORDERS',
                'INVENTORY',
                'DASHBOARD',
              ],
              resource: {
                type:
                  'authorization_expiration_release',
                id:
                  candidate.id,
              },
            }),
            correlationId,
            organization.organization_id,
            'realtime:expiration-release:'
              + todayBogota
              + ':'
              + candidate.id
              + ':'
              + organization.organization_id,
          ],
        );
      }

      expiredAuthorizations += 1;
      await commit();
      } catch (error) {
        const rollbackSucceeded = await rollback();
        ({
          expiredAuthorizations,
          releasedAllocations,
          releasedQuantity,
          releasedPurchaseOrderSources,
          releasedPurchaseSourceSnapshotQuantity,
          clearedAuthorizations,
        } = previousCounts);
        if (rollbackSucceeded && (error as { code?: string }).code === '55P03') {
          continue;
        }
        throw error;
      }
    }

    /*
     * Las vistas también deben refrescarse cuando cambia la clasificación
     * temporal aunque no haya reservas o compromisos que liberar.
     */
    await begin();
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
          o.active = true

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

    await commit();

    return {
      expiredAuthorizations,
      releasedAllocations,
      releasedQuantity,
      releasedPurchaseOrderSources,
      releasedPurchaseSourceSnapshotQuantity,
      clearedAuthorizations,
    };
  } catch (
    error
  ) {
    await rollback();

    throw error;
  } finally {
    client.removeListener?.('error', onClientError);
    if (connectionError) client.release(connectionError);
    else client.release();
  }
}
