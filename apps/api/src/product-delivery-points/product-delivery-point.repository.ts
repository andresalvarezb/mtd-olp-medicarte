import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import type { Scope } from '../common/request-scope';
import { DATABASE } from '../tokens';
import type { ProductDeliveryPointImportRow } from './product-delivery-point-xlsx';

type Database = ReturnType<typeof createDatabase>;

export type ProductDeliveryPointImportResult = Readonly<{
  totalMappings: number;
  duplicateRows: number;
  createdMappings: number;
  updatedMappings: number;
  unchangedMappings: number;
  createdPoints: number;
}>;

@Injectable()
export class ProductDeliveryPointRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async applyImport(input: {
    rows: readonly ProductDeliveryPointImportRow[];
    duplicateRows: number;
    scope: Scope;
  }): Promise<ProductDeliveryPointImportResult> {
    return this.database.db.transaction(async (tx) => {
      const medicarte = await tx.execute<{ id: string }>(sql`
        select id
        from organizations
        where upper(code) = 'MEDICARTE'
        limit 1
      `);

      const medicarteOrganizationId = medicarte.rows[0]?.id;

      if (!medicarteOrganizationId) {
        throw new Error('MEDICARTE_ORGANIZATION_NOT_FOUND');
      }

      let createdMappings = 0;
      let updatedMappings = 0;
      let unchangedMappings = 0;
      let createdPoints = 0;

      for (const row of input.rows) {
        let point = await tx.execute<{
          id: string;
          active: boolean;
        }>(sql`
          select id, active
          from dispensing_points
          where organization_id = ${medicarteOrganizationId}
            and upper(code) = ${row.siteCode}
          limit 1
          for update
        `);

        if (!point.rows[0]) {
          point = await tx.execute<{
            id: string;
            active: boolean;
          }>(sql`
            insert into dispensing_points (
              organization_id,
              code,
              name,
              active,
              created_by
            )
            values (
              ${medicarteOrganizationId},
              ${row.siteCode},
              ${row.siteName},
              true,
              ${input.scope.userId}
            )
            returning id, active
          `);

          createdPoints += 1;
        }

        const pointRow = point.rows[0];

        if (!pointRow) {
          throw new Error('DELIVERY_POINT_CREATE_FAILED');
        }

        if (!pointRow.active) {
          throw new Error(`DELIVERY_POINT_INACTIVE:${row.siteCode}`);
        }

        const current = await tx.execute<{
          id: string;
          source_cum_code: string;
          service_model: string | null;
          source_site_name: string;
          dispensing_point_id: string;
        }>(sql`
          select
            id,
            source_cum_code,
            service_model,
            source_site_name,
            dispensing_point_id
          from product_delivery_point_mappings
          where invima_record_normalized =
                ${row.invimaRecord}
            and invima_presentation_normalized =
                ${row.invimaPresentation}
          for update
        `);

        const existing = current.rows[0];

        if (!existing) {
          await tx.execute(sql`
            insert into product_delivery_point_mappings (
              invima_record_normalized,
              invima_presentation_normalized,
              source_cum_code,
              service_model,
              source_site_name,
              dispensing_point_id,
              created_by,
              updated_by
            )
            values (
              ${row.invimaRecord},
              ${row.invimaPresentation},
              ${row.cumCode},
              ${row.serviceModel},
              ${row.siteName},
              ${pointRow.id},
              ${input.scope.userId},
              ${input.scope.userId}
            )
          `);

          createdMappings += 1;
          continue;
        }

        const unchanged =
          existing.source_cum_code === row.cumCode &&
          existing.service_model === row.serviceModel &&
          existing.source_site_name.trim() === row.siteName.trim() &&
          existing.dispensing_point_id === pointRow.id;

        if (unchanged) {
          unchangedMappings += 1;
          continue;
        }

        await tx.execute(sql`
          update product_delivery_point_mappings
          set
            source_cum_code = ${row.cumCode},
            service_model = ${row.serviceModel},
            source_site_name = ${row.siteName},
            dispensing_point_id = ${pointRow.id},
            version = version + 1,
            updated_by = ${input.scope.userId},
            updated_at = now()
          where id = ${existing.id}
        `);

        updatedMappings += 1;
      }

      return {
        totalMappings: input.rows.length,
        duplicateRows: input.duplicateRows,
        createdMappings,
        updatedMappings,
        unchangedMappings,
        createdPoints,
      };
    });
  }

  async list() {
    const result = await this.database.db.execute<{
      id: string;
      invima_record_normalized: string;
      invima_presentation_normalized: string;
      source_cum_code: string;
      service_model: string | null;
      source_site_name: string;
      dispensing_point_id: string;
      dispensing_point_code: string;
      dispensing_point_name: string;
      version: number;
    }>(sql`
      select
        mapping.id,
        mapping.invima_record_normalized,
        mapping.invima_presentation_normalized,
        mapping.source_cum_code,
        mapping.service_model,
        mapping.source_site_name,
        mapping.dispensing_point_id,
        point.code as dispensing_point_code,
        point.name as dispensing_point_name,
        mapping.version
      from product_delivery_point_mappings mapping
      join dispensing_points point
        on point.id = mapping.dispensing_point_id
      order by
        mapping.invima_record_normalized,
        mapping.invima_presentation_normalized
    `);

    return {
      items: result.rows.map((row) => ({
        id: row.id,
        invimaRecord: row.invima_record_normalized,
        invimaPresentation: row.invima_presentation_normalized,
        cumCode: row.source_cum_code,
        serviceModel: row.service_model,
        siteName: row.source_site_name,
        dispensingPointId: row.dispensing_point_id,
        dispensingPointCode: row.dispensing_point_code,
        dispensingPointName: row.dispensing_point_name,
        version: row.version,
      })),
    };
  }
}
