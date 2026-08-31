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
  BULK_UPDATE_CONTRACT_VERSION,
  bulkUpdateBatchStatusSchema,
  bulkUpdateOperationContracts,
  bulkUpdateRowResultMessages,
  bulkUpdateRowResultCodeSchema,
  enabledBulkUpdateOperationTypes,
  type BulkUpdateBatchResponse,
  type BulkUpdateOperationType,
  type BulkUpdateRowResponse,
} from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';
import * as XLSX from 'xlsx';
import { DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';

type Database = ReturnType<typeof createDatabase>;

type BatchRow = {
  id: string;
  organization_id: string;
  operation_type: string;
  contract_version: number;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  status: string;
  total_rows: number;
  processed_rows: number;
  updated_rows: number;
  unchanged_rows: number;
  rejected_rows: number;
  last_error_code: string | null;
  created_at: Date;
  completed_at: Date | null;
};

type RowRecord = {
  id: string;
  row_number: number;
  result_code: string;
  result_message: string;
  authorization_key: string | null;
  authorization_item_id: string | null;
  field_name: string | null;
  previous_value: string | null;
  new_value: string | null;
  field_version: number | null;
  created_at: Date;
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

function toBatchResponse(row: BatchRow): BulkUpdateBatchResponse {
  const status = bulkUpdateBatchStatusSchema.parse(row.status);
  const operationType = bulkUpdateOperationContracts[
    row.operation_type as keyof typeof bulkUpdateOperationContracts
  ]
    ? (row.operation_type as BulkUpdateOperationType)
    : 'ASSIGN_DISPENSATION_LOCATION';
  return {
    id: row.id,
    operationType,
    status,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    contractVersion: row.contract_version,
    totalRows: row.total_rows,
    processedRows: row.processed_rows,
    updatedRows: row.updated_rows,
    unchangedRows: row.unchanged_rows,
    rejectedRows: row.rejected_rows,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
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

@Injectable()
export class BulkUpdatesService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async create(input: {
    operationType: string;
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer };
    idempotencyKey: string;
    scope: Scope;
  }): Promise<BulkUpdateBatchResponse> {
    if (
      !enabledBulkUpdateOperationTypes.includes(
        input.operationType as (typeof enabledBulkUpdateOperationTypes)[number],
      )
    ) {
      throw new BadRequestException({
        code: 'OPERATION_TYPE_NOT_ENABLED',
        message: 'El tipo de operación no está habilitado en esta fase.',
      });
    }
    const operationType = input.operationType as BulkUpdateOperationType;
    const contract = bulkUpdateOperationContracts[operationType];
    if (
      input.scope.organizationCode !== contract.actorOrganizationCode &&
      !input.scope.isFoundationAdmin
    ) {
      throw new ForbiddenException({
        code: 'ACTOR_NOT_ALLOWED',
        message: 'La organización no puede ejecutar este tipo de operación.',
      });
    }
    if (input.file.size <= 0) {
      throw new BadRequestException({
        code: 'BULK_FILE_EMPTY',
        message: 'El archivo de actualización no puede estar vacío.',
      });
    }
    if (input.file.size > 20 * 1024 * 1024) {
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: 'El archivo supera el máximo de 20 MB.',
      });
    }
    if (input.file.originalname.length > 255) {
      throw new BadRequestException({
        code: 'BULK_FILENAME_TOO_LONG',
        message: 'El nombre del archivo no puede superar 255 caracteres.',
      });
    }
    const contentHash = createHash('sha256').update(input.file.buffer).digest('hex');
    const requestHash = createHash('sha256')
      .update(`${operationType}\u0000${input.file.originalname}\u0000${contentHash}`)
      .digest('hex');
    const idempotencyScope = `bulk-updates.create:${input.scope.organizationId}`;
    const outboxIdempotencyKey = createHash('sha256')
      .update(
        `${operationType}:${input.scope.organizationId}:${contentHash}:${BULK_UPDATE_CONTRACT_VERSION}`,
      )
      .digest('hex');
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `${idempotencyScope}:${input.idempotencyKey}`,
      ]);
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `${operationType}:${input.scope.organizationId}:${contentHash}:${BULK_UPDATE_CONTRACT_VERSION}`,
      ]);
      await client.query(
        'delete from idempotency_records where scope = $1 and key = $2 and expires_at <= now()',
        [idempotencyScope, input.idempotencyKey],
      );
      const existing = await client.query<{
        request_hash: string;
        response: BulkUpdateBatchResponse;
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

      // SPEC-009: la clave de bulk update es operation_type + organización +
      // file_hash + contrato. Reenviar el mismo archivo deduplica al lote
      // original en lugar de crear otro trabajo.
      const replay = await client.query<BatchRow>(
        `select id, organization_id, operation_type, contract_version, original_filename, mime_type,
                size_bytes, sha256, status, total_rows, processed_rows, updated_rows, unchanged_rows,
                rejected_rows, last_error_code, created_at, completed_at
         from bulk_update_batches
         where organization_id = $1 and operation_type = $2 and sha256 = $3 and contract_version = $4`,
        [input.scope.organizationId, operationType, contentHash, BULK_UPDATE_CONTRACT_VERSION],
      );
      const replayed = replay.rows[0];
      if (replayed) {
        const replayResponse = toBatchResponse(replayed);
        await client.query(
          `insert into idempotency_records (scope, key, request_hash, status_code, response, expires_at)
           values ($1, $2, $3, 202, $4::jsonb, now() + interval '24 hours')`,
          [idempotencyScope, input.idempotencyKey, requestHash, JSON.stringify(replayResponse)],
        );
        await client.query('commit');
        return replayResponse;
      }

      const batchId = randomUUID();
      const eventId = randomUUID();
      const inserted = await client.query<BatchRow>(
        `insert into bulk_update_batches
           (id, organization_id, created_by, operation_type, contract_version, original_filename,
            mime_type, size_bytes, sha256, status, correlation_id, idempotency_key)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'CARGADO', $10, $11)
         returning id, organization_id, operation_type, contract_version, original_filename, mime_type,
                   size_bytes, sha256, status, total_rows, processed_rows, updated_rows, unchanged_rows,
                   rejected_rows, last_error_code, created_at, completed_at`,
        [
          batchId,
          input.scope.organizationId,
          input.scope.userId,
          operationType,
          BULK_UPDATE_CONTRACT_VERSION,
          input.file.originalname,
          input.file.mimetype,
          input.file.size,
          contentHash,
          input.scope.correlationId,
          outboxIdempotencyKey,
        ],
      );
      const batch = inserted.rows[0];
      if (!batch) throw new Error('Bulk update batch was not created');
      await client.query(
        `insert into bulk_update_source_files
           (id, batch_id, original_filename, mime_type, size_bytes, sha256, content)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          batchId,
          input.file.originalname,
          input.file.mimetype,
          input.file.size,
          contentHash,
          input.file.buffer,
        ],
      );
      const payload = {
        eventId,
        batchId,
        contractVersion: BULK_UPDATE_CONTRACT_VERSION,
        correlationId: input.scope.correlationId,
        idempotencyKey: outboxIdempotencyKey,
      };
      await client.query(
        `insert into audit_events
           (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
         values ('USER', $1, $2, 'BULK_UPDATE_CREATED', 'bulk_update_batch', $3, $4::jsonb, $5, $6, 'SUCCESS')`,
        [
          input.scope.userId,
          input.scope.organizationId,
          batchId,
          JSON.stringify({
            operationType,
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
         values ($1, 'authorization.bulk-update', ${BULK_UPDATE_CONTRACT_VERSION}, $2::jsonb, $3, $4, $5)`,
        [
          eventId,
          JSON.stringify(payload),
          input.scope.correlationId,
          input.scope.organizationId,
          outboxIdempotencyKey,
        ],
      );
      const response = toBatchResponse(batch);
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

  async getBatch(batchId: string, scope: Scope): Promise<BulkUpdateBatchResponse> {
    const row = await this.findBatch(parseUuid(batchId, 'batchId'), scope);
    if (!row) {
      throw new NotFoundException({
        code: 'BULK_UPDATE_NOT_FOUND',
        message: 'Bulk update batch not found',
      });
    }
    return toBatchResponse(row);
  }

  async getRows(input: { batchId: string; cursor?: string; limit: number; scope: Scope }): Promise<{
    items: BulkUpdateRowResponse[];
    nextCursor: string | null;
    resultCodeCounts: Record<string, number>;
  }> {
    const batchId = parseUuid(input.batchId, 'batchId');
    const batch = await this.findBatch(batchId, input.scope);
    if (!batch) {
      throw new NotFoundException({
        code: 'BULK_UPDATE_NOT_FOUND',
        message: 'Bulk update batch not found',
      });
    }
    const cursor = decodeRowCursor(input.cursor);
    const values: unknown[] = [batchId];
    let where = 'r.batch_id = $1';
    if (cursor !== undefined) {
      values.push(cursor);
      where += ` and r.row_number > $${values.length}`;
    }
    values.push(input.limit + 1);
    const [result, countResult] = await Promise.all([
      this.database.pool.query<RowRecord>(
        `select r.id, r.row_number, r.result_code, r.result_message, r.authorization_key,
              r.authorization_item_id, r.field_name, r.previous_value, r.new_value, r.field_version, r.created_at
       from bulk_update_rows r
       where ${where}
       order by r.row_number asc
       limit $${values.length}`,
        values,
      ),
      this.database.pool.query<{ result_code: string; count: string }>(
        `select result_code, count(*)::text as count
         from bulk_update_rows where batch_id = $1 group by result_code`,
        [batchId],
      ),
    ]);
    const hasNext = result.rows.length > input.limit;
    const rows = (hasNext ? result.rows.slice(0, input.limit) : result.rows).map((row) => {
      const resultCode = bulkUpdateRowResultCodeSchema.parse(row.result_code);
      return {
        id: row.id,
        rowNumber: row.row_number,
        resultCode,
        resultMessage: row.result_message || bulkUpdateRowResultMessages[resultCode],
        authorizationItemId: row.authorization_item_id,
        authorizationKey: row.authorization_key,
        fieldName: row.field_name,
        previousValue: row.previous_value,
        newValue: row.new_value,
        fieldVersion: row.field_version,
        createdAt: row.created_at.toISOString(),
      } satisfies BulkUpdateRowResponse;
    });
    const last = rows.at(-1);
    return {
      items: rows,
      nextCursor: hasNext && last ? encodeRowCursor(last.rowNumber) : null,
      resultCodeCounts: Object.fromEntries(
        countResult.rows.map((row) => [row.result_code, Number(row.count)]),
      ),
    };
  }

  async getReport(input: {
    batchId: string;
    format: 'csv' | 'xlsx';
    scope: Scope;
  }): Promise<{ filename: string; content: Buffer; contentType: string; rowCount: number }> {
    const batchId = parseUuid(input.batchId, 'batchId');
    const batch = await this.findBatch(batchId, input.scope);
    if (!batch) {
      throw new NotFoundException({
        code: 'BULK_UPDATE_NOT_FOUND',
        message: 'Bulk update batch not found',
      });
    }
    const rows = await this.database.pool.query<RowRecord>(
      `select r.id, r.row_number, r.result_code, r.result_message, r.authorization_key,
              r.authorization_item_id, r.field_name, r.previous_value, r.new_value, r.field_version, r.created_at
       from bulk_update_rows r
       where r.batch_id = $1
       order by r.row_number asc`,
      [batchId],
    );
    const header = [
      'row_number',
      'authorization_key',
      'result_code',
      'result_message',
      'field_name',
      'previous_value',
      'new_value',
      'field_version',
    ];
    const lines = [header.join(',')];
    for (const row of rows.rows) {
      lines.push(
        [
          csvValue(row.row_number),
          csvValue(row.authorization_key),
          csvValue(row.result_code),
          csvValue(row.result_message),
          csvValue(row.field_name),
          csvValue(row.previous_value),
          csvValue(row.new_value),
          csvValue(row.field_version),
        ].join(','),
      );
    }
    if (input.format === 'xlsx') {
      const data = rows.rows.map((row) => ({
        row_number: row.row_number,
        authorization_key: row.authorization_key
          ? safeSpreadsheetValue(row.authorization_key)
          : null,
        result_code: safeSpreadsheetValue(row.result_code),
        result_message: safeSpreadsheetValue(row.result_message),
        field_name: row.field_name ? safeSpreadsheetValue(row.field_name) : null,
        previous_value: row.previous_value ? safeSpreadsheetValue(row.previous_value) : null,
        new_value: row.new_value ? safeSpreadsheetValue(row.new_value) : null,
        field_version: row.field_version,
      }));
      const sheet = XLSX.utils.json_to_sheet(data, { header });
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'bulk-update-results');
      return {
        filename: `bulk-update-${batchId}-report.xlsx`,
        content: Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        rowCount: rows.rows.length,
      };
    }
    return {
      filename: `bulk-update-${batchId}-report.csv`,
      content: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      rowCount: rows.rows.length,
    };
  }

  private async findBatch(batchId: string, scope: Scope): Promise<BatchRow | undefined> {
    const result = await this.database.pool.query<BatchRow>(
      `select b.id, b.organization_id, b.operation_type, b.contract_version, b.original_filename,
              b.mime_type, b.size_bytes, b.sha256, b.status, b.total_rows, b.processed_rows,
              b.updated_rows, b.unchanged_rows, b.rejected_rows, b.last_error_code, b.created_at, b.completed_at
       from bulk_update_batches b
        where b.id = $1 and b.organization_id = $2`,
      [batchId, scope.organizationId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const contract = bulkUpdateOperationContracts[row.operation_type as BulkUpdateOperationType];
    if (
      !contract ||
      (scope.organizationCode !== contract.actorOrganizationCode && !scope.isFoundationAdmin)
    )
      return undefined;
    const permission = await this.database.pool.query(
      `select 1
       from user_organization_roles uor
       inner join role_permissions rp on rp.role_id = uor.role_id
       inner join permissions p on p.id = rp.permission_id
       where uor.user_id = $1 and uor.organization_id = $2 and uor.active = true and p.code = $3`,
      [scope.userId, scope.organizationId, contract.permission],
    );
    return permission.rowCount ? row : undefined;
  }
}
