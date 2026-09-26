import {
  Inject,
  Injectable,
} from '@nestjs/common';

import {
  sql,
  type SQL,
} from 'drizzle-orm';

import type {
  createDatabase,
} from '@authorization/database';

import type {
  Scope,
} from '../common/request-scope';

import {
  applyPointScope,
} from '../common/point-scope.sql';

import {
  toIsoTimestamp,
} from '../common/date-time';

import {
  DATABASE,
} from '../tokens';

import {
  resolveAuthorizationOperationalStatus,
} from './authorization-query-status';

import {
  resolveAuthorizationAuditStatus,
  resolveAuthorizationFulfillmentStatus,
  resolveAuthorizationInitialValidationStatus,
  resolveAuthorizationValidityStatus,
} from './authorization-query-state';

import {
  authorizationQueryValidityWindow,
} from './authorization-query-validity';

type Database =
  ReturnType<
    typeof createDatabase
  >;

export interface AuthorizationQueryFilters {
  authorizationNumber?: string;
  commercialCode?: string;
  patient?: string;

  enablementStatus?:
    | 'ENABLED'
    | 'BLOCKED_SOURCE_STATUS';

  operationalStatus?:
    | 'UNASSIGNED'
    | 'ASSIGNED'
    | 'CLOSED';

  coverageType?:
    | 'PBS'
    | 'NO_PBS';

  page: number;
  limit: number;
}

interface AuthorizationQueryRow
  extends Record<string, unknown> {
  id: string;

  authorization_number: string;

  commercial_code: string;

  product_description:
    string | null;

  minimum_quantity:
    number | null;

  patient_document:
    string | null;

  patient_name:
    string | null;

  quantity:
    string | null;

  assignment_date:
    string | null;

  validity_end_date:
    string | null;

  enablement_status:
    string;

  tariff_membership_status:
    string;

  direction_status:
    string;

  coverage_type:
    string;

  logistics_status:
    string | null;

  operational_status:
    'UNASSIGNED'
    | 'ASSIGNED'
    | 'CLOSED';

  allocated_quantity:
    number;

  remaining_assigned_quantity:
    number;

  purchase_order:
    string | null;

  dispensing_point_code:
    string | null;

  dispensing_point_name:
    string | null;

  fulfillment_id:
    string | null;

  fulfillment_type:
    string | null;

  fulfillment_effective_date:
    string | null;

  fulfillment_quantity:
    number | null;

  fulfillment_confirmed_at:
    Date | string | null;

  fulfillment_source:
    string | null;

  review_status:
    string | null;

  created_at:
    Date | string;

  updated_at:
    Date | string;
}

@Injectable()
export class AuthorizationQueryRepository {
  constructor(
    @Inject(DATABASE)
    private readonly database:
      Database,
  ) {}

  private visibility(
    _scope: Scope,
  ): SQL {
    void _scope;

    /*
     * CONSULTA DE AUTORIZACIONES
     * ==========================
     *
     * Toda AUTO es consultable.
     *
     * La visibilidad NO depende de:
     * - enablement_status;
     * - ventana HOY + 30;
     * - existencia de OC;
     * - aceptación OLP;
     * - punto de dispensación;
     * - allocation de inventario;
     * - estado de cumplimiento.
     *
     * El acceso al módulo continúa protegido por
     * autenticación/permisos del endpoint.
     *
     * Las reglas operacionales se aplican después,
     * de forma independiente.
     */
    return sql`true`;
  }


  private sourceDateKey(
    field:
      | 'FECHA_ASIGNACION'
      | 'FECHA_FINAL_VIGENCIA',
  ): SQL {
    return sql`
      case
        when
          btrim(
            coalesce(
              i.source_data
                ->>
                ${field},
              ''
            )
          )
          ~
          '^[0-9]{8}$'
        then
          btrim(
            i.source_data
              ->>
              ${field}
          )

        when
          btrim(
            coalesce(
              i.source_data
                ->>
                ${field},
              ''
            )
          )
          ~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        then
          replace(
            substring(
              btrim(
                i.source_data
                  ->>
                  ${field}
              )
              from 1 for 10
            ),
            '-',
            ''
          )

        else
          null
      end
    `;
  }


  /*
   * Ventana operacional de la AUTO:
   *
   * FECHA_FINAL_VIGENCIA >= HOY
   * FECHA_ASIGNACION <= HOY + 30 dias
   *
   * Los limites son inclusivos.
   *
   * La vigencia NO controla visibilidad:
   * todas las AUTO permitidas por scope son consultables.
   *
   * Esta ventana se usa para prioridad y elegibilidad
   * de las acciones operacionales.
   *
   * Una AUTO vencida puede conservar su allocation durante
   * los 5 dias de gracia, aunque ya no puede operar.
   *
   * La liberacion posterior a la gracia es automatica.
   * El XLS solo asigna saldo disponible.
   */
  private validityWindow(): SQL {
    const {
      today,
      horizon,
    } =
      authorizationQueryValidityWindow();

    const todayKey =
      today.replace(
        /-/g,
        '',
      );

    const horizonKey =
      horizon.replace(
        /-/g,
        '',
      );

    const assignmentDate =
      this.sourceDateKey(
        'FECHA_ASIGNACION',
      );

    const validityEndDate =
      this.sourceDateKey(
        'FECHA_FINAL_VIGENCIA',
      );

    return sql`
      ${validityEndDate}
      >=
      ${todayKey}

      and

      ${assignmentDate}
      <=
      ${horizonKey}
    `;
  }

  async list(
    filters:
      AuthorizationQueryFilters,

    scope:
      Scope,
  ) {
    const conditions: SQL[] = [
      this.visibility(
        scope,
      ),
    ];

    if (
      filters.authorizationNumber
    ) {
      conditions.push(sql`
        i.numero_autorizacion
        ilike
        ${`%${filters.authorizationNumber}%`}
      `);
    }

    if (
      filters.commercialCode
    ) {
      conditions.push(sql`
        (
          i.codigo_medicamento
          ilike
          ${`%${filters.commercialCode}%`}

          or exists (
            select 1

            from
              tariff_annex_products tap_filter

            where
              tap_filter.codigo_producto =
                i.codigo_medicamento

              and tap_filter.active =
                true

              and (
                coalesce(
                  tap_filter.descripcion_comercial,
                  ''
                )
                ilike
                ${`%${filters.commercialCode}%`}

                or

                coalesce(
                  tap_filter.descripcion_generica,
                  ''
                )
                ilike
                ${`%${filters.commercialCode}%`}
              )
          )
        )
      `);
    }

    if (
      filters.patient
    ) {
      conditions.push(sql`
        (
          coalesce(
            i.source_data
              ->>
              'IDENTIFICACION_PACIENTE',

            i.source_data
              ->>
              'NUM_DOCUMENTO',

            ''
          )
          ilike
          ${`%${filters.patient}%`}

          or

          coalesce(
            i.source_data
              ->>
              'NOMBRE_PACIENTE',

            ''
          )
          ilike
          ${`%${filters.patient}%`}
        )
      `);
    }

    if (
      filters.enablementStatus
    ) {
      conditions.push(sql`
        i.enablement_status =
        ${filters.enablementStatus}
      `);
    }

    if (
      filters.coverageType
    ) {
      conditions.push(sql`
        i.coverage_type =
        ${filters.coverageType}
      `);
    }

    /*
     * Estado operacional REAL de la AUTO.
     *
     * No se deriva de estados ni referencias logísticas
     * históricas. La autoridad para ASSIGNED es
     * exclusivamente inventory_authorization_allocations
     * con saldo disponible.
     */
    if (
      filters.operationalStatus ===
      'CLOSED'
    ) {
      conditions.push(sql`
        (
          exists (
            select 1

            from
              authorization_fulfillments
                af_filter

            where
              af_filter.authorization_item_id =
                i.id
          )

          or

          exists (
            select 1

            from
              patient_applications
                pa_filter

            where
              pa_filter.authorization_item_id =
                i.id

              and pa_filter.status =
                'CONFIRMED'
          )
        )
      `);
    }

    if (
      filters.operationalStatus ===
      'ASSIGNED'
    ) {
      conditions.push(sql`
        not exists (
          select 1

          from
            authorization_fulfillments
              af_filter

          where
            af_filter.authorization_item_id =
              i.id
        )

        and not exists (
          select 1

          from
            patient_applications
              pa_filter

          where
            pa_filter.authorization_item_id =
              i.id

            and pa_filter.status =
              'CONFIRMED'
        )

        and exists (
          select 1

          from
            inventory_authorization_allocations
              iaa_filter

          where
            iaa_filter.authorization_item_id =
              i.id

            and iaa_filter.status in (
              'ALLOCATED',
              'PARTIALLY_CONSUMED'
            )

            and (
              iaa_filter.allocated_quantity
              -
              iaa_filter.consumed_quantity
              -
              iaa_filter.released_quantity
            ) > 0
        )
      `);
    }

    if (
      filters.operationalStatus ===
      'UNASSIGNED'
    ) {
      conditions.push(sql`
        not exists (
          select 1

          from
            authorization_fulfillments
              af_filter

          where
            af_filter.authorization_item_id =
              i.id
        )

        and not exists (
          select 1

          from
            patient_applications
              pa_filter

          where
            pa_filter.authorization_item_id =
              i.id

            and pa_filter.status =
              'CONFIRMED'
        )

        and not exists (
          select 1

          from
            inventory_authorization_allocations
              iaa_filter

          where
            iaa_filter.authorization_item_id =
              i.id

            and iaa_filter.status in (
              'ALLOCATED',
              'PARTIALLY_CONSUMED'
            )

            and (
              iaa_filter.allocated_quantity
              -
              iaa_filter.consumed_quantity
              -
              iaa_filter.released_quantity
            ) > 0
        )
      `);
    }

    const where =
      sql.join(
        conditions,
        sql` and `,
      );

    const offset =
      (
        filters.page
        -
        1
      )
      *
      filters.limit;

    const count =
      await this.database.db.execute<{
        total: number;
      }>(sql`
        select
          count(*)::int
            as total

        from
          authorization_items i

        where
          ${where}
      `);

    const result =
      await this.queryRows(
        where,
        filters.limit,
        offset,
        scope,
      );

    return {
      items:
        result.rows.map(
          (row) =>
            this.toResponse(
              row,
            ),
        ),

      total:
        Number(
          count.rows[0]
            ?.total
          ??
          0,
        ),

      page:
        filters.page,

      pageSize:
        filters.limit,
    };
  }

  async detail(
    id: string,
    scope: Scope,
  ) {
    const conditions: SQL[] = [
      sql`i.id = ${id}`,

      this.visibility(
        scope,
      ),
    ];

    const result =
      await this.queryRows(
        sql.join(
          conditions,
          sql` and `,
        ),
        1,
        0,
        scope,
      );

    const row =
      result.rows[0];

    if (!row) {
      return null;
    }

    const purchaseOrders =
      await this.linkedPurchaseOrders(
        row.id,
        row.commercial_code,
        scope,
      );

    const response =
      this.toResponse(
        row,
      );

    /*
     * INVARIANTE OC:
     *
     * Una línea de orden de compra representa
     * producto + punto de dispensación.
     *
     * Por ello, cuando el detalle conoce la relación
     * durable AUTO -> OC, el punto debe provenir de
     * esas mismas líneas de OC y no de la elegibilidad
     * posterior de OLP/inventario.
     */
    const linkedPointCodes =
      [
        ...new Set(
          purchaseOrders
            .map(
              (order) =>
                order.dispensingPointCode,
            )
            .filter(
              (
                value,
              ): value is string =>
                Boolean(
                  value,
                ),
            ),
        ),
      ];

    const linkedPointNames =
      [
        ...new Set(
          purchaseOrders
            .map(
              (order) =>
                order.dispensingPointName,
            )
            .filter(
              (
                value,
              ): value is string =>
                Boolean(
                  value,
                ),
            ),
        ),
      ];

    return {
      ...response,

      /*
       * El contrato público de purchaseOrders
       * permanece sin cambios.
       */
      purchaseOrders:
        purchaseOrders.map(
          (order) => ({
            id:
              order.id,

            purchaseOrderCode:
              order.purchaseOrderCode,

            sourceQuantity:
              order.sourceQuantity,
          }),
        ),

      dispensingPointCode:
        linkedPointCodes.length >
          0
          ? linkedPointCodes.join(
              ', ',
            )
          : response.dispensingPointCode,

      dispensingPointName:
        linkedPointNames.length >
          0
          ? linkedPointNames.join(
              ', ',
            )
          : response.dispensingPointName,
    };
  }


  private async linkedPurchaseOrders(
    authorizationItemId: string,
    commercialCode: string,
    scope: Scope,
  ) {
    /*
     * Relación durable AUTO -> OC.
     *
     * NO determina ASSIGNED.
     * NO depende de inventory_authorization_allocations.
     *
     * MTD puede consultar la relación operacional completa.
     *
     * MEDICARTE conserva la frontera ya existente:
     * - OLP debe haber aceptado la OC.
     * - el punto debe pertenecer a la organización.
     * - se respeta el scope de puntos del usuario.
     */
    /*
     * Relación durable de consulta.
     *
     * La OC vinculada se muestra aunque todavía:
     * - no haya sido aceptada por OLP;
     * - no tenga inventario asignado.
     *
     * El punto forma parte de la línea de OC.
     * Para histórico se resuelve mediante el mapping
     * producto/INVIMA ya existente.
     *
     * Esto NO modifica operationalStatus.
     */
    void scope;

    const orderScope =
      sql`true`;

    const result =
      await this.database.db.execute<{
        id: string;

        purchase_order_code:
          string | null;

        source_quantity:
          number;

        dispensing_point_code:
          string | null;

        dispensing_point_name:
          string | null;
      }>(sql`
        select
          po_link.id,

          po_link.purchase_order_code,

          coalesce(
            sum(
              poas_link
                .source_quantity_snapshot
            ),
            0
          )::int
            as source_quantity,

          string_agg(
            distinct
              dp_link.code,
            ', '
          )
            as dispensing_point_code,

          string_agg(
            distinct
              dp_link.name,
            ', '
          )
            as dispensing_point_name

        from
          purchase_order_authorization_sources
            poas_link

        join
          purchase_order_lines
            pol_link
            on pol_link.id =
               poas_link
                 .purchase_order_line_id

        join
          purchase_orders
            po_link
            on po_link.id =
               pol_link.purchase_order_id

        /*
         * Las líneas modernas ya tienen punto.
         *
         * Para líneas históricas que no lo tengan,
         * conservamos la misma resolución por
         * producto/INVIMA usada actualmente.
         */
        left join lateral (
          select
            mapping_link
              .dispensing_point_id

          from
            tariff_annex_products
              tap_link

          join
            product_delivery_point_mappings
              mapping_link
              on btrim(
                   coalesce(
                     tap_link
                       .numero_expediente_invima,
                     ''
                   )
                 ) ~ '^[0-9]+$'

             and btrim(
                   coalesce(
                     tap_link
                       .consecutivo_invima_presentacion,
                     ''
                   )
                 ) ~ '^[0-9]+$'

             and mapping_link
                   .invima_record_normalized =
                 coalesce(
                   nullif(
                     ltrim(
                       btrim(
                         tap_link
                           .numero_expediente_invima
                       ),
                       '0'
                     ),
                     ''
                   ),
                   '0'
                 )

             and mapping_link
                   .invima_presentation_normalized =
                 coalesce(
                   nullif(
                     ltrim(
                       btrim(
                         tap_link
                           .consecutivo_invima_presentacion
                       ),
                       '0'
                     ),
                     ''
                   ),
                   '0'
                 )

          where
            pol_link.dispensing_point_id
              is null

            and tap_link.codigo_producto =
              pol_link.commercial_code

            and tap_link.active =
              true

          order by
            tap_link.updated_at desc,
            tap_link.id desc

          limit 1
        ) resolved_point
          on true

        left join
          dispensing_points
            dp_link
            on dp_link.id =
               coalesce(
                 pol_link
                   .dispensing_point_id,

                 resolved_point
                   .dispensing_point_id
               )

        where
          poas_link.authorization_item_id =
            ${authorizationItemId}

          and pol_link.commercial_code =
            ${commercialCode}

          /*
           * Canceladas/rechazadas conservan su
           * trazabilidad en BD, pero no participan
           * de la vista operacional activa.
           */
          and po_link.status not in (
            'CANCELLED',
            'REJECTED'
          )

          and ${orderScope}

        group by
          po_link.id,
          po_link.purchase_order_code,
          po_link.created_at

        order by
          po_link.created_at,
          po_link.id
      `);

    return result.rows.map(
      (row) => ({
        id:
          row.id,

        purchaseOrderCode:
          row.purchase_order_code ??
          row.id,

        sourceQuantity:
          Number(
            row.source_quantity ??
            0,
          ),

        dispensingPointCode:
          row.dispensing_point_code,

        dispensingPointName:
          row.dispensing_point_name,
      }),
    );
  }


  private queryRows(
    where:
      SQL,

    limit:
      number,

    offset:
      number,

    scope:
      Scope,
  ) {
    const eligibilityScope =
      scope.organizationCode ===
      'MEDICARTE'
        ? sql`
            dp_eligibility.organization_id =
              ${scope.organizationId}

            and

            ${applyPointScope(
              sql`dp_eligibility.id`,
              scope,
            )}
          `
        : sql`true`;

    /*
     * PRIORIDAD VISUAL DE CONSULTA
     * ============================
     *
     * La prioridad usa las mismas dimensiones que ya ve
     * el usuario en la tabla:
     *
     * 1. Cerradas siempre al final.
     * 2. Validación:
     *    Cumple -> Pendiente -> No cumple.
     * 3. Vigencia:
     *    Dentro de rango -> Fuera +30 -> Vencida -> Fecha inválida.
     * 4. Estado operativo:
     *    Lista para entrega/aplicación -> Pendiente.
     *
     * No modifica estados ni reglas funcionales.
     */

    const quantityText =
      sql`
        btrim(
          coalesce(
            i.source_data
              ->>
              'CANTIDAD',
            ''
          )
        )
      `;

    const quantityNumeric =
      sql`
        case
          when
            ${quantityText}
            ~
            '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
          then
            (${quantityText})::numeric

          else null
        end
      `;

    /*
     * Debe reflejar exactamente initialValidationStatus:
     *
     * 0 = PASSED
     * 1 = PENDING
     * 2 = FAILED
     */
    const validationPriority =
      sql`
        case
          when
            coalesce(
              i.enablement_status,
              ''
            ) <>
            'ENABLED'
          then 2

          when
            i.tariff_membership_status =
            'NOT_LISTED'
          then 2

          when
            coalesce(
              i.tariff_membership_status,
              ''
            ) <>
            'LISTED'
          then 1

          when
            ${quantityNumeric}
              is null

            or

            ${quantityNumeric}
              <= 0

            or

            trunc(
              ${quantityNumeric}
            ) <>
            ${quantityNumeric}

            or

            coalesce(
              product.minimum_quantity,
              1
            ) <= 0

            or

            ${quantityNumeric}
              <
            coalesce(
              product.minimum_quantity,
              1
            )
          then 2

          when
            i.coverage_type =
            'PBS'
          then
            case
              when
                i.direction_status =
                'NOT_APPLICABLE'
              then 0

              else 1
            end

          when
            i.coverage_type =
            'NO_PBS'
          then
            case
              when
                i.direction_status =
                'CONFIRMED'
              then 0

              else 1
            end

          else 1
        end
      `;

    const {
      today,
      horizon,
    } =
      authorizationQueryValidityWindow();

    const todayKey =
      today.replace(
        /-/g,
        '',
      );

    const horizonKey =
      horizon.replace(
        /-/g,
        '',
      );

    const assignmentDateKey =
      this.sourceDateKey(
        'FECHA_ASIGNACION',
      );

    const validityEndDateKey =
      this.sourceDateKey(
        'FECHA_FINAL_VIGENCIA',
      );

    /*
     * Refleja validityStatus:
     *
     * 0 = IN_WINDOW
     * 1 = OUTSIDE_HORIZON
     * 2 = EXPIRED
     * 3 = INVALID_DATE
     */
    const validityPriority =
      sql`
        case
          when (
            ${this.validityWindow()}
          )
          then 0

          when
            ${assignmentDateKey}
              is null

            or

            ${validityEndDateKey}
              is null
          then 3

          when
            ${validityEndDateKey}
              <
            ${todayKey}
          then 2

          when
            ${assignmentDateKey}
              >
            ${horizonKey}
          then 1

          else 3
        end
      `;

    /*
     * CLOSED tiene prioridad absoluta de salida:
     * cualquier AUTO cerrada va después de todas las
     * AUTO que aún requieren gestión.
     */
    const closedPriority =
      sql`
        case
          when
            fulfillment.id
              is not null

            or

            legacy_application.id
              is not null
          then 1

          else 0
        end
      `;

    /*
     * Entre AUTO activas:
     *
     * 0 = ASSIGNED / lista para entrega-aplicación
     * 1 = UNASSIGNED / pendiente recepción-asignación
     */
    const operationalPriority =
      sql`
        case
          when
            coalesce(
              allocation.remaining_quantity,
              0
            ) > 0
          then 0

          else 1
        end
      `;

    return this.database.db.execute<
      AuthorizationQueryRow
    >(sql`
      select
        i.id,

        i.numero_autorizacion
          as authorization_number,

        i.codigo_medicamento
          as commercial_code,

        product.product_description,

        product.minimum_quantity,

        coalesce(
          i.source_data
            ->>
            'IDENTIFICACION_PACIENTE',

          i.source_data
            ->>
            'NUM_DOCUMENTO'
        )
          as patient_document,

        i.source_data
          ->>
          'NOMBRE_PACIENTE'
          as patient_name,

        i.source_data
          ->>
          'CANTIDAD'
          as quantity,

        i.source_data
          ->>
          'FECHA_ASIGNACION'
          as assignment_date,

        i.source_data
          ->>
          'FECHA_FINAL_VIGENCIA'
          as validity_end_date,

        i.enablement_status,

        i.tariff_membership_status,

        i.direction_status,

        i.coverage_type,

        case
          when
            fulfillment.id
            is not null
          then
            'FULFILLED'

          when
            legacy_application.id
            is not null
          then
            'APPLIED'

          when
            coalesce(
              allocation.remaining_quantity,
              0
            )
            >
            0
          then
            'INVENTORY_ASSIGNED'

          when exists (
            select 1

            from
              patient_schedules ps

            where
              ps.authorization_item_id =
                i.id

              and ps.status in (
                'SCHEDULED',
                'RESCHEDULED'
              )
          )
          then
            'SCHEDULED'

          else
            'PENDING'
        end
          as logistics_status,

        case
          when
            fulfillment.id
            is not null

            or

            legacy_application.id
            is not null
          then
            'CLOSED'

          when
            coalesce(
              allocation.remaining_quantity,
              0
            )
            >
            0
          then
            'ASSIGNED'

          else
            'UNASSIGNED'
        end
          as operational_status,

        coalesce(
          allocation.allocated_quantity,
          0
        )::int
          as allocated_quantity,

        coalesce(
          allocation.remaining_quantity,
          0
        )::int
          as remaining_assigned_quantity,

        coalesce(
          allocation.purchase_order,
          eligibility.purchase_order
        )
          as purchase_order,

        coalesce(
          allocation.dispensing_point_code,
          eligibility.dispensing_point_code
        )
          as dispensing_point_code,

        coalesce(
          allocation.dispensing_point_name,
          eligibility.dispensing_point_name
        )
          as dispensing_point_name,

        coalesce(
          fulfillment.id,
          legacy_application.id
        )
          as fulfillment_id,

        case
          when
            fulfillment.id
            is not null
          then
            fulfillment.fulfillment_type

          when
            legacy_application.id
            is not null
          then
            'APPLICATION'

          else
            null
        end
          as fulfillment_type,

        coalesce(
          fulfillment.effective_date,
          legacy_application.application_date
        )
          as fulfillment_effective_date,

        coalesce(
          fulfillment.quantity,
          legacy_application.quantity
        )::int
          as fulfillment_quantity,

        coalesce(
          fulfillment.confirmed_at,
          legacy_application.confirmed_at
        )
          as fulfillment_confirmed_at,

        case
          when
            fulfillment.id
            is not null
          then
            fulfillment.source

          when
            legacy_application.id
            is not null
          then
            'LEGACY_APPLICATION'

          else
            null
        end
          as fulfillment_source,

        case
          when fulfillment.id is not null
          then fulfillment_audit.status

          when legacy_application.id is not null
          then application_audit.status

          else null
        end
          as review_status,

        i.created_at,

        i.updated_at

      from
        authorization_items i

      left join lateral (
        select
          coalesce(
            nullif(
              btrim(
                tap.descripcion_generica
              ),
              ''
            ),

            nullif(
              btrim(
                tap.descripcion_comercial
              ),
              ''
            )
          )
            as product_description,

          tap.minimum_quantity

        from
          tariff_annex_products tap

        where
          tap.codigo_producto =
            i.codigo_medicamento

          and tap.active =
            true

        order by
          tap.updated_at desc,
          tap.id desc

        limit 1
      ) product
        on true

      left join lateral (
        select
          coalesce(
            sum(
              poas_eligibility.source_quantity_snapshot
            ),
            0
          )::int
            as eligible_quantity,

          string_agg(
            distinct
              coalesce(
                po_eligibility.purchase_order_code,
                po_eligibility.id::text
              ),
            ', '
          )
            as purchase_order,

          string_agg(
            distinct
              dp_eligibility.code,
            ', '
          )
            as dispensing_point_code,

          string_agg(
            distinct
              dp_eligibility.name,
            ', '
          )
            as dispensing_point_name

        from
          purchase_order_authorization_sources
            poas_eligibility

        join
          purchase_order_lines
            pol_eligibility
            on pol_eligibility.id =
               poas_eligibility.purchase_order_line_id

        join
          purchase_orders
            po_eligibility
            on po_eligibility.id =
               pol_eligibility.purchase_order_id

        left join
          tariff_annex_products
            tap_eligibility
            on tap_eligibility.codigo_producto =
               pol_eligibility.commercial_code

           and tap_eligibility.active =
               true

        left join
          product_delivery_point_mappings
            mapping_eligibility
            on pol_eligibility.dispensing_point_id
               is null

           and btrim(
                 coalesce(
                   tap_eligibility.numero_expediente_invima,
                   ''
                 )
               ) ~ '^[0-9]+$'

           and btrim(
                 coalesce(
                   tap_eligibility.consecutivo_invima_presentacion,
                   ''
                 )
               ) ~ '^[0-9]+$'

           and mapping_eligibility.invima_record_normalized =
               coalesce(
                 nullif(
                   ltrim(
                     btrim(
                       tap_eligibility.numero_expediente_invima
                     ),
                     '0'
                   ),
                   ''
                 ),
                 '0'
               )

           and mapping_eligibility.invima_presentation_normalized =
               coalesce(
                 nullif(
                   ltrim(
                     btrim(
                       tap_eligibility.consecutivo_invima_presentacion
                     ),
                     '0'
                   ),
                   ''
                 ),
                 '0'
               )

        join
          dispensing_points
            dp_eligibility
            on dp_eligibility.id =
               coalesce(
                 pol_eligibility.dispensing_point_id,
                 mapping_eligibility.dispensing_point_id
               )

        where
          poas_eligibility.authorization_item_id =
            i.id

          and pol_eligibility.commercial_code =
            i.codigo_medicamento

          and po_eligibility.olp_accepted_at
            is not null

          and po_eligibility.status not in (
            'CANCELLED',
            'REJECTED'
          )

          and ${eligibilityScope}
      ) eligibility
        on true


      left join lateral (
        select
          coalesce(
            sum(
              iaa.allocated_quantity
            ),
            0
          )::int
            as allocated_quantity,

          coalesce(
            sum(
              greatest(
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
            as remaining_quantity,

          string_agg(
            distinct
              coalesce(
                po.purchase_order_code,
                po.id::text
              ),
            ', '
          )
            as purchase_order,

          string_agg(
            distinct
              dp.code,
            ', '
          )
            as dispensing_point_code,

          string_agg(
            distinct
              dp.name,
            ', '
          )
            as dispensing_point_name

        from
          inventory_authorization_allocations iaa

        join purchase_orders po
          on po.id =
             iaa.purchase_order_id

        join dispensing_points dp
          on dp.id =
             iaa.dispensing_point_id

        where
          iaa.authorization_item_id =
            i.id

          and iaa.status in (
            'ALLOCATED',
            'PARTIALLY_CONSUMED',
            'CONSUMED'
          )
      ) allocation
        on true

      left join lateral (
        select
          af.id,

          af.fulfillment_type,

          af.effective_date::text
            as effective_date,

          af.quantity,

          af.confirmed_at,

          af.source

        from
          authorization_fulfillments af

        where
          af.authorization_item_id =
            i.id

        limit 1
      ) fulfillment
        on true

      left join lateral (
        select
          pa.id,

          pa.application_date::text
            as application_date,

          coalesce(
            sum(
              pal.quantity
            ),
            0
          )::int
            as quantity,

          pa.confirmed_at

        from
          patient_applications pa

        left join patient_application_lines pal
          on pal.patient_application_id =
             pa.id

        where
          pa.authorization_item_id =
            i.id

          and pa.status =
            'CONFIRMED'

        group by
          pa.id,
          pa.application_date,
          pa.confirmed_at

        order by
          pa.confirmed_at desc nulls last,
          pa.id desc

        limit 1
      ) legacy_application
        on true

      left join lateral (
        select
          ar.status

        from
          audit_reviews ar

        where
          ar.authorization_fulfillment_id =
            fulfillment.id

        limit 1
      ) fulfillment_audit
        on true


      left join lateral (
        select
          paa.status

        from
          patient_application_audits paa

        where
          paa.patient_application_id =
            legacy_application.id

          and fulfillment.id
            is null

        limit 1
      ) application_audit
        on true

      where
        ${where}


      order by
        /*
         * 1. Cerradas siempre al final.
         */
        ${closedPriority} asc,

        /*
         * 2. Validación:
         *    Cumple -> Pendiente -> No cumple.
         */
        ${validationPriority} asc,

        /*
         * 3. Vigencia:
         *    Dentro de rango
         *    -> Fuera de rango +30
         *    -> Vencida
         *    -> Fecha inválida.
         */
        ${validityPriority} asc,

        /*
         * 4. Estado operativo:
         *    Lista para entrega/aplicación
         *    -> Pendiente de recepción/asignación.
         */
        ${operationalPriority} asc,

        /*
         * Dentro de rango:
         * primero la AUTO que vence antes.
         */
        case
          when
            ${validityPriority} = 0
          then
            ${validityEndDateKey}

          else null
        end asc nulls last,

        /*
         * Fuera +30:
         * primero la que entrará antes a la ventana.
         */
        case
          when
            ${validityPriority} = 1
          then
            ${assignmentDateKey}

          else null
        end asc nulls last,

        /*
         * Desempate determinístico.
         */
        i.created_at desc,
        i.id desc

      limit
        ${limit}

      offset
        ${offset}
    `);
  }

  private toResponse(
    row:
      AuthorizationQueryRow,
  ) {
    const fulfillment =
      row.fulfillment_id
        ? {
            id:
              row.fulfillment_id,

            type:
              row.fulfillment_type,

            effectiveDate:
              row.fulfillment_effective_date,

            quantity:
              row.fulfillment_quantity,

            confirmedAt:
              row.fulfillment_confirmed_at
                ? toIsoTimestamp(
                    row.fulfillment_confirmed_at,
                  )
                : null,

            source:
              row.fulfillment_source,
          }
        : null;

    const {
      today,
    } =
      authorizationQueryValidityWindow();

    const validityStatus =
      resolveAuthorizationValidityStatus({
        assignmentDate:
          row.assignment_date,

        validityEndDate:
          row.validity_end_date,

        today,
      });

    const initialValidationStatus =
      resolveAuthorizationInitialValidationStatus({
        enablementStatus:
          row.enablement_status,

        tariffMembershipStatus:
          row.tariff_membership_status,

        coverageType:
          row.coverage_type,

        directionStatus:
          row.direction_status,

        quantity:
          row.quantity,

        minimumQuantity:
          row.minimum_quantity,
      });

    const fulfillmentStatus =
      resolveAuthorizationFulfillmentStatus(
        row.fulfillment_type,
      );

    const auditStatus =
      resolveAuthorizationAuditStatus(
        row.review_status,
      );

    return {
      id:
        row.id,

      authorizationNumber:
        row.authorization_number,

      commercialCode:
        row.commercial_code,

      productDescription:
        row.product_description,

      patientDocument:
        row.patient_document,

      patientName:
        row.patient_name,

      quantity:
        row.quantity,

      assignmentDate:
        row.assignment_date,

      validityEndDate:
        row.validity_end_date,

      enablementStatus:
        row.enablement_status,

      initialValidationStatus,

      validityStatus,

      operationalEligible:
        initialValidationStatus ===
          'PASSED'
        &&
        validityStatus ===
          'IN_WINDOW',

      fulfillmentStatus,

      auditStatus,

      coverageType:
        row.coverage_type,

      logisticsStatus:
        row.logistics_status,

      operationalStatus:
        resolveAuthorizationOperationalStatus({
          hasFulfillment:
            Boolean(
              row.fulfillment_id,
            ),

          remainingAssignedQuantity:
            Number(
              row.remaining_assigned_quantity
              ??
              0,
            ),
        }),

      allocatedQuantity:
        Number(
          row.allocated_quantity
          ??
          0,
        ),

      remainingAssignedQuantity:
        Number(
          row.remaining_assigned_quantity
          ??
          0,
        ),

      purchaseOrder:
        row.purchase_order,

      /*
       * Se completa únicamente en detail().
       * La lista permanece liviana.
       */
      purchaseOrders: [],

      dispensingPointCode:
        row.dispensing_point_code,

      dispensingPointName:
        row.dispensing_point_name,

      fulfillment,

      createdAt:
        toIsoTimestamp(
          row.created_at,
        ),

      updatedAt:
        toIsoTimestamp(
          row.updated_at,
        ),
    };
  }
}
