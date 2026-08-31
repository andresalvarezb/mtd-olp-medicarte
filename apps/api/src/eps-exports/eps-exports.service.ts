import { Inject, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import type { EpsNovedadesExportQuery } from '@authorization/contracts';
import {
  currentBogotaDate,
  deriveEpsNovedadCausales,
  epsNovedadCausalMessages,
  type EpsNovedadCausal,
} from '@authorization/domain';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';
import { sourceBaseColumns, sourceBaseSelectSql } from '../common/source-base-columns';

type Database = ReturnType<typeof createDatabase>;

type NovedadesRow = {
  id: string;
  authorization_key: string;
  numero_autorizacion: string;
  codigo_medicamento: string;
  enablement_status: string;
  coverage_type: string;
  direction_status: string;
  operation_status: string | null;
  tariff_membership_status: string;
  audit_status: string;
  admission_status: string;
  lugar_dispensacion: string | null;
  fecha_dispensacion: string | null;
  fecha_aplicacion: string | null;
  operational_version: number;
  version: number;
  created_at: Date;
  updated_at: Date;
  nombre_paciente: string | null;
  numero_documento: string | null;
  cdgn001: string | null;
  cups_autorizado: string | null;
  cantidad: string | null;
  dosis: string | null;
  fecha_asignacion: string | null;
  fecha_final_vigencia: string | null;
  estado_autorizacion: string | null;
  no_prescripcion: string | null;
};

/** Columnas derivadas de validación y del proceso, después de la evidencia. */
const processColumns = [
  'id',
  'authorization_key',
  'enablement_status',
  'coverage_type',
  'direction_status',
  'operation_status',
  'tariff_membership_status',
  'lugar_dispensacion',
  'fecha_dispensacion',
  'fecha_aplicacion',
  'audit_status',
  'admission_status',
  'application_site_status',
  'operational_version',
  'version',
  'created_at',
  'updated_at',
  'resultado_validacion',
  'causal',
  'detalle_novedad',
] as const;

function csvValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = safeSpreadsheetValue(`${value}`);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function safeSpreadsheetValue(value: string): string {
  return /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
}

/**
 * SPEC-014 §13-15: base on-demand de registros que NO alcanzaron
  * LISTO_PARA_DISPENSAR, para que MTD remita las novedades a la EPS. No se
 * conserva copia del archivo (ADR-018); la operación queda auditada.
 */
@Injectable()
export class EpsExportsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async epsNovedades(input: {
    query: EpsNovedadesExportQuery;
    scope: Scope;
  }): Promise<{ filename: string; content: Buffer; rowCount: number; columns: string[] }> {
    if (input.scope.organizationCode !== 'MTD') {
      throw new ForbiddenEpsExportError();
    }
    const today = currentBogotaDate();
    const result = await this.database.pool.query<NovedadesRow>(
      `select i.id, i.authorization_key, i.numero_autorizacion, i.codigo_medicamento,
               i.enablement_status, i.coverage_type, i.direction_status, i.operation_status,
               i.tariff_membership_status, i.audit_status, i.admission_status,
               i.lugar_dispensacion, i.fecha_dispensacion::text, i.fecha_aplicacion::text,
               i.operational_version, i.version, i.created_at, i.updated_at,
               ${sourceBaseSelectSql('i')}
       from authorization_items i
       where (i.operation_status is null or i.operation_status in ('BLOQUEADO', 'VENCIDO'))
       order by i.created_at asc, i.id asc`,
    );
    const columns = [...sourceBaseColumns, ...processColumns];
    const rows = result.rows.map((row) => {
      const causales = deriveEpsNovedadCausales({
        enablementStatus: row.enablement_status as 'HABILITADO' | 'BLOQUEADO_POR_ESTADO_ORIGEN',
        operationStatus: row.operation_status as
          | 'BLOQUEADO'
          | 'LISTO_PARA_DISPENSAR'
          | 'DISPENSACION_REPORTADA'
          | 'DISPENSADO'
          | 'VENCIDO'
          | null,
        coverageType: row.coverage_type as 'PBS' | 'NO_PBS',
        directionStatus: row.direction_status as
          | 'NO_APLICA'
          | 'PENDIENTE'
          | 'CONFIRMADO'
          | 'ERROR_DE_CONSULTA',
        tariffMembershipStatus: row.tariff_membership_status as
          | 'NO_EVALUADO'
          | 'LISTADO'
          | 'NO_LISTADO',
        fechaFinalVigencia: row.fecha_final_vigencia,
        today,
      });
      const causalCodes: EpsNovedadCausal[] = causales;
      const detalle = causalCodes.map((causal) => epsNovedadCausalMessages[causal]).join(' | ');
      return {
        NUMERO_AUTORIZACION: row.numero_autorizacion,
        NUM_DOCUMENTO: row.numero_documento,
        NOMBRE_PACIENTE: row.nombre_paciente,
        CDGN001: row.cdgn001,
        COD_COMERCIAL: row.codigo_medicamento,
        CUPS_AUTORIZADO: row.cups_autorizado,
        CANTIDAD: row.cantidad,
        DOSIS: row.dosis,
        FECHA_ASIGNACION: row.fecha_asignacion,
        FECHA_FINAL_VIGENCIA: row.fecha_final_vigencia,
        ESTADO_AUTORIZACION: row.estado_autorizacion,
        'No.PRESCRIPCION': row.no_prescripcion,
        id: row.id,
        authorization_key: row.authorization_key,
        enablement_status: row.enablement_status,
        coverage_type: row.coverage_type,
        direction_status: row.direction_status,
        operation_status: row.operation_status,
        tariff_membership_status: row.tariff_membership_status,
        lugar_dispensacion: row.lugar_dispensacion,
        fecha_dispensacion: row.fecha_dispensacion,
        fecha_aplicacion: row.fecha_aplicacion,
        audit_status: row.audit_status,
        admission_status: row.admission_status,
        application_site_status:
          row.lugar_dispensacion === null || row.lugar_dispensacion === ''
            ? 'PENDIENTE_ASIGNACION'
            : 'ASIGNADO',
        operational_version: row.operational_version,
        version: row.version,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
        resultado_validacion: row.operation_status ?? 'PENDIENTE_DE_VALIDACION',
        causal: causalCodes.join(';'),
        detalle_novedad: detalle,
      };
    });
    const filename = 'eps-novedades';
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
      XLSX.utils.book_append_sheet(book, sheet, 'eps-novedades');
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
    rowCount: number;
    columns: readonly string[];
    result: 'SUCCESS' | 'DENIED' | 'FAILED';
  }): Promise<void> {
    await this.database.pool.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
       values ('USER', $1, $2, 'EPS_NOVEDADES_EXPORT_CREATED', 'eps_export', $3, $4::jsonb, $5, $6, $7)`,
      [
        input.scope.userId,
        input.scope.organizationId,
        `eps-novedades:${input.format}`,
        JSON.stringify({
          export: 'eps-novedades',
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

export class ForbiddenEpsExportError extends Error {
  constructor() {
    super('Solo MTD puede descargar la base de novedades EPS.');
    this.name = 'ForbiddenEpsExportError';
  }
}

export type { EpsNovedadesExportQuery };
