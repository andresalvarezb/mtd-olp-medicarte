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
  resolveAuthorizationFulfillmentProgressStatus,
  resolveAuthorizationOperationalStatus,
} from './authorization-query-status';

import {
  resolveAuthorizationAuditStatus,
  resolveAuthorizationFulfillmentStatus,
  resolveAuthorizationInitialValidationStatus,
  resolveAuthorizationLifecycleReasons,
  resolveAuthorizationLifecycleStatus,
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

  lifecycleEnablement?:
    | 'ENABLED'
    | 'PENDING'
    | 'DISABLED';

  operationalStatus?:
    | 'UNASSIGNED'
    | 'PARTIALLY_ASSIGNED'
    | 'ASSIGNED'
    | 'OUT_OF_OPERATION'
    | 'CLOSED';

  fulfillmentProgressStatus?:
    | 'PENDING'
    | 'PARTIAL'
    | 'COMPLETE';

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

  dosage:
    string | null;

  quantity:
    string | null;

  assignment_date:
    string | null;

  validity_end_date:
    string | null;

  moderator_fee_value:
    string | null;

  version:
    number;

  enablement_status:
    string;

  tariff_membership_status:
    string;

  direction_status:
    string;

  mipres_manual_decision:
    string;

  coverage_type:
    string;


  logistics_status:
    string | null;

  operational_status:
    'UNASSIGNED'
    | 'PARTIALLY_ASSIGNED'
    | 'ASSIGNED'
    | 'CLOSED';

  allocated_quantity:
    number;

  remaining_assigned_quantity:
    number;

  fulfilled_quantity:
    number;

  remaining_authorized_quantity:
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

  billing_audit_status:
    'PENDING'
    | 'REVIEWED';

  billing_audit_result:
    'COMPLIES'
    | 'DOES_NOT_COMPLY'
    | null;

  billing_audit_evidence_count:
    number;

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
    scope: Scope,
  ): SQL {
    /*
     * COMPENSAR OBSERVER
     * ==================
     *
     * Compensar consulta exclusivamente las
     * autorizaciones relacionadas con su organización.
     *
     * No se usa estado operacional como frontera:
     * puede observar el ciclo completo.
     */
    if (
      scope.organizationCode ===
      'COMPENSAR'
    ) {
      return sql`
        exists (
          select
            1

          from
            authorization_item_organizations
              aio_scope

          where
            aio_scope.authorization_item_id =
              i.id

            and aio_scope.organization_id =
              ${scope.organizationId}::uuid
        )
      `;
    }

    /*
     * Comportamiento operacional existente para
     * los demás actores.
     */
    return sql`true`;
  }


  private sourceDateKey(
    field:
      | 'FECHA_ASIGNACION'
      | 'FECHA_FINAL_VIGENCIA',
  ): SQL {
    const value =
      sql`
        btrim(
          coalesce(
            i.source_data
              ->>
              ${field},
            ''
          )
        )
      `;

    const compact =
      sql`
        case
          when
            ${value}
            ~
            '^[0-9]{8}$'
          then
            ${value}

          when
            ${value}
            ~
            '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          then
            replace(
              substring(
                ${value}
                from 1 for 10
              ),
              '-',
              ''
            )

          else
            null
        end
      `;

    const year =
      sql`
        substring(
          ${compact}
          from 1 for 4
        )::int
      `;

    const month =
      sql`
        substring(
          ${compact}
          from 5 for 2
        )::int
      `;

    const day =
      sql`
        substring(
          ${compact}
          from 7 for 2
        )::int
      `;

    const maximumDay =
      sql`
        case
          when
            ${month}
            in (
              1,
              3,
              5,
              7,
              8,
              10,
              12
            )
          then
            31

          when
            ${month}
            in (
              4,
              6,
              9,
              11
            )
          then
            30

          when
            ${month}
            =
            2
          then
            case
              when
                (
                  ${year}
                  %
                  400
                )
                =
                0

                or

                (
                  (
                    ${year}
                    %
                    4
                  )
                  =
                  0

                  and

                  (
                    ${year}
                    %
                    100
                  )
                  <>
                  0
                )
              then
                29

              else
                28
            end

          else
            0
        end
      `;

    return sql`
      case
        when
          ${compact}
            is null
        then
          null

        when
          ${month}
            < 1

          or

          ${month}
            > 12
        then
          null

        when
          ${day}
            < 1

          or

          ${day}
            >
          ${maximumDay}
        then
          null

        else
          ${compact}
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
  private validityStatusSql(): SQL {
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
      case
        when
          ${assignmentDate}
            is null

          or

          ${validityEndDate}
            is null
        then
          'INVALID_DATE'

        when
          ${validityEndDate}
            <
          ${todayKey}
        then
          'EXPIRED'

        when
          ${assignmentDate}
            >
          ${horizonKey}
        then
          'OUTSIDE_HORIZON'

        else
          'IN_WINDOW'
      end
    `;
  }


  private validityWindow(): SQL {
    return sql`
      (
        ${this.validityStatusSql()}
      )
      in (
        'IN_WINDOW',
        'EXPIRED'
      )
    `;
  }


  private initialValidationStatusSql(): SQL {
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

    const minimumQuantity =
      sql`
        coalesce(
          (
            select
              tap_validation.minimum_quantity

            from
              tariff_annex_products
                tap_validation

            where
              tap_validation.codigo_producto =
                i.codigo_medicamento

              and tap_validation.active =
                true

            order by
              tap_validation.updated_at
                desc,
              tap_validation.id
                desc

            limit 1
          ),
          1
        )
      `;

    return sql`
      case
        when
          coalesce(
            i.enablement_status,
            ''
          )
          <>
          'ENABLED'
        then
          'FAILED'

        when
          i.tariff_membership_status =
          'NOT_LISTED'
        then
          'FAILED'

        when
          coalesce(
            i.tariff_membership_status,
            ''
          )
          <>
          'LISTED'
        then
          'PENDING'

        when
          ${quantityNumeric}
            is null

          or

          ${quantityNumeric}
            <= 0

          or

          trunc(
            ${quantityNumeric}
          )
          <>
          ${quantityNumeric}

          or

          ${minimumQuantity}
            <= 0

          or

          ${quantityNumeric}
            <
          ${minimumQuantity}
        then
          'FAILED'

        when
          i.coverage_type =
          'PBS'
        then
          case
            when
              i.direction_status =
              'NOT_APPLICABLE'
            then
              'PASSED'

            else
              'PENDING'
          end

        when
          i.coverage_type =
          'NO_PBS'
        then
          case
            when
              i.mipres_manual_decision =
              'MANUALLY_ENABLED'
            then
              'PASSED'

            when
              i.mipres_manual_decision =
              'MANUALLY_DISABLED'
            then
              'FAILED'

            else
              'PENDING'
          end

        else
          'PENDING'
      end
    `;
  }


  private initialValidationPassed(): SQL {
    return sql`
      (
        ${this.initialValidationStatusSql()}
      )
      =
      'PASSED'
    `;
  }


  private lifecycleEnablementSql(): SQL {
    const initialValidationStatus =
      this.initialValidationStatusSql();

    const validityStatus =
      this.validityStatusSql();

    return sql`
      case
        /*
         * Bloqueos definitivos tienen precedencia
         * absoluta sobre cualquier condición pendiente.
         */
        when
          ${initialValidationStatus}
          =
          'FAILED'

          or

          ${validityStatus}
          in (
            'INVALID_DATE',
            'EXPIRED'
          )
        then
          'DISABLED'

        /*
         * Solo si no existe bloqueo definitivo,
         * las condiciones resolubles/temporales
         * producen PENDING.
         */
        when
          ${initialValidationStatus}
          =
          'PENDING'

          or

          ${validityStatus}
          =
          'OUTSIDE_HORIZON'
        then
          'PENDING'

        else
          'ENABLED'
      end
    `;
  }


  private operationalEligibility(): SQL {
    return sql`
      (
        ${this.initialValidationPassed()}
      )

      and

      (
        ${this.validityWindow()}
      )
    `;
  }


  private retainedExpiredAssignmentEligibility(): SQL {
    return sql`
      (
        ${this.initialValidationPassed()}
      )

      and

      (
        ${this.validityStatusSql()}
      )
      =
      'EXPIRED'

      and

      exists (
        select
          1

        from
          inventory_authorization_allocations
            iaa_retained

        where
          iaa_retained.authorization_item_id =
            i.id

          and iaa_retained.status in (
            'ALLOCATED',
            'PARTIALLY_CONSUMED'
          )

          and (
            iaa_retained.allocated_quantity
            -
            iaa_retained.consumed_quantity
            -
            iaa_retained.released_quantity
          ) > 0
      )
    `;
  }


  private assignmentOperationalEligibility(): SQL {
    return sql`
      (
        ${this.operationalEligibility()}
      )

      or

      (
        ${this.retainedExpiredAssignmentEligibility()}
      )
    `;
  }


  private authorizedQuantitySql(): SQL {
    return sql`
      case
        when
          btrim(
            coalesce(
              i.source_data
                ->>
                'CANTIDAD',
              ''
            )
          ) ~ '^[1-9][0-9]*$'

        then
          (
            i.source_data
              ->>
              'CANTIDAD'
          )::int

        else
          0
      end
    `;
  }


  private fulfilledQuantitySql(): SQL {
    /*
     * Durante la coexistencia de fulfillment y
     * patient_applications usamos la evidencia
     * acumulada máxima, NO la suma entre canales.
     *
     * Esto evita doble contabilización cuando una
     * misma operación ya dejó consumo de allocation.
     */
    return sql`
      greatest(
        coalesce(
          (
            select
              sum(
                af_progress.quantity
              )::int

            from
              authorization_fulfillments
                af_progress

            where
              af_progress.authorization_item_id =
                i.id
          ),
          0
        ),

        coalesce(
          (
            select
              sum(
                pal_progress.quantity
              )::int

            from
              patient_applications
                pa_progress

            join
              patient_application_lines
                pal_progress
                  on pal_progress.patient_application_id =
                     pa_progress.id

            where
              pa_progress.authorization_item_id =
                i.id

              and pa_progress.status =
                'CONFIRMED'
          ),
          0
        ),

        coalesce(
          (
            select
              sum(
                iaa_progress.consumed_quantity
              )::int

            from
              inventory_authorization_allocations
                iaa_progress

            where
              iaa_progress.authorization_item_id =
                i.id
          ),
          0
        )
      )
    `;
  }


  private remainingAuthorizedQuantitySql(): SQL {
    return sql`
      greatest(
        ${this.authorizedQuantitySql()}
        -
        ${this.fulfilledQuantitySql()},
        0
      )
    `;
  }


  private remainingAssignedQuantitySql(): SQL {
    return sql`
      coalesce(
        (
          select
            sum(
              greatest(
                iaa_progress.allocated_quantity
                -
                iaa_progress.consumed_quantity
                -
                iaa_progress.released_quantity,
                0
              )
            )::int

          from
            inventory_authorization_allocations
              iaa_progress

          where
            iaa_progress.authorization_item_id =
              i.id

            and iaa_progress.status in (
              'ALLOCATED',
              'PARTIALLY_CONSUMED'
            )
        ),
        0
      )
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
        (
          i.numero_autorizacion
          ilike
          ${`%${filters.authorizationNumber}%`}

          or

          i.authorization_key
          ilike
          ${`%${filters.authorizationNumber}%`}
        )
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
      filters.lifecycleEnablement
    ) {
      conditions.push(sql`
        (
          ${this.lifecycleEnablementSql()}
        )
        =
        ${filters.lifecycleEnablement}
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
     * Estado operacional acumulado.
     *
     * CLOSED solamente cuando:
     *
     * fulfilled >= authorized.
     *
     * La cobertura física se compara contra el
     * saldo autorizado pendiente, no contra la
     * cantidad original.
     */
    const authorizedQuantityFilter =
      this.authorizedQuantitySql();

    const remainingAuthorizedQuantityFilter =
      this.remainingAuthorizedQuantitySql();

    const remainingAssignedQuantityFilter =
      this.remainingAssignedQuantitySql();

    const fulfilledQuantityFilter =
      this.fulfilledQuantitySql();


    if (
      filters.fulfillmentProgressStatus ===
        'PENDING'
    ) {
      conditions.push(sql`
        ${fulfilledQuantityFilter}
          <= 0
      `);
    }


    if (
      filters.fulfillmentProgressStatus ===
        'PARTIAL'
    ) {
      conditions.push(sql`
        ${fulfilledQuantityFilter}
          > 0

        and

        not (
          ${authorizedQuantityFilter}
            > 0

          and

          ${remainingAuthorizedQuantityFilter}
            = 0
        )
      `);
    }


    if (
      filters.fulfillmentProgressStatus ===
        'COMPLETE'
    ) {
      conditions.push(sql`
        ${authorizedQuantityFilter}
          > 0

        and

        ${remainingAuthorizedQuantityFilter}
          = 0
      `);
    }


    if (
      filters.operationalStatus ===
        'CLOSED'
    ) {
      conditions.push(sql`
        ${authorizedQuantityFilter}
          > 0

        and

        ${remainingAuthorizedQuantityFilter}
          = 0
      `);
    }


    if (
      filters.operationalStatus ===
        'ASSIGNED'
    ) {
      conditions.push(sql`
        ${this.operationalEligibility()}

        and

        ${remainingAuthorizedQuantityFilter}
          > 0

        and

        ${remainingAssignedQuantityFilter}
          >=
        ${remainingAuthorizedQuantityFilter}
      `);
    }


    if (
      filters.operationalStatus ===
        'PARTIALLY_ASSIGNED'
    ) {
      conditions.push(sql`
        ${this.operationalEligibility()}

        and

        ${remainingAuthorizedQuantityFilter}
          > 0

        and

        ${remainingAssignedQuantityFilter}
          > 0

        and

        ${remainingAssignedQuantityFilter}
          <
        ${remainingAuthorizedQuantityFilter}
      `);
    }


    if (
      filters.operationalStatus ===
        'UNASSIGNED'
    ) {
      conditions.push(sql`
        ${this.operationalEligibility()}

        and

        ${remainingAuthorizedQuantityFilter}
          > 0

        and

        ${remainingAssignedQuantityFilter}
          <= 0
      `);
    }


    if (
      filters.operationalStatus ===
        'OUT_OF_OPERATION'
    ) {
      conditions.push(sql`
        not (
          ${authorizedQuantityFilter}
            > 0

          and

          ${remainingAuthorizedQuantityFilter}
            = 0
        )

        and

        not (
          ${this.operationalEligibility()}
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

            availableQuantity:
              order.availableQuantity,
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


  async history(
    id: string,
    scope: Scope,
  ) {
    /*
     * HISTORIAL DE AUTO
     * =================
     *
     * Read model exclusivamente de consulta.
     *
     * No reconstruye estados inventados a partir del
     * snapshot actual. Cada tarjeta nace de evidencia
     * persistida:
     *
     * - authorization_items
     * - purchase_order_authorization_sources
     * - purchase_order_receipts / receipts
     * - inventory_authorization_allocations
     * - authorization_fulfillments
     * - patient_applications
     * - audit_events
     *
     * La reasignación utiliza el audit_event
     * PURCHASE_ORDER_AUTHORIZATION_REASSIGNED porque
     * purchase_order_authorization_sources e
     * inventory_authorization_allocations cambian su FK
     * hacia la AUTO destino.
     */

    type HistoryEvent = {
      id: string;

      type: string;

      occurredAt: string;

      title: string;

      description: string;

      actorName: string | null;

      organizationCode: string | null;

      details: Array<{
        label: string;

        value: string;
      }>;
    };


    const authorization =
      (
        await this.database.db.execute<{
          id: string;

          authorization_key: string;

          authorization_number: string;

          commercial_code: string;

          patient_name: string | null;

          created_at: Date | string;

          created_by_name: string | null;

          organization_code: string | null;
        }>(sql`
          select
            i.id,

            i.authorization_key,

            i.numero_autorizacion
              as authorization_number,

            i.codigo_medicamento
              as commercial_code,

            coalesce(
              nullif(
                btrim(
                  i.source_data
                    ->>
                    'NOMBRE_PACIENTE'
                ),
                ''
              ),
              nullif(
                btrim(
                  i.source_data
                    ->>
                    'PACIENTE'
                ),
                ''
              )
            )
              as patient_name,

            i.created_at,

            creator.display_name
              as created_by_name,

            import_org.code
              as organization_code

          from
            authorization_items i

          left join
            import_batches ib
              on ib.id =
                 i.created_from_batch_id

          left join
            users creator
              on creator.id =
                 ib.created_by

          left join
            organizations import_org
              on import_org.id =
                 ib.organization_id

          where
            i.id =
              ${id}

            and ${this.visibility(scope)}

          limit 1
        `)
      ).rows[0];


    if (!authorization) {
      return null;
    }


    const events:
      HistoryEvent[] =
      [];


    events.push({
      id:
        `authorization-created:${authorization.id}`,

      type:
        'AUTHORIZATION_CREATED',

      occurredAt:
        toIsoTimestamp(
          authorization.created_at,
        ),

      title:
        'Autorización registrada',

      description:
        `Se registró la autorización ${authorization.authorization_number}${authorization.patient_name ? ` para ${authorization.patient_name}` : ''}.`,

      actorName:
        authorization.created_by_name,

      organizationCode:
        authorization.organization_code,

      details: [
        {
          label:
            'Autorización',

          value:
            authorization.authorization_number,
        },

        {
          label:
            'Producto',

          value:
            authorization.commercial_code,
        },
      ],
    });


    /*
     * ======================================================
     * REASIGNACIONES
     * ======================================================
     *
     * Esta es la fuente histórica autoritativa.
     *
     * No depende del authorization_item_id actual de la
     * allocation/source, porque esas FKs sí cambian durante
     * una reasignación.
     */

    /*
     * ======================================================
     * AUDITORÍA DE FACTURACIÓN
     * ======================================================
     *
     * Fuente histórica autoritativa:
     * audit_events de authorization_billing_audit.
     */
    if (
      scope.organizationCode ===
        'MTD'
    ) {
      const billingAuditHistoryEvents =
        await this.database.db.execute<{
          id: string;

          action: string;

          occurred_at:
            Date | string;

          actor_name:
            string | null;

          organization_code:
            string | null;

          audit_result:
            string | null;

          observation:
            string | null;
        }>(sql`
          select
            ae.id,

            ae.action,

            ae.occurred_at,

            actor.display_name
              as actor_name,

            actor_org.code
              as organization_code,

            ae.after
              ->>
              'result'
              as audit_result,

            ae.after
              ->>
              'observation'
              as observation

          from
            audit_events ae

          left join
            users actor
              on actor.id =
                 ae.actor_id

          left join
            organizations actor_org
              on actor_org.id =
                 ae.organization_id

          where
            ae.resource_type =
              'authorization_billing_audit'

            and ae.action in (
              'AUTHORIZATION_BILLING_AUDIT_STARTED',
              'AUTHORIZATION_BILLING_AUDIT_REVIEWED'
            )

            and ae.result =
              'SUCCESS'

            and ae.after
              ->>
              'authorizationItemId'
              =
              ${authorization.id}

          order by
            ae.occurred_at,
            ae.id
        `);


      for (
        const row of
        billingAuditHistoryEvents.rows
      ) {
        const reviewed =
          row.action ===
            'AUTHORIZATION_BILLING_AUDIT_REVIEWED';

        const resultLabel =
          row.audit_result ===
            'COMPLIES'
            ? 'Cumple'
            : row.audit_result ===
                'DOES_NOT_COMPLY'
              ? 'No cumple'
              : null;


        events.push({
          id:
            `billing-audit:${row.id}`,

          type:
            row.action,

          occurredAt:
            toIsoTimestamp(
              row.occurred_at,
            ),

          title:
            reviewed
              ? 'Auditoría de facturación revisada'
              : 'Auditoría de facturación iniciada',

          description:
            reviewed
              ? resultLabel
                ? `La auditoría de facturación de la autorización ${authorization.authorization_number} fue revisada con resultado: ${resultLabel}.`
                : `La auditoría de facturación de la autorización ${authorization.authorization_number} fue revisada.`
              : `Se inició la auditoría de facturación de la autorización ${authorization.authorization_number}.`,

          actorName:
            row.actor_name,

          organizationCode:
            row.organization_code,

          details: [
            {
              label:
                'Estado',

              value:
                reviewed
                  ? 'Revisada'
                  : 'Pendiente',
            },

            ...(
              resultLabel
                ? [
                    {
                      label:
                        'Resultado',

                      value:
                        resultLabel,
                    },
                  ]
                : []
            ),

            ...(
              reviewed &&
              row.actor_name
                ? [
                    {
                      label:
                        'Auditor',

                      value:
                        row.actor_name,
                    },
                  ]
                : []
            ),

            ...(
              row.observation
                ? [
                    {
                      label:
                        'Observación',

                      value:
                        row.observation,
                    },
                  ]
                : []
            ),
          ],
        });
      }
    }


    const reassignments =
      await this.database.db.execute<{
        id: string;

        occurred_at: Date | string;

        actor_name: string | null;

        organization_code: string | null;

        purchase_order_code: string | null;

        commercial_code: string | null;

        quantity: string | null;

        origin_authorization_key: string | null;

        destination_authorization_key: string | null;

        origin_authorization_number: string | null;

        destination_authorization_number: string | null;

        origin_patient_name: string | null;

        destination_patient_name: string | null;

        dispensing_point_code: string | null;

        dispensing_point_name: string | null;
      }>(sql`
        select
          ae.id,

          ae.occurred_at,

          actor.display_name
            as actor_name,

          actor_org.code
            as organization_code,

          ae.after
            ->>
            'purchaseOrderCode'
            as purchase_order_code,

          ae.after
            ->>
            'commercialCode'
            as commercial_code,

          ae.after
            ->>
            'quantity'
            as quantity,

          ae.after
            ->>
            'originAuthorizationKey'
            as origin_authorization_key,

          ae.after
            ->>
            'destinationAuthorizationKey'
            as destination_authorization_key,

          origin_auto.numero_autorizacion
            as origin_authorization_number,

          destination_auto.numero_autorizacion
            as destination_authorization_number,

          coalesce(
            origin_auto.source_data
              ->>
              'NOMBRE_PACIENTE',
            origin_auto.source_data
              ->>
              'PACIENTE'
          )
            as origin_patient_name,

          coalesce(
            destination_auto.source_data
              ->>
              'NOMBRE_PACIENTE',
            destination_auto.source_data
              ->>
              'PACIENTE'
          )
            as destination_patient_name,

          dp.code
            as dispensing_point_code,

          dp.name
            as dispensing_point_name

        from
          audit_events ae

        left join
          users actor
            on actor.id =
               ae.actor_id

        left join
          organizations actor_org
            on actor_org.id =
               ae.organization_id

        left join
          authorization_items origin_auto
            on origin_auto.authorization_key =
               ae.after
                 ->>
                 'originAuthorizationKey'

        left join
          authorization_items destination_auto
            on destination_auto.authorization_key =
               ae.after
                 ->>
                 'destinationAuthorizationKey'

        left join
          dispensing_points dp
            on dp.id::text =
               ae.after
                 ->>
                 'dispensingPointId'

        where
          ae.action =
            'PURCHASE_ORDER_AUTHORIZATION_REASSIGNED'

          and ae.result =
            'SUCCESS'

          and (
            ae.after
              ->>
              'originAuthorizationKey'
              =
              ${authorization.authorization_key}

            or

            ae.after
              ->>
              'destinationAuthorizationKey'
              =
              ${authorization.authorization_key}
          )

        order by
          ae.occurred_at,
          ae.id
      `);


    const inboundReassignmentOrders =
      new Set<string>();


    for (
      const row of
      reassignments.rows
    ) {
      const isOrigin =
        row.origin_authorization_key ===
          authorization.authorization_key;


      if (
        !isOrigin &&
        row.purchase_order_code
      ) {
        inboundReassignmentOrders.add(
          row.purchase_order_code,
        );
      }


      const originNumber =
        row.origin_authorization_number
        ??
        row.origin_authorization_key
        ??
        'AUTO origen no identificada';


      const destinationNumber =
        row.destination_authorization_number
        ??
        row.destination_authorization_key
        ??
        'AUTO destino no identificada';


      const originReference =
        row.origin_patient_name
          ? `${originNumber} · ${row.origin_patient_name}`
          : originNumber;


      const destinationReference =
        row.destination_patient_name
          ? `${destinationNumber} · ${row.destination_patient_name}`
          : destinationNumber;


      events.push({
        id:
          `reassignment:${row.id}:${isOrigin ? 'out' : 'in'}`,

        type:
          isOrigin
            ? 'REASSIGNMENT_OUT'
            : 'REASSIGNMENT_IN',

        occurredAt:
          toIsoTimestamp(
            row.occurred_at,
          ),

        title:
          isOrigin
            ? 'Producto reasignado'
            : 'Producto recibido por reasignación',

        description:
          `La reserva fue reasignada desde ${originReference} hacia ${destinationReference}.`,

        actorName:
          row.actor_name,

        organizationCode:
          row.organization_code,

        details: [
          ...(
            row.purchase_order_code
              ? [
                  {
                    label:
                      'Orden de compra',

                    value:
                      row.purchase_order_code,
                  },
                ]
              : []
          ),

          ...(
            row.commercial_code
              ? [
                  {
                    label:
                      'Producto',

                    value:
                      row.commercial_code,
                  },
                ]
              : []
          ),

          ...(
            row.quantity
              ? [
                  {
                    label:
                      'Cantidad',

                    value:
                      row.quantity,
                  },
                ]
              : []
          ),

          {
            label:
              'Desde · AUTO origen',

            value:
              originReference,
          },

          {
            label:
              'Hacia · AUTO destino',

            value:
              destinationReference,
          },

          ...(
            row.dispensing_point_code
              ? [
                  {
                    label:
                      'Punto',

                    value:
                      row.dispensing_point_name
                        ? `${row.dispensing_point_code} · ${row.dispensing_point_name}`
                        : row.dispensing_point_code,
                  },
                ]
              : []
          ),
        ],
      });
    }


    /*
     * ======================================================
     * AUTO -> OC
     * ======================================================
     */
    const purchaseOrders =
      await this.database.db.execute<{
        id: string;

        purchase_order_code: string;

        occurred_at: Date | string;

        quantity: number;

        actor_name: string | null;

        dispensing_point_code: string | null;

        dispensing_point_name: string | null;
      }>(sql`
        select
          po.id,

          coalesce(
            po.purchase_order_code,
            po.id::text
          )
            as purchase_order_code,

          min(
            poas.created_at
          )
            as occurred_at,

          coalesce(
            sum(
              poas.source_quantity_snapshot
            ),
            0
          )::int
            as quantity,

          creator.display_name
            as actor_name,

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
          purchase_order_authorization_sources poas

        join
          purchase_order_lines pol
            on pol.id =
               poas.purchase_order_line_id

        join
          purchase_orders po
            on po.id =
               pol.purchase_order_id

        left join
          dispensing_points dp
            on dp.id =
               pol.dispensing_point_id

        left join
          users creator
            on creator.id =
               po.created_by

        where
          poas.authorization_item_id =
            ${id}

        group by
          po.id,
          po.purchase_order_code,
          creator.display_name

        order by
          min(
            poas.created_at
          ),
          po.id
      `);


    for (
      const row of
      purchaseOrders.rows
    ) {
      /*
       * Si esta OC llegó a la AUTO mediante una
       * reasignación, su evento real es REASSIGNMENT_IN.
       *
       * No debemos presentar el created_at histórico de
       * purchase_order_authorization_sources como si la
       * AUTO destino hubiera estado allí desde el inicio.
       */
      if (
        inboundReassignmentOrders.has(
          row.purchase_order_code,
        )
      ) {
        continue;
      }


      events.push({
        id:
          `purchase-order:${row.id}`,

        type:
          'PURCHASE_ORDER_LINKED',

        occurredAt:
          toIsoTimestamp(
            row.occurred_at,
          ),

        title:
          'Orden de compra relacionada',

        description:
          `Esta autorización fue incluida como fuente de la OC ${row.purchase_order_code}.`,

        actorName:
          row.actor_name,

        organizationCode:
          null,

        details: [
          {
            label:
              'Orden de compra',

            value:
              row.purchase_order_code,
          },

          {
            label:
              'Cantidad vinculada',

            value:
              String(
                row.quantity,
              ),
          },

          ...(
            row.dispensing_point_code
              ? [
                  {
                    label:
                      'Punto',

                    value:
                      row.dispensing_point_name
                        ? `${row.dispensing_point_code} · ${row.dispensing_point_name}`
                        : row.dispensing_point_code,
                  },
                ]
              : []
          ),
        ],
      });
    }


    /*
     * ======================================================
     * RECEPCIÓN MODERNA
     * purchase_order_receipts
     * ======================================================
     */
    const directReceipts =
      await this.database.db.execute<{
        id: string;

        purchase_order_code: string;

        occurred_at: Date | string;

        quantity: number;

        actor_name: string | null;

        dispensing_point_code: string | null;

        dispensing_point_name: string | null;
      }>(sql`
        select
          por.id,

          coalesce(
            po.purchase_order_code,
            po.id::text
          )
            as purchase_order_code,

          por.confirmed_at
            as occurred_at,

          coalesce(
            sum(
              porl.received_quantity
            ),
            0
          )::int
            as quantity,

          confirmer.display_name
            as actor_name,

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
          purchase_order_receipts por

        join
          purchase_order_receipt_lines porl
            on porl.receipt_id =
               por.id

        join
          purchase_order_lines pol
            on pol.id =
               porl.purchase_order_line_id

        join
          purchase_orders po
            on po.id =
               por.purchase_order_id

        join
          purchase_order_authorization_sources poas
            on poas.purchase_order_line_id =
               pol.id

           and poas.authorization_item_id =
               ${id}

        left join
          dispensing_points dp
            on dp.id =
               pol.dispensing_point_id

        left join
          users confirmer
            on confirmer.id =
               por.confirmed_by

        where
          porl.received_quantity >
            0

        group by
          por.id,
          po.id,
          po.purchase_order_code,
          por.confirmed_at,
          confirmer.display_name

        order by
          por.confirmed_at,
          por.id
      `);


    for (
      const row of
      directReceipts.rows
    ) {
      events.push({
        id:
          `direct-receipt:${row.id}`,

        type:
          'PRODUCT_RECEIVED',

        occurredAt:
          toIsoTimestamp(
            row.occurred_at,
          ),

        title:
          'Producto recibido',

        description:
          `Se confirmó la recepción de producto de la OC ${row.purchase_order_code}.`,

        actorName:
          row.actor_name,

        organizationCode:
          null,

        details: [
          {
            label:
              'Orden de compra',

            value:
              row.purchase_order_code,
          },

          {
            label:
              'Cantidad recibida',

            value:
              String(
                row.quantity,
              ),
          },

          ...(
            row.dispensing_point_code
              ? [
                  {
                    label:
                      'Punto',

                    value:
                      row.dispensing_point_name
                        ? `${row.dispensing_point_code} · ${row.dispensing_point_name}`
                        : row.dispensing_point_code,
                  },
                ]
              : []
          ),
        ],
      });
    }


    /*
     * ======================================================
     * RECEPCIÓN LOGÍSTICA LEGACY/DELIVERY
     * receipts + deliveries
     * ======================================================
     */
    const logisticsReceipts =
      await this.database.db.execute<{
        id: string;

        purchase_order_code: string;

        occurred_at: Date | string;

        quantity: number;

        actor_name: string | null;

        dispensing_point_code: string | null;

        dispensing_point_name: string | null;
      }>(sql`
        select
          r.id,

          coalesce(
            po.purchase_order_code,
            po.id::text
          )
            as purchase_order_code,

          coalesce(
            r.confirmed_at,
            r.received_at
          )
            as occurred_at,

          coalesce(
            sum(
              rl.received_quantity
            ),
            0
          )::int
            as quantity,

          confirmer.display_name
            as actor_name,

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
          receipts r

        join
          deliveries d
            on d.id =
               r.delivery_id

        join
          receipt_lines rl
            on rl.receipt_id =
               r.id

        join
          delivery_lines dl
            on dl.id =
               rl.delivery_line_id

        join
          purchase_order_lines pol
            on pol.id =
               dl.purchase_order_line_id

        join
          purchase_orders po
            on po.id =
               d.purchase_order_id

        join
          purchase_order_authorization_sources poas
            on poas.purchase_order_line_id =
               pol.id

           and poas.authorization_item_id =
               ${id}

        left join
          dispensing_points dp
            on dp.id =
               dl.dispensing_point_id

        left join
          users confirmer
            on confirmer.id =
               r.updated_by

        where
          r.status =
            'CONFIRMED'

          and rl.received_quantity >
            0

        group by
          r.id,
          po.id,
          po.purchase_order_code,
          r.confirmed_at,
          r.received_at,
          confirmer.display_name

        order by
          coalesce(
            r.confirmed_at,
            r.received_at
          ),
          r.id
      `);


    for (
      const row of
      logisticsReceipts.rows
    ) {
      events.push({
        id:
          `logistics-receipt:${row.id}`,

        type:
          'PRODUCT_RECEIVED',

        occurredAt:
          toIsoTimestamp(
            row.occurred_at,
          ),

        title:
          'Producto recibido',

        description:
          `MEDICARTE confirmó la recepción del producto relacionado con la OC ${row.purchase_order_code}.`,

        actorName:
          row.actor_name,

        organizationCode:
          null,

        details: [
          {
            label:
              'Orden de compra',

            value:
              row.purchase_order_code,
          },

          {
            label:
              'Cantidad recibida',

            value:
              String(
                row.quantity,
              ),
          },

          ...(
            row.dispensing_point_code
              ? [
                  {
                    label:
                      'Punto',

                    value:
                      row.dispensing_point_name
                        ? `${row.dispensing_point_code} · ${row.dispensing_point_name}`
                        : row.dispensing_point_code,
                  },
                ]
              : []
          ),
        ],
      });
    }


    /*
     * ======================================================
     * RESERVA / ALLOCATION
     * ======================================================
     */
    const allocations =
      await this.database.db.execute<{
        id: string;

        occurred_at: Date | string;

        quantity: number;

        purchase_order_code: string;

        dispensing_point_code: string | null;

        dispensing_point_name: string | null;

        actor_name: string | null;
      }>(sql`
        select
          iaa.id,

          iaa.created_at
            as occurred_at,

          iaa.allocated_quantity
            as quantity,

          coalesce(
            po.purchase_order_code,
            po.id::text
          )
            as purchase_order_code,

          dp.code
            as dispensing_point_code,

          dp.name
            as dispensing_point_name,

          creator.display_name
            as actor_name

        from
          inventory_authorization_allocations iaa

        join
          purchase_orders po
            on po.id =
               iaa.purchase_order_id

        left join
          dispensing_points dp
            on dp.id =
               iaa.dispensing_point_id

        left join
          users creator
            on creator.id =
               iaa.created_by

        where
          iaa.authorization_item_id =
            ${id}

        order by
          iaa.created_at,
          iaa.id
      `);


    for (
      const row of
      allocations.rows
    ) {
      /*
       * La fila física conserva su created_at original
       * cuando cambia de AUTO.
       *
       * Si la AUTO recibió esta reserva por reasignación,
       * no debemos mostrarla como una asignación ocurrida
       * antes de la propia reasignación.
       */
      if (
        inboundReassignmentOrders.has(
          row.purchase_order_code,
        )
      ) {
        continue;
      }


      events.push({
        id:
          `allocation:${row.id}`,

        type:
          'INVENTORY_ASSIGNED',

        occurredAt:
          toIsoTimestamp(
            row.occurred_at,
          ),

        title:
          'Producto asignado a la autorización',

        description:
          `Se reservaron ${row.quantity} unidad(es) para esta autorización.`,

        actorName:
          row.actor_name,

        organizationCode:
          null,

        details: [
          {
            label:
              'Cantidad asignada',

            value:
              String(
                row.quantity,
              ),
          },

          {
            label:
              'Orden de compra',

            value:
              row.purchase_order_code,
          },

          ...(
            row.dispensing_point_code
              ? [
                  {
                    label:
                      'Punto',

                    value:
                      row.dispensing_point_name
                        ? `${row.dispensing_point_code} · ${row.dispensing_point_name}`
                        : row.dispensing_point_code,
                  },
                ]
              : []
          ),
        ],
      });
    }


    /*
     * ======================================================
     * ENTREGA / APLICACIÓN MODERNA
     * ======================================================
     */
    const fulfillments =
      await this.database.db.execute<{
        id: string;

        fulfillment_type: string;

        effective_date: string;

        quantity: number;

        confirmed_at: Date | string;

        source: string;

        actor_name: string | null;

        organization_code: string | null;
      }>(sql`
        select
          af.id,

          af.fulfillment_type,

          af.effective_date::text
            as effective_date,

          af.quantity,

          af.confirmed_at,

          af.source,

          confirmer.display_name
            as actor_name,

          fulfillment_org.code
            as organization_code

        from
          authorization_fulfillments af

        left join
          users confirmer
            on confirmer.id =
               af.confirmed_by

        left join
          organizations fulfillment_org
            on fulfillment_org.id =
               af.organization_id

        where
          af.authorization_item_id =
            ${id}

        order by
          af.confirmed_at,
          af.id
      `);


    for (
      const row of
      fulfillments.rows
    ) {
      const application =
        row.fulfillment_type ===
          'APPLICATION';


      events.push({
        id:
          `fulfillment:${row.id}`,

        type:
          application
            ? 'APPLICATION_RECORDED'
            : 'DELIVERY_RECORDED',

        occurredAt:
          toIsoTimestamp(
            row.confirmed_at,
          ),

        title:
          application
            ? 'Aplicación registrada'
            : 'Entrega registrada',

        description:
          application
            ? `Se registró la aplicación de ${row.quantity} unidad(es) al paciente.`
            : `Se registró la entrega de ${row.quantity} unidad(es) al paciente.`,

        actorName:
          row.actor_name,

        organizationCode:
          row.organization_code,

        details: [
          {
            label:
              'Cantidad',

            value:
              String(
                row.quantity,
              ),
          },

          {
            label:
              'Fecha efectiva',

            value:
              row.effective_date,
          },

          {
            label:
              'Origen del registro',

            value:
              row.source,
          },
        ],
      });
    }


    /*
     * ======================================================
     * APLICACIÓN HISTÓRICA / LEGACY
     * ======================================================
     */
    const applications =
      await this.database.db.execute<{
        id: string;

        application_date: string;

        confirmed_at: Date | string;

        quantity: number;

        actor_name: string | null;

        dispensing_point_code: string | null;

        dispensing_point_name: string | null;
      }>(sql`
        select
          pa.id,

          pa.application_date::text
            as application_date,

          coalesce(
            pa.confirmed_at,
            pa.updated_at
          )
            as confirmed_at,

          coalesce(
            sum(
              pal.quantity
            ),
            0
          )::int
            as quantity,

          confirmer.display_name
            as actor_name,

          dp.code
            as dispensing_point_code,

          dp.name
            as dispensing_point_name

        from
          patient_applications pa

        left join
          patient_application_lines pal
            on pal.patient_application_id =
               pa.id

        left join
          users confirmer
            on confirmer.id =
               pa.confirmed_by

        left join
          dispensing_points dp
            on dp.id =
               pa.dispensing_point_id

        where
          pa.authorization_item_id =
            ${id}

          and pa.status =
            'CONFIRMED'

        group by
          pa.id,
          pa.application_date,
          pa.confirmed_at,
          pa.updated_at,
          confirmer.display_name,
          dp.code,
          dp.name

        order by
          coalesce(
            pa.confirmed_at,
            pa.updated_at
          ),
          pa.id
      `);


    for (
      const row of
      applications.rows
    ) {
      events.push({
        id:
          `patient-application:${row.id}`,

        type:
          'APPLICATION_RECORDED',

        occurredAt:
          toIsoTimestamp(
            row.confirmed_at,
          ),

        title:
          'Aplicación registrada',

        description:
          `Se confirmó la aplicación de ${row.quantity} unidad(es) al paciente.`,

        actorName:
          row.actor_name,

        organizationCode:
          null,

        details: [
          {
            label:
              'Cantidad',

            value:
              String(
                row.quantity,
              ),
          },

          {
            label:
              'Fecha efectiva',

            value:
              row.application_date,
          },

          ...(
            row.dispensing_point_code
              ? [
                  {
                    label:
                      'Punto',

                    value:
                      row.dispensing_point_name
                        ? `${row.dispensing_point_code} · ${row.dispensing_point_name}`
                        : row.dispensing_point_code,
                  },
                ]
              : []
          ),
        ],
      });
    }


    /*
     * ======================================================
     * OTRAS ACCIONES AUDITADAS SOBRE LA AUTO
     * ======================================================
     */
    const auditedActions =
      await this.database.db.execute<{
        id: string;

        occurred_at: Date | string;

        action: string;

        actor_name: string | null;

        organization_code: string | null;

        before_commercial_code: string | null;

        after_commercial_code: string | null;

        before_quantity: string | null;

        after_quantity: string | null;

        before_validity_end_date: string | null;

        after_validity_end_date: string | null;
      }>(sql`
        select
          ae.id,

          ae.occurred_at,

          ae.action,

          actor.display_name
            as actor_name,

          actor_org.code
            as organization_code,

          coalesce(
            nullif(
              ae.before
                ->>
                'commercialCode',
              ''
            ),
            nullif(
              ae.before
                ->>
                'codigoMedicamento',
              ''
            ),
            nullif(
              ae.before
                ->>
                'commercial_code',
              ''
            )
          )
            as before_commercial_code,

          coalesce(
            nullif(
              ae.after
                ->>
                'commercialCode',
              ''
            ),
            nullif(
              ae.after
                ->>
                'codigoMedicamento',
              ''
            ),
            nullif(
              ae.after
                ->>
                'commercial_code',
              ''
            )
          )
            as after_commercial_code,

          coalesce(
            nullif(
              ae.before
                ->>
                'quantity',
              ''
            ),
            nullif(
              ae.before
                ->>
                'authorizedQuantity',
              ''
            ),
            nullif(
              ae.before
                ->>
                'cantidad',
              ''
            ),
            nullif(
              ae.before
                ->>
                'CANTIDAD',
              ''
            )
          )
            as before_quantity,

          coalesce(
            nullif(
              ae.after
                ->>
                'quantity',
              ''
            ),
            nullif(
              ae.after
                ->>
                'authorizedQuantity',
              ''
            ),
            nullif(
              ae.after
                ->>
                'cantidad',
              ''
            ),
            nullif(
              ae.after
                ->>
                'CANTIDAD',
              ''
            )
          )
            as after_quantity,

          coalesce(
            nullif(
              ae.before
                ->>
                'validityEndDate',
              ''
            ),
            nullif(
              ae.before
                ->>
                'validity_end_date',
              ''
            ),
            nullif(
              ae.before
                ->>
                'FECHA_FINAL_VIGENCIA',
              ''
            )
          )
            as before_validity_end_date,

          coalesce(
            nullif(
              ae.after
                ->>
                'validityEndDate',
              ''
            ),
            nullif(
              ae.after
                ->>
                'validity_end_date',
              ''
            ),
            nullif(
              ae.after
                ->>
                'FECHA_FINAL_VIGENCIA',
              ''
            )
          )
            as after_validity_end_date

        from
          audit_events ae

        left join
          users actor
            on actor.id =
               ae.actor_id

        left join
          organizations actor_org
            on actor_org.id =
               ae.organization_id

        where
          ae.result =
            'SUCCESS'

          and (
            ae.resource_id =
              ${id}::text

            or

            ae.after
              ->>
              'authorizationItemId'
              =
              ${id}::text
          )

          and (
            upper(
              ae.action
            ) like
              '%EDIT%'

            or

            upper(
              ae.action
            ) like
              '%UPDATE%'

            or

            upper(
              ae.action
            ) like
              '%AUDIT%'
          )

        order by
          ae.occurred_at,
          ae.id
      `);


    for (
      const row of
      auditedActions.rows
    ) {
      const action =
        row.action.toUpperCase();


      /*
       * ====================================================
       * EDICIÓN / ACTUALIZACIÓN DE LA AUTO
       * ====================================================
       *
       * El historial debe explicar QUÉ cambió.
       *
       * No basta con mostrar:
       * "Autorización modificada".
       */
      if (
        action.includes(
          'EDIT',
        )
        ||
        action.includes(
          'UPDATE',
        )
      ) {
        const changes:
          Array<{
            label: string;

            before: string | null;

            after: string | null;
          }> =
          [];


        if (
          row.before_commercial_code !==
            row.after_commercial_code
          &&
          (
            row.before_commercial_code
            ||
            row.after_commercial_code
          )
        ) {
          changes.push({
            label:
              'Producto',

            before:
              row.before_commercial_code,

            after:
              row.after_commercial_code,
          });
        }


        if (
          row.before_quantity !==
            row.after_quantity
          &&
          (
            row.before_quantity
            ||
            row.after_quantity
          )
        ) {
          changes.push({
            label:
              'Cantidad autorizada',

            before:
              row.before_quantity,

            after:
              row.after_quantity,
          });
        }


        if (
          row.before_validity_end_date !==
            row.after_validity_end_date
          &&
          (
            row.before_validity_end_date
            ||
            row.after_validity_end_date
          )
        ) {
          changes.push({
            label:
              'Vigencia',

            before:
              row.before_validity_end_date,

            after:
              row.after_validity_end_date,
          });
        }


        let title =
          'Autorización modificada';

        let description =
          'Se modificó información de la autorización.';


        if (
          changes.length ===
          1
        ) {
          const field =
            changes[0]!;


          if (
            field.label ===
              'Producto'
          ) {
            title =
              'Producto modificado';

            description =
              'Se modificó el producto asociado a la autorización.';
          } else if (
            field.label ===
              'Cantidad autorizada'
          ) {
            title =
              'Cantidad autorizada modificada';

            description =
              'Se modificó la cantidad autorizada.';
          } else if (
            field.label ===
              'Vigencia'
          ) {
            title =
              'Vigencia modificada';

            description =
              'Se modificó la fecha final de vigencia.';
          }
        } else if (
          changes.length >
          1
        ) {
          description =
            `Se modificaron ${changes.length} campos de la autorización.`;
        }


        events.push({
          id:
            `audit:${row.id}`,

          type:
            'AUTHORIZATION_UPDATED',

          occurredAt:
            toIsoTimestamp(
              row.occurred_at,
            ),

          title,

          description,

          actorName:
            row.actor_name,

          organizationCode:
            row.organization_code,

          details:
            changes.length >
              0
              ? changes.map(
                  (
                    change,
                  ) => ({
                    label:
                      change.label,

                    value:
                      `${change.before ?? 'Sin valor'} → ${change.after ?? 'Sin valor'}`,
                  }),
                )
              : [
                  {
                    label:
                      'Tipo de acción',

                    value:
                      row.action,
                  },
                ],
        });


        continue;
      }


      /*
       * ====================================================
       * AUDITORÍA
       * ====================================================
       */
      let title =
        'Auditoría registrada';

      let description =
        'Se registró una acción de auditoría sobre esta autorización.';


      if (
        action.includes(
          'APPROV',
        )
      ) {
        title =
          'Auditoría aprobada';

        description =
          'La auditoría relacionada con esta autorización fue aprobada.';
      } else if (
        action.includes(
          'REJECT',
        )
      ) {
        title =
          'Auditoría rechazada';

        description =
          'La auditoría relacionada con esta autorización fue rechazada.';
      }


      events.push({
        id:
          `audit:${row.id}`,

        type:
          'AUDITED_ACTION',

        occurredAt:
          toIsoTimestamp(
            row.occurred_at,
          ),

        title,

        description,

        actorName:
          row.actor_name,

        organizationCode:
          row.organization_code,

        details: [
          {
            label:
              'Acción',

            value:
              row.action,
          },
        ],
      });
    }


    /*
     * Más reciente primero.
     */
    events.sort(
      (
        left,
        right,
      ) =>
        new Date(
          right.occurredAt,
        ).getTime()
        -
        new Date(
          left.occurredAt,
        ).getTime(),
    );


    return {
      authorizationItemId:
        id,

      authorizationNumber:
        authorization.authorization_number,

      items:
        events,
    };
  }


  private async linkedPurchaseOrders(
    authorizationItemId: string,
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

        available_quantity:
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

          coalesce(
            (
              select
                sum(
                  greatest(
                    iaa_link.allocated_quantity
                    -
                    iaa_link.consumed_quantity
                    -
                    iaa_link.released_quantity,
                    0
                  )
                )::int

              from
                inventory_authorization_allocations
                  iaa_link

              where
                iaa_link.authorization_item_id =
                  ${authorizationItemId}

                and iaa_link.purchase_order_id =
                  po_link.id

                and iaa_link.status in (
                  'ALLOCATED',
                  'PARTIALLY_CONSUMED'
                )
            ),
            0
          )::int
            as available_quantity,

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

        availableQuantity:
          Number(
            row.available_quantity ??
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
                i.mipres_manual_decision =
                'MANUALLY_DISABLED'
              then 2

              when
                i.mipres_manual_decision =
                'MANUALLY_ENABLED'
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

    const authorizedQuantity =
      this.authorizedQuantitySql();

    const fulfilledQuantity =
      this.fulfilledQuantitySql();

    const remainingAuthorizedQuantity =
      this.remainingAuthorizedQuantitySql();


    /*
     * CLOSED tiene prioridad absoluta de salida:
     * cualquier AUTO cerrada va después de todas las
     * AUTO que aún requieren gestión.
     */
    const closedPriority =
      sql`
        case
          when
            ${authorizedQuantity}
              > 0

            and

            ${remainingAuthorizedQuantity}
              = 0

          then
            1

          else
            0
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
          'DOSIS'
          as dosage,

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

        i.source_data
          ->>
          'VALOR_CUOTA_MODERADORA'
          as moderator_fee_value,

        i.version,

        i.enablement_status,

        i.tariff_membership_status,

        i.direction_status,

        i.mipres_manual_decision,

        i.coverage_type,

        case
          when
            ${authorizedQuantity}
              > 0

            and

            ${remainingAuthorizedQuantity}
              = 0

          then
            'FULFILLED'

          when
            ${fulfilledQuantity}
              > 0

          then
            'PARTIALLY_FULFILLED'

          when
            coalesce(
              allocation.remaining_quantity,
              0
            ) > 0

          then
            'INVENTORY_ASSIGNED'

          when exists (
            select
              1

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
            ${authorizedQuantity}
              > 0

            and

            ${remainingAuthorizedQuantity}
              = 0

          then
            'CLOSED'

          when
            coalesce(
              allocation.remaining_quantity,
              0
            )
            <= 0

          then
            'UNASSIGNED'

          when
            coalesce(
              allocation.remaining_quantity,
              0
            )
            <
            ${remainingAuthorizedQuantity}

          then
            'PARTIALLY_ASSIGNED'

          else
            'ASSIGNED'
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

        ${fulfilledQuantity}::int
          as fulfilled_quantity,

        ${remainingAuthorizedQuantity}::int
          as remaining_authorized_quantity,

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

        coalesce(
          (
            select
              aba.status

            from
              authorization_billing_audits aba

            where
              aba.authorization_item_id =
                i.id

            limit 1
          ),
          'PENDING'
        )
          as billing_audit_status,

        (
          select
            aba.result

          from
            authorization_billing_audits aba

          where
            aba.authorization_item_id =
              i.id

          limit 1
        )
          as billing_audit_result,

        coalesce(
          (
            select
              count(*)::int

            from
              authorization_billing_audit_evidence
                abae_status

            join
              authorization_billing_audits
                aba_status
                  on aba_status.id =
                     abae_status.billing_audit_id

            where
              aba_status.authorization_item_id =
                i.id
          ),
          0
        )
          as billing_audit_evidence_count,


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

        order by
          af.confirmed_at
            desc,
          af.id
            desc

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
    const authorizedQuantity =
      Math.max(
        Number(
          row.quantity
          ??
          0,
        ),
        0,
      );

    const fulfilledQuantity =
      Math.max(
        Number(
          row.fulfilled_quantity
          ??
          0,
        ),
        0,
      );

    const remainingAuthorizedQuantity =
      Math.max(
        Number(
          row.remaining_authorized_quantity
          ??
          (
            authorizedQuantity
            -
            fulfilledQuantity
          ),
        ),
        0,
      );


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

        mipresManualDecision:
          row.mipres_manual_decision,

        quantity:
          row.quantity,

        minimumQuantity:
          row.minimum_quantity,
      });

    const lifecycleEnablement =
      resolveAuthorizationLifecycleStatus({
        initialValidationStatus,

        validityStatus,
      });

    const lifecycleReasons =
      resolveAuthorizationLifecycleReasons({
        lifecycleStatus:
          lifecycleEnablement,

        enablementStatus:
          row.enablement_status,

        tariffMembershipStatus:
          row.tariff_membership_status,

        coverageType:
          row.coverage_type,

        directionStatus:
          row.direction_status,

        mipresManualDecision:
          row.mipres_manual_decision,

        quantity:
          row.quantity,

        minimumQuantity:
          row.minimum_quantity,

        validityStatus,
      });

    const fulfillmentStatus =
      resolveAuthorizationFulfillmentStatus(
        row.fulfillment_type,
      );

    const auditStatus =
      resolveAuthorizationAuditStatus(
        row.review_status,
      );

    const operationalEligible =
      initialValidationStatus ===
        'PASSED'
      &&
      (
        validityStatus ===
          'IN_WINDOW'
        ||
        validityStatus ===
          'EXPIRED'
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

      dosage:
        row.dosage,

      quantity:
        row.quantity,

      authorizedQuantity,

      fulfilledQuantity,

      remainingAuthorizedQuantity,

      fulfillmentProgressStatus:
        resolveAuthorizationFulfillmentProgressStatus({
          authorizedQuantity,
          fulfilledQuantity,
        }),

      assignmentDate:
        row.assignment_date,

      validityEndDate:
        row.validity_end_date,

      moderatorFeeValue:
        row.moderator_fee_value,

      version:
        Number(
          row.version,
        ),

      enablementStatus:
        row.enablement_status,

      initialValidationStatus,

      validityStatus,

      lifecycleEnablement,

      lifecycleReasons,

      operationalEligible,

      fulfillmentStatus,

      auditStatus,

      billingAuditStatus:
        row.billing_audit_status,

      billingAuditResult:
        row.billing_audit_result,

      billingAuditEvidenceCount:
        Number(
          row.billing_audit_evidence_count
          ??
          0,
        ),

      billingAuditDisplayStatus:
        (() => {
          const evidenceCount =
            Number(
              row.billing_audit_evidence_count
              ??
              0,
            );

          if (
            row.operational_status !==
              'CLOSED'
          ) {
            return 'NOT_AVAILABLE';
          }

          if (
            row.billing_audit_status ===
              'PENDING'
          ) {
            return evidenceCount > 0
              ? 'PENDING_WITH_EVIDENCE'
              : 'PENDING_WITHOUT_EVIDENCE';
          }

          if (
            row.billing_audit_status ===
              'REVIEWED'
            &&
            row.billing_audit_result ===
              'COMPLIES'
          ) {
            return evidenceCount > 0
              ? 'COMPLIES_WITH_EVIDENCE'
              : 'COMPLIES_WITHOUT_EVIDENCE';
          }

          if (
            row.billing_audit_status ===
              'REVIEWED'
            &&
            row.billing_audit_result ===
              'DOES_NOT_COMPLY'
          ) {
            return evidenceCount > 0
              ? 'DOES_NOT_COMPLY_WITH_EVIDENCE'
              : 'DOES_NOT_COMPLY_WITHOUT_EVIDENCE';
          }

          return 'INCONSISTENT';
        })(),


      coverageType:
        row.coverage_type,

      mipresManualDecision:
        row.mipres_manual_decision,

      logisticsStatus:
        row.logistics_status,

      operationalStatus:
        resolveAuthorizationOperationalStatus({
          fulfilledQuantity,

          operationalEligible,

          remainingAssignedQuantity:
            Number(
              row.remaining_assigned_quantity
              ??
              0,
            ),

          authorizedQuantity,
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
