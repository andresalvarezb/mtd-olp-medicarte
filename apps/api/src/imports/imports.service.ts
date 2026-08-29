import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  authorizationClassificationSchema,
  importBatchStatusSchema,
  importRowResultMessages,
  type ConfirmImportResponse,
  type ImportBatchResponse,
  type ImportRowResponse,
} from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';
import type { ApiConfig } from '@authorization/config';
import { API_CONFIG, DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';

type Database = ReturnType<typeof createDatabase>;

type BatchRow = {
  id: string;
  organization_id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  status: string;
  total_rows: number;
  valid_rows: number;
  rejected_rows: number;
  duplicate_rows: number;
  existing_rows: number;
  confirmed_rows: number;
  last_error_code: string | null;
  created_at: Date;
  completed_at: Date | null;
  confirmed_at: Date | null;
};

type RowQueryResult = {
  id: string;
  row_number: number;
  result_code: string;
  result_message: string;
  confirmable: boolean;
  authorization_item_id: string | null;
  authorization_key: string | null;
  normalized_data: unknown;
  validation_errors: unknown;
};

const INITIAL_SCOPE_ORGANIZATION_CODES = ['MTD', 'COMPENSAR', 'OLP', 'MEDICARTE'];

function requestHash(filename: string, mimeType: string, contentHash: string): string {
  return createHash('sha256').update(`${filename}\u0000${mimeType}\u0000${contentHash}`).digest('hex');
}

function isRetryableTransactionError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === '40P01' || error.code === '40001';
}

function sourceDataRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function rawText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return `${value}`;
  return JSON.stringify(value) ?? '';
}

function parseUuid(value: string, field: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException({ code: 'INVALID_IDENTIFIER', message: `${field} must be a UUID` });
  }
  return value;
}

function encodeRowCursor(rowNumber: number): string {
  return Buffer.from(JSON.stringify({ rowNumber }), 'utf8').toString('base64url');
}

function decodeRowCursor(cursor: string | undefined): number | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { rowNumber?: unknown };
    if (typeof decoded.rowNumber !== 'number' || !Number.isInteger(decoded.rowNumber) || decoded.rowNumber < 1) throw new Error('invalid');
    return decoded.rowNumber;
  } catch {
    throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'Invalid pagination cursor' });
  }
}

function toBatchResponse(row: BatchRow): ImportBatchResponse {
  const status = importBatchStatusSchema.parse(row.status);
  return {
    id: row.id,
    status,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    totalRows: row.total_rows,
    validRows: row.valid_rows,
    rejectedRows: row.rejected_rows,
    duplicateRows: row.duplicate_rows,
    existingRows: row.existing_rows,
    confirmedRows: row.confirmed_rows,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

function toValidationErrors(value: unknown): Array<{ field: string; code: string; message: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as { field?: unknown; code?: unknown; message?: unknown };
    if (typeof candidate.field !== 'string' || typeof candidate.code !== 'string' || typeof candidate.message !== 'string') return [];
    return [{ field: candidate.field, code: candidate.code, message: candidate.message }];
  });
}

@Injectable()
export class ImportsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async create(input: {
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer };
    idempotencyKey: string;
    scope: Scope;
  }): Promise<ImportBatchResponse> {
    if (input.file.size <= 0) {
      throw new BadRequestException({ code: 'IMPORT_FILE_EMPTY', message: 'Import file cannot be empty' });
    }
    if (input.file.size > this.config.IMPORT_MAX_FILE_BYTES) {
      throw new PayloadTooLargeException({ code: 'IMPORT_FILE_TOO_LARGE', message: 'Import file exceeds the 20 MB limit' });
    }
    if (input.file.originalname.length > 255) {
      throw new BadRequestException({ code: 'IMPORT_FILENAME_TOO_LONG', message: 'Import filename cannot exceed 255 characters' });
    }
    if (input.file.mimetype.length > 160) {
      throw new BadRequestException({ code: 'IMPORT_MIME_TYPE_TOO_LONG', message: 'Import MIME type cannot exceed 160 characters' });
    }
    const contentHash = createHash('sha256').update(input.file.buffer).digest('hex');
    const hash = requestHash(input.file.originalname, input.file.mimetype, contentHash);
    const idempotencyScope = `imports.create:${input.scope.organizationId}`;
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`${idempotencyScope}:${input.idempotencyKey}`]);
      await client.query('delete from idempotency_records where scope = $1 and key = $2 and expires_at <= now()', [idempotencyScope, input.idempotencyKey]);
      const existing = await client.query<{ request_hash: string; response: ImportBatchResponse }>(
        'select request_hash, response from idempotency_records where scope = $1 and key = $2',
        [idempotencyScope, input.idempotencyKey],
      );
      const previous = existing.rows[0];
      if (previous) {
        if (previous.request_hash !== hash) {
          throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency key reused with another payload' });
        }
        await client.query('commit');
        return previous.response;
      }

      const batchId = randomUUID();
      const sourceFileId = randomUUID();
      const eventId = randomUUID();
      const outboxIdempotencyKey = createHash('sha256')
        .update(`${batchId}:${contentHash}:${this.config.IMPORT_PROCESSOR_VERSION}`)
        .digest('hex');
      const inserted = await client.query<BatchRow>(
        `insert into import_batches
           (id, organization_id, created_by, original_filename, mime_type, size_bytes, sha256, processor_version, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'UPLOADED')
         returning id, organization_id, original_filename, mime_type, size_bytes, sha256, status,
                   total_rows, valid_rows, rejected_rows, duplicate_rows, existing_rows, confirmed_rows,
                   last_error_code, created_at, completed_at, confirmed_at`,
        [
          batchId,
          input.scope.organizationId,
          input.scope.userId,
          input.file.originalname,
          input.file.mimetype,
          input.file.size,
          contentHash,
          this.config.IMPORT_PROCESSOR_VERSION,
        ],
      );
      const batch = inserted.rows[0];
      if (!batch) throw new Error('Import batch was not created');
      await client.query(
        `insert into import_source_files
           (id, import_batch_id, original_filename, mime_type, size_bytes, sha256, content)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [sourceFileId, batchId, input.file.originalname, input.file.mimetype, input.file.size, contentHash, input.file.buffer],
      );
      const payload = {
        eventId,
        batchId,
        sourceFileId,
        processorVersion: this.config.IMPORT_PROCESSOR_VERSION,
        correlationId: input.scope.correlationId,
        idempotencyKey: outboxIdempotencyKey,
      };
      await client.query(
        `insert into audit_events
           (id, actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
         values ($1, 'USER', $2, $3, 'IMPORT_CREATED', 'import_batch', $4, $5::jsonb, $6, $7, 'SUCCESS')`,
        [eventId, input.scope.userId, input.scope.organizationId, batchId, JSON.stringify({ filename: input.file.originalname, sizeBytes: input.file.size, sha256: contentHash }), input.scope.correlationId, input.scope.correlationId],
      );
      await client.query(
        `insert into outbox_events
           (id, event_type, version, payload, correlation_id, organization_id, idempotency_key)
         values ($1, 'authorization.import', 1, $2::jsonb, $3, $4, $5)`,
        [eventId, JSON.stringify(payload), input.scope.correlationId, input.scope.organizationId, outboxIdempotencyKey],
      );
      const response = toBatchResponse(batch);
      await client.query(
        `insert into idempotency_records (scope, key, request_hash, status_code, response, expires_at)
         values ($1, $2, $3, 202, $4::jsonb, now() + interval '24 hours')`,
        [idempotencyScope, input.idempotencyKey, hash, JSON.stringify(response)],
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

  async getBatch(batchId: string, scope: Scope): Promise<ImportBatchResponse> {
    const row = await this.findBatch(parseUuid(batchId, 'batchId'), scope);
    if (!row) throw new NotFoundException({ code: 'IMPORT_NOT_FOUND', message: 'Import batch not found' });
    return toBatchResponse(row);
  }

  async getRows(input: { batchId: string; cursor?: string; limit: number; scope: Scope }): Promise<{ items: ImportRowResponse[]; nextCursor: string | null }> {
    const batchId = parseUuid(input.batchId, 'batchId');
    const batch = await this.findBatch(batchId, input.scope);
    if (!batch) throw new NotFoundException({ code: 'IMPORT_NOT_FOUND', message: 'Import batch not found' });
    const cursor = decodeRowCursor(input.cursor);
    const values: unknown[] = [batchId];
    let where = 'r.import_batch_id = $1';
    if (cursor !== undefined) {
      values.push(cursor);
      where += ` and r.row_number > $${values.length}`;
    }
    values.push(input.limit + 1);
    const result = await this.database.pool.query<RowQueryResult>(
      `select r.id, r.row_number, r.result_code, r.result_message, r.confirmable,
              r.authorization_item_id, r.authorization_key, r.normalized_data,
              coalesce(json_agg(json_build_object('field', v.field_name, 'code', v.code, 'message', v.message) order by v.id) filter (where v.id is not null), '[]'::json) as validation_errors
       from import_rows r
       left join validation_errors v on v.import_row_id = r.id
       where ${where}
       group by r.id
       order by r.row_number asc
       limit $${values.length}`,
      values,
    );
    const hasNext = result.rows.length > input.limit;
    const rows = (hasNext ? result.rows.slice(0, input.limit) : result.rows).map((row) => {
      const normalized = authorizationClassificationSchema.safeParse(row.normalized_data);
      const resultCode = row.result_code as ImportRowResponse['resultCode'];
      return {
        id: row.id,
        rowNumber: row.row_number,
        resultCode,
        resultMessage: row.result_message || importRowResultMessages[resultCode],
        confirmable: row.confirmable,
        authorizationItemId: row.authorization_item_id,
        authorizationKey: row.authorization_key,
        normalized: normalized.success ? normalized.data : null,
        validationErrors: toValidationErrors(row.validation_errors),
      };
    });
    const last = rows.at(-1);
    return { items: rows, nextCursor: hasNext && last ? encodeRowCursor(last.rowNumber) : null };
  }

  async confirm(input: { batchId: string; idempotencyKey: string; scope: Scope }): Promise<ConfirmImportResponse> {
    const batchId = parseUuid(input.batchId, 'batchId');
    const idempotencyScope = `imports.confirm:${input.scope.organizationId}:${batchId}`;
    const requestHash = createHash('sha256').update(batchId).digest('hex');
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`${idempotencyScope}:${input.idempotencyKey}`]);
      await client.query('delete from idempotency_records where scope = $1 and key = $2 and expires_at <= now()', [idempotencyScope, input.idempotencyKey]);
      const existing = await client.query<{ request_hash: string; response: ConfirmImportResponse }>(
        'select request_hash, response from idempotency_records where scope = $1 and key = $2',
        [idempotencyScope, input.idempotencyKey],
      );
      const previous = existing.rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) {
          throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency key reused with another payload' });
        }
        await client.query('commit');
        return previous.response;
      }

      const batchResult = await client.query<BatchRow>(
        `select b.id, b.organization_id, b.original_filename, b.mime_type, b.size_bytes, b.sha256, b.status,
                b.total_rows, b.valid_rows, b.rejected_rows, b.duplicate_rows, b.existing_rows, b.confirmed_rows,
                b.last_error_code, b.created_at, b.completed_at, b.confirmed_at
         from import_batches b
          where b.id = $1 and b.organization_id = $2
          for update`,
        [batchId, input.scope.organizationId],
      );
      const batch = batchResult.rows[0];
      if (!batch) throw new NotFoundException({ code: 'IMPORT_NOT_FOUND', message: 'Import batch not found' });
      if (batch.status === 'COMPLETED') {
        const response: ConfirmImportResponse = {
          batchId,
          status: 'COMPLETED',
          createdRows: batch.confirmed_rows,
          existingRows: batch.existing_rows,
          confirmedAt: (batch.confirmed_at ?? new Date()).toISOString(),
        };
        await this.storeIdempotency(client, idempotencyScope, input.idempotencyKey, requestHash, response);
        await client.query('commit');
        return response;
      }
      if (batch.status !== 'READY_TO_CONFIRM') {
        throw new ConflictException({ code: 'IMPORT_NOT_READY', message: 'Import batch is not ready to confirm' });
      }

      await client.query(`update import_batches set status = 'CONFIRMING' where id = $1`, [batchId]);
      const rows = await client.query<{ id: string; row_number: number; raw_data: unknown; normalized_data: unknown; authorization_key: string }>(
         `select id, row_number, raw_data, normalized_data, authorization_key
          from import_rows where import_batch_id = $1 and result_code = 'ROW_VALID' and confirmable = true
          order by authorization_key, row_number for update`,
        [batchId],
      );
      let createdRows = 0;
      let concurrentExistingRows = 0;
      for (const row of rows.rows) {
        const classification = authorizationClassificationSchema.parse(row.normalized_data);
        const item = await client.query<{ id: string }>(
          `insert into authorization_items
             (numero_autorizacion, codigo_medicamento, authorization_key, source_data, source_status_normalized,
              source_cups_principal_normalized, enablement_status, coverage_type, direction_status, operation_status,
              coverage_rule_version, created_from_batch_id)
           values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, null, 'F2-COVERAGE-1', $10)
           on conflict (numero_autorizacion, codigo_medicamento) do nothing
           returning id`,
          [
            classification.numeroAutorizacion,
            classification.codigoMedicamento,
            classification.authorizationKey,
            JSON.stringify(row.raw_data),
            classification.sourceStatusNormalized,
            classification.cupsPrincipalNormalized,
            classification.enablementStatus,
            classification.coverageType,
            classification.directionStatus,
            batchId,
          ],
        );
        const itemId = item.rows[0]?.id;
        if (!itemId) {
          const existingItem = await client.query<{ id: string }>(
            'select id from authorization_items where numero_autorizacion = $1 and codigo_medicamento = $2',
            [classification.numeroAutorizacion, classification.codigoMedicamento],
          );
          const existingId = existingItem.rows[0]?.id;
          if (!existingId) throw new Error('Concurrent authorization item was not found');
          await client.query(
            `update import_rows set result_code = 'EXISTING_ITEM_REVIEW_REQUIRED', result_message = $2, confirmable = false, authorization_item_id = $3 where id = $1`,
            [row.id, importRowResultMessages.EXISTING_ITEM_REVIEW_REQUIRED, existingId],
          );
          concurrentExistingRows += 1;
          continue;
        }
        const sourceValue = rawText(sourceDataRecord(row.raw_data)?.CUPS_PRINCIPAL);
        await client.query(
          `insert into coverage_evaluations
             (authorization_item_id, evaluation_version, source_value, normalized_value, coverage_type, rule_version)
           values ($1, 1, $2, $3, $4, 'F2-COVERAGE-1')`,
          [itemId, sourceValue, classification.cupsPrincipalNormalized, classification.coverageType],
        );
        await client.query(
          `insert into authorization_item_organizations (authorization_item_id, organization_id)
           select $1, id from organizations where code = any($2::text[])
           on conflict do nothing`,
          [itemId, INITIAL_SCOPE_ORGANIZATION_CODES],
        );
        await this.insertAudit(client, {
          actorId: input.scope.userId,
          organizationId: input.scope.organizationId,
          action: 'AUTHORIZATION_ITEM_CREATED',
          resourceType: 'authorization_item',
          resourceId: itemId,
          after: { authorizationKey: classification.authorizationKey, batchId },
          correlationId: input.scope.correlationId,
        });
        await this.insertAudit(client, {
          actorId: input.scope.userId,
          organizationId: input.scope.organizationId,
          action: 'COVERAGE_CLASSIFIED',
          resourceType: 'authorization_item',
          resourceId: itemId,
          after: { coverageType: classification.coverageType, normalizedValue: classification.cupsPrincipalNormalized, ruleVersion: 'F2-COVERAGE-1' },
          correlationId: input.scope.correlationId,
        });
        if (classification.enablementStatus === 'BLOCKED_SOURCE_STATUS') {
          await this.insertAudit(client, {
            actorId: input.scope.userId,
            organizationId: input.scope.organizationId,
            action: 'SOURCE_STATUS_BLOCKED',
            resourceType: 'authorization_item',
            resourceId: itemId,
            after: { sourceStatus: classification.sourceStatusNormalized },
            correlationId: input.scope.correlationId,
          });
        }
        await client.query(
          `update import_rows set result_code = 'ITEM_CREATED', result_message = $2, confirmable = false, authorization_item_id = $3 where id = $1`,
          [row.id, importRowResultMessages.ITEM_CREATED, itemId],
        );
        createdRows += 1;
      }

      const completed = await client.query<{ confirmed_at: Date }>(
        `update import_batches
         set status = 'COMPLETED', confirmed_rows = $2, existing_rows = existing_rows + $3, confirmed_at = now(), completed_at = now()
         where id = $1
         returning confirmed_at`,
        [batchId, createdRows, concurrentExistingRows],
      );
      const confirmedAt = completed.rows[0]?.confirmed_at;
      if (!confirmedAt) throw new Error('Import batch confirmation timestamp was not created');
      await this.insertAudit(client, {
        actorId: input.scope.userId,
        organizationId: input.scope.organizationId,
        action: 'IMPORT_CONFIRMED',
        resourceType: 'import_batch',
        resourceId: batchId,
        after: { createdRows, existingRows: concurrentExistingRows },
        correlationId: input.scope.correlationId,
      });
      const response: ConfirmImportResponse = {
        batchId,
        status: 'COMPLETED',
        createdRows,
        existingRows: batch.existing_rows + concurrentExistingRows,
        confirmedAt: confirmedAt.toISOString(),
      };
      await this.storeIdempotency(client, idempotencyScope, input.idempotencyKey, requestHash, response);
      await client.query('commit');
      return response;
    } catch (error) {
      await client.query('rollback');
      if (isRetryableTransactionError(error)) {
        throw new ServiceUnavailableException({ code: 'TRANSACTION_RETRY_REQUIRED', message: 'The transaction could not complete; retry the request' });
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async findBatch(batchId: string, scope: Scope): Promise<BatchRow | undefined> {
    const result = await this.database.pool.query<BatchRow>(
      `select b.id, b.organization_id, b.original_filename, b.mime_type, b.size_bytes, b.sha256, b.status,
              b.total_rows, b.valid_rows, b.rejected_rows, b.duplicate_rows, b.existing_rows, b.confirmed_rows,
               b.last_error_code, b.created_at, b.completed_at, b.confirmed_at
       from import_batches b
        where b.id = $1 and b.organization_id = $2`,
      [batchId, scope.organizationId],
    );
    return result.rows[0];
  }

  private async storeIdempotency(
    client: { query: (query: string, values?: unknown[]) => Promise<unknown> },
    scope: string,
    key: string,
    hash: string,
    response: ConfirmImportResponse,
  ): Promise<void> {
    await client.query(
      `insert into idempotency_records (scope, key, request_hash, status_code, response, expires_at)
       values ($1, $2, $3, 200, $4::jsonb, now() + interval '24 hours')`,
      [scope, key, hash, JSON.stringify(response)],
    );
  }

  private async insertAudit(
    client: { query: (query: string, values?: unknown[]) => Promise<unknown> },
    input: {
      actorId: string;
      organizationId: string;
      action: string;
      resourceType: string;
      resourceId: string;
      after: unknown;
      correlationId: string;
    },
  ): Promise<void> {
    await client.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
         values ('USER', $1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'SUCCESS')`,
      [input.actorId, input.organizationId, input.action, input.resourceType, input.resourceId, JSON.stringify(input.after), input.correlationId, input.correlationId],
    );
  }
}
