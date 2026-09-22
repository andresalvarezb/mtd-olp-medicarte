import { Inject, Injectable } from '@nestjs/common';

import { sql } from 'drizzle-orm';

import type { createDatabase } from '@authorization/database';

import type { Scope } from '../common/request-scope';

import { toIsoTimestamp } from '../common/date-time';

import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;

export interface AuthorizationQueryFilters {
  authorizationNumber?: string;
  commercialCode?: string;
  patient?: string;

  enablementStatus?: 'ENABLED' | 'BLOCKED_SOURCE_STATUS';

  coverageType?: 'PBS' | 'NO_PBS';

  page: number;
  limit: number;
}

interface AuthorizationQueryRow extends Record<string, unknown> {
  id: string;
  authorization_number: string;
  commercial_code: string;

  patient_document: string | null;

  patient_name: string | null;

  quantity: string | null;

  assignment_date: string | null;

  validity_end_date: string | null;

  enablement_status: string;
  coverage_type: string;

  logistics_status: string | null;

  purchase_order: string | null;

  created_at: Date | string;

  updated_at: Date | string;
}

@Injectable()
export class AuthorizationQueryRepository {
  constructor(
    @Inject(DATABASE)
    private readonly database: Database,
  ) {}

  async list(filters: AuthorizationQueryFilters, scope: Scope) {
    const conditions = [
      scope.organizationCode === 'MTD'
        ? sql`true`
        : sql`
            exists (
              select 1
              from authorization_item_organizations aio
              where
                aio.authorization_item_id = i.id
                and aio.organization_id =
                  ${scope.organizationId}
            )
          `,
    ];

    if (filters.authorizationNumber) {
      conditions.push(sql`
        i.numero_autorizacion
        ilike
        ${`%${filters.authorizationNumber}%`}
      `);
    }

    if (filters.commercialCode) {
      conditions.push(sql`
        i.codigo_medicamento
        ilike
        ${`%${filters.commercialCode}%`}
      `);
    }

    if (filters.patient) {
      conditions.push(sql`
        (
          coalesce(
            i.source_data ->> 'IDENTIFICACION_PACIENTE',
            i.source_data ->> 'NUM_DOCUMENTO',
            ''
          )
          ilike
          ${`%${filters.patient}%`}

          or

          coalesce(
            i.source_data ->> 'NOMBRE_PACIENTE',
            ''
          )
          ilike
          ${`%${filters.patient}%`}
        )
      `);
    }

    if (filters.enablementStatus) {
      conditions.push(sql`
        i.enablement_status =
        ${filters.enablementStatus}
      `);
    }

    if (filters.coverageType) {
      conditions.push(sql`
        i.coverage_type =
        ${filters.coverageType}
      `);
    }

    const where = sql.join(conditions, sql` and `);

    const offset = (filters.page - 1) * filters.limit;

    const count = await this.database.db.execute<{
      total: number;
    }>(sql`
        select
          count(*)::int
            as total
        from authorization_items i
        where ${where}
      `);

    const result = await this.database.db.execute<AuthorizationQueryRow>(sql`
        select
          i.id,

          i.numero_autorizacion
            as authorization_number,

          i.codigo_medicamento
            as commercial_code,

          coalesce(
            i.source_data ->> 'IDENTIFICACION_PACIENTE',
            i.source_data ->> 'NUM_DOCUMENTO'
          )
            as patient_document,

          i.source_data ->> 'NOMBRE_PACIENTE'
            as patient_name,

          i.source_data ->> 'CANTIDAD'
            as quantity,

          i.source_data ->> 'FECHA_ASIGNACION'
            as assignment_date,

          i.source_data ->> 'FECHA_FINAL_VIGENCIA'
            as validity_end_date,

          i.enablement_status,
          i.coverage_type,
          case
            when exists (
              select 1
              from patient_applications pa
              where pa.authorization_item_id = i.id
                and pa.status = 'CONFIRMED'
            )
            then 'APPLIED'

            when exists (
              select 1
              from inventory_authorization_allocations iaa
              where iaa.authorization_item_id = i.id
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
            )
            then 'INVENTORY_ASSIGNED'

            when exists (
              select 1
              from patient_schedules ps
              where ps.authorization_item_id = i.id
                and ps.status in (
                  'SCHEDULED',
                  'RESCHEDULED'
                )
            )
            then 'SCHEDULED'

            else 'PENDING'
          end
            as logistics_status,

          (
            select
              string_agg(
                distinct coalesce(
                  po.purchase_order_code,
                  po.id::text
                ),
                ', '
              )

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
          )
            as purchase_order,

          i.created_at,
          i.updated_at

        from authorization_items i

        where ${where}

        order by
          i.created_at desc,
          i.id desc

        limit ${filters.limit}
        offset ${offset}
      `);

    const items = result.rows.map((row) => this.toResponse(row));

    return {
      items,

      total: Number(count.rows[0]?.total ?? 0),

      page: filters.page,

      pageSize: filters.limit,
    };
  }

  async detail(id: string, scope: Scope) {
    const conditions = [
      sql`i.id = ${id}`,

      scope.organizationCode === 'MTD'
        ? sql`true`
        : sql`
            exists (
              select 1
              from authorization_item_organizations aio
              where
                aio.authorization_item_id = i.id
                and aio.organization_id =
                  ${scope.organizationId}
            )
          `,
    ];

    const result = await this.database.db.execute<AuthorizationQueryRow>(sql`
        select
          i.id,

          i.numero_autorizacion
            as authorization_number,

          i.codigo_medicamento
            as commercial_code,

          coalesce(
            i.source_data ->> 'IDENTIFICACION_PACIENTE',
            i.source_data ->> 'NUM_DOCUMENTO'
          )
            as patient_document,

          i.source_data ->> 'NOMBRE_PACIENTE'
            as patient_name,

          i.source_data ->> 'CANTIDAD'
            as quantity,

          i.source_data ->> 'FECHA_ASIGNACION'
            as assignment_date,

          i.source_data ->> 'FECHA_FINAL_VIGENCIA'
            as validity_end_date,

          i.enablement_status,
          i.coverage_type,
          case
            when exists (
              select 1
              from patient_applications pa
              where pa.authorization_item_id = i.id
                and pa.status = 'CONFIRMED'
            )
            then 'APPLIED'

            when exists (
              select 1
              from inventory_authorization_allocations iaa
              where iaa.authorization_item_id = i.id
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
            )
            then 'INVENTORY_ASSIGNED'

            when exists (
              select 1
              from patient_schedules ps
              where ps.authorization_item_id = i.id
                and ps.status in (
                  'SCHEDULED',
                  'RESCHEDULED'
                )
            )
            then 'SCHEDULED'

            else 'PENDING'
          end
            as logistics_status,

          (
            select
              string_agg(
                distinct coalesce(
                  po.purchase_order_code,
                  po.id::text
                ),
                ', '
              )

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
          )
            as purchase_order,

          i.created_at,
          i.updated_at

        from authorization_items i

        where
          ${sql.join(conditions, sql` and `)}

        limit 1
      `);

    const row = result.rows[0];

    return row ? this.toResponse(row) : null;
  }

  private toIsoTimestamp(value: Date | string): string {
    if (value instanceof Date) {
      return value.toISOString();
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new TypeError(`Invalid database timestamp: ${value}`);
    }

    return parsed.toISOString();
  }

  private toResponse(row: AuthorizationQueryRow) {
    return {
      id: row.id,

      authorizationNumber: row.authorization_number,

      commercialCode: row.commercial_code,

      patientDocument: row.patient_document,

      patientName: row.patient_name,

      quantity: row.quantity,

      assignmentDate: row.assignment_date,

      validityEndDate: row.validity_end_date,

      enablementStatus: row.enablement_status,

      coverageType: row.coverage_type,

      logisticsStatus: row.logistics_status,

      purchaseOrder: row.purchase_order,

      createdAt: toIsoTimestamp(row.created_at),

      updatedAt: toIsoTimestamp(row.updated_at),
    };
  }
}
