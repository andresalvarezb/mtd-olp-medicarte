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
    if (
      scope.organizationCode ===
      'MTD'
    ) {
      return sql`true`;
    }

    /*
     * MEDICARTE no necesita una reserva previa
     * de inventario para consultar la autorización.
     *
     * Es visible cuando:
     *
     * AUTO
     * -> pertenece a una línea de OC
     * -> OLP ya aceptó la OC
     * -> producto coincide
     * -> el punto de esa línea está dentro
     *    de los scopes del usuario.
     *
     * La asignación física NO se decide aquí
     * ni al Entregar/Aplicar.
     *
     * Se materializa durante la recepción
     * de MEDICARTE en
     * inventory_authorization_allocations.
     *
     * La relación AUTO -> OC solamente
     * determina visibilidad y trazabilidad.
     */
    if (
      scope.organizationCode ===
      'MEDICARTE'
    ) {
      return sql`
        exists (
          select
            1

          from
            purchase_order_authorization_sources
              poas_visibility

          join
            purchase_order_lines
              pol_visibility
              on pol_visibility.id =
                 poas_visibility.purchase_order_line_id

          join
            purchase_orders
              po_visibility
              on po_visibility.id =
                 pol_visibility.purchase_order_id

          left join
            tariff_annex_products
              tap_visibility
              on tap_visibility.codigo_producto =
                 pol_visibility.commercial_code

             and tap_visibility.active =
                 true

          left join
            product_delivery_point_mappings
              mapping_visibility
              on pol_visibility.dispensing_point_id
                 is null

             and btrim(
                   coalesce(
                     tap_visibility.numero_expediente_invima,
                     ''
                   )
                 ) ~ '^[0-9]+$'

             and btrim(
                   coalesce(
                     tap_visibility.consecutivo_invima_presentacion,
                     ''
                   )
                 ) ~ '^[0-9]+$'

             and mapping_visibility.invima_record_normalized =
                 coalesce(
                   nullif(
                     ltrim(
                       btrim(
                         tap_visibility.numero_expediente_invima
                       ),
                       '0'
                     ),
                     ''
                   ),
                   '0'
                 )

             and mapping_visibility.invima_presentation_normalized =
                 coalesce(
                   nullif(
                     ltrim(
                       btrim(
                         tap_visibility.consecutivo_invima_presentacion
                       ),
                       '0'
                     ),
                     ''
                   ),
                   '0'
                 )

          join
            dispensing_points
              dp_visibility
              on dp_visibility.id =
                 coalesce(
                   pol_visibility.dispensing_point_id,
                   mapping_visibility.dispensing_point_id
                 )

          where
            poas_visibility.authorization_item_id =
              i.id

            and pol_visibility.commercial_code =
              i.codigo_medicamento

            and po_visibility.olp_accepted_at
              is not null

            and po_visibility.status not in (
              'CANCELLED',
              'REJECTED'
            )

            and dp_visibility.organization_id =
              ${scope.organizationId}

            and ${applyPointScope(
              sql`dp_visibility.id`,
              scope,
            )}
        )
      `;
    }

    return sql`
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

    return row
      ? this.toResponse(
          row,
        )
      : null;
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
            as product_description

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

      where
        ${where}

      order by
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
