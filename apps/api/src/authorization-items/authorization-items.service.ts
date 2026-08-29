import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  authorizationClassificationSchema,
  authorizationItemListQuerySchema,
  importRowResultMessages,
  type AuthorizationItemDetailResponse,
  type AuthorizationItemResponse,
  type AuthorizationItemListQuery,
} from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';

type Database = ReturnType<typeof createDatabase>;

type ItemRow = {
  id: string;
  numero_autorizacion: string;
  codigo_medicamento: string;
  authorization_key: string;
  source_data: unknown;
  source_status_normalized: string;
  source_cups_principal_normalized: string;
  enablement_status: string;
  coverage_type: string;
  direction_status: string;
  operation_status: string | null;
  coverage_rule_version: string;
  version: number;
  created_at: Date;
  updated_at: Date;
};

type HistoryRow = {
  batch_id: string;
  row_number: number;
  result_code: string;
  created_at: Date;
};

function parseUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ConflictException({
      code: 'INVALID_IDENTIFIER',
      message: 'authorization item identifier must be a UUID',
    });
  }
  return value;
}

function encodeItemCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id }), 'utf8').toString(
    'base64url',
  );
}

function decodeItemCursor(cursor: string | undefined): { createdAt: Date; id: string } | undefined {
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
    return { createdAt: new Date(value.createdAt), id: parseUuid(value.id) };
  } catch {
    throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'Invalid pagination cursor' });
  }
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

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function toItemResponse(row: ItemRow, includeSourceData: boolean): AuthorizationItemResponse {
  return {
    id: row.id,
    numeroAutorizacion: row.numero_autorizacion,
    codigoMedicamento: row.codigo_medicamento,
    authorizationKey: row.authorization_key,
    enablementStatus: row.enablement_status as AuthorizationItemResponse['enablementStatus'],
    coverageType: row.coverage_type as AuthorizationItemResponse['coverageType'],
    directionStatus: row.direction_status as AuthorizationItemResponse['directionStatus'],
    operationStatus: row.operation_status as AuthorizationItemResponse['operationStatus'],
    sourceData: includeSourceData ? sourceDataRecord(row.source_data) : null,
    sourceCupsPrincipalNormalized: row.source_cups_principal_normalized,
    coverageRuleVersion: row.coverage_rule_version,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class AuthorizationItemsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async list(input: {
    query: AuthorizationItemListQuery;
    scope: Scope;
  }): Promise<{ items: AuthorizationItemResponse[]; nextCursor: string | null }> {
    const query = authorizationItemListQuerySchema.parse(input.query);
    const cursor = decodeItemCursor(query.cursor);
    const values: unknown[] = [input.scope.organizationCode === 'MTD', input.scope.organizationId];
    const conditions = [
      `( $1::boolean = true or exists (select 1 from authorization_item_organizations aio where aio.authorization_item_id = i.id and aio.organization_id = $2) )`,
    ];
    const add = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };
    if (query.coverageType) conditions.push(`i.coverage_type = ${add(query.coverageType)}`);
    if (query.enablementStatus)
      conditions.push(`i.enablement_status = ${add(query.enablementStatus)}`);
    if (query.directionStatus)
      conditions.push(`i.direction_status = ${add(query.directionStatus)}`);
    if (query.operationStatus)
      conditions.push(`i.operation_status = ${add(query.operationStatus)}`);
    if (query.authorizationKey)
      conditions.push(
        `i.authorization_key ilike ${add(`%${escapeLikePattern(query.authorizationKey)}%`)} escape '\\'`,
      );
    if (cursor) {
      const createdAt = add(cursor.createdAt);
      const id = add(cursor.id);
      conditions.push(
        `(i.created_at < ${createdAt} or (i.created_at = ${createdAt} and i.id < ${id}))`,
      );
    }
    const limit = add(query.limit + 1);
    const result = await this.database.pool.query<ItemRow>(
      `select i.id, i.numero_autorizacion, i.codigo_medicamento, i.authorization_key, null::jsonb as source_data,
              i.source_status_normalized, i.source_cups_principal_normalized, i.enablement_status, i.coverage_type,
              i.direction_status, i.operation_status, i.coverage_rule_version, i.version, i.created_at, i.updated_at
       from authorization_items i
       where ${conditions.join(' and ')}
       order by i.created_at desc, i.id desc
       limit ${limit}`,
      values,
    );
    const hasNext = result.rows.length > query.limit;
    const rows = hasNext ? result.rows.slice(0, query.limit) : result.rows;
    const items = rows.map((row) => toItemResponse(row, false));
    const last = rows.at(-1);
    return {
      items,
      nextCursor: hasNext && last ? encodeItemCursor(last.created_at, last.id) : null,
    };
  }

  async get(itemId: string, scope: Scope): Promise<AuthorizationItemDetailResponse> {
    const id = parseUuid(itemId);
    const row = await this.findItem(id, scope, scope.readSensitive);
    if (!row)
      throw new NotFoundException({
        code: 'AUTHORIZATION_ITEM_NOT_FOUND',
        message: 'Authorization item not found',
      });
    const history = await this.database.pool.query<HistoryRow>(
      `select r.import_batch_id as batch_id, r.row_number, r.result_code, r.created_at
       from import_rows r where r.authorization_item_id = $1 order by r.created_at asc, r.row_number asc`,
      [id],
    );
    if (scope.readSensitive) {
      await this.insertReadAudit(id, scope);
    }
    return {
      item: toItemResponse(row, scope.readSensitive),
      importHistory: history.rows.map((entry) => ({
        batchId: entry.batch_id,
        rowNumber: entry.row_number,
        resultCode:
          entry.result_code as AuthorizationItemDetailResponse['importHistory'][number]['resultCode'],
        createdAt: entry.created_at.toISOString(),
      })),
    };
  }

  async updateFromImport(input: {
    itemId: string;
    importRowId: string;
    expectedVersion: number;
    idempotencyKey: string;
    scope: Scope;
  }): Promise<{ item: AuthorizationItemResponse; rowId: string; resultCode: 'ITEM_UPDATED' }> {
    const itemId = parseUuid(input.itemId);
    const rowId = parseUuid(input.importRowId);
    const idempotencyScope = `authorization-items.update:${input.scope.organizationId}:${itemId}`;
    const requestHash = createHash('sha256')
      .update(`${rowId}:${input.expectedVersion}`)
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
      const existingIdempotency = await client.query<{
        request_hash: string;
        response: { item: AuthorizationItemResponse; rowId: string; resultCode: 'ITEM_UPDATED' };
      }>('select request_hash, response from idempotency_records where scope = $1 and key = $2', [
        idempotencyScope,
        input.idempotencyKey,
      ]);
      const previous = existingIdempotency.rows[0];
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

      const itemResult = await client.query<ItemRow>(
        `select i.id, i.numero_autorizacion, i.codigo_medicamento, i.authorization_key, i.source_data,
                i.source_status_normalized, i.source_cups_principal_normalized, i.enablement_status, i.coverage_type,
                i.direction_status, i.operation_status, i.coverage_rule_version, i.version, i.created_at, i.updated_at
         from authorization_items i
         where i.id = $1
           and ($2::boolean = true or exists (select 1 from authorization_item_organizations aio where aio.authorization_item_id = i.id and aio.organization_id = $3))
         for update`,
        [itemId, input.scope.organizationCode === 'MTD', input.scope.organizationId],
      );
      const item = itemResult.rows[0];
      if (!item)
        throw new NotFoundException({
          code: 'AUTHORIZATION_ITEM_NOT_FOUND',
          message: 'Authorization item not found',
        });
      if (item.operation_status !== 'READY_TO_DISPENSE') {
        throw new ConflictException({
          code: 'EXPLICIT_UPDATE_NOT_ALLOWED',
          message: importRowResultMessages.EXPLICIT_UPDATE_NOT_ALLOWED,
        });
      }
      if (item.version !== input.expectedVersion) {
        throw new ConflictException({
          code: 'VERSION_CONFLICT',
          message: 'Authorization item version has changed',
        });
      }

      const sourceRow = await client.query<{
        id: string;
        raw_data: unknown;
        normalized_data: unknown;
        authorization_item_id: string | null;
      }>(
        `select r.id, r.raw_data, r.normalized_data, r.authorization_item_id
         from import_rows r
         inner join import_batches b on b.id = r.import_batch_id
          where r.id = $1 and r.authorization_item_id = $2 and r.result_code = 'EXISTING_ITEM_REVIEW_REQUIRED'
            and b.organization_id = $3`,
        [rowId, itemId, input.scope.organizationId],
      );
      const row = sourceRow.rows[0];
      if (!row)
        throw new ConflictException({
          code: 'SOURCE_UPDATE_ROW_INVALID',
          message: 'Import row is not eligible for this update',
        });
      const classification = authorizationClassificationSchema.safeParse(row.normalized_data);
      if (
        !classification.success ||
        classification.data.authorizationKey !== item.authorization_key
      ) {
        throw new ConflictException({
          code: 'SOURCE_UPDATE_KEY_MISMATCH',
          message: 'Import row does not match the authorization item',
        });
      }

      const updated = await client.query<ItemRow>(
        `update authorization_items set
           source_data = $2::jsonb, source_status_normalized = $3, source_cups_principal_normalized = $4,
           enablement_status = $5, coverage_type = $6, direction_status = $7,
           coverage_rule_version = 'F2-COVERAGE-1', version = version + 1, updated_at = now()
         where id = $1 and version = $8
         returning id, numero_autorizacion, codigo_medicamento, authorization_key, source_data,
                   source_status_normalized, source_cups_principal_normalized, enablement_status, coverage_type,
                   direction_status, operation_status, coverage_rule_version, version, created_at, updated_at`,
        [
          itemId,
          JSON.stringify(row.raw_data),
          classification.data.sourceStatusNormalized,
          classification.data.cupsPrincipalNormalized,
          classification.data.enablementStatus,
          classification.data.coverageType,
          classification.data.directionStatus,
          input.expectedVersion,
        ],
      );
      const changed = updated.rows[0];
      if (!changed)
        throw new ConflictException({
          code: 'VERSION_CONFLICT',
          message: 'Authorization item version has changed',
        });
      const sourceValue = rawText(sourceDataRecord(row.raw_data)?.CUPS_PRINCIPAL);
      await client.query(
        `insert into coverage_evaluations
           (authorization_item_id, evaluation_version, source_value, normalized_value, coverage_type, rule_version)
         values ($1, $2, $3, $4, $5, 'F2-COVERAGE-1')`,
        [
          itemId,
          changed.version,
          sourceValue,
          classification.data.cupsPrincipalNormalized,
          classification.data.coverageType,
        ],
      );
      await client.query(
        `update import_rows set result_code = 'ITEM_UPDATED', result_message = $2, confirmable = false where id = $1`,
        [rowId, importRowResultMessages.ITEM_UPDATED],
      );
      await this.insertAudit(client, {
        actorId: input.scope.userId,
        organizationId: input.scope.organizationId,
        action: 'AUTHORIZATION_ITEM_UPDATED',
        resourceType: 'authorization_item',
        resourceId: itemId,
        before: {
          version: item.version,
          authorizationKey: item.authorization_key,
          coverageType: item.coverage_type,
          enablementStatus: item.enablement_status,
        },
        after: {
          version: changed.version,
          authorizationKey: changed.authorization_key,
          coverageType: changed.coverage_type,
          enablementStatus: changed.enablement_status,
        },
        correlationId: input.scope.correlationId,
      });
      const response = {
        item: toItemResponse(changed, input.scope.readSensitive),
        rowId,
        resultCode: 'ITEM_UPDATED' as const,
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

  private async findItem(
    itemId: string,
    scope: Scope,
    includeSourceData: boolean,
  ): Promise<ItemRow | undefined> {
    const result = await this.database.pool.query<ItemRow>(
      `select i.id, i.numero_autorizacion, i.codigo_medicamento, i.authorization_key,
              ${includeSourceData ? 'i.source_data' : 'null::jsonb'} as source_data,
              i.source_status_normalized, i.source_cups_principal_normalized, i.enablement_status, i.coverage_type,
              i.direction_status, i.operation_status, i.coverage_rule_version, i.version, i.created_at, i.updated_at
       from authorization_items i
       where i.id = $1
         and ($2::boolean = true or exists (select 1 from authorization_item_organizations aio where aio.authorization_item_id = i.id and aio.organization_id = $3))`,
      [itemId, scope.organizationCode === 'MTD', scope.organizationId],
    );
    return result.rows[0];
  }

  private async insertReadAudit(itemId: string, scope: Scope): Promise<void> {
    await this.database.pool.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, correlation_id, request_id, result)
       values ('USER', $1, $2, 'AUTHORIZATION_ITEM_READ_SENSITIVE', 'authorization_item', $3, $4, $5, 'SUCCESS')`,
      [scope.userId, scope.organizationId, itemId, scope.correlationId, scope.correlationId],
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
      before: unknown;
      after: unknown;
      correlationId: string;
    },
  ): Promise<void> {
    await client.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, before, after, correlation_id, request_id, result)
       values ('USER', $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, 'SUCCESS')`,
      [
        input.actorId,
        input.organizationId,
        input.action,
        input.resourceType,
        input.resourceId,
        JSON.stringify(input.before),
        JSON.stringify(input.after),
        input.correlationId,
        input.correlationId,
      ],
    );
  }
}
