import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  noveltyListQuerySchema,
  type NoveltyListItem,
  type NoveltyListQuery,
} from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';
import { createXlsxExport } from '../common/xlsx-export';

type Database = ReturnType<typeof createDatabase>;

type NoveltyRow = {
  id: string;
  authorization_item_id: string | null;
  authorization_key: string | null;
  numero_autorizacion: string | null;
  identificacion_paciente: string | null;
  codigo_producto: string | null;
  code: string;
  error_type: string;
  stage: string;
  field: string | null;
  received_value: string | null;
  description: string;
  active: boolean;
  attempt_count: number;
  attempt_number: number;
  import_batch_id: string | null;
  bulk_update_batch_id: string | null;
  tariff_annex_import_id: string | null;
  source_row_number: number | null;
  processed_at: Date;
  original_row: Record<string, unknown>;
};

const EXPORT_DIAGNOSTIC_COLUMNS = [
  'ESTADO_PROCESAMIENTO',
  'ETAPA_ERROR',
  'CODIGO_ERROR',
  'TIPO_ERROR',
  'DESCRIPCION_ERROR',
] as const;

function buildWhere(input: {
  query: NoveltyListQuery;
  scope: Scope;
  values: unknown[];
}): string {
  const { query, scope, values } = input;
  const clauses: string[] = [];
  if (query.status === 'PENDIENTE' || query.status === undefined) {
    clauses.push('n.active = true');
  } else {
    clauses.push('n.active = false');
  }
  if (scope.organizationCode !== 'MTD') {
    values.push(scope.organizationId);
    clauses.push(
      `(
        (i.id is not null and exists (select 1 from authorization_item_organizations aio
          where aio.authorization_item_id = i.id and aio.organization_id = $${values.length}))
        or (i.id is null and (
          exists (select 1 from import_batches ib where ib.id = n.import_batch_id and ib.organization_id = $${values.length})
          or exists (select 1 from bulk_update_batches bb where bb.id = n.bulk_update_batch_id and bb.organization_id = $${values.length})
          or exists (select 1 from tariff_annex_imports ti where ti.id = n.tariff_annex_import_id and ti.organization_id = $${values.length})
        ))
      )`,
    );
  }
  if (query.code) {
    values.push(query.code);
    clauses.push(`n.code = $${values.length}`);
  }
  if (query.stage) {
    values.push(query.stage.toUpperCase());
    clauses.push(`upper(n.stage) = $${values.length}`);
  }
  if (query.errorType) {
    values.push(query.errorType);
    clauses.push(`c.error_type = $${values.length}`);
  }
  if (query.batchId) {
    values.push(query.batchId);
    clauses.push(
      `(n.import_batch_id = $${values.length} or n.bulk_update_batch_id = $${values.length} or n.tariff_annex_import_id = $${values.length})`,
    );
  }
  if (query.authorization) {
    values.push(query.authorization.trim());
    clauses.push(
      `(i.authorization_key = $${values.length} or i.numero_autorizacion = upper(btrim($${values.length}))
        or lower(regexp_replace(btrim(coalesce(n.original_row->>'NUMERO_AUTORIZACION', '')), '\\s+', ' ', 'g')) = lower(btrim($${values.length})))`,
    );
  }
  if (query.document) {
    values.push(query.document.trim());
    clauses.push(
      `(i.source_data->>'IDENTIFICACION_PACIENTE' = $${values.length}
        or coalesce(n.original_row->>'IDENTIFICACION_PACIENTE', n.original_row->>'NUM_DOCUMENTO') = $${values.length})`,
    );
  }
  return clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';
}

const SELECT_BODY = `
  select n.id, n.authorization_item_id, n.code, n.stage, n.field, n.received_value,
          n.description, n.active, n.import_batch_id, n.bulk_update_batch_id, n.tariff_annex_import_id,
          n.source_row_number, n.processed_at, n.original_row, n.attempt_number,
         c.error_type,
         i.authorization_key, i.numero_autorizacion,
         i.source_data->>'IDENTIFICACION_PACIENTE' as identificacion_paciente,
         i.codigo_medicamento as codigo_producto,
          count(*) over (partition by n.code, coalesce(
            n.authorization_item_id::text,
            lower(regexp_replace(btrim(coalesce(n.original_row->>'NUMERO_AUTORIZACION', '')), '\\s+', ' ', 'g')) || '|' ||
            lower(regexp_replace(btrim(coalesce(n.original_row->>'CODIGO_COMERCIAL', n.original_row->>'COD_COMERCIAL', '')), '\\s+', ' ', 'g')))
          ) as attempt_count
    from novelties n
    inner join novelty_codes c on c.code = n.code
    left join authorization_items i on i.id = n.authorization_item_id`;

@Injectable()
export class NoveltiesService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async list(rawQuery: unknown, scope: Scope): Promise<{ items: NoveltyListItem[] }> {
    const query = noveltyListQuerySchema.parse(rawQuery);
    const values: unknown[] = [];
    const where = buildWhere({ query, scope, values });
    values.push(query.limit);
    const result = await this.database.pool.query<NoveltyRow>(
      `${SELECT_BODY} ${where} order by n.processed_at desc, n.id desc limit $${values.length}`,
      values,
    );
    return { items: result.rows.map((row) => this.toItem(row)) };
  }

  async exportXlsx(rawQuery: unknown, scope: Scope): Promise<{ filename: string; content: Buffer }> {
    const query = noveltyListQuerySchema.parse(rawQuery);
    const values: unknown[] = [];
    const where = buildWhere({ query, scope, values });
    const limit = 50_000;
    values.push(limit);
    const result = await this.database.pool.query<NoveltyRow>(
      `${SELECT_BODY} ${where} order by n.import_batch_id nulls last, n.bulk_update_batch_id nulls last,
               n.source_row_number nulls first, n.processed_at asc, n.id asc limit $${values.length}`,
      values,
    );
    const sourceKeys: string[] = [];
    const seen = new Set<string>();
    for (const row of result.rows) {
      for (const key of Object.keys(row.original_row ?? {})) {
        if (!seen.has(key)) {
          seen.add(key);
          sourceKeys.push(key);
        }
      }
    }
    const headers = ['LLAVE', 'ID_NOVEDAD', 'ID_LOTE', ...sourceKeys, ...EXPORT_DIAGNOSTIC_COLUMNS];
    const rows: Record<string, unknown>[] = [];
    for (const row of result.rows) {
      const batchId = row.import_batch_id ?? row.bulk_update_batch_id ?? row.tariff_annex_import_id ?? '';
      rows.push({
        LLAVE: row.authorization_key ?? '',
        ID_NOVEDAD: row.id,
        ID_LOTE: batchId,
        ...Object.fromEntries(sourceKeys.map((key) => [key, row.original_row?.[key] ?? ''])),
        ESTADO_PROCESAMIENTO: row.active ? 'PENDIENTE' : 'RESUELTO',
        ETAPA_ERROR: row.stage,
        CODIGO_ERROR: row.code,
        TIPO_ERROR: row.error_type,
        DESCRIPCION_ERROR: row.description,
      });
    }
    await this.database.pool.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, before, after, correlation_id, request_id, result)
       values ('USER', $1, $2, 'NOVELTIES_EXPORT_CREATED', 'novelties', 'bandeja', $3::jsonb, $4::jsonb, $5, $6, 'SUCCESS')`,
      [
        scope.userId,
        scope.organizationId,
        JSON.stringify(query),
        JSON.stringify({ rowCount: result.rows.length, truncated: result.rows.length >= limit }),
        scope.correlationId,
        scope.correlationId,
      ],
    );
    const hash = createHash('sha256').update(scope.correlationId).digest('hex').slice(0, 12);
    return {
      filename: `novedades-${hash}.xlsx`,
      content: createXlsxExport(headers, rows),
    };
  }

  private toItem(row: NoveltyRow): NoveltyListItem {
    return {
      id: row.id,
      authorizationItemId: row.authorization_item_id,
      authorizationKey: row.authorization_key,
      numeroAutorizacion: row.numero_autorizacion,
      identificacionPaciente: row.identificacion_paciente,
      codigoProducto: row.codigo_producto,
      code: row.code,
      errorType: row.error_type as NoveltyListItem['errorType'],
      stage: row.stage,
      field: row.field,
      receivedValue: row.received_value,
      description: row.description,
      status: row.active ? 'PENDIENTE' : 'RESUELTO',
      attemptNumber: row.attempt_number,
      attemptCount: Number(row.attempt_count),
      importBatchId: row.import_batch_id,
      bulkUpdateBatchId: row.bulk_update_batch_id,
      tariffAnnexImportId: row.tariff_annex_import_id,
      sourceRowNumber: row.source_row_number,
      processedAt: row.processed_at.toISOString(),
    };
  }
}
