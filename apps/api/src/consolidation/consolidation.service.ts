import { Inject, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
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

type Database = ReturnType<typeof createDatabase>;

type IndicatorRow = {
  audit_status: string | null;
  operation_status: string | null;
  coverage_type: string | null;
  pending_location: boolean;
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
  fecha_dispensacion: string | null;
  fecha_aplicacion: string | null;
  audit_status: string;
  admission_status: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  nombre_paciente: string | null;
  numero_documento: string | null;
};

function csvValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = safeSpreadsheetValue(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function safeSpreadsheetValue(value: string | number | boolean): string {
  const text = `${value}`;
  return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
}

const baseColumns = [
  'id',
  'authorization_key',
  'numero_autorizacion',
  'codigo_medicamento',
  'enablement_status',
  'coverage_type',
  'direction_status',
  'operation_status',
  'lugar_dispensacion',
  'fecha_dispensacion',
  'fecha_aplicacion',
  'audit_status',
  'admission_status',
  'application_site_status',
  'version',
  'created_at',
  'updated_at',
] as const;

const sensitiveColumns = ['nombre_paciente', 'numero_documento'] as const;

/**
 * SPEC-006/ADR-018: el consolidado definitivo solo incluye registros
 * audit_status = APPROVED; el archivo se genera on-demand y no se persiste.
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
    const readSensitive = input.scope.readSensitive;
    const result = await this.database.pool.query<ExportRow>(
      `select i.id, i.authorization_key, i.numero_autorizacion, i.codigo_medicamento,
              i.enablement_status, i.coverage_type, i.direction_status, i.operation_status,
              i.lugar_dispensacion, i.fecha_dispensacion::text, i.fecha_aplicacion::text,
              i.audit_status, i.admission_status, i.version, i.created_at, i.updated_at,
              ${readSensitive ? "i.source_data->>'NOMBRE_PACIENTE'" : 'null::text'} as nombre_paciente,
              ${readSensitive ? "i.source_data->>'NUM_DOCUMENTO'" : 'null::text'} as numero_documento
       from authorization_items i
       where i.audit_status = 'APPROVED' ${coverageFilter}
         and ${condition.sql}
       order by i.created_at asc, i.id asc`,
      values,
    );
    const columns = [...baseColumns, ...(readSensitive ? sensitiveColumns : [])];
    const rows: Array<Record<string, string | number | null>> = result.rows.map((row) => ({
      id: row.id,
      authorization_key: row.authorization_key,
      numero_autorizacion: row.numero_autorizacion,
      codigo_medicamento: row.codigo_medicamento,
      enablement_status: row.enablement_status,
      coverage_type: row.coverage_type,
      direction_status: row.direction_status,
      operation_status: row.operation_status,
      lugar_dispensacion: row.lugar_dispensacion,
      fecha_dispensacion: row.fecha_dispensacion,
      fecha_aplicacion: row.fecha_aplicacion,
      audit_status: row.audit_status,
      admission_status: row.admission_status,
      application_site_status: deriveApplicationSiteStatus(row.lugar_dispensacion),
      version: row.version,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      nombre_paciente: row.nombre_paciente,
      numero_documento: row.numero_documento,
    }));
    const filename = `consolidado-aprobado`;
    if (input.query.format === 'xlsx') {
      const safeRows = rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === 'string' ? safeSpreadsheetValue(value) : value,
          ]),
        ),
      );
      const sheet = XLSX.utils.json_to_sheet(safeRows, { header: [...columns] });
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'consolidado');
      const content = Buffer.from(
        XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer,
      );
      return { filename: `${filename}.xlsx`, content, rowCount: rows.length, columns };
    }
    const lines = [columns.join(',')];
    for (const row of rows) {
      lines.push(columns.map((column) => csvValue(row[column])).join(','));
    }
    return {
      filename: `${filename}.csv`,
      content: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
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
