import { randomUUID } from 'node:crypto';
import {
  requiredTariffImportColumns,
  tariffImportJobSchema,
  type TariffImportJob,
} from '@authorization/contracts';
import { isValidTariffProductCode } from '@authorization/domain';
import type { createDatabase } from '@authorization/database';
import {
  parseTariffImportFile,
  TariffFileError,
} from './tariff-import-parser';

type Database = ReturnType<typeof createDatabase>;

type ProductRow = {
  id: string;
  codigo_producto: string;
  active: boolean;
  version: number;
  source_data: unknown;
};

type TariffRowResultCode =
  | 'PRODUCT_CREATED'
  | 'PRODUCT_REACTIVATED'
  | 'PRODUCT_EXISTING'
  | 'INVALID_PRODUCT_CODE'
  | 'DUPLICATE_IN_FILE'
  | 'INVALID_FILE_FORMAT'
  | 'PROCESSING_ERROR';

export type TariffImportProcessingResult = Readonly<{
  batchId: string;
  status: 'COMPLETADO' | 'FALLIDO' | 'DEDUPLICADO' | 'OMITIDO';
  skipReason?: string;
  totalRows: number;
  createdRows: number;
  reactivatedRows: number;
  existingRows: number;
  rejectedRows: number;
  duplicateRows: number;
}>;

/**
 * SPEC-014 §5-6: procesamiento idempotente del cargue masivo del Anexo
 * Tarifario. Valida por fila con códigos estables, es idempotente (cargar dos
 * veces el mismo archivo no duplica productos) y emite, en la misma
 * transacción, los eventos de revalidación de los productos creados o
 * reactivados.
 */
export class TariffImportProcessor {
  constructor(private readonly database: Database) {}

  async process(rawJob: TariffImportJob): Promise<TariffImportProcessingResult> {
    const job = tariffImportJobSchema.parse(rawJob);
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const batchResult = await client.query<{
        id: string;
        organization_id: string;
        created_by: string;
        status: string;
        correlation_id: string;
      }>(
        `select id, organization_id, created_by, status, correlation_id
         from tariff_annex_imports where id = $1 for update`,
        [job.payload.batchId],
      );
      const batch = batchResult.rows[0];
      if (!batch) {
        await client.query('commit');
        return this.summary(job.payload.batchId, 'OMITIDO', 'BATCH_NOT_FOUND');
      }
      if (batch.status === 'COMPLETADO' || batch.status === 'FALLIDO') {
        // Reintento sobre un lote terminal: sin nuevos efectos.
        const persisted = await client.query<{
          total_rows: number;
          created_rows: number;
          reactivated_rows: number;
          existing_rows: number;
          rejected_rows: number;
          duplicate_rows: number;
        }>(
          `select total_rows, created_rows, reactivated_rows, existing_rows, rejected_rows, duplicate_rows
           from tariff_annex_imports where id = $1`,
          [batch.id],
        );
        const totals = persisted.rows[0];
        await client.query('commit');
        return {
          batchId: batch.id,
          status: batch.status,
          totalRows: Number(totals?.total_rows ?? 0),
          createdRows: Number(totals?.created_rows ?? 0),
          reactivatedRows: Number(totals?.reactivated_rows ?? 0),
          existingRows: Number(totals?.existing_rows ?? 0),
          rejectedRows: Number(totals?.rejected_rows ?? 0),
          duplicateRows: Number(totals?.duplicate_rows ?? 0),
        };
      }
      if (batch.status !== 'CARGADO') {
        await client.query('commit');
        return this.summary(batch.id, 'OMITIDO', 'BATCH_NOT_PROCESSABLE');
      }

      await client.query(
        `update tariff_annex_imports set status = 'VALIDANDO', started_at = now() where id = $1`,
        [batch.id],
      );
      const source = await client.query<{ content: Buffer | null }>(
        `select content from tariff_annex_import_source_files where import_id = $1`,
        [batch.id],
      );
      const content = source.rows[0]?.content;
      if (!content) {
        await this.failBatch(client, batch.id, 'INVALID_FILE_FORMAT');
        await client.query('commit');
        return this.summary(batch.id, 'FALLIDO', 'INVALID_FILE_FORMAT');
      }

      let parsed: ReturnType<typeof parseTariffImportFile>;
      const batchMeta = await client.query<{ original_filename: string; mime_type: string }>(
        `select original_filename, mime_type from tariff_annex_imports where id = $1`,
        [batch.id],
      );
      try {
        parsed = parseTariffImportFile(
          content,
          batchMeta.rows[0]?.original_filename ?? '',
          batchMeta.rows[0]?.mime_type ?? '',
          requiredTariffImportColumns,
        );
      } catch (e) {
        if (e instanceof TariffFileError) {
          await this.failBatch(client, batch.id, e.code);
          await client.query('commit');
          return this.summary(batch.id, 'FALLIDO', e.code);
        }
        await this.failBatch(client, batch.id, 'INVALID_FILE_FORMAT');
        await client.query('commit');
        return this.summary(batch.id, 'FALLIDO', 'INVALID_FILE_FORMAT');
      }

      const results = new Map<number, { code: TariffRowResultCode; productId: string | null; codigo: string | null }>();
      const seenCodes = new Map<string, number>();
      let createdRows = 0;
      let reactivatedRows = 0;
      let existingRows = 0;
      let rejectedRows = 0;
      let duplicateRows = 0;

      for (const row of parsed.rows) {
        const codigo = row.codigoProducto;
        if (!codigo) {
          results.set(row.rowNumber, { code: 'INVALID_PRODUCT_CODE', productId: null, codigo: null });
          rejectedRows += 1;
          continue;
        }
        if (seenCodes.has(codigo)) {
          results.set(row.rowNumber, { code: 'DUPLICATE_IN_FILE', productId: null, codigo });
          duplicateRows += 1;
          continue;
        }
        seenCodes.set(codigo, row.rowNumber);
        const outcome = await this.upsertProduct(client, {
          codigo,
          sourceData: row.rawData,
          actorId: batch.created_by,
          organizationId: batch.organization_id,
          correlationId: batch.correlation_id,
        });
        results.set(row.rowNumber, { code: outcome.resultCode, productId: outcome.productId, codigo });
        if (outcome.resultCode === 'PRODUCT_CREATED') createdRows += 1;
        else if (outcome.resultCode === 'PRODUCT_REACTIVATED') reactivatedRows += 1;
        else existingRows += 1;
      }

      for (const row of parsed.rows) {
        const outcome = results.get(row.rowNumber);
        if (!outcome) continue;
        const message = tariffRowMessages[outcome.code];
        await client.query(
          `insert into tariff_annex_import_rows
             (import_id, row_number, raw_data, codigo_producto, result_code, result_message, product_id)
           values ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
          [
            batch.id,
            row.rowNumber,
            JSON.stringify(row.rawData),
            outcome.codigo,
            outcome.code,
            message,
            outcome.productId,
          ],
        );
      }

      await client.query(
        `update tariff_annex_imports
         set status = 'COMPLETADO', total_rows = $2, created_rows = $3, reactivated_rows = $4,
             existing_rows = $5, rejected_rows = $6, duplicate_rows = $7, completed_at = now()
         where id = $1`,
        [
          batch.id,
          parsed.rows.length,
          createdRows,
          reactivatedRows,
          existingRows,
          rejectedRows,
          duplicateRows,
        ],
      );
      await client.query(
        `insert into audit_events
           (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
         values ('USER', $1, $2, 'TARIFF_ANNEX_IMPORTED', 'tariff_annex_import', $3, $4::jsonb, $5, $6, 'SUCCESS')`,
        [
          batch.created_by,
          batch.organization_id,
          batch.id,
          JSON.stringify({
            totalRows: parsed.rows.length,
            createdRows,
            reactivatedRows,
            existingRows,
            rejectedRows,
            duplicateRows,
            idempotencyKey: job.idempotencyKey,
          }),
          job.correlationId,
          job.correlationId,
        ],
      );
      await client.query(
        `update tariff_annex_import_source_files set content = null, processed_at = now() where import_id = $1`,
        [batch.id],
      );
      await client.query('commit');
      return {
        batchId: batch.id,
        status: 'COMPLETADO',
        totalRows: parsed.rows.length,
        createdRows,
        reactivatedRows,
        existingRows,
        rejectedRows,
        duplicateRows,
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertProduct(
    client: {
      query: (query: string, values?: unknown[]) => Promise<{ rows: ProductRow[]; rowCount?: number | null }>;
    },
    input: {
      codigo: string;
      sourceData: Record<string, unknown>;
      actorId: string;
      organizationId: string;
      correlationId: string;
    },
  ): Promise<{ resultCode: TariffRowResultCode; productId: string | null }> {
    if (!isValidTariffProductCode(input.codigo)) {
      return { resultCode: 'INVALID_PRODUCT_CODE', productId: null };
    }
    const inserted = await client.query(
      `insert into tariff_annex_products (codigo_producto, active, organization_id, created_by, updated_by, source_data)
       values ($1, true, $2, $3, $3, $4::jsonb)
       on conflict (codigo_producto) do nothing
       returning id, codigo_producto, active, version, source_data`,
      [input.codigo, input.organizationId, input.actorId, JSON.stringify(input.sourceData)],
    );
    let product = inserted.rows[0];
    if (product) {
      await this.insertProductAudit(client, {
        actorId: input.actorId,
        organizationId: input.organizationId,
        action: 'TARIFF_PRODUCT_CREATED',
        product,
        after: { codigoProducto: product.codigo_producto, active: true, version: product.version },
        correlationId: input.correlationId,
      });
      await this.enqueueRevalidation(client, {
        product,
        actorId: input.actorId,
        organizationId: input.organizationId,
        correlationId: input.correlationId,
      });
      return { resultCode: 'PRODUCT_CREATED', productId: product.id };
    }
    const existing = await client.query(
      `select id, codigo_producto, active, version, source_data from tariff_annex_products where codigo_producto = $1 for update`,
      [input.codigo],
    );
    const current: ProductRow | undefined = existing.rows[0];
    if (!current) {
      return { resultCode: 'PROCESSING_ERROR', productId: null };
    }
    if (current.active) {
      return { resultCode: 'PRODUCT_EXISTING', productId: current.id };
    }
    const reactivated = await client.query(
      `update tariff_annex_products
       set active = true, version = version + 1, updated_by = $2, organization_id = $3, updated_at = now(),
           source_data = $4::jsonb
       where id = $1
       returning id, codigo_producto, active, version, source_data`,
      [current.id, input.actorId, input.organizationId, JSON.stringify(input.sourceData)],
    );
    product = reactivated.rows[0];
    if (!product) return { resultCode: 'PROCESSING_ERROR', productId: null };
    await this.insertProductAudit(client, {
      actorId: input.actorId,
      organizationId: input.organizationId,
      action: 'TARIFF_PRODUCT_UPDATED',
      product,
      before: { codigoProducto: current.codigo_producto, active: false, version: current.version },
      after: { codigoProducto: product.codigo_producto, active: true, version: product.version },
      correlationId: input.correlationId,
    });
    await this.enqueueRevalidation(client, {
      product,
      actorId: input.actorId,
      organizationId: input.organizationId,
      correlationId: input.correlationId,
    });
    return { resultCode: 'PRODUCT_REACTIVATED', productId: product.id };
  }

  private async enqueueRevalidation(
    client: {
      query: (query: string, values?: unknown[]) => Promise<unknown>;
    },
    input: { product: ProductRow; actorId: string; organizationId: string; correlationId: string },
  ): Promise<void> {
    const idempotencyKey = `tariff-reval:${input.product.id}:${input.product.version}`.slice(0, 200);
    const eventId = randomUUID();
    const payload = {
      eventId,
      tariffProductId: input.product.id,
      codigoProducto: input.product.codigo_producto,
      actorId: input.actorId,
      correlationId: input.correlationId,
      idempotencyKey,
    };
    await client.query(
      `insert into outbox_events
         (id, event_type, version, payload, correlation_id, organization_id, idempotency_key)
       values ($1, 'tariff.product.activated', 1, $2::jsonb, $3, $4, $5)
       on conflict (idempotency_key) do nothing`,
      [
        eventId,
        JSON.stringify(payload),
        input.correlationId,
        input.organizationId,
        idempotencyKey,
      ],
    );
  }

  private async insertProductAudit(
    client: { query: (query: string, values?: unknown[]) => Promise<unknown> },
    input: {
      actorId: string;
      organizationId: string;
      action: string;
      product: ProductRow;
      before?: Record<string, unknown>;
      after: Record<string, unknown>;
      correlationId: string;
    },
  ): Promise<void> {
    await client.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, before, after, correlation_id, request_id, result)
       values ('USER', $1, $2, $3, 'tariff_annex_product', $4, $5::jsonb, $6::jsonb, $7, $8, 'SUCCESS')`,
      [
        input.actorId,
        input.organizationId,
        input.action,
        input.product.id,
        JSON.stringify(input.before ?? null),
        JSON.stringify({
          ...input.after,
          codigoProducto: input.product.codigo_producto,
          resourceVersion: input.product.version,
        }),
        input.correlationId,
        input.correlationId,
      ],
    );
  }

  private async failBatch(
    client: { query: (query: string, values?: unknown[]) => Promise<unknown> },
    batchId: string,
    errorCode: string,
  ): Promise<void> {
    await client.query(
      `update tariff_annex_imports set status = 'FALLIDO', last_error_code = $2, completed_at = now() where id = $1`,
      [batchId, errorCode],
    );
  }

  private summary(
    batchId: string,
    status: TariffImportProcessingResult['status'],
    skipReason?: string,
  ): TariffImportProcessingResult {
    const base = {
      batchId,
      status,
      totalRows: 0,
      createdRows: 0,
      reactivatedRows: 0,
      existingRows: 0,
      rejectedRows: 0,
      duplicateRows: 0,
    };
    return skipReason === undefined ? base : { ...base, skipReason };
  }
}

const tariffRowMessages: Record<TariffRowResultCode, string> = {
  PRODUCT_CREATED: 'Producto agregado al Anexo Tarifario.',
  PRODUCT_REACTIVATED: 'Producto reactivado en el Anexo Tarifario.',
  PRODUCT_EXISTING: 'Ya se encontraba registrado y activo.',
  INVALID_PRODUCT_CODE: 'Código de producto obligatorio o con formato inválido.',
  DUPLICATE_IN_FILE: 'Código repetido dentro del archivo.',
  INVALID_FILE_FORMAT: 'Estructura de archivo inválida.',
  PROCESSING_ERROR: 'No fue posible procesar la fila.',
};
