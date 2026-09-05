import { Inject, Injectable } from '@nestjs/common';
import type {
  ConsolidatedExportQuery,
  OperationalIndicatorsResponse,
} from '@authorization/contracts';
import {
  auditStatusSchema,
  operationStatusSchema,
  coverageTypeSchema,
} from '@authorization/contracts';
import { deriveApplicationSiteStatus } from '@authorization/domain';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';
import { sourceBaseColumns, sourceBaseSelectSql } from '../common/source-base-columns';
import { createXlsxExport } from '../common/xlsx-export';

type Database = ReturnType<typeof createDatabase>;

type IndicatorRow = {
  audit_status: string | null;
  operation_status: string | null;
  coverage_type: string | null;
  pending_location: boolean;
  assigned_location: boolean;
  pending_dispensation_date: boolean;
  pending_application_date: boolean;
  ready_for_review: boolean;
  approved_for_admission: boolean;
};

type ExportRow = {
  id: string;
  authorization_key: string;
  numero_autorizacion: string;
  codigo_medicamento: string;
  enablement_status: string;
  coverage_type: string;
  direction_status: string;
  operation_status: string | null;
  lugar_dispensacion: string | null;
  fecha_programada: string | null;
  fecha_dispensacion: string | null;
  fecha_aplicacion: string | null;
  audit_status: string;
  admission_status: string;
  process_status: string;
  orden_compra: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  audit_observations: string | null;
  nombre_paciente: string | null;
  numero_documento: string | null;
  cdgn001: string | null;
  cups_autorizado: string | null;
  cantidad: string | null;
  dosis: string | null;
  fecha_asignacion: string | null;
  fecha_final_vigencia: string | null;
  estado_autorizacion: string | null;
  obs_autorizacion: string | null;
  valor_cuota_moderadora: string | null;
  no_prescripcion: string | null;
};

const processColumns = [
  'CLAVE_AUTORIZACION',
  'ESTADO_HABILITACION',
  'TIPO_COBERTURA',
  'ESTADO_DIRECCIONAMIENTO',
  'ESTADO_OPERACION',
  'LUGAR_DISPENSACION',
  'FECHA_PROGRAMADA',
  'FECHA_DISPENSACION',
  'FECHA_APLICACION',
  'ESTADO_AUDITORIA',
  'OBSERVACIONES_AUDITORIA',
  'ESTADO_ADMISION',
  'ESTADO_PUNTO_APLICACION',
  'VERSION',
  'FECHA_CREACION',
  'FECHA_ACTUALIZACION',
] as const;

/**
 * El consolidado no filtra por estado de validación u operación.
 */
@Injectable()
export class ConsolidationService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private scopeCondition(scope: Scope): { sql: string; values: unknown[] } {
    return {
      sql: '($1::boolean = true or exists (select 1 from authorization_item_organizations aio where aio.authorization_item_id = i.id and aio.organization_id = $2))',
      values: [scope.organizationCode === 'MTD', scope.organizationId],
    };
  }

  async indicators(scope: Scope): Promise<OperationalIndicatorsResponse> {
    const condition = this.scopeCondition(scope);
    const result = await this.database.pool.query<IndicatorRow>(
      `select
         i.audit_status,
         i.operation_status,
         i.coverage_type,
         (i.lugar_dispensacion is null and i.operation_status in ('READY_TO_DISPENSE','DISPENSATION_REPORTED','DISPENSED')) as pending_location,
         (i.lugar_dispensacion is not null and i.lugar_dispensacion <> '' and i.operation_status = 'READY_TO_DISPENSE') as assigned_location,
         (i.fecha_dispensacion is null and i.operation_status = 'READY_TO_DISPENSE') as pending_dispensation_date,
         (i.fecha_aplicacion is null and i.fecha_dispensacion is not null and i.operation_status = 'DISPENSATION_REPORTED') as pending_application_date,
         (i.audit_status = 'READY') as ready_for_review,
         (i.audit_status = 'APPROVED') as approved_for_admission
       from authorization_items i
       where ${condition.sql}`,
      condition.values,
    );
    const byAuditStatus = Object.fromEntries(
      auditStatusSchema.options.map((status) => [status, 0]),
    ) as OperationalIndicatorsResponse['byAuditStatus'];
    const byOperationStatus = Object.fromEntries(
      operationStatusSchema.options.map((status) => [status, 0]),
    ) as OperationalIndicatorsResponse['byOperationStatus'];
    const byCoverageType = Object.fromEntries(
      coverageTypeSchema.options.map((status) => [status, 0]),
    );
    let pendingLocation = 0;
    let assignedLocation = 0;
    let pendingDispensationDate = 0;
    let pendingApplicationDate = 0;
    let readyForReview = 0;
    let approvedForAdmission = 0;
    for (const row of result.rows) {
      if (row.audit_status && row.audit_status in byAuditStatus) {
        byAuditStatus[row.audit_status as keyof typeof byAuditStatus] += 1;
      }
      if (row.operation_status && row.operation_status in byOperationStatus) {
        byOperationStatus[row.operation_status as keyof typeof byOperationStatus] += 1;
      }
      if (row.coverage_type && row.coverage_type in byCoverageType) {
        byCoverageType[row.coverage_type as keyof typeof byCoverageType]! += 1;
      }
      if (row.pending_location) pendingLocation += 1;
      if (row.assigned_location) assignedLocation += 1;
      if (row.pending_dispensation_date) pendingDispensationDate += 1;
      if (row.pending_application_date) pendingApplicationDate += 1;
      if (row.ready_for_review) readyForReview += 1;
      if (row.approved_for_admission) approvedForAdmission += 1;
    }
    return {
      byAuditStatus,
      byOperationStatus,
      byCoverageType,
      pendingDispensationLocation: pendingLocation,
      assignedDispensationLocation: assignedLocation,
      pendingDispensationDate,
      pendingApplicationDate,
      readyForReview,
      approvedForAdmission,
    };
  }

  async consolidatedExport(input: {
    query: ConsolidatedExportQuery;
    scope: Scope;
  }): Promise<{ filename: string; content: Buffer; rowCount: number; columns: string[] }> {
    const condition = this.scopeCondition(input.scope);
    const values = [...condition.values];
    if (input.query.coverageType) {
      values.push(input.query.coverageType);
    }
    const coverageFilter = input.query.coverageType
      ? `and i.coverage_type = $${values.length}`
      : '';
    const result = await this.database.pool.query<ExportRow>(
      `select i.id, i.authorization_key, i.numero_autorizacion, i.codigo_medicamento,
              i.enablement_status, i.coverage_type, i.direction_status, i.operation_status,
               i.lugar_dispensacion, i.fecha_programada::text, i.fecha_dispensacion::text, i.fecha_aplicacion::text,
               i.audit_status, i.admission_status, i.version, i.created_at, i.updated_at,
               (select string_agg(
                  format('Revision %s [%s]: %s', ar.review_number, ar.status, ar.observations),
                  ' | ' order by ar.review_number
                )
                from audit_reviews ar
                where ar.authorization_item_id = i.id
                  and ar.observations is not null
                  and btrim(ar.observations) <> '') as audit_observations,
               ${sourceBaseSelectSql('i')}
       from authorization_items i
        where ${input.query.includeAll ? 'true' : "i.audit_status = 'APPROVED'"} ${coverageFilter}
         and ${condition.sql}
       order by i.created_at asc, i.id asc`,
      values,
    );
    const columns = ['IDENTIFICADOR_REGISTRO', ...sourceBaseColumns, ...processColumns] as string[];
    const rows: Array<Record<string, string | number | null>> = result.rows.map((row) => ({
      NUMERO_AUTORIZACION: row.numero_autorizacion,
      NUM_DOCUMENTO: row.numero_documento,
      NOMBRE_PACIENTE: row.nombre_paciente,
      CDGN001: row.cdgn001,
      CODIGO_COMERCIAL: row.codigo_medicamento,
      CUPS_AUTORIZADO: row.cups_autorizado,
      CANTIDAD: row.cantidad,
      DOSIS: row.dosis,
      FECHA_ASIGNACION: row.fecha_asignacion,
      FECHA_FINAL_VIGENCIA: row.fecha_final_vigencia,
      ESTADO_AUTORIZACION: row.estado_autorizacion,
      OBS_AUTORIZACION: row.obs_autorizacion,
      VALOR_CUOTA_MODERADORA: row.valor_cuota_moderadora,
      NUMERO_PRESCRIPCION: row.no_prescripcion,
      IDENTIFICADOR_REGISTRO: row.id,
      CLAVE_AUTORIZACION: row.authorization_key,
      ESTADO_HABILITACION: row.enablement_status,
      TIPO_COBERTURA: row.coverage_type,
      ESTADO_DIRECCIONAMIENTO: row.direction_status,
      ESTADO_OPERACION: row.operation_status,
      LUGAR_DISPENSACION: row.lugar_dispensacion,
      FECHA_PROGRAMADA: row.fecha_programada,
      FECHA_DISPENSACION: row.fecha_dispensacion,
      FECHA_APLICACION: row.fecha_aplicacion,
      ESTADO_AUDITORIA: row.audit_status,
      OBSERVACIONES_AUDITORIA: row.audit_observations,
      ESTADO_ADMISION: row.admission_status,
      ESTADO_PUNTO_APLICACION: deriveApplicationSiteStatus(row.lugar_dispensacion),
      VERSION: row.version,
      FECHA_CREACION: row.created_at.toISOString(),
      FECHA_ACTUALIZACION: row.updated_at.toISOString(),
    }));
    const filename = input.query.includeAll ? 'autorizaciones-completas' : 'consolidado-aprobado';
    return {
      filename: `${filename}.xlsx`,
      content: createXlsxExport(columns, rows),
      rowCount: rows.length,
      columns,
    };
  }

  async auditExport(input: {
    scope: Scope;
    format: string;
    coverageType: string | null;
    rowCount: number;
    columns: readonly string[];
    result: 'SUCCESS' | 'DENIED' | 'FAILED';
  }): Promise<void> {
    await this.database.pool.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
       values ('USER', $1, $2, 'CONSOLIDATED_EXPORT_CREATED', 'consolidated_export', $3, $4::jsonb, $5, $6, $7)`,
      [
        input.scope.userId,
        input.scope.organizationId,
        `authorization-items:${input.format}`,
        JSON.stringify({
          coverageType: input.coverageType ?? null,
          format: input.format,
          rowCount: input.rowCount,
          columns: input.columns,
          result: input.result,
        }),
        input.scope.correlationId,
        input.scope.correlationId,
        input.result,
      ],
    );
  }
}
