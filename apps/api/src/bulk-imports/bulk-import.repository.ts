import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  BulkImportJobResponse,
  BulkImportJobStatus,
  BulkImportRowExecutionStatus,
  BulkImportRowResponse,
  BulkImportRowValidationStatus,
} from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';
import {
  BULK_IMPORT_ROW_CLAIM_LEASE_SECONDS,
  POINT_ACCESS_DENIED,
  decideBulkImportCompletion,
  rowIdempotencyKey,
} from '@authorization/domain';
import type { Scope } from '../common/request-scope';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;
export type BulkImportTransaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];

class StaleBulkImportClaimError extends Error {
  constructor() {
    super('STALE_BULK_IMPORT_CLAIM');
    this.name = 'StaleBulkImportClaimError';
  }
}

export type BulkImportRowInsert = Readonly<{
  rowNumber: number;
  rawPayload: unknown;
  normalizedPayload: unknown;
  validationStatus: BulkImportRowValidationStatus;
  errorCode: string | null;
  errorMessage: string | null;
  errorColumn: string | null;
  executionStatus: BulkImportRowExecutionStatus;
  authorizationNumber: string | null;
  commercialCode: string | null;
  dispensingPointCode: string | null;
  assignmentDate: string | null;
  quantity: number | null;
}>;

type JobRow = {
  id: string;
  import_type: 'AUTHORIZATIONS' | 'SCHEDULING';
  authorization_import_batch_id: string | null;
  template_version: string;
  status: BulkImportJobStatus;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  file_hash: string;
  duplicate_file: boolean;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  warning_rows: number;
  succeeded_rows: number;
  failed_rows: number;
  skipped_rows: number;
  last_error_code: string | null;
  created_at: Date | string;
  validated_at: Date | string | null;
  confirmed_at: Date | string | null;
  completed_at: Date | string | null;
  cancelled_at: Date | string | null;
};

const JOB_COLUMNS = sql`
  id, import_type, authorization_import_batch_id, template_version, status, original_filename, mime_type, size_bytes, file_hash,
  duplicate_file, total_rows, valid_rows, invalid_rows, duplicate_rows, warning_rows,
  succeeded_rows, failed_rows, skipped_rows, last_error_code, created_at, validated_at,
  confirmed_at, completed_at, cancelled_at
`;

function asIso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toJob(row: JobRow): BulkImportJobResponse {
  return {
    id: row.id,
    importType: row.import_type,
    templateVersion: row.template_version,
    status: row.status,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    fileHash: row.file_hash,
    duplicateFile: Boolean(row.duplicate_file),
    totalRows: Number(row.total_rows),
    validRows: Number(row.valid_rows),
    invalidRows: Number(row.invalid_rows),
    duplicateRows: Number(row.duplicate_rows),
    warningRows: Number(row.warning_rows),
    createRows: Number(row.valid_rows),
    conflictRows: Number(row.warning_rows),
    succeededRows: Number(row.succeeded_rows),
    failedRows: Number(row.failed_rows),
    skippedRows: Number(row.skipped_rows),
    lastErrorCode: row.last_error_code,
    createdAt: asIso(row.created_at) as string,
    validatedAt: asIso(row.validated_at),
    confirmedAt: asIso(row.confirmed_at),
    completedAt: asIso(row.completed_at),
    cancelledAt: asIso(row.cancelled_at),
  };
}

@Injectable()
export class BulkImportRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async hasDuplicateHash(createdBy: string, fileHash: string): Promise<boolean> {
    const result = await this.database.db.execute<{ n: string }>(sql`
      select count(*)::text n from bulk_import_jobs where created_by = ${createdBy} and file_hash = ${fileHash}
    `);
    return Number(result.rows[0]?.n ?? 0) > 0;
  }

  async findActiveTariffAnnexProductCodes(
    organizationId: string,
    codes: readonly string[],
  ): Promise<Set<string>> {
    if (codes.length === 0) return new Set();
    const result = await this.database.db.execute<{ codigo_producto: string }>(sql`
      select codigo_producto
      from tariff_annex_products
      where organization_id = ${organizationId}
        and active = true
        and codigo_producto in (${sql.join(codes.map((code) => sql`${code}`), sql`, `)})
    `);
    return new Set(result.rows.map((row) => row.codigo_producto));
  }

  async createJob(input: {
    actor: Scope;
    templateVersion: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    fileHash: string;
    duplicateFile: boolean;
    rows: readonly BulkImportRowInsert[];
    status: 'READY' | 'INVALID';
  }): Promise<BulkImportJobResponse> {
    return this.database.db.transaction(async (tx) => {
      const validRows = input.rows.filter((row) => row.validationStatus === 'VALID').length;
      const invalidRows = input.rows.filter((row) => row.validationStatus === 'INVALID').length;
      const duplicateRows = input.rows.filter((row) => row.validationStatus === 'DUPLICATE').length;
      const warningRows = input.rows.filter((row) => row.validationStatus === 'CONFLICT').length;
      const skippedRows = input.rows.filter((row) => row.executionStatus === 'SKIPPED').length;
      const authorizationBatch = await tx.execute<{ id: string }>(sql`
        insert into import_batches
          (organization_id, created_by, original_filename, mime_type, size_bytes, sha256, processor_version, status, total_rows, valid_rows, rejected_rows)
        values
          (${input.actor.organizationId}, ${input.actor.userId}, ${input.originalFilename}, ${input.mimeType}, ${input.sizeBytes}, ${input.fileHash}, 1, 'UPLOADED', ${input.rows.length}, ${validRows}, ${invalidRows})
        returning id
      `);
      const inserted = await tx.execute<JobRow>(sql`
        insert into bulk_import_jobs (
          organization_id, created_by, import_type, authorization_import_batch_id, template_version, status, original_filename,
          mime_type, size_bytes, file_hash, duplicate_file, total_rows, valid_rows, invalid_rows,
          duplicate_rows, warning_rows, skipped_rows, correlation_id, validated_at
        ) values (
          ${input.actor.organizationId}, ${input.actor.userId}, 'AUTHORIZATIONS', ${authorizationBatch.rows[0]!.id}, ${input.templateVersion},
          ${input.status}, ${input.originalFilename}, ${input.mimeType}, ${input.sizeBytes},
          ${input.fileHash}, ${input.duplicateFile}, ${input.rows.length}, ${validRows}, ${invalidRows},
          ${duplicateRows}, ${warningRows}, ${skippedRows}, ${input.actor.correlationId}::uuid, now()
        ) returning ${JOB_COLUMNS}
      `);
      const job = inserted.rows[0]!;
      for (const row of input.rows) {
        await tx.execute(sql`
          insert into bulk_import_rows (
            job_id, row_number, raw_payload, normalized_payload, validation_status, error_code,
            error_message, error_column, execution_status, idempotency_key
          ) values (
            ${job.id}, ${row.rowNumber}, ${JSON.stringify(row.rawPayload)}::jsonb,
            ${row.normalizedPayload == null ? null : JSON.stringify(row.normalizedPayload)}::jsonb,
            ${row.validationStatus}, ${row.errorCode}, ${row.errorMessage}, ${row.errorColumn},
            ${row.executionStatus}, ${rowIdempotencyKey(job.id, row.rowNumber)}
          )
        `);
      }
      await this.audit(tx, input.actor, 'BULK_IMPORT_UPLOADED', job.id, {
        importType: 'AUTHORIZATIONS',
        totalRows: input.rows.length,
        validRows,
        invalidRows,
      });
      await this.audit(tx, input.actor, 'BULK_IMPORT_VALIDATED', job.id, {
        importType: 'AUTHORIZATIONS',
        status: input.status,
        validRows,
        invalidRows,
      });
      return toJob(job);
    });
  }

  async findJob(id: string, actor: Scope): Promise<BulkImportJobResponse | null> {
    const org = this.orgFilter(actor);
    const result = await this.database.db.execute<JobRow>(sql`
      select ${JOB_COLUMNS} from bulk_import_jobs where id = ${id} and ${org}
    `);
    const row = result.rows[0];
    return row ? toJob(row) : null;
  }

  async listJobs(actor: Scope, limit: number): Promise<BulkImportJobResponse[]> {
    const org = this.orgFilter(actor);
    const result = await this.database.db.execute<JobRow>(sql`
      select ${JOB_COLUMNS} from bulk_import_jobs where ${org} order by created_at desc limit ${limit}
    `);
    return result.rows.map(toJob);
  }

  async listRows(
    jobId: string,
    filter: 'ALL' | 'VALID' | 'INVALID' | 'EXECUTED' | 'FAILED',
    actor?: Scope,
  ): Promise<BulkImportRowResponse[]> {
    const where =
      filter === 'VALID'
        ? sql`validation_status = 'VALID'`
        : filter === 'INVALID'
          ? sql`validation_status in ('INVALID', 'DUPLICATE', 'CONFLICT')`
          : filter === 'EXECUTED'
            ? sql`execution_status = 'SUCCEEDED'`
            : filter === 'FAILED'
              ? sql`execution_status = 'FAILED'`
              : sql`true`;
    const result = await this.database.db.execute<{
      id: string;
      row_number: number;
      validation_status: BulkImportRowValidationStatus;
      execution_status: BulkImportRowExecutionStatus;
      error_code: string | null;
      error_message: string | null;
      execution_error_code: string | null;
      execution_error: string | null;
      error_column: string | null;
      entity_reference: string | null;
      attempt_count: number;
      normalized_payload: Record<string, unknown> | null;
    }>(sql`
      select id, row_number, validation_status, execution_status, error_code, error_message,
             execution_error_code, execution_error, error_column, entity_reference, attempt_count,
             normalized_payload
      from bulk_import_rows
      where job_id = ${jobId} and ${where} and ${actor ? this.rowPointFilter(actor) : sql`true`}
      order by row_number
    `);
    return result.rows.map((row) => {
      const payload = row.normalized_payload ?? {};
      const executed = row.execution_status === 'FAILED' || row.execution_status === 'SUCCEEDED';
      const quantityRaw = payload.CANTIDAD;
      return {
        id: row.id,
        rowNumber: row.row_number,
        validationStatus: row.validation_status,
        executionStatus: row.execution_status,
        errorCode: executed ? (row.execution_error_code ?? row.error_code) : row.error_code,
        errorMessage: executed ? (row.execution_error ?? row.error_message) : row.error_message,
        column: row.error_column,
        entityReference: row.entity_reference,
        attemptCount: Number(row.attempt_count),
        authorizationNumber:
          typeof payload.NUMERO_AUTORIZACION === 'string' ? payload.NUMERO_AUTORIZACION : null,
          commercialCode: typeof payload.CODIGO_COMERCIAL === 'string' ? payload.CODIGO_COMERCIAL : null,
        dispensingPointCode:
          typeof payload.dispensingPointCode === 'string' ? payload.dispensingPointCode : null,
        assignmentDate: typeof payload.FECHA_ASIGNACION === 'string' ? payload.FECHA_ASIGNACION : null,
        quantity: typeof quantityRaw === 'number' ? quantityRaw : Number(quantityRaw) || null,
      };
    });
  }

  async markJobProcessing(
    jobId: string,
    token: string,
  ): Promise<{ previousStatus: BulkImportJobStatus; waveStartedAt: Date | string } | null> {
    const result = await this.database.db.execute<{
      previous_status: BulkImportJobStatus;
      processing_heartbeat_at: Date | string;
    }>(sql`
      update bulk_import_jobs as j
      set status = 'PROCESSING',
          confirmed_at = coalesce(j.confirmed_at, now()),
          processing_generation = j.processing_generation + 1,
          processing_token = ${token}::uuid,
          processing_heartbeat_at = now()
      from (
        select id, status
        from bulk_import_jobs
        where id = ${jobId}
          and status in ('READY', 'PARTIALLY_COMPLETED', 'FAILED', 'PROCESSING')
        for update
      ) as current_job
      where j.id = current_job.id
      returning current_job.status as previous_status, j.processing_heartbeat_at
    `);
    const row = result.rows[0];
    return row
      ? { previousStatus: row.previous_status, waveStartedAt: row.processing_heartbeat_at }
      : null;
  }

  async claimNextRow(
    jobId: string,
    mode: 'confirm' | 'retry',
    token: string,
    waveStartedAt: Date | string,
  ): Promise<{
    id: string;
    rowNumber: number;
    normalizedPayload: Record<string, unknown> | null;
    attemptCount: number;
    claimToken: string;
    claimGeneration: number;
    reclaimed: boolean;
  } | null> {
    const executable =
      mode === 'retry'
        ? sql`(
            execution_status = 'FAILED'
            and (executed_at is null or executed_at < ${waveStartedAt}::timestamptz)
          )`
        : sql`execution_status = 'PENDING'`;
    const result = await this.database.db.execute<{
      id: string;
      row_number: number;
      normalized_payload: Record<string, unknown> | null;
      attempt_count: number;
      claim_token: string;
      claim_generation: number;
      previous_status: string;
    }>(sql`
      update bulk_import_rows as r
      set execution_status = 'PROCESSING',
          claim_token = ${token}::uuid,
          claim_generation = r.claim_generation + 1,
          claimed_at = now(),
          claim_expires_at = now() + (${BULK_IMPORT_ROW_CLAIM_LEASE_SECONDS} * interval '1 second'),
          attempt_count = r.attempt_count + 1
      from (
        select id, execution_status as previous_status
        from bulk_import_rows
        where job_id = ${jobId}
          and validation_status = 'VALID'
          and (
            ${executable}
            or (
              execution_status = 'PROCESSING'
              and (claim_expires_at is null or claim_expires_at < now())
            )
          )
        order by row_number
        for update skip locked
        limit 1
      ) as next_row
      where r.id = next_row.id
      returning r.id, r.row_number, r.normalized_payload, r.attempt_count, r.claim_token,
                r.claim_generation, next_row.previous_status
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      rowNumber: Number(row.row_number),
      normalizedPayload: row.normalized_payload,
      attemptCount: Number(row.attempt_count),
      claimToken: row.claim_token,
      claimGeneration: Number(row.claim_generation),
      reclaimed: row.previous_status === 'PROCESSING',
    };
  }

  async upsertAuthorizationInTx(
    tx: BulkImportTransaction,
    input: { actor: Scope; payload: Record<string, unknown>; jobId: string },
  ): Promise<{ id: string }> {
    const batch = await tx.execute<{ authorization_import_batch_id: string | null }>(sql`
      select authorization_import_batch_id from bulk_import_jobs where id = ${input.jobId} for share
    `);
    const batchId = batch.rows[0]?.authorization_import_batch_id;
    if (!batchId) throw new Error('AUTHORIZATION_IMPORT_BATCH_NOT_FOUND');
    const p = input.payload;
    const text = (key: string): string => {
      const value = p[key];
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '';
    };
    const result = await tx.execute<{ id: string }>(sql`
      insert into authorization_items
        (numero_autorizacion, codigo_medicamento, authorization_key, source_data,
         source_status_normalized, source_prescripcion_normalized, no_prescripcion,
         enablement_status, coverage_type, direction_status, coverage_rule_version,
         created_from_batch_id, updated_by, last_load_id)
      values
        (${text('NUMERO_AUTORIZACION')}, ${text('CODIGO_COMERCIAL')},
         ${`${text('NUMERO_AUTORIZACION')}|${text('CODIGO_COMERCIAL')}`},
         ${JSON.stringify(p)}::jsonb, ${text('ESTADO_AUTORIZACION')},
         ${text('NUMERO_PRESCRIPCION')}, ${text('NUMERO_PRESCRIPCION')},
         case when upper(${text('ESTADO_AUTORIZACION')}) in ('VIGENTE', 'ACTIVA', 'AUTORIZADA') then 'ENABLED' else 'BLOCKED_SOURCE_STATUS' end,
         'PBS', 'NOT_APPLICABLE', 'AUTHORIZATIONS_V1', ${batchId}, ${input.actor.userId}, ${batchId})
      on conflict (numero_autorizacion, codigo_medicamento) do update
        set source_data = excluded.source_data,
            source_status_normalized = excluded.source_status_normalized,
            enablement_status = excluded.enablement_status,
            last_load_id = excluded.last_load_id,
            updated_by = excluded.updated_by,
            updated_at = now(), version = authorization_items.version + 1
      returning id
    `);
    const id = result.rows[0]!.id;
    await tx.execute(sql`
      insert into authorization_item_organizations (authorization_item_id, organization_id)
      values (${id}, ${input.actor.organizationId}) on conflict do nothing
    `);
    return { id };
  }

  async executeClaimedRow<TCreated extends { id: string }>(input: {
    rowId: string;
    attemptNumber: number;
    claimToken: string;
    claimGeneration: number;
    execute: (tx: BulkImportTransaction) => Promise<TCreated>;
  }): Promise<'succeeded' | 'stale'> {
    try {
      return await this.database.db.transaction(async (tx) => {
        const held = await tx.execute<{ id: string }>(sql`
          select id
          from bulk_import_rows
          where id = ${input.rowId}
            and execution_status = 'PROCESSING'
            and claim_token = ${input.claimToken}::uuid
            and claim_generation = ${input.claimGeneration}
          for update
        `);
        if (!held.rows[0]) return 'stale';
        const created = await input.execute(tx);
        const marked = await tx.execute<{ id: string }>(sql`
          update bulk_import_rows
          set execution_status = 'SUCCEEDED',
              entity_reference = ${created.id}::uuid,
              execution_error_code = null,
              execution_error = null,
              executed_at = now(),
              claim_token = null,
              claim_expires_at = null
          where id = ${input.rowId}
            and execution_status = 'PROCESSING'
            and claim_token = ${input.claimToken}::uuid
            and claim_generation = ${input.claimGeneration}
          returning id
        `);
        if (!marked.rows[0]) throw new StaleBulkImportClaimError();
        await tx.execute(sql`
          insert into bulk_import_row_attempts (row_id, attempt_number, status, error_code, error_message)
          values (${input.rowId}, ${input.attemptNumber}, 'SUCCEEDED', null, null)
        `);
        return 'succeeded';
      });
    } catch (error) {
      if (error instanceof StaleBulkImportClaimError) return 'stale';
      throw error;
    }
  }

  async markRowResult(input: {
    rowId: string;
    attemptNumber: number;
    claimToken: string;
    claimGeneration: number;
    status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
    entityReference?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<boolean> {
    return this.database.db.transaction(async (tx) => {
      const updated = await tx.execute<{ id: string }>(sql`
        update bulk_import_rows
        set execution_status = ${input.status},
            entity_reference = coalesce(${input.entityReference ?? null}::uuid, entity_reference),
            execution_error_code = ${input.errorCode ?? null},
            execution_error = ${input.errorMessage ?? null},
            executed_at = now(),
            claim_token = null,
            claim_expires_at = null
        where id = ${input.rowId}
          and execution_status = 'PROCESSING'
          and claim_token = ${input.claimToken}::uuid
          and claim_generation = ${input.claimGeneration}
        returning id
      `);
      if (!updated.rows[0]) return false;
      await tx.execute(sql`
        insert into bulk_import_row_attempts (row_id, attempt_number, status, error_code, error_message)
        values (${input.rowId}, ${input.attemptNumber}, ${input.status}, ${input.errorCode ?? null}, ${input.errorMessage ?? null})
      `);
      return true;
    });
  }

  async finalizeFromRows(jobId: string, actor: Scope): Promise<BulkImportJobResponse> {
    const result = await this.database.db.transaction(async (tx) => {
      const counts = await tx.execute<{
        succeeded: number;
        failed: number;
        skipped: number;
        pending: number;
        processing: number;
      }>(sql`
        select
          count(*) filter (where execution_status = 'SUCCEEDED')::int succeeded,
          count(*) filter (where execution_status = 'FAILED')::int failed,
          count(*) filter (where execution_status = 'SKIPPED')::int skipped,
          count(*) filter (where execution_status = 'PENDING')::int pending,
          count(*) filter (where execution_status = 'PROCESSING')::int processing
        from bulk_import_rows where job_id = ${jobId}
      `);
      const row = counts.rows[0]!;
      const pending = Number(row.pending) + Number(row.processing);
      const finalStatus = decideBulkImportCompletion({
        succeeded: Number(row.succeeded),
        failed: Number(row.failed),
        pending,
      });
      if (finalStatus === 'PROCESSING') {
        const current = await tx.execute<JobRow>(sql`
          select ${JOB_COLUMNS} from bulk_import_jobs where id = ${jobId}
        `);
        return current.rows[0]!;
      }
      const updated = await tx.execute<JobRow>(sql`
        update bulk_import_jobs
        set status = ${finalStatus},
            succeeded_rows = ${row.succeeded},
            failed_rows = ${row.failed},
            skipped_rows = ${row.skipped},
            completed_at = now(),
            failed_at = case when ${finalStatus} = 'FAILED' then now() else failed_at end,
            processing_token = null
        where id = ${jobId}
          and status = 'PROCESSING'
        returning ${JOB_COLUMNS}
      `);
      const job = updated.rows[0];
      if (!job) {
        const current = await tx.execute<JobRow>(sql`
          select ${JOB_COLUMNS} from bulk_import_jobs where id = ${jobId}
        `);
        return current.rows[0]!;
      }
      const action =
        finalStatus === 'COMPLETED'
          ? 'BULK_IMPORT_COMPLETED'
          : finalStatus === 'PARTIALLY_COMPLETED'
            ? 'BULK_IMPORT_PARTIALLY_COMPLETED'
            : 'BULK_IMPORT_FAILED';
      await this.audit(tx, actor, action, jobId, {
        importType: 'AUTHORIZATIONS',
        succeededRows: Number(row.succeeded),
        failedRows: Number(row.failed),
        skippedRows: Number(row.skipped),
      });
      return job;
    });
    return toJob(result);
  }

  async cancelJob(jobId: string, actor: Scope): Promise<BulkImportJobResponse | null> {
    const result = await this.database.db.transaction(async (tx) => {
      const updated = await tx.execute<JobRow>(sql`
        update bulk_import_jobs
        set status = 'CANCELLED', cancelled_at = now()
        where id = ${jobId} and status in ('UPLOADED', 'VALIDATING', 'READY', 'INVALID')
        returning ${JOB_COLUMNS}
      `);
      const job = updated.rows[0];
      if (!job) return null;
      await this.audit(tx, actor, 'BULK_IMPORT_CANCELLED', jobId, { importType: 'AUTHORIZATIONS' });
      return job;
    });
    return result ? toJob(result) : null;
  }

  async recordAudit(actor: Scope, action: string, jobId: string, after: unknown): Promise<void> {
    await this.database.db.execute(sql`
      insert into audit_events
        (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
      values (
        'USER', ${actor.userId}, ${actor.organizationId}, ${action}, 'bulk_import_job', ${jobId},
        ${JSON.stringify(after)}::jsonb, ${actor.correlationId}, ${actor.correlationId}, 'SUCCESS'
      )
    `);
  }

  private orgFilter(actor: Scope) {
    if (actor.organizationCode === 'MTD' || actor.isFoundationAdmin) return sql`true`;
    if (actor.pointAccessKind === 'explicit') {
      return sql`organization_id = ${actor.organizationId} and created_by = ${actor.userId}`;
    }
    return sql`organization_id = ${actor.organizationId}`;
  }

  private rowPointFilter(actor: Scope) {
    if (actor.pointAccessKind !== 'explicit') return sql`true`;
    return sql`(
      coalesce(normalized_payload->>'dispensingPointCode', '') = ''
      or error_code = ${POINT_ACCESS_DENIED}
      or execution_error_code = ${POINT_ACCESS_DENIED}
      or not exists (
        select 1 from dispensing_points dp
        where upper(dp.code) = upper(normalized_payload->>'dispensingPointCode')
      )
      or exists (
        select 1
        from dispensing_points dp
        join user_point_scopes ups on ups.dispensing_point_id = dp.id
        where ups.user_id = ${actor.userId}::uuid
          and ups.revoked_at is null
          and upper(dp.code) = upper(normalized_payload->>'dispensingPointCode')
      )
    )`;
  }

  private async audit(
    tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
    actor: Scope,
    action: string,
    jobId: string,
    after: unknown,
  ) {
    await tx.execute(sql`
      insert into audit_events
        (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
      values (
        'USER', ${actor.userId}, ${actor.organizationId}, ${action}, 'bulk_import_job', ${jobId},
        ${JSON.stringify(after)}::jsonb, ${actor.correlationId}, ${actor.correlationId}, 'SUCCESS'
      )
    `);
  }
}
