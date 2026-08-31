import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  createTariffProductRequestSchema,
  paginatedTariffImportRowsResponseSchema,
  tariffImportRowResultMessages,
  tariffProductListQuerySchema,
  tariffAnnexRevalidationPayloadSchema,
  type CreateTariffProductRequest,
  type TariffImportBatchResponse,
  type TariffProductListQuery,
  type TariffProductResponse,
} from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';
import type { ApiConfig } from '@authorization/config';
import { API_CONFIG, DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';

type Database = ReturnType<typeof createDatabase>;

type ProductRow = {
  id: string;
  codigo_producto: string;
  active: boolean;
  version: number;
  created_by: string;
  source_data: unknown;
  created_at: Date;
  updated_at: Date;
};

type ImportBatchRow = {
  id: string;
  organization_id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  status: string;
  total_rows: number;
  created_rows: number;
  reactivated_rows: number;
  existing_rows: number;
  rejected_rows: number;
  duplicate_rows: number;
  last_error_code: string | null;
  created_at: Date;
  completed_at: Date | null;
};

type ImportRowQueryRow = {
  id: string;
  row_number: number;
  codigo_producto: string | null;
  result_code: string;
  result_message: string;
  product_id: string | null;
  created_at: Date;
};

type QueryableClient = {
  query: <T>(
    query: string,
    values?: unknown[],
  ) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

function parseUuid(value: string, field: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException({
      code: 'INVALID_IDENTIFIER',
      message: `${field} must be a UUID`,
    });
  }
  return value;
}

function requireMtd(scope: Scope): void {
  if (scope.organizationCode !== 'MTD') {
    throw new ForbiddenException({
      code: 'TARIFF_ANNEX_MTD_ONLY',
      message: 'El Anexo Tarifario solo puede administrarse desde MTD',
    });
  }
}

function encodeProductCursor(row: ProductRow): string {
  return Buffer.from(
    JSON.stringify({ createdAt: row.created_at.toISOString(), id: row.id }),
    'utf8',
  ).toString('base64url');
}

function decodeProductCursor(cursor: string | undefined): { createdAt: Date; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (
      typeof value.createdAt !== 'string' ||
      Number.isNaN(Date.parse(value.createdAt)) ||
      typeof value.id !== 'string'
    )
      throw new Error('invalid');
    return { createdAt: new Date(value.createdAt), id: parseUuid(value.id, 'cursor') };
  } catch {
    throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'Invalid pagination cursor' });
  }
}

function encodeRowCursor(rowNumber: number): string {
  return Buffer.from(JSON.stringify({ rowNumber }), 'utf8').toString('base64url');
}

function decodeRowCursor(cursor: string | undefined): number | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      rowNumber?: unknown;
    };
    if (
      typeof decoded.rowNumber !== 'number' ||
      !Number.isInteger(decoded.rowNumber) ||
      decoded.rowNumber < 1
    )
      throw new Error('invalid');
    return decoded.rowNumber;
  } catch {
    throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'Invalid pagination cursor' });
  }
}

function toProductResponse(row: ProductRow): TariffProductResponse {
  return {
    id: row.id,
    codigoProducto: row.codigo_producto,
    active: row.active,
    version: row.version,
    createdBy: row.created_by,
    sourceData:
      row.source_data && typeof row.source_data === 'object' && !Array.isArray(row.source_data)
        ? (row.source_data as Record<string, unknown>)
        : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toImportBatchResponse(row: ImportBatchRow): TariffImportBatchResponse {
  return {
    id: row.id,
    status: row.status as TariffImportBatchResponse['status'],
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    totalRows: row.total_rows,
    createdRows: row.created_rows,
    reactivatedRows: row.reactivated_rows,
    existingRows: row.existing_rows,
    rejectedRows: row.rejected_rows,
    duplicateRows: row.duplicate_rows,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * SPEC-014 / ADR-024: administración del Anexo Tarifario (organización MTD).
 * Toda mutación persiste auditoría inmutable y, cuando el producto se crea o
 * se reactiva, un evento outbox `tariff.product.activated` que dispara la
 * revalidación dirigida de autorizaciones (requerimiento 16).
 */
@Injectable()
export class TariffAnnexService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async list(input: {
    query: TariffProductListQuery;
    scope: Scope;
  }): Promise<{ items: TariffProductResponse[]; nextCursor: string | null }> {
    requireMtd(input.scope);
    const query = tariffProductListQuerySchema.parse(input.query);
    const cursor = decodeProductCursor(query.cursor);
    const values: unknown[] = [];
    const conditions: string[] = [];
    if (query.active) {
      values.push(query.active === 'true');
      conditions.push(`p.active = $${values.length}`);
    }
    if (query.codigo) {
      values.push(`%${escapeLikePattern(query.codigo)}%`);
      conditions.push(`p.codigo_producto ilike $${values.length} escape '\\'`);
    }
    if (cursor) {
      values.push(cursor.createdAt);
      conditions.push(`(p.created_at, p.id) < ($${values.length}::timestamptz, $${values.length + 1}::uuid)`);
      values.push(cursor.id);
    }
    values.push(query.limit + 1);
    const result = await this.database.pool.query<ProductRow>(
      `select p.id, p.codigo_producto, p.active, p.version, p.created_by, p.source_data, p.created_at, p.updated_at
       from tariff_annex_products p
       ${conditions.length ? `where ${conditions.join(' and ')}` : ''}
       order by p.created_at desc, p.id desc
       limit $${values.length}`,
      values,
    );
    const hasNext = result.rows.length > query.limit;
    const rows = hasNext ? result.rows.slice(0, query.limit) : result.rows;
    const last = rows.at(-1);
    return {
      items: rows.map(toProductResponse),
      nextCursor: hasNext && last ? encodeProductCursor(last) : null,
    };
  }

  async create(input: {
    body: CreateTariffProductRequest;
    idempotencyKey: string;
    scope: Scope;
  }): Promise<{ product: TariffProductResponse; resultCode: 'PRODUCT_CREATED' | 'PRODUCT_EXISTING' | 'PRODUCT_REACTIVATED' }> {
    requireMtd(input.scope);
    const body = createTariffProductRequestSchema.parse(input.body);
    const codigoProducto = body.codigoProducto.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!codigoProducto || codigoProducto.length > 255) {
      throw new BadRequestException({
        code: 'INVALID_PRODUCT_CODE',
        message: 'Código de producto obligatorio o con formato inválido.',
      });
    }
    const idempotencyScope = `tariff-annex.create:${input.scope.organizationId}`;
    const requestHash = createHash('sha256').update(codigoProducto).digest('hex');
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `${idempotencyScope}:${input.idempotencyKey}`,
      ]);
      await client.query(
        'delete from idempotency_records where scope = $1 and key = $2 and expires_at <= now()',
        [idempotencyScope, input.idempotencyKey],
      );
      const existing = await client.query<{
        request_hash: string;
        response: { product: TariffProductResponse; resultCode: string };
      }>('select request_hash, response from idempotency_records where scope = $1 and key = $2', [
        idempotencyScope,
        input.idempotencyKey,
      ]);
      const previous = existing.rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'Idempotency key reused with another payload',
          });
        }
        await client.query('commit');
        return previous.response as {
          product: TariffProductResponse;
          resultCode: 'PRODUCT_CREATED' | 'PRODUCT_EXISTING' | 'PRODUCT_REACTIVATED';
        };
      }
      const result = await this.upsertProduct(client, {
        codigoProducto,
        actorId: input.scope.userId,
        organizationId: input.scope.organizationId,
        correlationId: input.scope.correlationId,
      });
      const response = {
        product: toProductResponse(result.product),
        resultCode: result.resultCode,
      };
      await client.query(
        `insert into idempotency_records (scope, key, request_hash, status_code, response, expires_at)
         values ($1, $2, $3, 200, $4::jsonb, now() + interval '24 hours')`,
        [idempotencyScope, input.idempotencyKey, requestHash, JSON.stringify(response)],
      );
      await client.query('commit');
      return response;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(input: {
    productId: string;
    body: { active: boolean };
    scope: Scope;
  }): Promise<{ product: TariffProductResponse; changed: boolean }> {
    requireMtd(input.scope);
    const productId = parseUuid(input.productId, 'productId');
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const result = await this.setProductActive(client, {
        productId,
        active: input.body.active,
        actorId: input.scope.userId,
        organizationId: input.scope.organizationId,
        correlationId: input.scope.correlationId,
      });
      await client.query('commit');
      return { product: toProductResponse(result.product), changed: result.changed };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async deactivate(input: { productId: string; scope: Scope }): Promise<{ product: TariffProductResponse; changed: boolean }> {
    return this.update({
      productId: input.productId,
      body: { active: false },
      scope: input.scope,
    });
  }

  /**
   * Upsert idempotente del producto. Crea, reactiva o reporta existente; la
   * activación emite el evento de revalidación en la misma transacción.
   */
  private async upsertProduct(
    client: QueryableClient,
    input: {
      codigoProducto: string;
      actorId: string;
      organizationId: string;
      correlationId: string;
    },
  ): Promise<{
    product: ProductRow;
    resultCode: 'PRODUCT_CREATED' | 'PRODUCT_EXISTING' | 'PRODUCT_REACTIVATED';
  }> {
    const inserted = await client.query<ProductRow>(
      `insert into tariff_annex_products (codigo_producto, active, organization_id, created_by, updated_by, source_data)
       values ($1, true, $2, $3, $3, '{}'::jsonb)
       on conflict (codigo_producto) do nothing
       returning id, codigo_producto, active, version, created_by, source_data, created_at, updated_at`,
      [input.codigoProducto, input.organizationId, input.actorId],
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
      return { product, resultCode: 'PRODUCT_CREATED' };
    }
    const existingResult = await client.query<ProductRow>(
      `select id, codigo_producto, active, version, created_by, source_data, created_at, updated_at
       from tariff_annex_products where codigo_producto = $1 for update`,
      [input.codigoProducto],
    );
    const existingProduct = existingResult.rows[0];
    if (!existingProduct) throw new Error('Tariff product was not found after upsert');
    if (existingProduct.active) {
      await this.insertProductAudit(client, {
        actorId: input.actorId,
        organizationId: input.organizationId,
        action: 'TARIFF_PRODUCT_EXISTING',
        product: existingProduct,
        after: { codigoProducto: existingProduct.codigo_producto, active: true },
        correlationId: input.correlationId,
      });
      return { product: existingProduct, resultCode: 'PRODUCT_EXISTING' };
    }
    const reactivated = await client.query<ProductRow>(
      `update tariff_annex_products
       set active = true, version = version + 1, updated_by = $2, organization_id = $3, updated_at = now()
       where id = $1
       returning id, codigo_producto, active, version, created_by, source_data, created_at, updated_at`,
      [existingProduct.id, input.actorId, input.organizationId],
    );
    product = reactivated.rows[0];
    if (!product) throw new Error('Tariff product was not reactivated');
    await this.insertProductAudit(client, {
      actorId: input.actorId,
      organizationId: input.organizationId,
      action: 'TARIFF_PRODUCT_UPDATED',
      product,
      before: { codigoProducto: existingProduct.codigo_producto, active: false, version: existingProduct.version },
      after: { codigoProducto: product.codigo_producto, active: true, version: product.version },
      correlationId: input.correlationId,
    });
    await this.enqueueRevalidation(client, {
      product,
      actorId: input.actorId,
      organizationId: input.organizationId,
      correlationId: input.correlationId,
    });
    return { product, resultCode: 'PRODUCT_REACTIVATED' };
  }

  private async setProductActive(
    client: QueryableClient,
    input: {
      productId: string;
      active: boolean;
      actorId: string;
      organizationId: string;
      correlationId: string;
    },
  ): Promise<{ product: ProductRow; changed: boolean }> {
    const current = await client.query<ProductRow>(
      `select id, codigo_producto, active, version, created_by, source_data, created_at, updated_at
       from tariff_annex_products where id = $1 for update`,
      [input.productId],
    );
    const product = current.rows[0];
    if (!product) {
      throw new NotFoundException({
        code: 'TARIFF_PRODUCT_NOT_FOUND',
        message: 'Tariff product not found',
      });
    }
    if (product.active === input.active) {
      return { product, changed: false };
    }
    const updated = await client.query<ProductRow>(
      `update tariff_annex_products
       set active = $2, version = version + 1, updated_by = $3, organization_id = $4, updated_at = now()
       where id = $1
       returning id, codigo_producto, active, version, created_by, source_data, created_at, updated_at`,
      [product.id, input.active, input.actorId, input.organizationId],
    );
    const changedProduct = updated.rows[0];
    if (!changedProduct) throw new Error('Tariff product was not updated');
    await this.insertProductAudit(client, {
      actorId: input.actorId,
      organizationId: input.organizationId,
      action: input.active ? 'TARIFF_PRODUCT_UPDATED' : 'TARIFF_PRODUCT_DEACTIVATED',
      product: changedProduct,
      before: { codigoProducto: product.codigo_producto, active: product.active, version: product.version },
      after: { codigoProducto: changedProduct.codigo_producto, active: changedProduct.active, version: changedProduct.version },
      correlationId: input.correlationId,
    });
    if (input.active) {
      await this.enqueueRevalidation(client, {
        product: changedProduct,
        actorId: input.actorId,
        organizationId: input.organizationId,
        correlationId: input.correlationId,
      });
    }
    return { product: changedProduct, changed: true };
  }

  /** Evento outbox de revalidación (una única vez por versión del producto). */
  private async enqueueRevalidation(
    client: QueryableClient,
    input: { product: ProductRow; actorId: string; organizationId: string; correlationId: string },
  ): Promise<void> {
    const idempotencyKey = `tariff-reval:${input.product.id}:${input.product.version}`.slice(0, 200);
    const eventId = randomUUID();
    const payload = tariffAnnexRevalidationPayloadSchema.parse({
      eventId,
      tariffProductId: input.product.id,
      codigoProducto: input.product.codigo_producto,
      actorId: input.actorId,
      correlationId: input.correlationId,
      idempotencyKey,
    });
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
    client: QueryableClient,
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

  // ---------------------------------------------------------------------
  // Cargue masivo (Cargar Anexo Tarifario)
  // ---------------------------------------------------------------------

  async createImport(input: {
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer };
    idempotencyKey: string;
    scope: Scope;
  }): Promise<TariffImportBatchResponse> {
    requireMtd(input.scope);
    if (input.file.size <= 0) {
      throw new BadRequestException({
        code: 'TARIFF_IMPORT_FILE_EMPTY',
        message: 'El archivo del Anexo Tarifario no puede estar vacío',
      });
    }
    if (input.file.size > this.config.IMPORT_MAX_FILE_BYTES) {
      throw new PayloadTooLargeException({
        code: 'TARIFF_IMPORT_FILE_TOO_LARGE',
        message: 'El archivo supera el límite de 20 MB',
      });
    }
    const contentHash = createHash('sha256').update(input.file.buffer).digest('hex');
    const idempotencyScope = `tariff-annex.imports.create:${input.scope.organizationId}`;
    const requestHash = createHash('sha256')
      .update(`${input.file.originalname}\u0000${input.file.mimetype}\u0000${contentHash}`)
      .digest('hex');
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `${idempotencyScope}:${input.idempotencyKey}`,
      ]);
      await client.query(
        'delete from idempotency_records where scope = $1 and key = $2 and expires_at <= now()',
        [idempotencyScope, input.idempotencyKey],
      );
      const existing = await client.query<{
        request_hash: string;
        response: TariffImportBatchResponse;
      }>('select request_hash, response from idempotency_records where scope = $1 and key = $2', [
        idempotencyScope,
        input.idempotencyKey,
      ]);
      const previous = existing.rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'Idempotency key reused with another payload',
          });
        }
        await client.query('commit');
        return previous.response;
      }
      // Idempotencia lógica: el mismo archivo para la misma organización no
      // genera un segundo lote (el worker procesa una única vez).
      const duplicateBatch = await client.query<ImportBatchRow>(
        `select id, organization_id, original_filename, mime_type, size_bytes, sha256, status,
                total_rows, created_rows, reactivated_rows, existing_rows, rejected_rows, duplicate_rows,
                last_error_code, created_at, completed_at
         from tariff_annex_imports where organization_id = $1 and sha256 = $2`,
        [input.scope.organizationId, contentHash],
      );
      const duplicate = duplicateBatch.rows[0];
      if (duplicate) {
        const response = toImportBatchResponse(duplicate);
        await client.query(
          `insert into idempotency_records (scope, key, request_hash, status_code, response, expires_at)
           values ($1, $2, $3, 202, $4::jsonb, now() + interval '24 hours')`,
          [idempotencyScope, input.idempotencyKey, requestHash, JSON.stringify(response)],
        );
        await client.query('commit');
        return response;
      }
      const importId = randomUUID();
      const sourceFileId = randomUUID();
      const eventId = randomUUID();
      const outboxIdempotencyKey = createHash('sha256')
        .update(`tariff-import:${importId}:${contentHash}`)
        .digest('hex');
      const payload = {
        eventId,
        batchId: importId,
        sourceFileId,
        correlationId: input.scope.correlationId,
        idempotencyKey: outboxIdempotencyKey,
      };
      await client.query(
        `insert into tariff_annex_imports
           (id, organization_id, created_by, original_filename, mime_type, size_bytes, sha256, status, correlation_id, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7, 'CARGADO', $8, $9)`,
        [
          importId,
          input.scope.organizationId,
          input.scope.userId,
          input.file.originalname,
          input.file.mimetype,
          input.file.size,
          contentHash,
          input.scope.correlationId,
          outboxIdempotencyKey,
        ],
      );
      await client.query(
        `insert into tariff_annex_import_source_files
           (id, import_id, original_filename, mime_type, size_bytes, sha256, content)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          sourceFileId,
          importId,
          input.file.originalname,
          input.file.mimetype,
          input.file.size,
          contentHash,
          input.file.buffer,
        ],
      );
      await client.query(
        `insert into audit_events
           (id, actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
         values ($1, 'USER', $2, $3, 'TARIFF_ANNEX_IMPORT_CREATED', 'tariff_annex_import', $4, $5::jsonb, $6, $7, 'SUCCESS')`,
        [
          randomUUID(),
          input.scope.userId,
          input.scope.organizationId,
          importId,
          JSON.stringify({
            filename: input.file.originalname,
            sizeBytes: input.file.size,
            sha256: contentHash,
          }),
          input.scope.correlationId,
          input.scope.correlationId,
        ],
      );
      await client.query(
        `insert into outbox_events
           (id, event_type, version, payload, correlation_id, organization_id, idempotency_key)
         values ($1, 'tariff.import', 1, $2::jsonb, $3, $4, $5)`,
        [
          eventId,
          JSON.stringify(payload),
          input.scope.correlationId,
          input.scope.organizationId,
          outboxIdempotencyKey,
        ],
      );
      const created = await client.query<ImportBatchRow>(
        `select id, organization_id, original_filename, mime_type, size_bytes, sha256, status,
                total_rows, created_rows, reactivated_rows, existing_rows, rejected_rows, duplicate_rows,
                last_error_code, created_at, completed_at
         from tariff_annex_imports where id = $1`,
        [importId],
      );
      const batch = created.rows[0];
      if (!batch) throw new Error('Tariff import batch was not created');
      const response = toImportBatchResponse(batch);
      await client.query(
        `insert into idempotency_records (scope, key, request_hash, status_code, response, expires_at)
         values ($1, $2, $3, 202, $4::jsonb, now() + interval '24 hours')`,
        [idempotencyScope, input.idempotencyKey, requestHash, JSON.stringify(response)],
      );
      await client.query('commit');
      return response;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async getImport(batchId: string, scope: Scope): Promise<TariffImportBatchResponse> {
    requireMtd(scope);
    const result = await this.database.pool.query<ImportBatchRow>(
      `select id, organization_id, original_filename, mime_type, size_bytes, sha256, status,
              total_rows, created_rows, reactivated_rows, existing_rows, rejected_rows, duplicate_rows,
              last_error_code, created_at, completed_at
       from tariff_annex_imports where id = $1 and organization_id = $2`,
      [parseUuid(batchId, 'batchId'), scope.organizationId],
    );
    const batch = result.rows[0];
    if (!batch) {
      throw new NotFoundException({
        code: 'TARIFF_IMPORT_NOT_FOUND',
        message: 'Tariff annex import not found',
      });
    }
    return toImportBatchResponse(batch);
  }

  async getImportRows(input: {
    batchId: string;
    cursor?: string;
    limit: number;
    scope: Scope;
  }): Promise<{ items: unknown[]; nextCursor: string | null }> {
    const batch = await this.getImport(input.batchId, input.scope);
    const cursor = decodeRowCursor(input.cursor);
    const values: unknown[] = [batch.id];
    let where = 'r.import_id = $1';
    if (cursor !== undefined) {
      values.push(cursor);
      where += ` and r.row_number > $${values.length}`;
    }
    values.push(input.limit + 1);
    const result = await this.database.pool.query<ImportRowQueryRow>(
      `select r.id, r.row_number, r.codigo_producto, r.result_code, r.result_message, r.product_id, r.created_at
       from tariff_annex_import_rows r
       where ${where}
       order by r.row_number asc
       limit $${values.length}`,
      values,
    );
    const hasNext = result.rows.length > input.limit;
    const rows = hasNext ? result.rows.slice(0, input.limit) : result.rows;
    const items = rows.map((row) => {
      const resultCode = row.result_code as keyof typeof tariffImportRowResultMessages;
      return {
        id: row.id,
        rowNumber: row.row_number,
        codigoProducto: row.codigo_producto,
        resultCode,
        resultMessage: row.result_message || tariffImportRowResultMessages[resultCode],
        productId: row.product_id,
        createdAt: row.created_at.toISOString(),
      };
    });
    const last = rows.at(-1);
    const parsed = paginatedTariffImportRowsResponseSchema.parse({
      items,
      nextCursor: hasNext && last ? encodeRowCursor(last.row_number) : null,
    });
    return parsed;
  }
}
