import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  authorizationClassificationSchema,
  authorizationItemListQuerySchema,
  importRowResultMessages,
  mipresRecheckRequestResponseSchema,
  type AuthorizationItemDetailResponse,
  type AuthorizationItemResponse,
  type AuthorizationItemListQuery,
  type MipresRecheckRequestResponse,
} from '@authorization/contracts';
import type { ApiConfig } from '@authorization/config';
import type { createDatabase } from '@authorization/database';
import {
  currentBogotaDate,
  deriveApplicationSiteStatus,
  deriveOperationStatus,
} from '@authorization/domain';
import { API_CONFIG, DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';
import { AuditsService } from '../audits/audits.service';

type Database = ReturnType<typeof createDatabase>;

type ItemRow = {
  id: string;
  numero_autorizacion: string;
  codigo_medicamento: string;
  authorization_key: string;
  source_data: unknown;
  source_status_normalized: string;
  source_prescripcion_normalized: string;
  no_prescripcion: string;
  enablement_status: string;
  coverage_type: string;
  direction_status: string;
  operation_status: string | null;
  coverage_rule_version: string;
  lugar_dispensacion: string | null;
  fecha_dispensacion: string | null;
  fecha_aplicacion: string | null;
  audit_status: AuthorizationItemResponse['auditStatus'];
  admission_status: string;
  operational_version: number;
  tariff_membership_status: 'NOT_EVALUATED' | 'LISTED' | 'NOT_LISTED';
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

function evidenceHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value) ?? 'null')
    .digest('hex');
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
    sourcePrescripcionNormalized: row.source_prescripcion_normalized,
    noPrescripcion: row.no_prescripcion,
    lugarDispensacion: row.lugar_dispensacion,
    fechaDispensacion: row.fecha_dispensacion,
    fechaAplicacion: row.fecha_aplicacion,
    auditStatus: row.audit_status,
    admissionStatus: row.admission_status as AuthorizationItemResponse['admissionStatus'],
    applicationSiteStatus: deriveApplicationSiteStatus(row.lugar_dispensacion),
    operationalVersion: row.operational_version,
    coverageRuleVersion: row.coverage_rule_version,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class AuthorizationItemsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly audits: AuditsService,
  ) {}

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
    if (query.applicationSiteStatus)
      conditions.push(
        query.applicationSiteStatus === 'ASSIGNED'
          ? `i.lugar_dispensacion is not null and i.lugar_dispensacion <> ''`
          : `(i.lugar_dispensacion is null or i.lugar_dispensacion = '')`,
      );
    if (query.auditStatus) conditions.push(`i.audit_status = ${add(query.auditStatus)}`);
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
      `select i.id, i.numero_autorizacion, i.codigo_medicamento, i.authorization_key, i.source_data,
              i.source_status_normalized, i.source_prescripcion_normalized, i.no_prescripcion, i.enablement_status,
               i.coverage_type, i.direction_status, i.operation_status, i.coverage_rule_version, i.lugar_dispensacion,
               i.fecha_dispensacion::text, i.fecha_aplicacion::text, i.audit_status, i.admission_status, i.operational_version, i.version,
              i.created_at, i.updated_at
       from authorization_items i
       where ${conditions.join(' and ')}
       order by i.created_at desc, i.id desc
       limit ${limit}`,
      values,
    );
    const hasNext = result.rows.length > query.limit;
    const rows = hasNext ? result.rows.slice(0, query.limit) : result.rows;
    const items = rows.map((row) => toItemResponse(row, input.scope.readSensitive));
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
    const auditReviews = await this.audits.listForItem(id, scope);
    return {
      item: toItemResponse(row, scope.readSensitive),
      importHistory: history.rows.map((entry) => ({
        batchId: entry.batch_id,
        rowNumber: entry.row_number,
        resultCode:
          entry.result_code as AuthorizationItemDetailResponse['importHistory'][number]['resultCode'],
        createdAt: entry.created_at.toISOString(),
      })),
      auditReviews,
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
    const idempotencyKeyHash = createHash('sha256').update(input.idempotencyKey).digest('hex');
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `${idempotencyScope}:${input.idempotencyKey}`,
      ]);
      const access = await client.query<{ organization_code: string; role_id: string }>(
        `select o.code as organization_code, uor.role_id
         from users u
         inner join user_organization_roles uor on uor.user_id = u.id
         inner join organizations o on o.id = uor.organization_id
         where u.id = $1 and u.active = true and uor.organization_id = $2
           and uor.active = true and o.active = true
         for share of u, uor, o`,
        [input.scope.userId, input.scope.organizationId],
      );
      if (access.rows.length === 0) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: 'Permission denied for organization',
        });
      }
      const currentPermissions = await client.query<{ code: string }>(
        `select p.code
         from role_permissions rp
         inner join permissions p on p.id = rp.permission_id
         where rp.role_id = any($1::uuid[])
           and p.code in ('imports.confirm', 'authorizations.read_sensitive')
         for share of rp, p`,
        [[...new Set(access.rows.map((row) => row.role_id))]],
      );
      const permissionCodes = new Set(currentPermissions.rows.map((row) => row.code));
      if (!permissionCodes.has('imports.confirm')) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: 'Permission denied for organization',
        });
      }
      const currentReadSensitive = permissionCodes.has('authorizations.read_sensitive');
      const currentOrganizationCode = access.rows[0]?.organization_code;
      if (currentOrganizationCode !== 'MTD') {
        const relationship = await client.query(
          `select authorization_item_id
           from authorization_item_organizations
           where authorization_item_id = $1 and organization_id = $2
           for share`,
          [itemId, input.scope.organizationId],
        );
        if (relationship.rows.length === 0) {
          throw new NotFoundException({
            code: 'AUTHORIZATION_ITEM_NOT_FOUND',
            message: 'Authorization item not found',
          });
        }
      }
      await client.query(
        'delete from idempotency_records where scope = $1 and key = $2 and expires_at <= now()',
        [idempotencyScope, input.idempotencyKey],
      );
      const itemResult = await client.query<ItemRow>(
        `select i.id, i.numero_autorizacion, i.codigo_medicamento, i.authorization_key, i.source_data,
                i.source_status_normalized, i.source_prescripcion_normalized, i.no_prescripcion, i.enablement_status,
                 i.coverage_type, i.direction_status, i.operation_status, i.coverage_rule_version, i.lugar_dispensacion,
                 i.fecha_dispensacion::text, i.fecha_aplicacion::text, i.audit_status, i.admission_status, i.operational_version,
                 i.tariff_membership_status, i.version,
                i.created_at, i.updated_at
         from authorization_items i
         where i.id = $1
         for update`,
        [itemId],
      );
      const item = itemResult.rows[0];
      if (!item)
        throw new NotFoundException({
          code: 'AUTHORIZATION_ITEM_NOT_FOUND',
          message: 'Authorization item not found',
        });
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
        let replaySourceData: Record<string, unknown> | null = null;
        if (currentReadSensitive) {
          const replayEvidence = await client.query<{ raw_data: unknown }>(
            `select r.raw_data
             from import_rows r
             inner join import_batches b on b.id = r.import_batch_id
             where r.id = $1 and r.authorization_item_id = $2 and r.result_code = 'ITEM_UPDATED'
               and b.organization_id = $3`,
            [previous.response.rowId, itemId, input.scope.organizationId],
          );
          replaySourceData = sourceDataRecord(replayEvidence.rows[0]?.raw_data);
          if (!replaySourceData) throw new Error('Idempotent source evidence was not found');
          await this.insertReadAudit(itemId, input.scope, client);
        }
        await client.query('commit');
        return {
          ...previous.response,
          item: {
            ...previous.response.item,
            sourceData: replaySourceData,
          },
        };
      }

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
      const previousEvidence = await client.query<{ id: string; raw_data: unknown }>(
        `select id, raw_data
         from import_rows
         where authorization_item_id = $1 and result_code in ('ITEM_CREATED', 'ITEM_UPDATED')
         order by created_at desc, id desc
         limit 1`,
        [itemId],
      );
      const previousEvidenceRow = previousEvidence.rows[0];
      if (!previousEvidenceRow) throw new Error('Previous source evidence was not found');

      const rawSource = (row.raw_data ?? {}) as Record<string, unknown>;
      const operationStatus = deriveOperationStatus({
        enablementStatus: classification.data.enablementStatus,
        coverageType: classification.data.coverageType,
        directionStatus: classification.data.directionStatus,
        productInTariffAnnex: item.tariff_membership_status === 'LISTED',
        fechaFinalVigencia: rawSource.FECHA_FINAL_VIGENCIA,
        today: currentBogotaDate(),
      });
      const updated = await client.query<ItemRow>(
        `update authorization_items set
           source_data = $2::jsonb, source_status_normalized = $3, source_prescripcion_normalized = $4,
           no_prescripcion = $5, enablement_status = $6, coverage_type = $7, direction_status = $8,
           operation_status = $9, coverage_rule_version = 'F2-COVERAGE-2', version = version + 1, updated_at = now()
          where id = $1 and version = $10
          returning id, numero_autorizacion, codigo_medicamento, authorization_key, source_data,
                   source_status_normalized, source_prescripcion_normalized, no_prescripcion, enablement_status,
                    coverage_type, direction_status, operation_status, coverage_rule_version, lugar_dispensacion,
                    fecha_dispensacion::text, fecha_aplicacion::text, audit_status, admission_status,
                   operational_version, version, created_at, updated_at`,
        [
          itemId,
          JSON.stringify(row.raw_data),
          classification.data.sourceStatusNormalized,
          classification.data.prescripcionNormalized,
          classification.data.noPrescripcion,
          classification.data.enablementStatus,
          classification.data.coverageType,
          classification.data.directionStatus,
          operationStatus,
          input.expectedVersion,
        ],
      );
      const changed = updated.rows[0];
      if (!changed)
        throw new ConflictException({
          code: 'VERSION_CONFLICT',
          message: 'Authorization item version has changed',
        });
      const sourceValue = rawText(sourceDataRecord(row.raw_data)?.NUMERO_PRESCRIPCION);
      await client.query(
        `insert into coverage_evaluations
           (authorization_item_id, evaluation_version, source_value, normalized_value, coverage_type, rule_version)
         values ($1, $2, $3, $4, $5, 'F2-COVERAGE-2')`,
        [
          itemId,
          changed.version,
          sourceValue,
          classification.data.prescripcionNormalized,
          classification.data.coverageType,
        ],
      );
      await client.query(
        `update import_rows set result_code = 'ITEM_UPDATED', result_message = $2, confirmable = false where id = $1`,
        [rowId, importRowResultMessages.ITEM_UPDATED],
      );
      const storedResponse = {
        item: toItemResponse(changed, false),
        rowId,
        resultCode: 'ITEM_UPDATED' as const,
      };
      const idempotencyRecord = await client.query<{ id: string }>(
        `insert into idempotency_records (scope, key, request_hash, status_code, response, expires_at)
         values ($1, $2, $3, 200, $4::jsonb, now() + interval '24 hours')
         returning id`,
        [idempotencyScope, input.idempotencyKey, requestHash, JSON.stringify(storedResponse)],
      );
      const idempotencyRecordId = idempotencyRecord.rows[0]?.id;
      if (!idempotencyRecordId) throw new Error('Idempotency record was not created');
      await this.insertAudit(client, {
        actorId: input.scope.userId,
        organizationId: input.scope.organizationId,
        action: 'AUTHORIZATION_ITEM_UPDATED',
        resourceType: 'authorization_item',
        resourceId: itemId,
        before: {
          version: item.version,
          authorizationKey: item.authorization_key,
          numeroAutorizacionNormalized: item.numero_autorizacion,
          codigoComercialNormalized: item.codigo_medicamento,
          sourceEvidence: {
            importRowId: previousEvidenceRow.id,
            sha256: evidenceHash(previousEvidenceRow.raw_data),
          },
          sourceStatusNormalized: item.source_status_normalized,
          sourcePrescripcionNormalized: item.source_prescripcion_normalized,
          noPrescripcion: item.no_prescripcion,
          coverageType: item.coverage_type,
          enablementStatus: item.enablement_status,
          directionStatus: item.direction_status,
          operationStatus: item.operation_status,
          coverageRuleVersion: item.coverage_rule_version,
        },
        after: {
          version: changed.version,
          authorizationKey: changed.authorization_key,
          numeroAutorizacionNormalized: changed.numero_autorizacion,
          codigoComercialNormalized: changed.codigo_medicamento,
          sourceEvidence: {
            importRowId: rowId,
            sha256: evidenceHash(row.raw_data),
          },
          sourceStatusNormalized: changed.source_status_normalized,
          sourcePrescripcionNormalized: changed.source_prescripcion_normalized,
          noPrescripcion: changed.no_prescripcion,
          coverageType: changed.coverage_type,
          enablementStatus: changed.enablement_status,
          directionStatus: changed.direction_status,
          operationStatus: changed.operation_status,
          coverageRuleVersion: changed.coverage_rule_version,
          idempotency: {
            recordId: idempotencyRecordId,
            scope: idempotencyScope,
            requestHash,
            keyHash: idempotencyKeyHash,
          },
        },
        correlationId: input.scope.correlationId,
      });
      const response = {
        ...storedResponse,
        item: {
          ...storedResponse.item,
          sourceData: currentReadSensitive ? sourceDataRecord(changed.source_data) : null,
        },
      };
      await client.query('commit');
      return response;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async requestMipresRecheck(input: {
    itemId: string;
    idempotencyKey: string;
    scope: Scope;
  }): Promise<MipresRecheckRequestResponse> {
    const itemId = parseUuid(input.itemId);
    const idempotencyScope = `mipres.recheck:${input.scope.organizationId}:${itemId}`;
    const requestHash = createHash('sha256').update(itemId).digest('hex');
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `${idempotencyScope}:${input.idempotencyKey}`,
      ]);
      const access = await client.query<{ organization_code: string; role_id: string }>(
        `select o.code as organization_code, uor.role_id
         from users u
         inner join user_organization_roles uor on uor.user_id = u.id
         inner join organizations o on o.id = uor.organization_id
         where u.id = $1 and u.active = true and uor.organization_id = $2
           and uor.active = true and o.active = true
         for share of u, uor, o`,
        [input.scope.userId, input.scope.organizationId],
      );
      if (access.rows.length === 0) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: 'Permission denied for organization',
        });
      }
      const permissions = await client.query<{ code: string }>(
        `select p.code
         from role_permissions rp
         inner join permissions p on p.id = rp.permission_id
         where rp.role_id = any($1::uuid[]) and p.code in ('mipres.recheck')
         for share of rp, p`,
        [[...new Set(access.rows.map((row) => row.role_id))]],
      );
      if (permissions.rows.length === 0) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: 'Permission denied for organization',
        });
      }
      const organizationCode = access.rows[0]?.organization_code;
      if (organizationCode !== 'MTD') {
        const relationship = await client.query(
          `select authorization_item_id
           from authorization_item_organizations
           where authorization_item_id = $1 and organization_id = $2
           for share`,
          [itemId, input.scope.organizationId],
        );
        if (relationship.rows.length === 0) {
          throw new NotFoundException({
            code: 'AUTHORIZATION_ITEM_NOT_FOUND',
            message: 'Authorization item not found',
          });
        }
      }
      await client.query(
        'delete from idempotency_records where scope = $1 and key = $2 and expires_at <= now()',
        [idempotencyScope, input.idempotencyKey],
      );
      const existingIdempotency = await client.query<{
        request_hash: string;
        response: MipresRecheckRequestResponse;
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

      const item = await client.query<{
        id: string;
        no_prescripcion: string;
        enablement_status: string;
        coverage_type: string;
      }>(
        `select id, no_prescripcion, enablement_status, coverage_type
         from authorization_items where id = $1 for update`,
        [itemId],
      );
      const row = item.rows[0];
      if (!row) {
        throw new NotFoundException({
          code: 'AUTHORIZATION_ITEM_NOT_FOUND',
          message: 'Authorization item not found',
        });
      }
      if (row.coverage_type !== 'NO_PBS' || row.enablement_status !== 'ENABLED') {
        throw new ConflictException({
          code: 'MIPRES_RECHECK_NOT_APPLICABLE',
          message: 'Only enabled NO_PBS items can request a MIPRES recheck',
        });
      }
      if (!row.no_prescripcion) {
        throw new ConflictException({
          code: 'MIPRES_RECHECK_NOT_APPLICABLE',
          message: 'The authorization item has no prescription number',
        });
      }
      const checkDate = currentBogotaDate();
      const manualChecks = await client.query<{ count: string }>(
        `select count(*)::text as count
         from mipres_checks
         where authorization_item_id = $1 and query_type = 'MANUAL' and check_date = $2`,
        [itemId, checkDate],
      );
      if (
        Number.parseInt(manualChecks.rows[0]?.count ?? '0', 10) >=
        this.config.MIPRES_MANUAL_RECHECK_DAILY_LIMIT
      ) {
        throw new HttpException(
          {
            code: 'MIPRES_RECHECK_RATE_LIMITED',
            message: 'Manual MIPRES recheck daily limit reached for this item',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const eventId = randomUUID();
      const idempotencyKeyHash = createHash('sha256').update(input.idempotencyKey).digest('hex');
      const idempotencyKey =
        `mipres:manual:${itemId}:${input.scope.userId}:${idempotencyKeyHash}`.slice(0, 200);
      const payload = {
        eventId,
        itemId,
        prescriptionNumber: row.no_prescripcion,
        queryType: 'MANUAL',
        requestedBy: input.scope.userId,
        correlationId: input.scope.correlationId,
        idempotencyKey,
      };
      await client.query(
        `insert into outbox_events
           (id, event_type, version, payload, correlation_id, organization_id, idempotency_key)
         values ($1, 'authorization.mipres-recheck', 1, $2::jsonb, $3, $4, $5)`,
        [
          eventId,
          JSON.stringify(payload),
          input.scope.correlationId,
          input.scope.organizationId,
          idempotencyKey,
        ],
      );
      await client.query(
        `insert into audit_events
           (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
         values ('USER', $1, $2, 'MIPRES_RECHECK_REQUESTED', 'authorization_item', $3, $4::jsonb, $5, $6, 'SUCCESS')`,
        [
          input.scope.userId,
          input.scope.organizationId,
          itemId,
          JSON.stringify({
            prescriptionNumber: row.no_prescripcion,
            queryType: 'MANUAL',
            outboxEventId: eventId,
          }),
          input.scope.correlationId,
          input.scope.correlationId,
        ],
      );
      const response = mipresRecheckRequestResponseSchema.parse({
        itemId,
        status: 'QUEUED',
        queryType: 'MANUAL',
        correlationId: input.scope.correlationId,
      });
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

  private async findItem(
    itemId: string,
    scope: Scope,
    includeSourceData: boolean,
  ): Promise<ItemRow | undefined> {
    const result = await this.database.pool.query<ItemRow>(
      `select i.id, i.numero_autorizacion, i.codigo_medicamento, i.authorization_key,
                ${includeSourceData ? 'i.source_data' : 'null::jsonb'} as source_data,
                i.source_status_normalized, i.source_prescripcion_normalized, i.no_prescripcion, i.enablement_status,
                 i.coverage_type, i.direction_status, i.operation_status, i.coverage_rule_version, i.lugar_dispensacion,
                 i.fecha_dispensacion::text, i.fecha_aplicacion::text, i.audit_status, i.admission_status, i.operational_version, i.version,
                i.created_at, i.updated_at
         from authorization_items i
         where i.id = $1
           and ($2::boolean = true or exists (select 1 from authorization_item_organizations aio where aio.authorization_item_id = i.id and aio.organization_id = $3))`,
      [itemId, scope.organizationCode === 'MTD', scope.organizationId],
    );
    return result.rows[0];
  }

  private async insertReadAudit(
    itemId: string,
    scope: Scope,
    client: { query: (query: string, values?: unknown[]) => Promise<unknown> } = this.database.pool,
  ): Promise<void> {
    await client.query(
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
