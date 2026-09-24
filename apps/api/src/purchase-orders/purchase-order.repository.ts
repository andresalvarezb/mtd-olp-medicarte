import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  authorizationPurchaseMonthEnd,
  currentBogotaDate,
  isAuthorizationSourceEnabled,
} from '@authorization/domain';
import type { createDatabase } from '@authorization/database';
import { normalizeInvimaComponent } from '@authorization/domain';
import type {
  CreatePurchaseOrderRequest,
  PurchaseOrderListQuery,
  UpdatePurchaseOrderRequest,
} from '@authorization/contracts';
import { DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
export type PurchaseOrderActor = Readonly<{
  userId: string;
  organizationId: string;
  correlationId: string;
}>;

type LineInput = CreatePurchaseOrderRequest['lines'][number];
type Outcome<T> =
  | T
  | { outcome: 'not_found' }
  | { outcome: 'version_conflict'; currentVersion: number };
type PurchaseOrderJoinedRow = {
  id: string;
  purchase_order_code: string | null;
  planning_period_id: string;
  order_type: 'STANDARD' | 'COMPLEMENTARY';
  status: string;
  version: number;
  issued_at: string | null;
  issued_by: string | null;
  olp_accepted_at: string | null;
  olp_committed_date: string | null;
  created_at: string;
  updated_at: string;
  line_id: string | null;
  commercial_code: string | null;
  product_description: string | null;
  presentation: string | null;
  dispensing_point_id: string | null;
  dispensing_point_code: string | null;
  dispensing_point_name: string | null;
  requested_quantity: number | null;
  accepted_quantity: number | null;
  requested_delivery_date: string | null;
  compensar_unit_rate_snapshot: string | null;
  supplier_unit_cost: string | null;
  projected_demand_line_id: string | null;
  projected_demand_revision: number | null;
  demand_bucket: 'REGULAR' | 'LATE' | null;
  allocated_quantity: number | null;
  current_demand_revision: number | null;
};

@Injectable()
export class PurchaseOrderRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async create(input: { body: CreatePurchaseOrderRequest; actor: PurchaseOrderActor }) {
    return this.database.db.transaction(async (tx) => {
      await this.lockDemandLines(tx, input.body.planningPeriodId, input.body.lines);
      const order = await tx.execute<{ id: string }>(sql`
        insert into purchase_orders (purchase_order_code, planning_period_id, order_type, created_by, updated_by)
        values (${input.body.purchaseOrderCode ?? null}, ${input.body.planningPeriodId}, ${input.body.orderType}, ${input.actor.userId}, ${input.actor.userId}) returning id`);
      const id = order.rows[0]!.id;
      await this.replaceLines(tx, id, input.body.lines, input.body.orderType);
      await this.audit(tx, input.actor, 'PURCHASE_ORDER_CREATED', id, null);
      return this.findByIdOn(tx, id);
    });
  }

  async update(input: {
    id: string;
    body: UpdatePurchaseOrderRequest;
    actor: PurchaseOrderActor;
  }): Promise<Outcome<Awaited<ReturnType<PurchaseOrderRepository['findById']>>>> {
    return this.database.db.transaction(async (tx) => {
      const current = await tx.execute<{
        version: number;
        status: string;
        order_type: 'STANDARD' | 'COMPLEMENTARY';
        planning_period_id: string;
      }>(
        sql`select version, status, order_type, planning_period_id from purchase_orders where id = ${input.id} for update`,
      );
      const row = current.rows[0];
      if (!row) return { outcome: 'not_found' };
      if (row.version !== input.body.expectedVersion)
        return { outcome: 'version_conflict', currentVersion: row.version };
      if (row.status !== 'DRAFT') throw new Error('PURCHASE_ORDER_FROZEN');
      if (input.body.lines) {
        await this.lockDemandLines(tx, row.planning_period_id, input.body.lines);
        await tx.execute(
          sql`delete from purchase_order_demand_allocations where purchase_order_line_id in (select id from purchase_order_lines where purchase_order_id = ${input.id})`,
        );
        await tx.execute(
          sql`delete from purchase_order_lines where purchase_order_id = ${input.id}`,
        );
        await this.replaceLines(tx, input.id, input.body.lines, row.order_type);
      }
      await tx.execute(
        sql`update purchase_orders set purchase_order_code = coalesce(${input.body.purchaseOrderCode ?? null}, purchase_order_code), version = version + 1, updated_at = now(), updated_by = ${input.actor.userId} where id = ${input.id}`,
      );
      await this.audit(tx, input.actor, 'PURCHASE_ORDER_UPDATED', input.id, input.body);
      return this.findByIdOn(tx, input.id);
    });
  }

  async issue(
    id: string,
    expectedVersion: number,
    actor: PurchaseOrderActor,
  ): Promise<Outcome<Awaited<ReturnType<PurchaseOrderRepository['findById']>>>> {
    return this.transition(id, expectedVersion, actor, async (tx, row) => {
      if (row.status !== 'DRAFT') throw new Error('PURCHASE_ORDER_INVALID_TRANSITION');
      const code = await tx.execute<{ purchase_order_code: string | null }>(
        sql`select purchase_order_code from purchase_orders where id = ${id}`,
      );
      if (!code.rows[0]?.purchase_order_code) throw new Error('PURCHASE_ORDER_CODE_REQUIRED');
      await tx.execute(
        sql`update purchase_orders set status = 'ISSUED', issued_at = now(), issued_by = ${actor.userId}, version = version + 1, updated_at = now(), updated_by = ${actor.userId} where id = ${id}`,
      );
      await this.audit(tx, actor, 'PURCHASE_ORDER_ISSUED', id, null);
    });
  }

  async cancel(id: string, expectedVersion: number, actor: PurchaseOrderActor) {
    return this.transition(id, expectedVersion, actor, async (tx, row) => {
      if (!['DRAFT', 'ISSUED'].includes(row.status))
        throw new Error('PURCHASE_ORDER_INVALID_TRANSITION');
      await tx.execute(
        sql`update purchase_orders set status = 'CANCELLED', version = version + 1, updated_at = now(), updated_by = ${actor.userId} where id = ${id}`,
      );
      await this.audit(tx, actor, 'PURCHASE_ORDER_CANCELLED', id, null);
    });
  }

  private async transition(
    id: string,
    expectedVersion: number,
    actor: PurchaseOrderActor,
    action: (tx: Tx, row: { version: number; status: string }) => Promise<void>,
  ) {
    return this.database.db.transaction(async (tx) => {
      const result = await tx.execute<{ version: number; status: string }>(
        sql`select version, status from purchase_orders where id = ${id} for update`,
      );
      const row = result.rows[0];
      if (!row) return { outcome: 'not_found' as const };
      if (row.version !== expectedVersion)
        return { outcome: 'version_conflict' as const, currentVersion: row.version };
      await action(tx, row);
      return this.findByIdOn(tx, id);
    });
  }

  async acceptBySupplier(
    id: string,

    input: {
      expectedVersion: number;

      committedDate: string;

      observation?: string;
    },

    actor: PurchaseOrderActor,
  ) {
    return this.database.db.transaction(
      async (tx) => {
        /*
         * La aceptación OLP es evidencia operacional nueva.
         *
         * Las OC LEGACY_BACKFILL permanecen técnicamente
         * HISTORICAL_ONLY para no alterar la procedencia
         * reconstruida ni violar purchase_orders_origin_shape_check.
         *
         * Su avance operacional se determina mediante
         * olp_accepted_at / olp_committed_date.
         */
        const result =
          await tx.execute<{
            version: number;

            status: string;

            olp_accepted_at:
              Date | null;
          }>(sql`
            select
              version,
              status,
              olp_accepted_at

            from
              purchase_orders

            where
              id = ${id}

            for update
          `);

        const order =
          result.rows[0];

        if (!order) {
          return {
            outcome:
              'not_found' as const,
          };
        }

        if (
          order.version !==
          input.expectedVersion
        ) {
          return {
            outcome:
              'version_conflict' as const,

            currentVersion:
              order.version,
          };
        }

        if (
          order.olp_accepted_at !==
          null
        ) {
          throw new Error(
            'PURCHASE_ORDER_ALREADY_ACCEPTED',
          );
        }

        if (
          ![
            'DRAFT',
            'ISSUED',
            'HISTORICAL_ONLY',
          ].includes(
            order.status,
          )
        ) {
          throw new Error(
            'PURCHASE_ORDER_NOT_ACCEPTABLE',
          );
        }


        /*
         * Siempre exigimos al menos una línea real en la OC.
         */
        const orderLines =
          await tx.execute<{
            id: string;
          }>(sql`
            select
              id

            from
              purchase_order_lines

            where
              purchase_order_id = ${id}

            order by
              id

            for update
          `);

        if (
          orderLines.rows.length <
          1
        ) {
          throw new Error(
            'PURCHASE_ORDER_LINES_REQUIRED',
          );
        }


        /*
         * OC operacionales:
         * OLP acepta la totalidad solicitada.
         *
         * OC históricas:
         * NO modificamos accepted_quantity porque esa columna
         * pertenece a la evidencia reconstruida y además puede
         * estar sujeta al constraint histórico de supplier cost.
         */
        if (
          order.status !==
          'HISTORICAL_ONLY'
        ) {
          await tx.execute(sql`
            update
              purchase_order_lines

            set
              accepted_quantity =
                requested_quantity,

              updated_at =
                now()

            where
              purchase_order_id =
                ${id}
          `);
        }


        /*
         * Para LEGACY_BACKFILL conservamos HISTORICAL_ONLY.
         * Cambiarlo a ACCEPTED rompería el shape constraint.
         *
         * La aceptación OLP se persiste independientemente
         * en sus columnas operacionales.
         */
        await tx.execute(sql`
          update
            purchase_orders

          set
            status =
              case
                when status =
                  'HISTORICAL_ONLY'
                  then
                    'HISTORICAL_ONLY'
                else
                  'ACCEPTED'
              end,

            olp_accepted_at =
              now(),

            olp_accepted_by =
              ${actor.userId},

            olp_committed_date =
              ${input.committedDate}::date,

            version =
              version + 1,

            updated_at =
              now(),

            updated_by =
              ${actor.userId}

          where
            id = ${id}
        `);


        await this.audit(
          tx,
          actor,
          'PURCHASE_ORDER_OLP_ACCEPTED',
          id,
          {
            committedDate:
              input.committedDate,

            observation:
              input.observation ??
              null,

            historicalBackfill:
              order.status ===
              'HISTORICAL_ONLY',
          },
        );


        return this.findByIdOn(
          tx,
          id,
          true,
        );
      },
    );
  }

  async reviewLine(
    id: string,
    lineId: string,
    input: { acceptedQuantity: number; supplierUnitCost?: number; expectedVersion: number },
    actor: PurchaseOrderActor,
  ) {
    return this.database.db.transaction(async (tx) => {
      const order = await tx.execute<{ version: number; status: string }>(
        sql`select version, status from purchase_orders where id = ${id} for update`,
      );
      const row = order.rows[0];
      if (!row || !['ISSUED', 'UNDER_OLP_REVIEW'].includes(row.status))
        throw new Error('PURCHASE_ORDER_NOT_REVIEWABLE');
      if (row.version !== input.expectedVersion)
        return { outcome: 'version_conflict' as const, currentVersion: row.version };
      const update = await tx.execute(
        sql`update purchase_order_lines set accepted_quantity = ${input.acceptedQuantity}, supplier_unit_cost = ${input.supplierUnitCost?.toFixed(2) ?? null}, updated_at = now() where id = ${lineId} and purchase_order_id = ${id} returning id`,
      );
      if (!update.rows[0]) throw new Error('PURCHASE_ORDER_LINE_NOT_FOUND');
      await tx.execute(
        sql`update purchase_orders set status = 'UNDER_OLP_REVIEW', version = version + 1, updated_at = now(), updated_by = ${actor.userId} where id = ${id}`,
      );
      await this.audit(tx, actor, 'PURCHASE_ORDER_LINE_REVIEWED', lineId, input);
      return this.findByIdOn(tx, id);
    });
  }

  async returnBySupplier(
    id: string,
    expectedVersion: number,
    observation: string,
    actor: PurchaseOrderActor,
  ) {
    return this.database.db.transaction(async (tx) => {
      const order = await tx.execute<{
        version: number;
        status: string;
      }>(sql`
        select version, status
        from purchase_orders
        where id = ${id}
        for update
      `);

      const row = order.rows[0];

      if (!row || !['ISSUED', 'UNDER_OLP_REVIEW'].includes(row.status)) {
        throw new Error('PURCHASE_ORDER_NOT_REVIEWABLE');
      }

      if (row.version !== expectedVersion) {
        return {
          outcome: 'version_conflict' as const,
          currentVersion: row.version,
        };
      }

      /*
       * Una devolución de OLP libera toda la cobertura
       * pendiente de la OC.
       *
       * La observación se conserva en audit_events.
       */
      await tx.execute(sql`
        update purchase_order_lines
        set
          accepted_quantity = 0,
          supplier_unit_cost = null,
          updated_at = now()
        where purchase_order_id = ${id}
      `);

      await tx.execute(sql`
        update purchase_orders
        set
          status = 'REJECTED',
          version = version + 1,
          updated_at = now(),
          updated_by = ${actor.userId}
        where id = ${id}
      `);

      await this.audit(tx, actor, 'PURCHASE_ORDER_RETURNED_BY_SUPPLIER', id, {
        observation,
        previousStatus: row.status,
      });

      return this.findByIdOn(tx, id, true);
    });
  }

  async completeReview(id: string, expectedVersion: number, actor: PurchaseOrderActor) {
    return this.database.db.transaction(async (tx) => {
      const order = await tx.execute<{ version: number; status: string }>(
        sql`select version, status from purchase_orders where id = ${id} for update`,
      );
      const row = order.rows[0];
      if (!row || row.status !== 'UNDER_OLP_REVIEW')
        throw new Error('PURCHASE_ORDER_NOT_REVIEWABLE');
      if (row.version !== expectedVersion)
        return { outcome: 'version_conflict' as const, currentVersion: row.version };
      const counts = await tx.execute<{
        total: number;
        accepted: number;
        positive: number;
        full: number;
      }>(
        sql`select count(*)::int total, count(*) filter (where accepted_quantity is not null)::int accepted, count(*) filter (where accepted_quantity > 0)::int positive, count(*) filter (where accepted_quantity = requested_quantity)::int full from purchase_order_lines where purchase_order_id = ${id}`,
      );
      const c = counts.rows[0]!;
      if (c.total !== c.accepted) throw new Error('PURCHASE_ORDER_REVIEW_INCOMPLETE');
      const status =
        c.positive === 0 ? 'REJECTED' : c.full === c.total ? 'ACCEPTED' : 'PARTIALLY_ACCEPTED';
      await tx.execute(
        sql`update purchase_orders set status = ${status}, version = version + 1, updated_at = now(), updated_by = ${actor.userId} where id = ${id}`,
      );
      await this.audit(tx, actor, 'PURCHASE_ORDER_SUPPLIER_REVIEW_COMPLETED', id, { status });
      return this.findByIdOn(tx, id);
    });
  }

  async list(query: PurchaseOrderListQuery, actor: Scope, supplier = false) {
    const filters = query.status ? [sql`true`] : [sql`po.status <> 'CANCELLED'`];
    /*
     * Una OC creada por MTD entra inmediatamente
     * en responsabilidad operacional de OLP.
     *
     * DRAFT se conserva temporalmente como estado técnico
     * legado, pero no impide su consulta por OLP.
     */
    if (query.planningPeriodId)
      filters.push(sql`po.planning_period_id = ${query.planningPeriodId}`);
    if (query.status) filters.push(sql`po.status = ${query.status}`);
    if (query.orderType) filters.push(sql`po.order_type = ${query.orderType}`);
    if (query.purchaseOrderCode)
      filters.push(sql`po.purchase_order_code ilike ${`%${query.purchaseOrderCode}%`}`);
    if (query.commercialCode)
      filters.push(
        sql`exists (
          select 1
          from purchase_order_lines pol
          where pol.purchase_order_id = po.id
            and pol.commercial_code ilike ${`%${query.commercialCode}%`}
        )`,
      );
    if (query.dispensingPointId)
      filters.push(
        sql`exists (select 1 from purchase_order_lines pol where pol.purchase_order_id = po.id and pol.dispensing_point_id = ${query.dispensingPointId})`,
      );
    /*
     * Las OC son creadas por MTD, pero OLP es el proveedor operacional
     * de esas órdenes. Por ello el listado supplier no debe limitarse
     * por po.organization_id = OLP.
     *
     * El acceso continúa protegido por purchase_orders.read en el
     * controller supplier.
     */
    if (
      !supplier &&
      actor.organizationCode ===
        'MEDICARTE'
    ) {
      /*
       * Medicarte entra en el proceso únicamente
       * después de la aceptación de OLP.
       */
      filters.push(
        sql`
          po.olp_accepted_at
            IS NOT NULL
        `,
      );

      /*
       * Una OC es visible para Medicarte cuando al
       * menos una de sus líneas resuelve a un punto
       * vigente dentro de los scopes del usuario.
       *
       * El punto histórico de la línea tiene
       * prioridad; el mapping producto -> punto se
       * usa únicamente como fallback.
       */
      filters.push(
        sql`
          EXISTS (
            SELECT
              1

            FROM
              purchase_order_lines scoped_pol

            LEFT JOIN
              tariff_annex_products scoped_tap
                ON scoped_tap.codigo_producto =
                   scoped_pol.commercial_code

               AND scoped_tap.active =
                   true

            LEFT JOIN
              product_delivery_point_mappings scoped_mapping
                ON scoped_pol.dispensing_point_id
                   IS NULL

               AND BTRIM(
                     COALESCE(
                       scoped_tap.numero_expediente_invima,
                       ''
                     )
                   ) ~ '^[0-9]+$'

               AND BTRIM(
                     COALESCE(
                       scoped_tap.consecutivo_invima_presentacion,
                       ''
                     )
                   ) ~ '^[0-9]+$'

               AND scoped_mapping.invima_record_normalized =
                   COALESCE(
                     NULLIF(
                       LTRIM(
                         BTRIM(
                           scoped_tap.numero_expediente_invima
                         ),
                         '0'
                       ),
                       ''
                     ),
                     '0'
                   )

               AND scoped_mapping.invima_presentation_normalized =
                   COALESCE(
                     NULLIF(
                       LTRIM(
                         BTRIM(
                           scoped_tap.consecutivo_invima_presentacion
                         ),
                         '0'
                       ),
                       ''
                     ),
                     '0'
                   )

            JOIN
              user_point_scopes ups
                ON ups.dispensing_point_id =
                   COALESCE(
                     scoped_pol.dispensing_point_id,
                     scoped_mapping.dispensing_point_id
                   )

               AND ups.user_id =
                   ${actor.userId}::uuid

               AND ups.revoked_at
                   IS NULL

            WHERE
              scoped_pol.purchase_order_id =
                po.id
          )
        `,
      );
    } else if (
      !supplier &&
      actor.organizationCode !==
        'MTD'
    ) {
      filters.push(
        sql`
          po.organization_id =
            ${actor.organizationId}
        `,
      );
    }
    /*
     * UNIVERSAL_OC_STATUS_LIST_V1
     *
     * El status técnico de purchase_orders NO representa por sí
     * solo el estado operacional visible.
     *
     * Especialmente para LEGACY_BACKFILL, HISTORICAL_ONLY debe
     * permanecer inmutable. Por eso calculamos aquí la proyección
     * operacional a partir de:
     *
     * - aceptación OLP,
     * - cantidad solicitada,
     * - recepciones legacy confirmadas,
     * - recepciones directas quantity-only.
     */
    const rows =
      await this.database.db.execute<{
        id: string;
        technical_status: string;
        olp_accepted_at:
          | Date
          | string
          | null;
        requested_quantity: number;
        received_quantity: number;
      }>(sql`
        with visible_orders as (
          select
            po.id,
            po.status
              as technical_status,
            po.olp_accepted_at,
            po.created_at

          from purchase_orders po

          where ${
            sql.join(
              filters,
              sql` and `,
            )
          }

          order by
            po.created_at desc

          limit ${query.limit}
        ),

        requested as (
          select
            pol.purchase_order_id,

            coalesce(
              sum(
                pol.requested_quantity
              ),
              0
            )::int
              as requested_quantity

          from purchase_order_lines pol

          join visible_orders vo
            on vo.id =
               pol.purchase_order_id

          group by
            pol.purchase_order_id
        ),

        received_sources as (
          /*
           * Recepción legacy:
           * deliveries -> receipts.
           */
          select
            d.purchase_order_id,

            rl.received_quantity

          from receipts r

          join deliveries d
            on d.id =
               r.delivery_id

          join receipt_lines rl
            on rl.receipt_id =
               r.id

          join visible_orders vo
            on vo.id =
               d.purchase_order_id

          where r.status =
                'CONFIRMED'


          union all


          /*
           * Recepción directa actual:
           * quantity-only Medicarte.
           */
          select
            por.purchase_order_id,

            porl.received_quantity

          from purchase_order_receipts por

          join purchase_order_receipt_lines porl
            on porl.receipt_id =
               por.id

          join visible_orders vo
            on vo.id =
               por.purchase_order_id
        ),

        received as (
          select
            purchase_order_id,

            coalesce(
              sum(
                received_quantity
              ),
              0
            )::int
              as received_quantity

          from received_sources

          group by
            purchase_order_id
        )

        select
          vo.id,
          vo.technical_status,
          vo.olp_accepted_at,

          coalesce(
            requested.requested_quantity,
            0
          )::int
            as requested_quantity,

          coalesce(
            received.received_quantity,
            0
          )::int
            as received_quantity

        from visible_orders vo

        left join requested
          on requested.purchase_order_id =
             vo.id

        left join received
          on received.purchase_order_id =
             vo.id

        order by
          vo.created_at desc
      `);


    const orders =
      await Promise.all(
        rows.rows.map(
          (row) =>
            this.findById(
              row.id,
              supplier,
            ),
        ),
      );


    return orders.flatMap(
      (
        order,
        index,
      ) => {
        if (!order) {
          return [];
        }

        const snapshot =
          rows.rows[index];

        if (!snapshot) {
          return [];
        }

        const requestedQuantity =
          Number(
            snapshot.requested_quantity ??
            0,
          );

        const receivedQuantity =
          Number(
            snapshot.received_quantity ??
            0,
          );

        const pendingQuantity =
          Math.max(
            requestedQuantity -
            receivedQuantity,
            0,
          );


        const operationalState:
          | 'PENDING_OLP'
          | 'PENDING_MEDICARTE'
          | 'RECEIVED_WITH_PENDING'
          | 'RECEIVED'
          | 'REJECTED'
          | 'CANCELLED' =
          snapshot.technical_status ===
          'CANCELLED'
            ? 'CANCELLED'
            : snapshot.technical_status ===
                'REJECTED'
              ? 'REJECTED'
              : !snapshot.olp_accepted_at
                ? 'PENDING_OLP'
                : receivedQuantity <=
                    0
                  ? 'PENDING_MEDICARTE'
                  : pendingQuantity >
                      0
                    ? 'RECEIVED_WITH_PENDING'
                    : 'RECEIVED';


        return [
          {
            ...order,

            olpAcceptedAt:
              snapshot.olp_accepted_at,

            operationalState,

            requestedQuantity,

            receivedQuantity,

            pendingQuantity,
          },
        ];
      },
    );
  }

  findById(id: string, supplier = false) {
    return this.findByIdOn(this.database.db, id, supplier);
  }

  async findVisibleById(
    id: string,
    actor: Scope,
    supplier = false,
  ) {
    /*
     * MTD conserva lectura global.
     * OLP usa el contrato supplier.
     */
    if (
      actor.organizationCode ===
        'MTD' ||
      supplier
    ) {
      return this.findById(
        id,
        supplier,
      );
    }

    if (
      actor.organizationCode !==
      'MEDICARTE'
    ) {
      return null;
    }

    /*
     * Medicarte no debe conocer una OC antes
     * de que OLP la haya aceptado.
     */
    const order =
      await this.database.db.execute<{
        id: string;

        olp_accepted_at:
          Date | string | null;
      }>(sql`
        SELECT
          po.id,
          po.olp_accepted_at

        FROM
          purchase_orders po

        WHERE
          po.id =
            ${id}

        LIMIT 1
      `);

    if (
      !order.rows[0] ||
      !order.rows[0]
        .olp_accepted_at
    ) {
      return null;
    }

    const pointRows =
      await this.database.db.execute<{
        dispensing_point_id:
          string;
      }>(sql`
        SELECT
          ups.dispensing_point_id

        FROM
          user_point_scopes ups

        WHERE
          ups.user_id =
            ${actor.userId}::uuid

          AND ups.revoked_at
            IS NULL
      `);

    const allowedPoints =
      new Set(
        pointRows.rows.map(
          (row) =>
            row.dispensing_point_id,
        ),
      );

    const detail =
      await this.findById(
        id,
        false,
      );

    if (!detail) {
      return null;
    }

    const lines =
      detail.lines.filter(
        (line) =>
          line.dispensingPointId !==
            null &&
          allowedPoints.has(
            line.dispensingPointId,
          ),
      );

    if (
      lines.length ===
      0
    ) {
      return null;
    }

    return {
      ...detail,

      lines,
    };
  }


  private async operationalDetailUnscoped(id: string, actor: Scope) {
    void actor;
    const orderResult = await this.database.db.execute<{
      id: string;
      purchase_order_code: string | null;
      order_type: string;
      status: string;
      version: number;
      created_at: Date | string;
      updated_at: Date | string;
      issued_at: Date | string | null;
      olp_accepted_at: Date | string | null;
      olp_committed_date: string | null;
      created_by_name: string | null;
      accepted_by_name: string | null;
    }>(sql`
      select
        po.id,
        po.purchase_order_code,
        po.order_type,
        po.status,
        po.version,
        po.created_at,
        po.updated_at,
        po.issued_at,
        po.olp_accepted_at,
        po.olp_committed_date::text,

        coalesce(
          creator.display_name,
          creator.username
        ) as created_by_name,

        coalesce(
          accepter.display_name,
          accepter.username
        ) as accepted_by_name

      from purchase_orders po

      left join users creator
        on creator.id = po.created_by

      left join users accepter
        on accepter.id = po.olp_accepted_by

      where po.id = ${id}

      limit 1
    `);

    const order = orderResult.rows[0];

    if (!order) {
      return null;
    }

    const lineResult = await this.database.db.execute<{
      id: string;
      commercial_code: string;
      product_description: string | null;
      presentation: string | null;
      dispensing_point_id: string | null;
      dispensing_point_code: string | null;
      dispensing_point_name: string | null;
      requested_quantity: number;
      accepted_quantity: number | null;
      compensar_unit_rate_snapshot: string | null;
      supplier_unit_cost: string | null;
      dispatched_quantity: number;
      received_quantity: number;
      accepted_received_quantity: number;
      receipt_outcome: string | null;
    }>(sql`
      with dispatched as (
        select
          dl.purchase_order_line_id,

          coalesce(
            sum(dl.quantity),
            0
          )::int as dispatched_quantity

        from delivery_lines dl

        join deliveries d
          on d.id = dl.delivery_id

        where d.purchase_order_id = ${id}

          and d.status in (
            'DISPATCHED',
            'RECEIVED'
          )

        group by
          dl.purchase_order_line_id
      ),

      received_sources as (
        select
          dl.purchase_order_line_id,

          rl.received_quantity

        from receipt_lines rl

        join receipts r
          on r.id =
             rl.receipt_id

        join delivery_lines dl
          on dl.id =
             rl.delivery_line_id

        join deliveries d
          on d.id =
             dl.delivery_id

        where d.purchase_order_id =
              ${id}

          and r.status =
              'CONFIRMED'

        union all

        select
          porl.purchase_order_line_id,

          porl.received_quantity

        from purchase_order_receipt_lines porl

        join purchase_order_receipts por
          on por.id =
             porl.receipt_id

        where por.purchase_order_id =
              ${id}
      ),

      received as (
        select
          purchase_order_line_id,

          coalesce(
            sum(
              received_quantity
            ),
            0
          )::int as received_quantity,

          coalesce(
            sum(
              received_quantity
            ),
            0
          )::int as accepted_received_quantity

        from received_sources

        group by
          purchase_order_line_id
      )

      select
        pol.id,
        pol.commercial_code,

        coalesce(
          nullif(
            btrim(
              coalesce(
                pol.product_description,
                ''
              )
            ),
            ''
          ),

          nullif(
            btrim(
              coalesce(
                tap.descripcion_comercial,
                ''
              )
            ),
            ''
          ),

          nullif(
            btrim(
              coalesce(
                tap.descripcion_generica,
                ''
              )
            ),
            ''
          )
        ) as product_description,

        coalesce(
          nullif(
            btrim(
              coalesce(
                pol.presentation,
                ''
              )
            ),
            ''
          ),
          tap.consecutivo_invima_presentacion
        ) as presentation,

        coalesce(
          pol.dispensing_point_id,
          mapped.dispensing_point_id
        ) as dispensing_point_id,

        coalesce(
          historical_point.code,
          mapped_point.code
        ) as dispensing_point_code,

        coalesce(
          historical_point.name,
          mapped_point.name
        ) as dispensing_point_name,

        pol.requested_quantity,
        pol.accepted_quantity,
        pol.compensar_unit_rate_snapshot,
        pol.supplier_unit_cost,

        coalesce(
          dispatched.dispatched_quantity,
          0
        )::int as dispatched_quantity,

        coalesce(
          received.received_quantity,
          0
        )::int as received_quantity,

        coalesce(
          received.accepted_received_quantity,
          0
        )::int as accepted_received_quantity,

        latest_direct_receipt.outcome
          as receipt_outcome

      from purchase_order_lines pol

      left join tariff_annex_products tap
        on tap.codigo_producto =
           pol.commercial_code
       and tap.active = true

      left join dispensing_points historical_point
        on historical_point.id =
           pol.dispensing_point_id

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

      left join dispensing_points mapped_point
        on mapped_point.id =
           mapped.dispensing_point_id
       and mapped_point.active = true

      left join dispatched
        on dispatched.purchase_order_line_id =
           pol.id

      left join received
        on received.purchase_order_line_id =
           pol.id

      left join lateral (
        select
          porl.outcome

        from purchase_order_receipt_lines porl

        join purchase_order_receipts por
          on por.id =
             porl.receipt_id

        where por.purchase_order_id =
              ${id}

          and porl.purchase_order_line_id =
              pol.id

        order by
          por.confirmed_at desc,
          porl.id desc

        limit 1
      ) latest_direct_receipt
        on true

      where pol.purchase_order_id = ${id}

      order by
        pol.commercial_code,
        pol.id
    `);

    const deliveryResult = await this.database.db.execute<{
      id: string;
      supplier_reference: string | null;
      status: string;
      declared_dispatch_date: string | null;
      dispatched_at: Date | string | null;
      created_at: Date | string;
      actor_name: string | null;
      line_id: string | null;
      purchase_order_line_id: string | null;
      commercial_code: string | null;
      quantity: number | null;
      dispensing_point_code: string | null;
    }>(sql`
      select
        d.id,
        d.supplier_reference,
        d.status,
        d.declared_dispatch_date::text,
        d.dispatched_at,
        d.created_at,

        coalesce(
          u.display_name,
          u.username
        ) as actor_name,

        dl.id as line_id,
        dl.purchase_order_line_id,
        dl.commercial_code,
        dl.quantity,

        dp.code as dispensing_point_code

      from deliveries d

      left join users u
        on u.id = d.updated_by

      left join delivery_lines dl
        on dl.delivery_id = d.id

      left join dispensing_points dp
        on dp.id = dl.dispensing_point_id

      where d.purchase_order_id = ${id}

      order by
        d.created_at,
        d.id,
        dl.id
    `);

    const receiptResult = await this.database.db.execute<{
      id: string;
      delivery_id: string;
      status: string;
      declared_received_date: string | null;
      confirmed_at: Date | string | null;
      created_at: Date | string;
      actor_name: string | null;
      line_id: string | null;
      delivery_line_id: string | null;
      purchase_order_line_id: string | null;
      received_quantity: number | null;
      accepted_quantity: number | null;
      rejected_quantity: number | null;
      nonconformity_reason: string | null;
      observation: string | null;
    }>(sql`
      select
        r.id,
        r.delivery_id,
        r.status,
        r.received_at::date::text
          as declared_received_date,
        r.confirmed_at,
        r.created_at,

        coalesce(
          u.display_name,
          u.username
        ) as actor_name,

        rl.id as line_id,
        rl.delivery_line_id,
        dl.purchase_order_line_id,
        rl.received_quantity,
        rl.accepted_quantity,
        rl.rejected_quantity,
        rl.nonconformity_reason,
        rl.observation

      from receipts r

      join deliveries d
        on d.id = r.delivery_id

      left join users u
        on u.id = r.updated_by

      left join receipt_lines rl
        on rl.receipt_id = r.id

      left join delivery_lines dl
        on dl.id = rl.delivery_line_id

      where d.purchase_order_id = ${id}

      order by
        r.created_at,
        r.id,
        rl.id
    `);

    const directReceiptHistoryResult =
      await this.database.db.execute<{
        receipt_id: string;
        received_at: Date | string;
        confirmed_at: Date | string;
        actor_name: string | null;
        receipt_line_id: string;
        purchase_order_line_id: string;
        received_quantity: number;
      }>(sql`
        select
          por.id
            as receipt_id,

          por.received_at,
          por.confirmed_at,

          coalesce(
            u.display_name,
            u.username
          )
            as actor_name,

          porl.id
            as receipt_line_id,

          porl.purchase_order_line_id,

          porl.received_quantity

        from purchase_order_receipts por

        join purchase_order_receipt_lines porl
          on porl.receipt_id =
             por.id

        left join users u
          on u.id =
             por.confirmed_by

        where por.purchase_order_id =
              ${id}

          and porl.received_quantity >
              0

        order by
          por.received_at asc,
          por.confirmed_at asc,
          por.id asc,
          porl.id asc
      `);


    const acceptanceAudit = await this.database.db.execute<{
      observation: string | null;
    }>(sql`
      select
        nullif(
          btrim(
            coalesce(
              after ->> 'observation',
              ''
            )
          ),
          ''
        ) as observation

      from audit_events

      where resource_type = 'purchase_order'
        and resource_id = ${id}
        and action = 'PURCHASE_ORDER_OLP_ACCEPTED'

      order by occurred_at desc

      limit 1
    `);

    const returnedAudit = await this.database.db.execute<{
      observation: string | null;
    }>(sql`
      select
        nullif(
          btrim(
            coalesce(
              after ->> 'observation',
              ''
            )
          ),
          ''
        ) as observation

      from audit_events

      where resource_type = 'purchase_order'
        and resource_id = ${id}
        and action = 'PURCHASE_ORDER_RETURNED_BY_SUPPLIER'

      order by occurred_at desc

      limit 1
    `);

    const lines = lineResult.rows.map((line) => {
      const requestedQuantity =
        Number(line.requested_quantity ?? 0);

      const dispatchedQuantity =
        Number(line.dispatched_quantity ?? 0);

      const receivedQuantity =
        Number(line.received_quantity ?? 0);

      const supplierPendingQuantity =
        Math.max(
          requestedQuantity -
          dispatchedQuantity,
          0,
        );

      const receiptPendingQuantity =
        Math.max(
          dispatchedQuantity -
          receivedQuantity,
          0,
        );

      const pendingQuantity =
        Math.max(
          requestedQuantity -
          receivedQuantity,
          0,
        );

      return {
        id: line.id,

        commercialCode:
          line.commercial_code,

        productDescription:
          line.product_description,

        presentation:
          line.presentation,

        dispensingPointId:
          line.dispensing_point_id,

        dispensingPointCode:
          line.dispensing_point_code,

        dispensingPointName:
          line.dispensing_point_name,

        requestedQuantity,

        acceptedQuantity:
          line.accepted_quantity,

        dispatchedQuantity,

        receivedQuantity,

        acceptedReceivedQuantity:
          Number(
            line.accepted_received_quantity ??
            0,
          ),

        receiptOutcome:
          line.receipt_outcome,

        supplierPendingQuantity,

        receiptPendingQuantity,

        pendingQuantity,

        compensarUnitRateSnapshot:
          line.compensar_unit_rate_snapshot,

        supplierUnitCost:
          line.supplier_unit_cost,
      };
    });

    const deliveriesMap =
      new Map<
        string,
        {
          id: string;
          supplierReference: string | null;
          status: string;
          declaredDispatchDate: string | null;
          dispatchedAt: Date | string | null;
          createdAt: Date | string;
          actorName: string | null;
          lines: Array<{
            id: string;
            purchaseOrderLineId: string;
            commercialCode: string;
            quantity: number;
            dispensingPointCode: string | null;
          }>;
        }
      >();

    for (const row of deliveryResult.rows) {
      let delivery =
        deliveriesMap.get(
          row.id,
        );

      if (!delivery) {
        delivery = {
          id: row.id,

          supplierReference:
            row.supplier_reference,

          status:
            row.status,

          declaredDispatchDate:
            row.declared_dispatch_date,

          dispatchedAt:
            row.dispatched_at,

          createdAt:
            row.created_at,

          actorName:
            row.actor_name,

          lines: [],
        };

        deliveriesMap.set(
          row.id,
          delivery,
        );
      }

      if (
        row.line_id &&
        row.purchase_order_line_id &&
        row.commercial_code &&
        row.quantity !== null
      ) {
        delivery.lines.push({
          id:
            row.line_id,

          purchaseOrderLineId:
            row.purchase_order_line_id,

          commercialCode:
            row.commercial_code,

          quantity:
            Number(
              row.quantity,
            ),

          dispensingPointCode:
            row.dispensing_point_code,
        });
      }
    }

    const receiptsMap =
      new Map<
        string,
        {
          id: string;
          deliveryId: string;
          status: string;
          declaredReceivedDate: string | null;
          confirmedAt: Date | string | null;
          createdAt: Date | string;
          actorName: string | null;
          lines: Array<{
            id: string;
            deliveryLineId: string;
            purchaseOrderLineId: string | null;
            receivedQuantity: number;
            acceptedQuantity: number;
            rejectedQuantity: number;
            nonconformityReason: string | null;
            observation: string | null;
          }>;
        }
      >();

    for (const row of receiptResult.rows) {
      let receipt =
        receiptsMap.get(
          row.id,
        );

      if (!receipt) {
        receipt = {
          id:
            row.id,

          deliveryId:
            row.delivery_id,

          status:
            row.status,

          declaredReceivedDate:
            row.declared_received_date,

          confirmedAt:
            row.confirmed_at,

          createdAt:
            row.created_at,

          actorName:
            row.actor_name,

          lines: [],
        };

        receiptsMap.set(
          row.id,
          receipt,
        );
      }

      if (
        row.line_id &&
        row.delivery_line_id
      ) {
        receipt.lines.push({
          id:
            row.line_id,

          deliveryLineId:
            row.delivery_line_id,

          purchaseOrderLineId:
            row.purchase_order_line_id,

          receivedQuantity:
            Number(
              row.received_quantity ??
              0,
            ),

          acceptedQuantity:
            Number(
              row.accepted_quantity ??
              0,
            ),

          rejectedQuantity:
            Number(
              row.rejected_quantity ??
              0,
            ),

          nonconformityReason:
            row.nonconformity_reason,

          observation:
            row.observation,
        });
      }
    }

    const deliveries =
      Array.from(
        deliveriesMap.values(),
      );

    const receipts =
      Array.from(
        receiptsMap.values(),
      );

    const visibleReceiptHistoryLineIds =
      new Set(
        lines.map(
          (line) =>
            line.id,
        ),
      );

    const directReceiptHistoryMap =
      new Map<
        string,
        {
          id: string;
          receivedAt: Date | string;
          confirmedAt: Date | string;
          actorName: string | null;
          lines: Array<{
            id: string;
            purchaseOrderLineId: string;
            receivedQuantity: number;
          }>;
        }
      >();

    for (
      const row of
      directReceiptHistoryResult.rows
    ) {
      if (
        !visibleReceiptHistoryLineIds.has(
          row.purchase_order_line_id,
        )
      ) {
        continue;
      }

      let event =
        directReceiptHistoryMap.get(
          row.receipt_id,
        );

      if (!event) {
        event = {
          id:
            row.receipt_id,

          receivedAt:
            row.received_at,

          confirmedAt:
            row.confirmed_at,

          actorName:
            row.actor_name,

          lines:
            [],
        };

        directReceiptHistoryMap.set(
          row.receipt_id,
          event,
        );
      }

      event.lines.push({
        id:
          row.receipt_line_id,

        purchaseOrderLineId:
          row.purchase_order_line_id,

        receivedQuantity:
          Number(
            row.received_quantity ??
            0,
          ),
      });
    }

    const receiptHistory =
      Array.from(
        directReceiptHistoryMap.values(),
      );


    const totalRequested =
      lines.reduce(
        (
          total,
          line,
        ) =>
          total +
          line.requestedQuantity,
        0,
      );

    const totalDispatched =
      lines.reduce(
        (
          total,
          line,
        ) =>
          total +
          line.dispatchedQuantity,
        0,
      );

    const totalReceived =
      lines.reduce(
        (
          total,
          line,
        ) =>
          total +
          line.receivedQuantity,
        0,
      );

    const totalPending =
      lines.reduce(
        (
          total,
          line,
        ) =>
          total +
          line.pendingQuantity,
        0,
      );

    const totalSupplierPending =
      lines.reduce(
        (
          total,
          line,
        ) =>
          total +
          line.supplierPendingQuantity,
        0,
      );

    const totalReceiptPending =
      lines.reduce(
        (
          total,
          line,
        ) =>
          total +
          line.receiptPendingQuantity,
        0,
      );

    const allReceived =
      lines.length > 0 &&
      lines.every(
        (line) =>
          line.receivedQuantity >=
          line.requestedQuantity,
      );

    const anyReceiptEvent =
      receipts.length > 0 ||
      lines.some(
        (line) =>
          line.receiptOutcome !==
          null,
      );

    const operationalState =
      allReceived
        ? 'RECEIVED'
        : anyReceiptEvent
          ? 'RECEIVED_WITH_PENDING'
          : order.olp_accepted_at
            ? 'PENDING_MEDICARTE'
            : 'PENDING_OLP';

    const responsible =
      operationalState ===
      'PENDING_OLP'
        ? 'OLP'
        : operationalState ===
            'RECEIVED'
          ? 'Finalizada'
          : 'Medicarte';

    let contractualValue =
      0;

    let contractualComplete =
      true;

    let supplierProjectedCost =
      0;

    let supplierCostComplete =
      true;

    for (const line of lines) {
      const tariff =
        line.compensarUnitRateSnapshot ===
        null
          ? null
          : Number(
              line.compensarUnitRateSnapshot,
            );

      const supplierCost =
        line.supplierUnitCost ===
        null
          ? null
          : Number(
              line.supplierUnitCost,
            );

      if (
        tariff === null ||
        !Number.isFinite(
          tariff,
        )
      ) {
        contractualComplete =
          false;
      } else {
        contractualValue +=
          tariff *
          line.requestedQuantity;
      }

      if (
        supplierCost === null ||
        !Number.isFinite(
          supplierCost,
        )
      ) {
        supplierCostComplete =
          false;
      } else {
        supplierProjectedCost +=
          supplierCost *
          line.requestedQuantity;
      }
    }

    const novelties: Array<{
      type: string;
      message: string;
      commercialCode: string | null;
    }> = [];

    if (
      order.status ===
      'REJECTED'
    ) {
      novelties.push({
        type:
          'SUPPLIER_RETURN',

        message:
          returnedAudit.rows[0]?.observation ??
          'La orden fue devuelta por OLP.',

        commercialCode:
          null,
      });
    }

    if (
      order.status ===
      'CANCELLED'
    ) {
      novelties.push({
        type:
          'CANCELLED',

        message:
          'La orden de compra fue cancelada.',

        commercialCode:
          null,
      });
    }

    if (
      order.status ===
      'HISTORICAL_ONLY'
    ) {
      novelties.push({
        type:
          'HISTORICAL_ONLY',

        message:
          'Registro histórico: los hechos físicos no se reconstruyen cuando no existe evidencia autoritativa.',

        commercialCode:
          null,
      });
    }

    for (const receipt of receipts) {
      for (
        const receiptLine of
        receipt.lines
      ) {
        if (
          receiptLine.rejectedQuantity >
            0 ||
          receiptLine.nonconformityReason
        ) {
          const sourceLine =
            lines.find(
              (line) =>
                line.id ===
                receiptLine.purchaseOrderLineId,
            );

          novelties.push({
            type:
              'RECEIPT_NONCONFORMITY',

            message:
              receiptLine.nonconformityReason ??
              `Recepción con ${receiptLine.rejectedQuantity} unidad(es) rechazada(s).`,

            commercialCode:
              sourceLine?.commercialCode ??
              null,
          });
        }
      }
    }

    return {
      id:
        order.id,

      purchaseOrderCode:
        order.purchase_order_code,

      orderType:
        order.order_type,

      technicalStatus:
        order.status,

      operationalState,

      responsible,

      version:
        order.version,

      createdAt:
        order.created_at,

      createdByName:
        order.created_by_name,

      issuedAt:
        order.issued_at,

      updatedAt:
        order.updated_at,

      olpAcceptedAt:
        order.olp_accepted_at,

      olpAcceptedByName:
        order.accepted_by_name,

      olpCommittedDate:
        order.olp_committed_date,

      olpAcceptanceObservation:
        acceptanceAudit.rows[0]?.observation ??
        null,

      latestSupplierObservation:
        returnedAudit.rows[0]?.observation ??
        null,

      summary: {
        products:
          lines.length,

        requestedQuantity:
          totalRequested,

        dispatchedQuantity:
          totalDispatched,

        receivedQuantity:
          totalReceived,

        pendingQuantity:
          totalPending,

        supplierPendingQuantity:
          totalSupplierPending,

        receiptPendingQuantity:
          totalReceiptPending,
      },

      financial: {
        contractualValue:
          contractualComplete
            ? contractualValue
            : null,

        supplierProjectedCost:
          supplierCostComplete
            ? supplierProjectedCost
            : null,

        projectedGrossMargin:
          contractualComplete &&
          supplierCostComplete
            ? contractualValue -
              supplierProjectedCost
            : null,
      },

      lines,

      deliveries,

      receipts,

      receiptHistory,

      novelties,
    };
  }

  async operationalDetail(
    id: string,
    actor: Scope,
  ) {
    const detail =
      await this.operationalDetailUnscoped(
        id,
        actor,
      );

    if (!detail) {
      return null;
    }

    if (
      actor.organizationCode !==
      'MEDICARTE'
    ) {
      return detail;
    }

    const pointRows =
      await this.database.db.execute<{
        dispensing_point_id:
          string;
      }>(sql`
        SELECT
          ups.dispensing_point_id

        FROM
          user_point_scopes ups

        WHERE
          ups.user_id =
            ${actor.userId}::uuid

          AND ups.revoked_at
            IS NULL
      `);

    const allowedPoints =
      new Set(
        pointRows.rows.map(
          (row) =>
            row.dispensing_point_id,
        ),
      );

    const lines =
      detail.lines.filter(
        (line) =>
          line.dispensingPointId !==
            null &&
          allowedPoints.has(
            line.dispensingPointId,
          ),
      );

    const lineIds =
      new Set(
        lines.map(
          (line) =>
            line.id,
        ),
      );

    const deliveries =
      detail.deliveries
        .map(
          (delivery) => ({
            ...delivery,

            lines:
              delivery.lines.filter(
                (line) =>
                  lineIds.has(
                    line.purchaseOrderLineId,
                  ),
              ),
          }),
        )
        .filter(
          (delivery) =>
            delivery.lines.length >
            0,
        );

    const receipts =
      detail.receipts
        .map(
          (receipt) => ({
            ...receipt,

            lines:
              receipt.lines.filter(
                (line) =>
                  line.purchaseOrderLineId !==
                    null &&
                  lineIds.has(
                    line.purchaseOrderLineId,
                  ),
              ),
          }),
        )
        .filter(
          (receipt) =>
            receipt.lines.length >
            0,
        );

    const summary =
      lines.reduce(
        (
          total,
          line,
        ) => ({
          products:
            total.products +
            1,

          requestedQuantity:
            total.requestedQuantity +
            line.requestedQuantity,

          dispatchedQuantity:
            total.dispatchedQuantity +
            line.dispatchedQuantity,

          receivedQuantity:
            total.receivedQuantity +
            line.receivedQuantity,

          pendingQuantity:
            total.pendingQuantity +
            line.pendingQuantity,

          supplierPendingQuantity:
            total.supplierPendingQuantity +
            line.supplierPendingQuantity,

          receiptPendingQuantity:
            total.receiptPendingQuantity +
            line.receiptPendingQuantity,
        }),
        {
          products: 0,

          requestedQuantity: 0,

          dispatchedQuantity: 0,

          receivedQuantity: 0,

          pendingQuantity: 0,

          supplierPendingQuantity: 0,

          receiptPendingQuantity: 0,
        },
      );

    const visibleCodes =
      new Set(
        lines.map(
          (line) =>
            line.commercialCode,
        ),
      );

    return {
      ...detail,

      summary,

      /*
       * Medicarte opera cantidades físicas.
       * No recibe información económica de MTD/OLP.
       */
      financial: {
        contractualValue:
          null,

        supplierProjectedCost:
          null,

        projectedGrossMargin:
          null,
      },

      lines,

      deliveries,

      receipts,

      novelties:
        detail.novelties.filter(
          (novelty) =>
            novelty.commercialCode !==
              null &&
            visibleCodes.has(
              novelty.commercialCode,
            ),
        ),
    };
  }


  async available(planningPeriodId: string) {
    const rows = await this.database.db.execute<{
      id: string;
      commercialCode: string;
      dispensingPointId: string | null;
      dispensingPointCode: string | null;
      dispensingPointName: string | null;
      deliveryPointMapped: boolean;
      revision: number;
      regularQuantity: number;
      lateQuantity: number;
      regularAvailable: number;
      lateAvailable: number;
      regularOverOrdered: number;
      lateOverOrdered: number;
    }>(sql`
      with period_mode as (
        select exists (
          select 1
          from projected_demand_lines
          where planning_period_id = ${planningPeriodId}
            and dispensing_point_id is null
        ) as modern
      ),
      candidate as (
        select
          pdl.*,
          tap.numero_expediente_invima,
          tap.consecutivo_invima_presentacion
        from projected_demand_lines pdl
        join tariff_annex_products tap
          on tap.codigo_producto =
             pdl.commercial_code
         and tap.active = true
         and regexp_replace(
               upper(
                 trim(
                   coalesce(
                     tap.tipo_inclusion,
                     ''
                   )
                 )
               ),
               '\s+',
               '_',
               'g'
             ) = 'PBS'
        cross join period_mode pm
        where pdl.planning_period_id = ${planningPeriodId}
          and (
            (pm.modern and pdl.dispensing_point_id is null)
            or
            (
              not pm.modern
              and pdl.dispensing_point_id is not null
            )
          )
      ),
      ordered as (
        select
          a.projected_demand_line_id,
          pol.commercial_code,
          a.demand_bucket,
          coalesce(
            sum(
              case
                when po.status in (
                  'DRAFT',
                  'ISSUED',
                  'UNDER_OLP_REVIEW'
                )
                  then a.allocated_quantity
                when po.status in (
                  'REJECTED',
                  'CANCELLED'
                )
                  then 0
                else coalesce(
                  pol.accepted_quantity,
                  0
                )
              end
            ),
            0
          )::int as effective_coverage
        from purchase_order_demand_allocations a
        join purchase_order_lines pol
          on pol.id =
             a.purchase_order_line_id
        join purchase_orders po
          on po.id =
             pol.purchase_order_id
        where po.planning_period_id =
              ${planningPeriodId}
        group by
          a.projected_demand_line_id,
          pol.commercial_code,
          a.demand_bucket
      )
      select
        pdl.id,
        pdl.commercial_code as "commercialCode",
        case
          when pdl.dispensing_point_id is null
            then mapped_point.id
          else pdl.dispensing_point_id
        end as "dispensingPointId",

        case
          when pdl.dispensing_point_id is null
            then mapped_point.code
          else historical_point.code
        end as "dispensingPointCode",

        case
          when pdl.dispensing_point_id is null
            then mapped_point.name
          else historical_point.name
        end as "dispensingPointName",

        case
          when pdl.dispensing_point_id is null
            then mapped_point.id is not null
          else true
        end as "deliveryPointMapped",

        pdl.revision,
        pdl.regular_quantity
          as "regularQuantity",
        pdl.late_quantity
          as "lateQuantity",

        case
          when pdl.dispensing_point_id is null
            then greatest(
              pdl.regular_quantity
              -
              (
                coalesce(
                  inv.usable_quantity,
                  0
                )
                +
                coalesce(
                  opc.open_quantity,
                  0
                )
              ),
              0
            )
          else greatest(
            pdl.regular_quantity
            -
            coalesce(
              regular_ordered.effective_coverage,
              0
            ),
            0
          )
        end::int
          as "regularAvailable",

        case
          when pdl.dispensing_point_id is null
            then greatest(
              pdl.late_quantity
              -
              greatest(
                (
                  coalesce(
                    inv.usable_quantity,
                    0
                  )
                  +
                  coalesce(
                    opc.open_quantity,
                    0
                  )
                )
                -
                pdl.regular_quantity,
                0
              ),
              0
            )
          else greatest(
            pdl.late_quantity
            -
            coalesce(
              late_ordered.effective_coverage,
              0
            ),
            0
          )
        end::int
          as "lateAvailable",

        greatest(
          coalesce(
            regular_ordered.effective_coverage,
            0
          )
          -
          pdl.regular_quantity,
          0
        )::int
          as "regularOverOrdered",

        greatest(
          coalesce(
            late_ordered.effective_coverage,
            0
          )
          -
          pdl.late_quantity,
          0
        )::int
          as "lateOverOrdered"

      from candidate pdl

      left join ordered regular_ordered
        on regular_ordered.projected_demand_line_id =
           pdl.id
       and regular_ordered.demand_bucket =
           'REGULAR'

      left join ordered late_ordered
        on late_ordered.projected_demand_line_id =
           pdl.id
       and late_ordered.demand_bucket =
           'LATE'

      left join inventory_usable_by_product inv
        on inv.commercial_code =
           pdl.commercial_code

      left join purchase_open_coverage_by_product opc
        on opc.commercial_code =
           pdl.commercial_code

      left join dispensing_points historical_point
        on historical_point.id =
           pdl.dispensing_point_id

      left join product_delivery_point_mappings mapped
        on pdl.dispensing_point_id is null
       and btrim(
             coalesce(
               pdl.numero_expediente_invima,
               ''
             )
           ) ~ '^[0-9]+$'
       and btrim(
             coalesce(
               pdl.consecutivo_invima_presentacion,
               ''
             )
           ) ~ '^[0-9]+$'
       and mapped.invima_record_normalized =
           coalesce(
             nullif(
               ltrim(
                 btrim(
                   pdl.numero_expediente_invima
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
                   pdl.consecutivo_invima_presentacion
                 ),
                 '0'
               ),
               ''
             ),
             '0'
           )

      left join dispensing_points mapped_point
        on mapped_point.id =
           mapped.dispensing_point_id
       and mapped_point.active = true

      order by
        pdl.commercial_code,
        pdl.dispensing_point_id nulls first
    `);

    return rows.rows;
  }

  private async lockDemandLines(tx: Tx, planningPeriodId: string, lines: readonly LineInput[]) {
    const seen = new Set<string>();

    for (const line of lines) {
      if (seen.has(line.projectedDemandLineId)) {
        throw new Error('PURCHASE_ORDER_DUPLICATE_DEMAND_LINE');
      }

      seen.add(line.projectedDemandLineId);
    }

    const ids = [...new Set(lines.map((line) => line.projectedDemandLineId))].sort();

    const locked = await tx.execute<{
      id: string;
      planning_period_id: string;
      dispensing_point_id: string | null;
      commercial_code: string;
      revision: number;
      regular_quantity: number;
      late_quantity: number;
      tarifa_unidad: string | null;
      descripcion_generica: string | null;
      numero_expediente_invima: string | null;
      consecutivo_invima_presentacion: string | null;
    }>(sql`
        select
          pdl.id,
          pdl.planning_period_id,
          pdl.dispensing_point_id,
          pdl.commercial_code,
          pdl.revision,
          pdl.regular_quantity,
          pdl.late_quantity,
          tap.tarifa_unidad,
          tap.descripcion_generica,
          tap.numero_expediente_invima,
          tap.consecutivo_invima_presentacion
        from projected_demand_lines pdl
        left join tariff_annex_products tap
          on tap.codigo_producto =
             pdl.commercial_code
         and tap.active = true
        where pdl.id in (
          ${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )}
        )
        order by pdl.id
        for update of pdl
      `);

    if (locked.rows.length !== ids.length) {
      throw new Error('PROJECTED_DEMAND_LINE_NOT_FOUND');
    }

    const modernCodes = [
      ...new Set(
        locked.rows
          .filter((row) => row.dispensing_point_id === null)
          .map((row) => row.commercial_code),
      ),
    ].sort();

    // Cross-period / recreated-demand concurrency guard:
    // procurement availability is product-scoped, therefore the lock must
    // also be product-scoped rather than only projected-demand-line scoped.
    for (const commercialCode of modernCodes) {
      await tx.execute(sql`
        select pg_advisory_xact_lock(
          hashtext(
            ${`PROCUREMENT:${commercialCode}`}
          )
        )
      `);
    }

    for (const line of lines) {
      const demand = locked.rows.find((item) => item.id === line.projectedDemandLineId)!;

      if (demand.planning_period_id !== planningPeriodId) {
        throw new Error('PURCHASE_ORDER_DEMAND_PERIOD_MISMATCH');
      }

      if (demand.revision !== line.expectedDemandRevision) {
        throw new Error('PROJECTED_DEMAND_REVISION_CONFLICT');
      }

      /*
       * Macro 4A.
       *
       * La elegibilidad de una compra nueva se vuelve a validar
       * contra el Anexo Tarifario vigente dentro de la misma
       * transacción que materializa la OC.
       *
       * FOR SHARE serializa este punto contra CONFIRM del AT,
       * que bloquea la fila del producto con FOR UPDATE.
       */
      const currentTariff = await tx.execute<{
        tarifa_unidad: string | null;
        tipo_inclusion: string | null;
        numero_expediente_invima: string | null;
        consecutivo_invima_presentacion: string | null;
      }>(sql`
        select
          tarifa_unidad,
          tipo_inclusion,
          numero_expediente_invima,
          consecutivo_invima_presentacion
        from tariff_annex_products
        where codigo_producto =
              ${demand.commercial_code}
          and active = true
        for share
      `);

      const currentTariffRow = currentTariff.rows[0];

      const currentTariffInclusion = (currentTariffRow?.tipo_inclusion ?? '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_');

      if (!currentTariffRow || currentTariffInclusion !== 'PBS') {
        throw new Error('PURCHASE_ORDER_TARIFF_NOT_PBS');
      }

      if (!currentTariffRow.tarifa_unidad) {
        throw new Error('TARIFF_RATE_NOT_FOUND');
      }

      if (demand.dispensing_point_id === null) {
        if (line.dispensingPointId !== undefined) {
          throw new Error('PURCHASE_ORDER_MODERN_DEMAND_POINT_NOT_ALLOWED');
        }

        await this.assertModernDemandIsCurrent(tx, {
          id: demand.id,
          commercialCode: demand.commercial_code,
          regularQuantity: demand.regular_quantity,
          lateQuantity: demand.late_quantity,
        });

        /*
         * Wave 2A.
         *
         * La sede logística no viene del paciente ni del request.
         * Se deriva del maestro producto/presentación -> sede Medicarte.
         *
         * La resolución ocurre dentro de la misma transacción de creación
         * de OC para impedir usar una relación logística obsoleta.
         */
        await this.resolveProductDeliveryPoint(
          tx,
          currentTariffRow.numero_expediente_invima,
          currentTariffRow.consecutivo_invima_presentacion,
        );

        const supply = await tx.execute<{
          usable_stock: number;
          open_purchase_coverage: number;
        }>(sql`
            select
              coalesce(
                (
                  select usable_quantity
                  from inventory_usable_by_product
                  where commercial_code =
                        ${demand.commercial_code}
                ),
                0
              )::int as usable_stock,

              coalesce(
                (
                  select open_quantity
                  from purchase_open_coverage_by_product
                  where commercial_code =
                        ${demand.commercial_code}
                ),
                0
              )::int
                as open_purchase_coverage
          `);

        const usableStock = Number(supply.rows[0]?.usable_stock ?? 0);

        const openCoverage = Number(supply.rows[0]?.open_purchase_coverage ?? 0);

        const offset = usableStock + openCoverage;

        const regularAvailable = Math.max(demand.regular_quantity - offset, 0);

        const remainingOffset = Math.max(offset - demand.regular_quantity, 0);

        const lateAvailable = Math.max(demand.late_quantity - remainingOffset, 0);

        const available = line.demandBucket === 'REGULAR' ? regularAvailable : lateAvailable;

        if (line.requestedQuantity > available) {
          throw new Error('PURCHASE_ORDER_DEMAND_EXCEEDS_AVAILABLE');
        }

        continue;
      }

      // Historical point-based demand compatibility.
      const effectivePoint = line.dispensingPointId ?? demand.dispensing_point_id;

      const point = await tx.execute<{
        id: string;
      }>(sql`
          select id
          from dispensing_points
          where id =
                ${effectivePoint}
            and active = true
        `);

      if (!point.rows[0]) {
        throw new Error('DISPENSING_POINT_NOT_FOUND');
      }

      if (effectivePoint !== demand.dispensing_point_id) {
        throw new Error('PURCHASE_ORDER_DEMAND_POINT_MISMATCH');
      }

      const coverage = await tx.execute<{
        quantity: number;
      }>(sql`
          select
            coalesce(
              sum(
                case
                  when po.status in (
                    'DRAFT',
                    'ISSUED',
                    'UNDER_OLP_REVIEW'
                  )
                    then
                      a.allocated_quantity

                  when po.status in (
                    'REJECTED',
                    'CANCELLED'
                  )
                    then 0

                  else
                    coalesce(
                      pol.accepted_quantity,
                      0
                    )
                end
              ),
              0
            )::int as quantity

          from purchase_order_demand_allocations a

          join purchase_order_lines pol
            on pol.id =
               a.purchase_order_line_id

          join purchase_orders po
            on po.id =
               pol.purchase_order_id

          where
            a.projected_demand_line_id =
              ${demand.id}

            and a.demand_bucket =
              ${line.demandBucket}
        `);

      const historicalDemand =
        line.demandBucket === 'REGULAR' ? demand.regular_quantity : demand.late_quantity;

      if (line.requestedQuantity > historicalDemand - Number(coverage.rows[0]?.quantity ?? 0)) {
        throw new Error('PURCHASE_ORDER_DEMAND_EXCEEDS_AVAILABLE');
      }
    }
  }

  private async assertModernDemandIsCurrent(
    tx: Tx,
    demand: Readonly<{
      id: string;
      commercialCode: string;
      regularQuantity: number;
      lateQuantity: number;
    }>,
  ): Promise<void> {
    const metadata = await tx.execute<{
      consolidated_at: string | null;
    }>(sql`
        select
          consolidated_at::text
            as consolidated_at
        from projected_demand_lines
        where id = ${demand.id}
      `);

    /*
     * Compatibilidad controlada:
     *
     * Las líneas históricas/sintéticas anteriores al reconciliador
     * moderno pueden no tener consolidated_at. El boundary nuevo
     * protege las líneas materializadas por consolidación moderna,
     * que siempre tienen provenance en demand_sources.
     */
    if (!metadata.rows[0]?.consolidated_at) {
      return;
    }

    const sources = await tx.execute<{
      authorization_item_id: string | null;
      quantity: number;
      demand_bucket: 'REGULAR' | 'LATE';
    }>(sql`
        select
          authorization_item_id,
          quantity,
          demand_bucket
        from demand_sources
        where projected_demand_line_id =
              ${demand.id}
        order by id
      `);

    if (
      sources.rows.length === 0 ||
      sources.rows.some((source) => source.authorization_item_id === null)
    ) {
      throw new Error('PURCHASE_ORDER_DEMAND_STALE');
    }

    const authorizationIds = [
      ...new Set(sources.rows.map((source) => source.authorization_item_id!)),
    ].sort();

    const authorizations = await tx.execute<{
      id: string;
      commercial_code: string;
      source_status_normalized: string;
      enablement_status: string;
      coverage_type: string;
      source_quantity: string | null;
      assignment_date: string | null;
      expiration_date: string | null;
    }>(sql`
        select
          id,
          codigo_medicamento
            as commercial_code,
          source_status_normalized,
          enablement_status,
          coverage_type,
          source_data->>'CANTIDAD'
            as source_quantity,
          source_data->>'FECHA_ASIGNACION'
            as assignment_date,
          source_data->>'FECHA_FINAL_VIGENCIA'
            as expiration_date
        from authorization_items
        where id in (
          ${sql.join(
            authorizationIds.map((id) => sql`${id}`),
            sql`, `,
          )}
        )
        order by id
        for share
      `);

    if (authorizations.rows.length !== authorizationIds.length) {
      throw new Error('PURCHASE_ORDER_DEMAND_STALE');
    }

    const authorizationById = new Map(
      authorizations.rows.map((authorization) => [authorization.id, authorization]),
    );

    const todayBogota = currentBogotaDate();

    const monthEnd = authorizationPurchaseMonthEnd(todayBogota);

    const isStrictIsoDate = (value: string | null): value is string => {
      if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
      }

      const instant = new Date(`${value}T00:00:00Z`);

      return !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
    };

    let regularSourceQuantity = 0;
    let lateSourceQuantity = 0;

    for (const source of sources.rows) {
      const authorization = authorizationById.get(source.authorization_item_id!);

      if (!authorization) {
        throw new Error('PURCHASE_ORDER_DEMAND_STALE');
      }

      const sourceQuantity =
        authorization.source_quantity !== null &&
        /^[1-9][0-9]*$/.test(authorization.source_quantity)
          ? Number(authorization.source_quantity)
          : Number.NaN;

      const assignmentDate = authorization.assignment_date;

      const expirationDate = authorization.expiration_date;

      const eligible =
        authorization.commercial_code === demand.commercialCode &&
        isAuthorizationSourceEnabled(authorization.source_status_normalized) &&
        authorization.enablement_status === 'ENABLED' &&
        authorization.coverage_type === 'PBS' &&
        Number.isSafeInteger(sourceQuantity) &&
        sourceQuantity > 0 &&
        sourceQuantity === source.quantity &&
        isStrictIsoDate(assignmentDate) &&
        assignmentDate <= monthEnd &&
        isStrictIsoDate(expirationDate) &&
        expirationDate >= todayBogota;

      if (!eligible) {
        throw new Error('PURCHASE_ORDER_DEMAND_STALE');
      }

      if (source.demand_bucket === 'REGULAR') {
        regularSourceQuantity += source.quantity;
      } else {
        lateSourceQuantity += source.quantity;
      }
    }

    if (
      regularSourceQuantity !== demand.regularQuantity ||
      lateSourceQuantity !== demand.lateQuantity
    ) {
      throw new Error('PURCHASE_ORDER_DEMAND_STALE');
    }
  }

  private async resolveProductDeliveryPoint(
    tx: Tx,
    invimaRecordRaw: string | null,
    invimaPresentationRaw: string | null,
  ): Promise<{
    id: string;
    code: string;
    name: string;
  }> {
    const invimaRecord = normalizeInvimaComponent(invimaRecordRaw);

    const invimaPresentation = normalizeInvimaComponent(invimaPresentationRaw);

    if (!invimaRecord || !invimaPresentation) {
      throw new Error('DELIVERY_POINT_MAPPING_MISSING');
    }

    const mapping = await tx.execute<{
      id: string;
      code: string;
      name: string;
    }>(sql`
      select
        dp.id,
        dp.code,
        dp.name
      from product_delivery_point_mappings m
      join dispensing_points dp
        on dp.id = m.dispensing_point_id
       and dp.active = true
      where m.invima_record_normalized =
            ${invimaRecord}
        and m.invima_presentation_normalized =
            ${invimaPresentation}
      for share of m, dp
    `);

    const point = mapping.rows[0];

    if (!point) {
      throw new Error('DELIVERY_POINT_MAPPING_MISSING');
    }

    return point;
  }

  private async replaceLines(
    tx: Tx,
    orderId: string,
    lines: readonly LineInput[],
    orderType: string,
  ) {
    for (const line of lines) {
      const demand = await tx.execute<{
        commercial_code: string;
        dispensing_point_id: string | null;
        tarifa_unidad: string;
        descripcion_generica: string | null;
        numero_expediente_invima: string | null;
        consecutivo_invima_presentacion: string | null;
      }>(
        sql`select pdl.commercial_code, pdl.dispensing_point_id, tap.tarifa_unidad, tap.descripcion_generica, tap.numero_expediente_invima, tap.consecutivo_invima_presentacion from projected_demand_lines pdl join tariff_annex_products tap on tap.codigo_producto = pdl.commercial_code and tap.active = true and regexp_replace(upper(trim(coalesce(tap.tipo_inclusion, ''))), '\\s+', '_', 'g') = 'PBS' where pdl.id = ${line.projectedDemandLineId}`,
      );

      const d = demand.rows[0]!;

      let dispensingPointId = line.dispensingPointId ?? d.dispensing_point_id ?? null;

      if (d.dispensing_point_id === null) {
        const mappedPoint = await this.resolveProductDeliveryPoint(
          tx,
          d.numero_expediente_invima,
          d.consecutivo_invima_presentacion,
        );

        dispensingPointId = mappedPoint.id;
      }

      if (!dispensingPointId) {
        throw new Error('DELIVERY_POINT_MAPPING_MISSING');
      }

      const inserted = await tx.execute<{ id: string }>(
        sql`insert into purchase_order_lines (purchase_order_id, commercial_code, product_description, presentation, dispensing_point_id, requested_quantity, requested_delivery_date, compensar_unit_rate_snapshot, projected_demand_line_id, projected_demand_revision, demand_bucket) values (${orderId}, ${d.commercial_code}, ${d.descripcion_generica}, ${d.consecutivo_invima_presentacion}, ${dispensingPointId}, ${line.requestedQuantity}, ${line.requestedDeliveryDate ?? null}, ${d.tarifa_unidad}, ${line.projectedDemandLineId}, ${line.expectedDemandRevision}, ${line.demandBucket}) returning id`,
      );
      await tx.execute(
        sql`insert into purchase_order_demand_allocations (purchase_order_line_id, projected_demand_line_id, projected_demand_revision, demand_bucket, allocated_quantity) values (${inserted.rows[0]!.id}, ${line.projectedDemandLineId}, ${line.expectedDemandRevision}, ${line.demandBucket}, ${line.requestedQuantity})`,
      );

      await tx.execute(sql`
        insert into purchase_order_authorization_sources (
          purchase_order_line_id,
          authorization_item_id,
          projected_demand_line_id,
          projected_demand_revision,
          source_quantity_snapshot
        )
        select
          ${inserted.rows[0]!.id},
          ds.authorization_item_id,
          ${line.projectedDemandLineId},
          ${line.expectedDemandRevision},
          ds.quantity
        from demand_sources ds
        where ds.projected_demand_line_id = ${line.projectedDemandLineId}
          and ds.authorization_item_id is not null
        on conflict (
          purchase_order_line_id,
          authorization_item_id
        ) do nothing
      `);

      if (orderType === 'STANDARD' && line.demandBucket !== 'REGULAR')
        throw new Error('PURCHASE_ORDER_BUCKET_MISMATCH');
    }
  }

  private async findByIdOn(conn: Tx | Database['db'], id: string, supplier = false) {
    const rows = await conn.execute<PurchaseOrderJoinedRow>(sql`
      select
        po.id,
        po.purchase_order_code,
        po.planning_period_id,
        po.order_type,
        po.status,
        po.version,
        po.issued_at,
        po.issued_by,
        po.olp_accepted_at,
        po.olp_committed_date::text,
        po.created_at,
        po.updated_at,

        pol.id as line_id,
        pol.commercial_code,

        COALESCE(
          NULLIF(
            BTRIM(
              COALESCE(
                pol.product_description,
                ''
              )
            ),
            ''
          ),
          NULLIF(
            BTRIM(
              COALESCE(
                tap.descripcion_comercial,
                ''
              )
            ),
            ''
          ),
          NULLIF(
            BTRIM(
              COALESCE(
                tap.descripcion_generica,
                ''
              )
            ),
            ''
          )
        )
          as product_description,

        COALESCE(
          NULLIF(
            BTRIM(
              COALESCE(
                pol.presentation,
                ''
              )
            ),
            ''
          ),
          tap.consecutivo_invima_presentacion
        )
          as presentation,

        COALESCE(
          pol.dispensing_point_id,
          mapped.dispensing_point_id
        )
          as dispensing_point_id,

        COALESCE(
          historical_point.code,
          mapped_point.code
        )
          as dispensing_point_code,

        COALESCE(
          historical_point.name,
          mapped_point.name
        )
          as dispensing_point_name,

        pol.requested_quantity,
        pol.accepted_quantity,
        pol.requested_delivery_date,
        pol.compensar_unit_rate_snapshot,
        pol.supplier_unit_cost,
        pol.projected_demand_line_id,
        pol.projected_demand_revision,
        pol.demand_bucket,

        a.allocated_quantity,
        pdl.revision as current_demand_revision

      from purchase_orders po

      left join purchase_order_lines pol
        on pol.purchase_order_id = po.id

      left join purchase_order_demand_allocations a
        on a.purchase_order_line_id = pol.id

      left join tariff_annex_products tap
        on tap.codigo_producto =
           pol.commercial_code
       and tap.active = true

      /*
       * Punto histórico de la línea:
       * siempre tiene prioridad sobre el mapping vigente.
       */
      left join dispensing_points historical_point
        on historical_point.id =
           pol.dispensing_point_id

      /*
       * Fallback únicamente cuando la línea histórica
       * no trae punto.
       *
       * Producto -> AT -> INVIMA/presentación -> punto.
       */
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

      left join dispensing_points mapped_point
        on mapped_point.id =
           mapped.dispensing_point_id
       and mapped_point.active = true

      left join projected_demand_lines pdl
        on pdl.id = pol.projected_demand_line_id

      where po.id = ${id}

      order by pol.id
    `);

    const first = rows.rows[0];

    if (!first) {
      return null;
    }

    const common = {
      id: first.id,
      purchaseOrderCode: first.purchase_order_code,
      orderType: first.order_type,
      status: first.status,
      version: first.version,
      issuedAt: first.issued_at,

      olpAcceptedAt:
        first.olp_accepted_at,

      olpCommittedDate:
        first.olp_committed_date,

      createdAt: first.created_at,
      updatedAt: first.updated_at,
    };

    /*
     * Contrato de exposición OLP:
     * no tarifa COMPENSAR,
     * no línea de demanda,
     * no revisión interna,
     * no información clínica.
     */
    if (supplier) {
      return {
        ...common,

        lines: rows.rows
          .filter((row) => row.line_id)
          .map((row) => ({
            id: row.line_id,

            commercialCode: row.commercial_code,

            productDescription: row.product_description,

            presentation: row.presentation,

            dispensingPointId: row.dispensing_point_id,

            dispensingPointCode: row.dispensing_point_code,

            dispensingPointName: row.dispensing_point_name,

            requestedQuantity: row.requested_quantity,

            acceptedQuantity: row.accepted_quantity,

            shortage: (row.requested_quantity ?? 0) - (row.accepted_quantity ?? 0),

            requestedDeliveryDate: row.requested_delivery_date,

            supplierUnitCost: row.supplier_unit_cost,
          })),
      };
    }

    const returned = await conn.execute<{
      observation: string | null;
    }>(sql`
      select
        after ->> 'observation'
          as observation
      from audit_events
      where resource_type = 'purchase_order'
        and resource_id = ${id}
        and action =
          'PURCHASE_ORDER_RETURNED_BY_SUPPLIER'
      order by occurred_at desc
      limit 1
    `);

    return {
      ...common,

      planningPeriodId: first.planning_period_id,

      issuedBy: first.issued_by,

      latestSupplierObservation: returned.rows[0]?.observation ?? null,

      lines: rows.rows
        .filter((row) => row.line_id)
        .map((row) => ({
          id: row.line_id,

          commercialCode: row.commercial_code,

          productDescription: row.product_description,

          presentation: row.presentation,

          dispensingPointId: row.dispensing_point_id,

          dispensingPointCode: row.dispensing_point_code,

          dispensingPointName: row.dispensing_point_name,

          requestedQuantity: row.requested_quantity,

          acceptedQuantity: row.accepted_quantity,

          shortage: (row.requested_quantity ?? 0) - (row.accepted_quantity ?? 0),

          requestedDeliveryDate: row.requested_delivery_date,

          compensarUnitRateSnapshot: row.compensar_unit_rate_snapshot,

          supplierUnitCost: row.supplier_unit_cost,

          projectedDemandLineId: row.projected_demand_line_id,

          projectedDemandRevision: row.projected_demand_revision,

          demandBucket: row.demand_bucket,

          allocatedQuantity: row.allocated_quantity,

          sourceDemandChanged: row.current_demand_revision !== row.projected_demand_revision,
        })),
    };
  }

  private async audit(
    tx: Tx,
    actor: PurchaseOrderActor,
    action: string,
    resourceId: string,
    after: unknown,
  ) {
    await tx.execute(
      sql`insert into audit_events (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result) values ('USER', ${actor.userId}, ${actor.organizationId}, ${action}, 'purchase_order', ${resourceId}, ${after ? JSON.stringify(after) : null}::jsonb, ${actor.correlationId}, ${actor.correlationId}, 'SUCCESS')`,
    );
  }
}
