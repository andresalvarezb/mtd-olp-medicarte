import { Inject, Injectable } from '@nestjs/common';

import { sql, type SQL } from 'drizzle-orm';

import type { createDatabase } from '@authorization/database';

import type { Scope } from '../common/request-scope';

import { authorizationQueryValidityWindow } from '../clinical/authorization-query-validity';

import { DATABASE } from '../tokens';

import {
  normalizeSourceDate,
  parsePositiveInteger,
  resolveMipresReadState,
  resolveOperationalWindow,
} from './mipres-read-model';

type Database = ReturnType<typeof createDatabase>;

export type MipresListFilters = Readonly<{
  search?: string;

  directionStatus?: 'CONFIRMED' | 'PENDING' | 'QUERY_ERROR';
  atStatus?: 'LISTED' | 'NOT_LISTED' | 'NOT_EVALUATED';

  manualDecision?: 'PENDING_MANUAL_ENABLEMENT' | 'MANUALLY_ENABLED' | 'MANUALLY_DISABLED';

  state?: 'OPERABLE' | 'BLOCKED';

  page: number;

  limit: number;
}>;

type BaseRow = Readonly<{
  id: string;

  authorization_number: string;

  patient_document: string | null;

  patient_name: string | null;

  product_code: string;

  product_description: string | null;

  quantity: string | null;

  minimum_quantity: number;

  prescription_number: string;

  coverage_type: string;

  direction_status: string;

  enablement_status: string;

  tariff_membership_status: string;

  manual_decision: string;
  manual_version: number;

  manual_concept_code: string | null;

  manual_concept_name: string | null;

  manual_note: string | null;

  manual_updated_at: Date | string | null;

  manual_updated_by: string | null;

  manual_updated_by_name: string | null;

  assignment_date: string | null;

  validity_end_date: string | null;

  latest_check_at: Date | string | null;

  latest_outcome: string | null;

  updated_at: Date | string;
}>;

function timestamp(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

@Injectable()
export class MipresReadRepository {
  constructor(
    @Inject(DATABASE)
    private readonly database: Database,
  ) {}

  private sourceDateKey(field: 'FECHA_ASIGNACION' | 'FECHA_FINAL_VIGENCIA'): SQL {
    const value = sql`
        btrim(
          coalesce(
            i.source_data
              ->>
              ${field},
            ''
          )
        )
      `;

    const compact = sql`
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

    const year = sql`
        substring(
          ${compact}
          from 1 for 4
        )::int
      `;

    const month = sql`
        substring(
          ${compact}
          from 5 for 2
        )::int
      `;

    const day = sql`
        substring(
          ${compact}
          from 7 for 2
        )::int
      `;

    const maximumDay = sql`
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

  private operationalWindowStatusSql(): SQL {
    const { today, horizon } = authorizationQueryValidityWindow();

    const todayKey = today.replace(/-/g, '');

    const horizonKey = horizon.replace(/-/g, '');

    const assignmentDate = this.sourceDateKey('FECHA_ASIGNACION');

    const validityEndDate = this.sourceDateKey('FECHA_FINAL_VIGENCIA');

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

  private quantitySql(): SQL {
    const quantity = sql`
        btrim(
          coalesce(
            i.source_data
              ->>
              'CANTIDAD',
            ''
          )
        )
      `;

    return sql`
      case
        when
          ${quantity}
          ~
          '^[1-9][0-9]*$'
        then
          (${quantity})::numeric

        else
          null
      end
    `;
  }

  private minimumQuantitySql(scope: Scope): SQL {
    return sql`
      coalesce(
        (
          select
            tap.minimum_quantity

          from
            tariff_annex_products tap

          where
            tap.organization_id =
              ${scope.organizationId}::uuid

            and
            tap.codigo_producto =
              i.codigo_medicamento

            and
            tap.active =
              true

          order by
            tap.updated_at desc,
            tap.id desc

          limit 1
        ),
        1
      )
    `;
  }

  private operableSql(scope: Scope): SQL {
    const quantity = this.quantitySql();

    const minimumQuantity = this.minimumQuantitySql(scope);

    return sql`
      (
        i.coverage_type =
          'NO_PBS'

        and

        i.enablement_status =
          'ENABLED'

        and

        i.tariff_membership_status =
          'LISTED'

        and

        i.mipres_manual_decision =
          'MANUALLY_ENABLED'

        and

        (
          ${this.operationalWindowStatusSql()}
        )
        =
        'IN_WINDOW'

        and

        ${quantity}
        is not null

        and

        ${quantity}
        >=
        ${minimumQuantity}
      )
    `;
  }

  private baseSelect(
    where: SQL,

    scope: Scope,

    limit: number,

    offset: number,
  ) {
    return this.database.db.execute<BaseRow>(sql`
      select
        i.id,

        i.numero_autorizacion
          as authorization_number,

        nullif(
          btrim(
            coalesce(
              i.source_data
                ->>
                'IDENTIFICACION_PACIENTE',

              i.source_data
                ->>
                'NUM_DOCUMENTO',

              ''
            )
          ),
          ''
        )
          as patient_document,

        nullif(
          btrim(
            coalesce(
              i.source_data
                ->>
                'NOMBRE_PACIENTE',
              ''
            )
          ),
          ''
        )
          as patient_name,

        i.codigo_medicamento
          as product_code,

        (
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

          from
            tariff_annex_products tap

          where
            tap.organization_id =
              ${scope.organizationId}::uuid

            and
            tap.codigo_producto =
              i.codigo_medicamento

            and
            tap.active =
              true

          order by
            tap.updated_at desc,
            tap.id desc

          limit 1
        )
          as product_description,

        nullif(
          btrim(
            coalesce(
              i.source_data
                ->>
                'CANTIDAD',
              ''
            )
          ),
          ''
        )
          as quantity,

        ${this.minimumQuantitySql(scope)}::int
          as minimum_quantity,

        i.no_prescripcion
          as prescription_number,

        i.coverage_type,

        i.direction_status,

        i.enablement_status,

        i.tariff_membership_status,

        i.mipres_manual_decision
          as manual_decision,

        i.mipres_manual_version
          as manual_version,

        i.mipres_manual_concept_code
          as manual_concept_code,

        concept.name
          as manual_concept_name,

        i.mipres_manual_note
          as manual_note,

        i.mipres_manual_updated_at
          as manual_updated_at,

        i.mipres_manual_updated_by
          as manual_updated_by,

        decision_user.display_name
          as manual_updated_by_name,

        nullif(
          btrim(
            coalesce(
              i.source_data
                ->>
                'FECHA_ASIGNACION',
              ''
            )
          ),
          ''
        )
          as assignment_date,

        nullif(
          btrim(
            coalesce(
              i.source_data
                ->>
                'FECHA_FINAL_VIGENCIA',
              ''
            )
          ),
          ''
        )
          as validity_end_date,

        (
          select
            mc.queried_at

          from
            mipres_checks mc

          where
            mc.authorization_item_id =
              i.id

          order by
            mc.queried_at desc,
            mc.id desc

          limit 1
        )
          as latest_check_at,

        (
          select
            mc.outcome

          from
            mipres_checks mc

          where
            mc.authorization_item_id =
              i.id

          order by
            mc.queried_at desc,
            mc.id desc

          limit 1
        )
          as latest_outcome,

        i.updated_at

      from
        authorization_items i

      left join
        mipres_manual_decision_concepts concept
          on concept.code =
             i.mipres_manual_concept_code

      left join
        users decision_user
          on decision_user.id =
             i.mipres_manual_updated_by

      where
        ${where}

      order by
        i.updated_at desc,
        i.id desc

      limit
        ${limit}

      offset
        ${offset}
    `);
  }

  private mapRow(row: BaseRow) {
    const { today, horizon } = authorizationQueryValidityWindow();

    const assignmentDate = normalizeSourceDate(row.assignment_date);

    const validityEndDate = normalizeSourceDate(row.validity_end_date);

    const quantity = parsePositiveInteger(row.quantity);

    const operationalWindow = resolveOperationalWindow({
      assignmentDate,
      validityEndDate,
      today,
      horizon,
    });

    const operational = resolveMipresReadState({
      enablementStatus: row.enablement_status,

      tariffMembershipStatus: row.tariff_membership_status,

      coverageType: row.coverage_type,

      directionStatus: row.direction_status,

      manualDecision: row.manual_decision,

      quantity,

      minimumQuantity: Number(row.minimum_quantity),

      operationalWindow,
    });

    return {
      id: row.id,

      authorizationNumber: row.authorization_number,

      patientDocument: row.patient_document,

      patientName: row.patient_name,

      productCode: row.product_code,

      productDescription: row.product_description,

      quantity,

      minimumQuantity: Number(row.minimum_quantity),

      prescriptionNumber: row.prescription_number,

      directionStatus: row.direction_status,

      manualDecision: row.manual_decision,

      authorizationState: operational.authorizationState,

      mipresState: operational.mipresState,

      state: operational.state,

      blockedReasons: operational.blockedReasons,

      latestMipresCheckAt: timestamp(row.latest_check_at),

      latestMipresOutcome: row.latest_outcome,

      assignmentDate,

      validityEndDate,

      validations: {
        source: {
          result: row.enablement_status === 'ENABLED' ? 'PASS' : 'FAIL',

          value: row.enablement_status,
        },

        tariffAnnex: {
          result:
            row.tariff_membership_status === 'LISTED'
              ? 'PASS'
              : row.tariff_membership_status === 'NOT_EVALUATED'
                ? 'PENDING'
                : 'FAIL',

          value: row.tariff_membership_status,
        },

        mipresDirection: {
          result:
            row.direction_status === 'CONFIRMED'
              ? 'PASS'
              : row.direction_status === 'QUERY_ERROR'
                ? 'ERROR'
                : 'PENDING',

          value: row.direction_status,
        },

        operationalWindow: {
          result: operationalWindow === 'IN_WINDOW' ? 'PASS' : 'FAIL',

          value: operationalWindow,
        },

        manualMtdControl: {
          result:
            row.manual_decision === 'MANUALLY_ENABLED'
              ? 'PASS'
              : row.manual_decision === 'MANUALLY_DISABLED'
                ? 'FAIL'
                : 'PENDING',

          value: row.manual_decision,
        },
      },

      decision: {
        status: row.manual_decision,

        version: row.manual_version,

        conceptCode: row.manual_concept_code,

        conceptName: row.manual_concept_name,

        note: row.manual_note,

        updatedAt: timestamp(row.manual_updated_at),

        updatedBy: row.manual_updated_by
          ? {
              id: row.manual_updated_by,

              displayName: row.manual_updated_by_name,
            }
          : null,
      },

      updatedAt: timestamp(row.updated_at),
    };
  }

  async list(
    filters: MipresListFilters,

    scope: Scope,
  ) {
    const conditions: SQL[] = [
      sql`
          btrim(i.no_prescripcion) <> ''
        `,

      sql`
          btrim(
            i.no_prescripcion
          )
          <>
          ''
        `,
    ];

    if (filters.search) {
      const search = `%${filters.search}%`;

      conditions.push(sql`
        (
          i.numero_autorizacion
            ilike
            ${search}

          or

          i.no_prescripcion
            ilike
            ${search}

          or

          i.codigo_medicamento
            ilike
            ${search}

          or

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
            ${search}

          or

          coalesce(
            i.source_data
              ->>
              'NOMBRE_PACIENTE',
            ''
          )
            ilike
            ${search}

          or

          exists (
            select
              1

            from
              tariff_annex_products
                tap_search

            where
              tap_search.organization_id =
                ${scope.organizationId}::uuid

              and
              tap_search.codigo_producto =
                i.codigo_medicamento

              and
              tap_search.active =
                true

              and
              (
                coalesce(
                  tap_search.descripcion_generica,
                  ''
                )
                  ilike
                  ${search}

                or

                coalesce(
                  tap_search.descripcion_comercial,
                  ''
                )
                  ilike
                  ${search}
              )
          )

          or

          exists (
            select
              1
            from
              mipres_directions md_search
            where
              md_search.authorization_item_id =
                i.id
              and
              (
                coalesce(
                  md_search.direction_id,
                  ''
                )
                  ilike
                    ${search}

                or

                coalesce(
                  md_search.raw::text,
                  ''
                )
                  ilike
                    ${search}
              )
          )

        )
      `);
    }

    if (filters.directionStatus) {
      conditions.push(sql`
        i.direction_status =
          ${filters.directionStatus}
      `);
    }

    if (filters.atStatus) {
      conditions.push(sql`
        i.tariff_membership_status =
          ${filters.atStatus}
      `);
    }

    if (filters.manualDecision) {
      conditions.push(sql`
        i.mipres_manual_decision =
          ${filters.manualDecision}
      `);
    }

    if (filters.state === 'OPERABLE') {
      conditions.push(this.operableSql(scope));
    }

    if (filters.state === 'BLOCKED') {
      conditions.push(sql`
        not (
          ${this.operableSql(scope)}
        )
      `);
    }

    const where = sql.join(conditions, sql` and `);

    const count = await this.database.db.execute<{
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

    const offset = (filters.page - 1) * filters.limit;

    const result = await this.baseSelect(where, scope, filters.limit, offset);

    return {
      items: result.rows.map((row) => this.mapRow(row)),

      total: Number(count.rows[0]?.total ?? 0),

      page: filters.page,

      pageSize: filters.limit,
    };
  }

  async detail(
    authorizationItemId: string,

    scope: Scope,
  ) {
    const result = await this.baseSelect(
      sql`
          i.id =
            ${authorizationItemId}

          and

          i.coverage_type =
            'NO_PBS'

          and

          btrim(
            i.no_prescripcion
          )
          <>
          ''
        `,
      scope,
      1,
      0,
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    const latestCheck =
      (
        await this.database.db.execute<{
          id: string;

          prescription_number: string;

          query_type: string;

          outcome: string;

          http_status: number | null;

          direction_count: number;

          has_current_direction: boolean | null;

          rule_version: string;

          check_date: string;

          queried_at: Date | string;
        }>(sql`
          select
            mc.id,
            mc.prescription_number,
            mc.query_type,
            mc.outcome,
            mc.http_status,
            mc.direction_count,
            mc.has_current_direction,
            mc.rule_version,
            mc.check_date::text
              as check_date,
            mc.queried_at

          from
            mipres_checks mc

          where
            mc.authorization_item_id =
              ${authorizationItemId}

          order by
            mc.queried_at desc,
            mc.id desc

          limit 1
        `)
      ).rows[0] ?? null;

    const directions = latestCheck
      ? (
          await this.database.db.execute<{
            id: string;

            external_id: string;

            direction_id: string;

            prescription_number: string;

            technology_type: string;

            technology_consecutive: string;

            maximum_delivery_date: string;

            external_status: string;

            annulled: boolean;

            current: boolean;

            created_at: Date | string;
          }>(sql`
              select
                md.id,
                md.external_id,
                md.direction_id,
                md.prescription_number,
                md.technology_type,
                md.technology_consecutive,
                md.maximum_delivery_date::text
                  as maximum_delivery_date,
                md.external_status,
                md.annulled,
                md.current,
                md.created_at

              from
                mipres_directions md

              where
                md.mipres_check_id =
                  ${latestCheck.id}

              order by
                md.current desc,
                md.maximum_delivery_date desc,
                md.id desc
            `)
        ).rows
      : [];

    const currentDirection = directions.find((direction) => direction.current) ?? null;

    return {
      ...this.mapRow(row),

      mipres: {
        prescriptionNumber: row.prescription_number,

        directionStatus: row.direction_status,

        lastQueryAt: latestCheck ? timestamp(latestCheck.queried_at) : null,

        lastQueryType: latestCheck?.query_type ?? null,

        lastOutcome: latestCheck?.outcome ?? null,

        lastHttpStatus: latestCheck?.http_status ?? null,

        directionCount: latestCheck ? Number(latestCheck.direction_count) : 0,

        hasCurrentDirection: latestCheck?.has_current_direction ?? false,

        ruleVersion: latestCheck?.rule_version ?? null,

        checkDate: latestCheck?.check_date ?? null,

        currentDirection: currentDirection
          ? {
              id: currentDirection.id,

              externalId: currentDirection.external_id,

              directionId: currentDirection.direction_id,

              prescriptionNumber: currentDirection.prescription_number,

              technologyType: currentDirection.technology_type,

              technologyConsecutive: currentDirection.technology_consecutive,

              maximumDeliveryDate: currentDirection.maximum_delivery_date,

              externalStatus: currentDirection.external_status,

              annulled: currentDirection.annulled,

              current: currentDirection.current,
            }
          : null,

        directions: directions.map((direction) => ({
          id: direction.id,

          externalId: direction.external_id,

          directionId: direction.direction_id,

          prescriptionNumber: direction.prescription_number,

          technologyType: direction.technology_type,

          technologyConsecutive: direction.technology_consecutive,

          maximumDeliveryDate: direction.maximum_delivery_date,

          externalStatus: direction.external_status,

          annulled: direction.annulled,

          current: direction.current,

          createdAt: timestamp(direction.created_at),
        })),
      },
    };
  }

  async history(
    authorizationItemId: string,

    scope: Scope,
  ) {
    const exists = (
      await this.database.db.execute<{
        id: string;
      }>(sql`
          select
            i.id

          from
            authorization_items i

          where
            i.id =
              ${authorizationItemId}

            and

            i.coverage_type =
              'NO_PBS'

            and

            btrim(
              i.no_prescripcion
            )
            <>
            ''

          limit 1
        `)
    ).rows[0];

    if (!exists) {
      return null;
    }

    const decisions = (
      await this.database.db.execute<Record<string, unknown>>(sql`
          select
            h.id,
            h.previous_decision,
            h.decision,
            h.decision_version,
            h.concept_code,
            c.name
              as concept_name,
            h.note,
            h.actor_id,
            u.display_name
              as actor_name,
            h.created_at

          from
            authorization_mipres_decision_history h

          left join
            mipres_manual_decision_concepts c
              on c.code =
                 h.concept_code

          left join
            users u
              on u.id =
                 h.actor_id

          where
            h.authorization_item_id =
              ${authorizationItemId}

            and

            h.organization_id =
              ${scope.organizationId}::uuid

          order by
            h.created_at desc,
            h.id desc
        `)
    ).rows;

    const evidence = (
      await this.database.db.execute<Record<string, unknown>>(sql`
          select
            mc.id,
            mc.prescription_number,
            mc.query_type,
            mc.outcome,
            mc.http_status,
            mc.direction_count,
            mc.has_current_direction,
            mc.rule_version,
            mc.check_date::text
              as check_date,
            mc.queried_at

          from
            mipres_checks mc

          where
            mc.authorization_item_id =
              ${authorizationItemId}

          order by
            mc.queried_at desc,
            mc.id desc
        `)
    ).rows;

    const items = [
      ...decisions.map((event) => ({
        id: String(event.id),

        kind: 'MTD_DECISION' as const,

        occurredAt: timestamp(event.created_at as Date | string | null),

        previousDecision: event.previous_decision,

        decision: event.decision,

        decisionVersion: event.decision_version,

        conceptCode: event.concept_code,

        conceptName: event.concept_name,

        note: event.note,

        actorId: event.actor_id,

        actorName: event.actor_name,
      })),

      ...evidence.map((event) => ({
        id: String(event.id),

        kind: 'MIPRES_EVIDENCE' as const,

        occurredAt: timestamp(event.queried_at as Date | string | null),

        prescriptionNumber: event.prescription_number,

        queryType: event.query_type,

        outcome: event.outcome,

        httpStatus: event.http_status,

        directionCount: event.direction_count,

        hasCurrentDirection: event.has_current_direction,

        ruleVersion: event.rule_version,

        checkDate: event.check_date,
      })),
    ];

    items.sort((left, right) => (right.occurredAt ?? '').localeCompare(left.occurredAt ?? ''));

    return {
      items,
    };
  }

  async concepts(action?: 'ENABLE' | 'DISABLE') {
    const where = action
      ? sql`
            active =
              true

            and

            action =
              ${action}
          `
      : sql`
            active =
              true
          `;

    const result = await this.database.db.execute<{
      code: string;

      name: string;

      action: string;

      requires_note: boolean;

      sort_order: number;
    }>(sql`
        select
          code,
          name,
          action,
          requires_note,
          sort_order

        from
          mipres_manual_decision_concepts

        where
          ${where}

        order by
          action,
          sort_order,
          code
      `);

    return {
      items: result.rows.map((row) => ({
        code: row.code,

        name: row.name,

        action: row.action,

        requiresNote: row.requires_note,
      })),
    };
  }
}
