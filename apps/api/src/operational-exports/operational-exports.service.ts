import { Inject, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import {
  bulkUpdateOperationContracts,
  type BulkUpdateOperationType,
  type OperationalExportQuery,
} from '@authorization/contracts';
import { deriveApplicationSiteStatus } from '@authorization/domain';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';

type Database = ReturnType<typeof createDatabase>;

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
  operational_version: number;
  version: number;
  created_at: Date;
  updated_at: Date;
  nombre_paciente: string | null;
  numero_documento: string | null;
};

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
  'application_site_status',
  'operational_version',
  'version',
  'created_at',
  'updated_at',
] as const;

const sensitiveColumns = ['nombre_paciente', 'numero_documento'] as const;

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

/**
 * Fase 4 (SPEC-013/DEC-007/ADR-018): descarga on-demand de la base completa
 * permitida. CSV/XLSX se genera durante la respuesta y no se conserva copia
 * persistente; la operación queda auditada.
 */
@Injectable()
export class OperationalExportsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async authorizationItems(input: {
    query: OperationalExportQuery;
    scope: Scope;
  }): Promise<{ filename: string; content: Buffer; rowCount: number; columns: string[] }> {
    const operationType: BulkUpdateOperationType = input.query.operationType;
    const contract = bulkUpdateOperationContracts[operationType];
    const readSensitive = input.scope.readSensitive;
    if (
      input.scope.organizationCode !== contract.actorOrganizationCode &&
      input.scope.organizationCode !== 'MTD'
    ) {
      throw new ForbiddenExportError(contract.actorOrganizationCode);
    }
    const result = await this.database.pool.query<ExportRow>(
      `select i.id, i.authorization_key, i.numero_autorizacion, i.codigo_medicamento,
              i.enablement_status, i.coverage_type, i.direction_status, i.operation_status,
               i.lugar_dispensacion, i.fecha_dispensacion::text, i.fecha_aplicacion::text,
               i.audit_status, i.operational_version, i.version, i.created_at, i.updated_at,
              ${readSensitive ? "i.source_data->>'NOMBRE_PACIENTE'" : 'null::text'} as nombre_paciente,
              ${readSensitive ? "i.source_data->>'NUM_DOCUMENTO'" : 'null::text'} as numero_documento
       from authorization_items i
       where i.operation_status in ('READY_TO_DISPENSE', 'DISPENSATION_REPORTED', 'DISPENSED')
         and ($1::boolean = true or exists (
           select 1 from authorization_item_organizations aio
           where aio.authorization_item_id = i.id and aio.organization_id = $2))
       order by i.created_at asc, i.id asc`,
      [input.scope.organizationCode === 'MTD', input.scope.organizationId],
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
      application_site_status: deriveApplicationSiteStatus(row.lugar_dispensacion),
      operational_version: row.operational_version,
      version: row.version,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      nombre_paciente: row.nombre_paciente,
      numero_documento: row.numero_documento,
    }));
    const filename = `authorization-items-${operationType.toLowerCase()}`;
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
      XLSX.utils.book_append_sheet(book, sheet, 'authorization-items');
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
    operationType: string;
    format: string;
    rowCount: number;
    columns: readonly string[];
    result: 'SUCCESS' | 'DENIED' | 'FAILED';
  }): Promise<void> {
    await this.database.pool.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
       values ('USER', $1, $2, 'OPERATIONAL_EXPORT_CREATED', 'operational_export', $3, $4::jsonb, $5, $6, $7)`,
      [
        input.scope.userId,
        input.scope.organizationId,
        `${input.operationType}:${input.format}`,
        JSON.stringify({
          operationType: input.operationType,
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

export class ForbiddenExportError extends Error {
  constructor(readonly requiredActor: string) {
    super(`El actor no puede descargar la base para este tipo de operación.`);
    this.name = 'ForbiddenExportError';
  }
}
