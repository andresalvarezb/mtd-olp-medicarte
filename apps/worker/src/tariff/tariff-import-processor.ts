import { randomUUID } from 'node:crypto';
import {
  tariffImportJobSchema,
  tariffImportRowResultMessages,
  type TariffImportJob,
} from '@authorization/contracts';
import {
  isValidTariffProductCode,
  normalizeTariffProductCode,
  noveltyForTariffImportResult,
} from '@authorization/domain';
import {
  insertNovelty,
  resolveNovelties,
  tariffNoveltyLogicalKey,
  tariffNoveltyLogicalKeyPrefix,
  type createDatabase,
} from '@authorization/database';
import { canonicalizeTariffMoney, parseTariffImportFile, previewTariffRows, TariffFileError } from './tariff-import-parser';

type Database = ReturnType<typeof createDatabase>;

type ProductRow = {
  id: string;
  codigo_producto: string;
  active: boolean;
  version: number;
  tarifa_unidad?: string | null;
  numero_expediente_invima?: string | null;
  consecutivo_invima_presentacion?: string | null;
  descripcion_generica?: string | null;
  descripcion_comercial?: string | null;
  laboratorio?: string | null;
  tipo_inclusion?: string | null;
};

type ProductCommercialInput = {
  tarifaUnidad: string | null;
  numeroExpedienteInvima: string | null;
  consecutivoInvimaPresentacion: string | null;
  descripcionGenerica: string | null;
  descripcionComercial: string | null;
  laboratorio: string | null;
  tipoInclusion: string | null;
};

function commercialSnapshotFromInput(input: ProductCommercialInput): Record<string, string | null> {
  return {
    tarifaUnidad: input.tarifaUnidad,
    numeroExpedienteInvima: input.numeroExpedienteInvima,
    consecutivoInvimaPresentacion: input.consecutivoInvimaPresentacion,
    descripcionGenerica: input.descripcionGenerica,
    descripcionComercial: input.descripcionComercial,
    laboratorio: input.laboratorio,
    tipoInclusion: input.tipoInclusion,
  };
}

function commercialSnapshot(row: ProductRow): Record<string, string | null> {
  return {
    tarifaUnidad: row.tarifa_unidad ?? null,
    numeroExpedienteInvima: row.numero_expediente_invima ?? null,
    consecutivoInvimaPresentacion: row.consecutivo_invima_presentacion ?? null,
    descripcionGenerica: row.descripcion_generica ?? null,
    descripcionComercial: row.descripcion_comercial ?? null,
    laboratorio: row.laboratorio ?? null,
    tipoInclusion: row.tipo_inclusion ?? null,
  };
}

function commercialColumnsEqual(
  current: {
    tarifa_unidad?: string | null;
    numero_expediente_invima?: string | null;
    consecutivo_invima_presentacion?: string | null;
    descripcion_generica?: string | null;
    descripcion_comercial?: string | null;
    laboratorio?: string | null;
    tipo_inclusion?: string | null;
  },
  input: ProductCommercialInput,
): boolean {
  return (
    current.tarifa_unidad === input.tarifaUnidad &&
    current.numero_expediente_invima === input.numeroExpedienteInvima &&
    current.consecutivo_invima_presentacion === input.consecutivoInvimaPresentacion &&
    current.descripcion_generica === input.descripcionGenerica &&
    current.descripcion_comercial === input.descripcionComercial &&
    current.laboratorio === input.laboratorio &&
    current.tipo_inclusion === input.tipoInclusion
  );
}

function sourceValue(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  const text =
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? `${value}`
      : (JSON.stringify(value) ?? '');
  return text.trim() || null;
}

type TariffRowResultCode = keyof typeof tariffImportRowResultMessages;

export type TariffImportProcessingResult = Readonly<{
  batchId: string;
  status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
  skipReason?: string;
  totalRows: number;
  createdRows: number;
  reactivatedRows: number;
  existingRows: number;
  rejectedRows: number;
  duplicateRows: number;
}>;

/**
 * SPEC-014: procesamiento idempotente del cargue masivo del Anexo Tarifario.
 * Valida por fila con códigos estables (una fila inválida no impide procesar
 * las demás), no duplica productos al repetir el mismo archivo y emite, en la
 * misma transacción, los eventos de revalidación de los productos creados o
 * reactivados. El archivo más recientemente cargado es la fuente autoritativa:
 * si el producto ya existe y sus valores cambian, se actualizan los campos
 * comerciales (versión +1, auditoría y revalidación); si coinciden, el
 * producto queda intacto (sin incremento de versión).
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
        original_filename: string;
        mime_type: string;
      }>(
        `select id, organization_id, created_by, status, correlation_id, original_filename, mime_type
         from tariff_annex_imports where id = $1 for update`,
        [job.payload.batchId],
      );
      const batch = batchResult.rows[0];
      if (!batch) {
        await client.query('commit');
        return this.summary(job.payload.batchId, 'SKIPPED', 'BATCH_NOT_FOUND');
      }
      if (batch.status !== 'CONFIRMING' && batch.status !== 'COMPLETED' && batch.status !== 'FAILED') {
        await client.query('commit');
        return this.summary(batch.id, 'SKIPPED', 'BATCH_NOT_CONFIRMED');
      }
      if (batch.status === 'COMPLETED' || batch.status === 'FAILED') {
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
      await client.query(
        `update tariff_annex_imports set status = 'VALIDATING', started_at = now() where id = $1`,
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
        return this.summary(batch.id, 'FAILED', 'INVALID_FILE_FORMAT');
      }

      let parsed: ReturnType<typeof parseTariffImportFile>;
      try {
        parsed = parseTariffImportFile(content, batch.original_filename, batch.mime_type);
      } catch (error) {
        const code =
          error instanceof TariffFileError ? error.code : ('INVALID_FILE_FORMAT' as const);
        await this.failBatch(client, batch.id, code);
        await client.query('commit');
        return this.summary(batch.id, 'FAILED', code);
      }

      const results = new Map<
        number,
        { code: TariffRowResultCode; productId: string | null; codigo: string | null }
      >();
      const seenCodes = new Map<string, number>();
      let createdRows = 0;
      let reactivatedRows = 0;
      let existingRows = 0;
      let rejectedRows = 0;
      let duplicateRows = 0;

      const activeProducts = await client.query<{ codigo_producto: string; tarifa_unidad: string | null }>(
        `select codigo_producto, tarifa_unidad from tariff_annex_products where active = true`,
      );
      const preview = previewTariffRows(parsed.rows, new Map(activeProducts.rows.map((row) => [row.codigo_producto, row.tarifa_unidad])));
      if (preview.anomalous > 0 && !job.payload.overrideReason) {
        await this.failBatch(client, batch.id, 'TARIFF_SCALE_ANOMALY_REQUIRES_OVERRIDE');
        await client.query(
          `insert into audit_events (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
           values ('USER', $1, $2, 'TARIFF_IMPORT_ANOMALY_BLOCKED', 'tariff_annex_import', $3, $4::jsonb, $5, $6, 'BLOCKED')`,
          [batch.created_by, batch.organization_id, batch.id, JSON.stringify(preview), batch.correlation_id, batch.correlation_id],
        );
        await client.query('commit');
        return this.summary(batch.id, 'FAILED', 'TARIFF_SCALE_ANOMALY_REQUIRES_OVERRIDE');
      }
      if (preview.anomalous > 0 && job.payload.overrideReason) {
        await client.query(
          `insert into audit_events (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
           values ('USER', $1, $2, 'TARIFF_IMPORT_ANOMALY_OVERRIDE', 'tariff_annex_import', $3, $4::jsonb, $5, $6, 'SUCCESS')`,
          [batch.created_by, batch.organization_id, batch.id, JSON.stringify({ preview, reason: job.payload.overrideReason }), batch.correlation_id, batch.correlation_id],
        );
      }

      for (const row of parsed.rows) {
        const codigo = row.codigoProducto;
        if (!isValidTariffProductCode(codigo)) {
          results.set(row.rowNumber, {
            code: 'INVALID_PRODUCT_CODE',
            productId: null,
            codigo: codigo || null,
          });
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
           tarifaUnidad: canonicalizeTariffMoney(row.rawData.TARIFA_UNIDAD).raw,
          numeroExpedienteInvima: sourceValue(row.rawData, 'NUMERO_EXPEDIENTE_INVIMA'),
          consecutivoInvimaPresentacion: sourceValue(
            row.rawData,
            'CONSECUTIVO_INVIMA_PRESENTACION',
          ),
          descripcionGenerica: sourceValue(row.rawData, 'DESCRIPCION_GENERICA_MEDICAMENTO'),
          descripcionComercial: sourceValue(row.rawData, 'DESCRIPCION_COMERCIAL_MEDICAMENTO'),
          laboratorio: sourceValue(row.rawData, 'LABORATORIO_MEDICAMENTO'),
          tipoInclusion: sourceValue(row.rawData, 'TIPO_INCLUSION_MEDICAMENTO'),
          actorId: batch.created_by,
          organizationId: batch.organization_id,
           correlationId: batch.correlation_id,
           importId: batch.id,
           ...(job.payload.overrideReason ? { overrideReason: job.payload.overrideReason } : {}),
        });
        results.set(row.rowNumber, {
          code: outcome.resultCode,
          productId: outcome.productId,
          codigo,
        });
        if (outcome.resultCode === 'PRODUCT_CREATED') createdRows += 1;
        else if (outcome.resultCode === 'PRODUCT_REACTIVATED') reactivatedRows += 1;
        else existingRows += 1;
      }

      for (const row of parsed.rows) {
        const outcome = results.get(row.rowNumber);
        if (!outcome) continue;
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
            tariffImportRowResultMessages[outcome.code],
            outcome.productId,
          ],
        );
        const novelty = noveltyForTariffImportResult(outcome.code);
        if (novelty) {
          // Identidad de negocio por producto normalizado cuando existe;
          // sin producto válido la identidad es técnica (lote + fila).
          const productForIdentity = outcome.codigo
            ? normalizeTariffProductCode(outcome.codigo)
            : '';
          await insertNovelty(client, {
            tariffAnnexImportId: batch.id,
            sourceRowNumber: row.rowNumber,
            originalRow: row.rawData,
            code: novelty.code,
            stage: novelty.stage,
            field:
              outcome.code === 'INVALID_PRODUCT_CODE' ? 'CODIGO_PRODUCTO' : (novelty.field ?? null),
            receivedValue: outcome.codigo ?? null,
            description: tariffImportRowResultMessages[outcome.code],
            actorId: batch.created_by,
            correlationId: batch.correlation_id,
            logicalKey: productForIdentity
              ? tariffNoveltyLogicalKey({
                  organizationId: batch.organization_id,
                  normalizedProductCode: productForIdentity,
                  code: novelty.code,
                  stage: novelty.stage,
                  field:
                    outcome.code === 'INVALID_PRODUCT_CODE'
                      ? 'CODIGO_PRODUCTO'
                      : (novelty.field ?? null),
                })
              : null,
          });
        } else {
          // TASK-NOV-001: la carga exitosa del producto resuelve únicamente
          // las novedades técnicas previas de ese mismo producto; un producto
          // ausente del archivo conserva su novedad pendiente.
          const productForIdentity = outcome.codigo
            ? normalizeTariffProductCode(outcome.codigo)
            : '';
          if (productForIdentity) {
            await resolveNovelties(client, {
              logicalKeyPrefix: tariffNoveltyLogicalKeyPrefix({
                organizationId: batch.organization_id,
                normalizedProductCode: productForIdentity,
              }),
              reason: `TARIFF_PRODUCT_AVAILABLE:${outcome.code}`,
              actorType: 'SYSTEM',
              actorId: batch.created_by,
              correlationId: batch.correlation_id,
            });
          }
        }
      }

      await client.query(
        `update tariff_annex_imports
         set status = 'COMPLETED', total_rows = $2, created_rows = $3, reactivated_rows = $4,
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
         values ('USER', $1, $2, 'TARIFF_ANNEX_IMPORT_COMPLETED', 'tariff_annex_import', $3, $4::jsonb, $5, $6, 'SUCCESS')`,
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
        status: 'COMPLETED',
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
      query: (
        query: string,
        values?: unknown[],
      ) => Promise<{ rows: ProductRow[]; rowCount?: number | null }>;
    },
    input: {
      codigo: string;
      actorId: string;
      organizationId: string;
      correlationId: string;
      importId: string;
      overrideReason?: string;
    } & ProductCommercialInput,
  ): Promise<{ resultCode: TariffRowResultCode; productId: string | null }> {
    const inserted = await client.query(
      `insert into tariff_annex_products
         (codigo_producto, tarifa_unidad, tarifa_unidad_canonical, numero_expediente_invima, consecutivo_invima_presentacion,
          descripcion_generica, descripcion_comercial, laboratorio, tipo_inclusion,
          active, organization_id, created_by, updated_by)
        values ($1, $2, $3::numeric, $4, $5, $6, $7, $8, $9, true, $10, $11, $11)
       on conflict (codigo_producto) do nothing
       returning id, codigo_producto, active, version`,
      [
        input.codigo,
         input.tarifaUnidad,
         input.tarifaUnidad,
        input.numeroExpedienteInvima,
        input.consecutivoInvimaPresentacion,
        input.descripcionGenerica,
        input.descripcionComercial,
        input.laboratorio,
        input.tipoInclusion,
        input.organizationId,
        input.actorId,
      ],
    );
    const product = inserted.rows[0];
    if (product) {
      await this.insertProductAudit(client, {
        actorId: input.actorId,
        organizationId: input.organizationId,
        action: 'TARIFF_PRODUCT_CREATED',
        product,
        after: { codigoProducto: product.codigo_producto, active: true, version: product.version },
        correlationId: input.correlationId,
      });
      await this.insertTariffRevision(client, { product, input, revision: product.version });
      await this.enqueueRevalidation(client, {
        product,
        actorId: input.actorId,
        organizationId: input.organizationId,
        correlationId: input.correlationId,
      });
      return { resultCode: 'PRODUCT_CREATED', productId: product.id };
    }
    const existing = await client.query(
      `select id, codigo_producto, tarifa_unidad, numero_expediente_invima,
              consecutivo_invima_presentacion, descripcion_generica, descripcion_comercial,
              laboratorio, tipo_inclusion, active, version
         from tariff_annex_products where codigo_producto = $1 for update`,
      [input.codigo],
    );
    const current: ProductRow | undefined = existing.rows[0];
    if (!current) {
      return { resultCode: 'PROCESSING_ERROR', productId: null };
    }
    if (current.active && commercialColumnsEqual(current, input)) {
      return { resultCode: 'PRODUCT_EXISTING', productId: current.id };
    }
    const previous = current.tarifa_unidad ? Number(current.tarifa_unidad.replace(',', '.')) : null;
    const next = input.tarifaUnidad ? Number(input.tarifaUnidad.replace(',', '.')) : null;
    if (!input.overrideReason && previous && next && ((previous / next >= 900 && previous / next <= 1100) || (previous / next >= 0.0009 && previous / next <= 0.0011))) {
      throw new Error('TARIFF_SCALE_ANOMALY_REQUIRES_EXPLICIT_CONFIRMATION');
    }
    const commercialValues = [
      input.tarifaUnidad,
      input.numeroExpedienteInvima,
      input.consecutivoInvimaPresentacion,
      input.descripcionGenerica,
      input.descripcionComercial,
      input.laboratorio,
      input.tipoInclusion,
    ];
    const updated = await client.query(
       `update tariff_annex_products
        set tarifa_unidad = $2, tarifa_unidad_canonical = $3::numeric, numero_expediente_invima = $4,
            consecutivo_invima_presentacion = $5, descripcion_generica = $6,
            descripcion_comercial = $7, laboratorio = $8, tipo_inclusion = $9,
            active = true, version = version + 1, updated_by = $10, updated_at = now()
       where id = $1
       returning id, codigo_producto, active, version`,
       [current.id, input.tarifaUnidad, input.tarifaUnidad, ...commercialValues.slice(1), input.actorId],
    );
    const changed = updated.rows[0];
    if (!changed) return { resultCode: 'PROCESSING_ERROR', productId: null };
    const auditAction = current.active ? 'TARIFF_PRODUCT_UPDATED' : 'TARIFF_PRODUCT_ACTIVATED';
    await this.insertProductAudit(client, {
      actorId: input.actorId,
      organizationId: input.organizationId,
      action: auditAction,
      product: changed,
      before: {
        ...commercialSnapshot(current),
        active: current.active,
        version: current.version,
      },
      after: {
        ...commercialSnapshotFromInput(input),
        active: changed.active,
        version: changed.version,
      },
      correlationId: input.correlationId,
    });
    await this.insertTariffRevision(client, { product: changed, input, revision: changed.version });
    await this.enqueueRevalidation(client, {
      product: changed,
      actorId: input.actorId,
      organizationId: input.organizationId,
      correlationId: input.correlationId,
    });
    return {
      resultCode: current.active ? 'PRODUCT_EXISTING' : 'PRODUCT_REACTIVATED',
      productId: changed.id,
    };
  }

  private async enqueueRevalidation(
    client: {
      query: (query: string, values?: unknown[]) => Promise<unknown>;
    },
    input: {
      product: ProductRow;
      actorId: string;
      organizationId: string;
      correlationId: string;
    },
  ): Promise<void> {
    const idempotencyKey = `tariff-reval:${input.product.id}:${input.product.version}`.slice(
      0,
      200,
    );
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
      [eventId, JSON.stringify(payload), input.correlationId, input.organizationId, idempotencyKey],
    );
  }

  private async insertTariffRevision(
    client: { query: (query: string, values?: unknown[]) => Promise<unknown> },
    input: { product: ProductRow; input: ProductCommercialInput & { codigo?: string; actorId: string; importId: string }; revision: number },
  ): Promise<void> {
    await client.query(
      `insert into tariff_product_revisions
         (product_id,codigo_producto,revision,import_id,tarifa_unidad_raw,tarifa_unidad_canonical,tipo_inclusion,commercial_snapshot,valid_from,changed_by,provenance)
       values ($1,$2,$3,$4,$5,$6::numeric,$7,$8::jsonb,now(),$9,'IMPORT_PROCESSOR')
       on conflict (product_id,revision) do nothing`,
      [input.product.id, input.product.codigo_producto, input.revision, input.input.importId, input.input.tarifaUnidad, input.input.tarifaUnidad, input.input.tipoInclusion, JSON.stringify(commercialSnapshotFromInput(input.input)), input.input.actorId],
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
      `update tariff_annex_imports set status = 'FAILED', last_error_code = $2, completed_at = now() where id = $1`,
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
