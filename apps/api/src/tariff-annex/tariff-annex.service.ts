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
import * as XLSX from 'xlsx';
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
import {
  currentBogotaDate,
  deriveEpsNovedadCausales,
  epsNovedadCausalMessages,
  isValidTariffProductCode,
  normalizeTariffProductCode,
  type EpsNovedadInput,
} from '@authorization/domain';
import { API_CONFIG, DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';

type Database = ReturnType<typeof createDatabase>;

type ProductRow = {
  id: string;
  codigo_producto: string;
  tarifa_unidad: string | null;
  numero_expediente_invima: string | null;
  consecutivo_invima_presentacion: string | null;
  descripcion_generica: string | null;
  descripcion_comercial: string | null;
  laboratorio: string | null;
  tipo_inclusion: string | null;
  active: boolean;
  version: number;
  created_by: string;
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

type NovedadRow = {
  id: string;
  authorization_key: string;
  numero_autorizacion: string;
  codigo_medicamento: string;
  enablement_status: 'ENABLED' | 'BLOCKED_SOURCE_STATUS';
  coverage_type: 'PBS' | 'NO_PBS';
  direction_status: 'NOT_APPLICABLE' | 'PENDING' | 'CONFIRMED' | 'QUERY_ERROR';
  operation_status: 'BLOCKED' | 'EXPIRED' | null;
  tariff_membership_status: 'NOT_EVALUATED' | 'LISTED' | 'NOT_LISTED';
  audit_status: string;
  numero_documento: string | null;
  nombre_paciente: string | null;
  cdgn001: string | null;
  cups_autorizado: string | null;
  cantidad: string | null;
  dosis: string | null;
  fecha_asignacion: string | null;
  valor_cuota_moderadora: string | null;
  no_prescripcion: string | null;
  fecha_final_vigencia: string | null;
  created_at: Date;
  updated_at: Date;
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

function decodeProductCursor(
  cursor: string | undefined,
): { createdAt: Date; id: string } | undefined {
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
    tarifaUnidad: row.tarifa_unidad,
    numeroExpedienteInvima: row.numero_expediente_invima,
    consecutivoInvimaPresentacion: row.consecutivo_invima_presentacion,
    descripcionGenerica: row.descripcion_generica,
    descripcionComercial: row.descripcion_comercial,
    laboratorio: row.laboratorio,
    tipoInclusion: row.tipo_inclusion,
    active: row.active,
    version: row.version,
    createdBy: row.created_by,
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
 * SPEC-014 / ADR-024: administración del Anexo Tarifario (organización MTD).
 * Toda mutación persiste auditoría inmutable y, cuando el producto se crea o
 * se reactiva, un evento outbox `tariff.product.activated` que dispara la
 * revalidación dirigida de autorizaciones omitidas.
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
      values.push(`%${escapeLikePattern(normalizeTariffProductCode(query.codigo))}%`);
      conditions.push(`p.codigo_producto ilike $${values.length} escape '\\'`);
    }
    if (cursor) {
      values.push(cursor.createdAt);
      conditions.push(
        `(p.created_at, p.id) < ($${values.length}::timestamptz, $${values.length + 1}::uuid)`,
      );
      values.push(cursor.id);
    }
    values.push(query.limit + 1);
    const result = await this.database.pool.query<ProductRow>(
      `select p.id, p.codigo_producto, p.tarifa_unidad, p.numero_expediente_invima,
              p.consecutivo_invima_presentacion, p.descripcion_generica, p.descripcion_comercial,
              p.laboratorio, p.tipo_inclusion, p.active, p.version, p.created_by, p.created_at, p.updated_at
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

  async get(input: { productId: string; scope: Scope }): Promise<TariffProductResponse> {
    requireMtd(input.scope);
    const productId = parseUuid(input.productId, 'productId');
    const result = await this.database.pool.query<ProductRow>(
      `select id, codigo_producto, tarifa_unidad, numero_expediente_invima,
              consecutivo_invima_presentacion, descripcion_generica, descripcion_comercial,
              laboratorio, tipo_inclusion, active, version, created_by, created_at, updated_at
       from tariff_annex_products where id = $1`,
      [productId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException({
        code: 'TARIFF_PRODUCT_NOT_FOUND',
        message: 'Tariff product not found',
      });
    }
    return toProductResponse(row);
  }

  async create(input: {
    body: CreateTariffProductRequest;
    idempotencyKey: string;
    scope: Scope;
  }): Promise<{
    product: TariffProductResponse;
    resultCode: 'PRODUCT_CREATED' | 'PRODUCT_EXISTING' | 'PRODUCT_REACTIVATED';
  }> {
    requireMtd(input.scope);
    const body = createTariffProductRequestSchema.parse(input.body);
    const codigoProducto = normalizeTariffProductCode(body.codigoProducto);
    if (!isValidTariffProductCode(codigoProducto)) {
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
        tarifaUnidad: body.tarifaUnidad ?? null,
        numeroExpedienteInvima: body.numeroExpedienteInvima ?? null,
        consecutivoInvimaPresentacion: body.consecutivoInvimaPresentacion ?? null,
        descripcionGenerica: body.descripcionGenerica ?? null,
        descripcionComercial: body.descripcionComercial ?? null,
        laboratorio: body.laboratorio ?? null,
        tipoInclusion: body.tipoInclusion ?? null,
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

  async deactivate(input: {
    productId: string;
    scope: Scope;
  }): Promise<{ product: TariffProductResponse; changed: boolean }> {
    return this.update({ productId: input.productId, body: { active: false }, scope: input.scope });
  }

  /**
   * Upsert idempotente del producto. Crea, reactiva o reporta existente; la
   * creación/reactivación emite el evento de revalidación en la misma
   * transacción (outbox).
   */
  private async upsertProduct(
    client: QueryableClient,
    input: {
      codigoProducto: string;
      tarifaUnidad: string | null;
      numeroExpedienteInvima: string | null;
      consecutivoInvimaPresentacion: string | null;
      descripcionGenerica: string | null;
      descripcionComercial: string | null;
      laboratorio: string | null;
      tipoInclusion: string | null;
      actorId: string;
      organizationId: string;
      correlationId: string;
    },
  ): Promise<{
    product: ProductRow;
    resultCode: 'PRODUCT_CREATED' | 'PRODUCT_EXISTING' | 'PRODUCT_REACTIVATED';
  }> {
    const inserted = await client.query<ProductRow>(
      `insert into tariff_annex_products
         (codigo_producto, tarifa_unidad, numero_expediente_invima, consecutivo_invima_presentacion,
          descripcion_generica, descripcion_comercial, laboratorio, tipo_inclusion,
          active, organization_id, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $10)
       on conflict (codigo_producto) do nothing
       returning id, codigo_producto, tarifa_unidad, numero_expediente_invima,
                 consecutivo_invima_presentacion, descripcion_generica, descripcion_comercial,
                 laboratorio, tipo_inclusion, active, version, created_by, created_at, updated_at`,
      [
        input.codigoProducto,
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
      await this.enqueueRevalidation(client, {
        product,
        actorId: input.actorId,
        organizationId: input.organizationId,
        correlationId: input.correlationId,
      });
      return { product, resultCode: 'PRODUCT_CREATED' };
    }
    const existingResult = await client.query<ProductRow>(
      `select id, codigo_producto, tarifa_unidad, numero_expediente_invima,
              consecutivo_invima_presentacion, descripcion_generica, descripcion_comercial,
              laboratorio, tipo_inclusion, active, version, created_by, created_at, updated_at
       from tariff_annex_products where codigo_producto = $1 for update`,
      [input.codigoProducto],
    );
    const existingProduct = existingResult.rows[0];
    if (!existingProduct) throw new Error('Tariff product was not found after upsert');
    if (existingProduct.active) {
      return { product: existingProduct, resultCode: 'PRODUCT_EXISTING' };
    }
    const reactivated = await client.query<ProductRow>(
      `update tariff_annex_products
       set tarifa_unidad = $2, numero_expediente_invima = $3,
           consecutivo_invima_presentacion = $4, descripcion_generica = $5,
           descripcion_comercial = $6, laboratorio = $7, tipo_inclusion = $8,
           active = true, version = version + 1, updated_by = $9, updated_at = now()
       where id = $1
       returning id, codigo_producto, tarifa_unidad, numero_expediente_invima,
                 consecutivo_invima_presentacion, descripcion_generica, descripcion_comercial,
                 laboratorio, tipo_inclusion, active, version, created_by, created_at, updated_at`,
      [
        existingProduct.id,
        input.tarifaUnidad,
        input.numeroExpedienteInvima,
        input.consecutivoInvimaPresentacion,
        input.descripcionGenerica,
        input.descripcionComercial,
        input.laboratorio,
        input.tipoInclusion,
        input.actorId,
      ],
    );
    const changed = reactivated.rows[0];
    if (!changed) throw new Error('Tariff product was not reactivated');
    await this.insertProductAudit(client, {
      actorId: input.actorId,
      organizationId: input.organizationId,
      action: 'TARIFF_PRODUCT_ACTIVATED',
      product: changed,
      before: { active: false, version: existingProduct.version },
      after: { active: true, version: changed.version },
      correlationId: input.correlationId,
    });
    await this.enqueueRevalidation(client, {
      product: changed,
      actorId: input.actorId,
      organizationId: input.organizationId,
      correlationId: input.correlationId,
    });
    return { product: changed, resultCode: 'PRODUCT_REACTIVATED' };
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
      `select id, codigo_producto, tarifa_unidad, numero_expediente_invima,
              consecutivo_invima_presentacion, descripcion_generica, descripcion_comercial,
              laboratorio, tipo_inclusion, active, version, created_by, created_at, updated_at
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
       set active = $2, version = version + 1, updated_by = $3, updated_at = now()
       where id = $1
       returning id, codigo_producto, tarifa_unidad, numero_expediente_invima,
                 consecutivo_invima_presentacion, descripcion_generica, descripcion_comercial,
                 laboratorio, tipo_inclusion, active, version, created_by, created_at, updated_at`,
      [product.id, input.active, input.actorId],
    );
    const changedProduct = updated.rows[0];
    if (!changedProduct) throw new Error('Tariff product was not updated');
    await this.insertProductAudit(client, {
      actorId: input.actorId,
      organizationId: input.organizationId,
      action: input.active ? 'TARIFF_PRODUCT_ACTIVATED' : 'TARIFF_PRODUCT_DEACTIVATED',
      product: changedProduct,
      before: { active: product.active, version: product.version },
      after: { active: changedProduct.active, version: changedProduct.version },
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
      [eventId, JSON.stringify(payload), input.correlationId, input.organizationId, idempotencyKey],
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
      // genera un segundo lote (el worker lo procesa una única vez).
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
         values ($1, $2, $3, $4, $5, $6, $7, 'UPLOADED', $8, $9)`,
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
           (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
         values ('USER', $1, $2, 'TARIFF_ANNEX_IMPORT_CREATED', 'tariff_annex_import', $3, $4::jsonb, $5, $6, 'SUCCESS')`,
        [
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

  async listImports(input: {
    query: { cursor?: string | undefined; limit: number };
    scope: Scope;
  }): Promise<{ items: TariffImportBatchResponse[]; nextCursor: string | null }> {
    requireMtd(input.scope);
    const offset = decodeRowCursor(input.query.cursor) ?? 0;
    const result = await this.database.pool.query<ImportBatchRow>(
      `select b.id, b.organization_id, b.original_filename, b.mime_type, b.size_bytes, b.sha256, b.status,
              b.total_rows, b.created_rows, b.reactivated_rows, b.existing_rows, b.rejected_rows, b.duplicate_rows,
              b.last_error_code, b.created_at, b.completed_at
       from tariff_annex_imports b
       where b.organization_id = $1
       order by b.created_at desc, b.id desc
       limit $2 offset $3`,
      [input.scope.organizationId, input.query.limit + 1, offset],
    );
    const hasNext = result.rows.length > input.query.limit;
    const rows = hasNext ? result.rows.slice(0, input.query.limit) : result.rows;
    return {
      items: rows.map(toImportBatchResponse),
      nextCursor: hasNext ? encodeRowCursor(offset + input.query.limit) : null,
    };
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
  }) {
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
    return paginatedTariffImportRowsResponseSchema.parse({
      items,
      nextCursor: hasNext && last ? encodeRowCursor(last.row_number) : null,
    });
  }

  /**
   * SPEC-014: base de novedades EPS on-demand (CSV/XLSX). Contiene los
   * registros que no alcanzaron READY_TO_DISPENSE con todas sus causales
   * activas derivadas; no se conserva copia persistente y la operación queda
   * auditada.
   */
  async epsNovedadesExport(input: {
    format: 'csv' | 'xlsx';
    scope: Scope;
  }): Promise<{ filename: string; content: Buffer; rowCount: number; columns: string[] }> {
    requireMtd(input.scope);
    const today = currentBogotaDate();
    const result = await this.database.pool.query<NovedadRow>(
      `select i.id, i.authorization_key, i.numero_autorizacion, i.codigo_medicamento,
              i.enablement_status, i.coverage_type, i.direction_status, i.operation_status,
              i.tariff_membership_status, i.audit_status,
               i.source_data->>'IDENTIFICACION_PACIENTE' as numero_documento,
              i.source_data->>'NOMBRE_PACIENTE' as nombre_paciente,
              i.source_data->>'CDGN001' as cdgn001,
              i.source_data->>'CUPS_AUTORIZADO' as cups_autorizado,
              i.source_data->>'CANTIDAD' as cantidad,
              i.source_data->>'DOSIS' as dosis,
              i.source_data->>'FECHA_ASIGNACION' as fecha_asignacion,
               i.source_data->>'VALOR_CUOTA_MODERADORA' as valor_cuota_moderadora,
               i.source_data->>'NUMERO_PRESCRIPCION' as no_prescripcion,
              i.source_data->>'FECHA_FINAL_VIGENCIA' as fecha_final_vigencia,
              i.created_at, i.updated_at
       from authorization_items i
       where i.operation_status is null or i.operation_status in ('BLOCKED', 'EXPIRED')
       order by i.created_at asc, i.id asc`,
    );
    const columns = [
       'IDENTIFICADOR_REGISTRO',
      'NUMERO_AUTORIZACION',
       'IDENTIFICACION_PACIENTE',
      'NOMBRE_PACIENTE',
      'CDGN001',
       'CODIGO_COMERCIAL',
      'CUPS_AUTORIZADO',
      'CANTIDAD',
      'DOSIS',
      'FECHA_ASIGNACION',
      'FECHA_FINAL_VIGENCIA',
       'VALOR_CUOTA_MODERADORA',
       'NUMERO_PRESCRIPCION',
       'CLAVE_AUTORIZACION',
       'TIPO_COBERTURA',
       'ESTADO_OPERACION',
       'ESTADO_HABILITACION',
       'ESTADO_DIRECCIONAMIENTO',
       'ESTADO_PERTENENCIA_ANEXO',
       'FECHA_FINAL_VIGENCIA',
       'CAUSAL',
       'DETALLE_NOVEDAD',
       'ESTADO_AUDITORIA',
       'FECHA_CREACION',
       'FECHA_ACTUALIZACION',
    ];
    const rows: Array<Record<string, string | null>> = result.rows.map((row) => {
      const novedadInput: EpsNovedadInput = {
        enablementStatus: row.enablement_status,
        operationStatus: row.operation_status,
        coverageType: row.coverage_type,
        directionStatus: row.direction_status,
        tariffMembershipStatus: row.tariff_membership_status,
        fechaFinalVigencia: row.fecha_final_vigencia,
        today,
      };
      const causales = deriveEpsNovedadCausales(novedadInput);
      return {
         IDENTIFICADOR_REGISTRO: row.id,
        NUMERO_AUTORIZACION: row.numero_autorizacion,
         IDENTIFICACION_PACIENTE: row.numero_documento,
        NOMBRE_PACIENTE: row.nombre_paciente,
        CDGN001: row.cdgn001,
         CODIGO_COMERCIAL: row.codigo_medicamento,
        CUPS_AUTORIZADO: row.cups_autorizado,
        CANTIDAD: row.cantidad,
        DOSIS: row.dosis,
        FECHA_ASIGNACION: row.fecha_asignacion,
        FECHA_FINAL_VIGENCIA: row.fecha_final_vigencia,
         VALOR_CUOTA_MODERADORA: row.valor_cuota_moderadora,
         NUMERO_PRESCRIPCION: row.no_prescripcion,
         CLAVE_AUTORIZACION: row.authorization_key,
         TIPO_COBERTURA: row.coverage_type,
         ESTADO_OPERACION: row.operation_status,
         ESTADO_HABILITACION: row.enablement_status,
         ESTADO_DIRECCIONAMIENTO: row.direction_status,
         ESTADO_PERTENENCIA_ANEXO: row.tariff_membership_status,
         CAUSAL: causales.join(';'),
         DETALLE_NOVEDAD: causales.map((causal) => epsNovedadCausalMessages[causal]).join('; '),
         ESTADO_AUDITORIA: row.audit_status,
         FECHA_CREACION: row.created_at.toISOString(),
         FECHA_ACTUALIZACION: row.updated_at.toISOString(),
      };
    });
    await this.auditNovedadesExport(input.scope, input.format, rows.length, columns);
    const filename = 'eps-novedades';
    if (input.format === 'xlsx') {
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

  private async auditNovedadesExport(
    scope: Scope,
    format: string,
    rowCount: number,
    columns: string[],
  ): Promise<void> {
    await this.database.pool.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
       values ('USER', $1, $2, 'EPS_NOVEDADES_EXPORT_CREATED', 'eps_novedades_export', $3, $4::jsonb, $5, $6, 'SUCCESS')`,
      [
        scope.userId,
        scope.organizationId,
        `eps-novedades:${format}`,
        JSON.stringify({ format, rowCount, columns }),
        scope.correlationId,
        scope.correlationId,
      ],
    );
  }
}
