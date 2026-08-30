import { createHash, randomUUID } from 'node:crypto';
import {
  bulkUpdateJobSchema,
  BULK_UPDATE_CONTRACT_VERSION,
  bulkUpdateOperationContracts,
  bulkUpdateRowResultMessages,
  type BulkUpdateJob,
  type BulkUpdateRowResultCode,
} from '@authorization/contracts';
import {
  buildAuthorizationKey,
  evaluateOperationalFieldTransition,
  normalizeOperationalText,
  isValidOperationalText,
} from '@authorization/domain';
import type { createDatabase } from '@authorization/database';
import { parseBulkFile, BulkFileError } from './bulk-parser';

type Database = ReturnType<typeof createDatabase>;

type SourceRow = {
  batch_id: string;
  batch_status: string;
  batch_operation_type: string;
  batch_contract_version: number;
  batch_organization_id: string;
  batch_created_by: string;
  source_file_id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  source_sha256: string;
  batch_sha256: string;
  content: Buffer | null;
};

type ItemRow = {
  id: string;
  authorization_key: string;
  lugar_dispensacion: string | null;
  operational_version: number;
  operation_status: string | null;
};

export type BulkProcessingResult = Readonly<{
  status: 'COMPLETED' | 'FAILED';
  totalRows: number;
  processedRows: number;
  updatedRows: number;
  unchangedRows: number;
  rejectedRows: number;
}>;

function hashContent(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function hasValue(row: Record<string, unknown>, field: string): boolean {
  const value = row[field];
  return (
    value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '')
  );
}

/**
 * Fase 4 (SPEC-013/ADR-022): pipeline genérico de bulk updates. En esta fase
 * el catálogo habilitado contiene únicamente ASSIGN_DISPENSATION_LOCATION
 * (MEDICARTE, columna `lugar_dispensacion`). Cada fila válida actualiza el
 * valor vigente, incrementa la versión operacional, crea historial append-only,
 * auditoría y el evento outbox para OLP dentro de una misma transacción.
 * Reprocesar el lote no duplica el efecto lógico ni la notificación.
 */
export class BulkUpdateProcessor {
  constructor(private readonly database: Database) {}

  async process(rawJob: BulkUpdateJob): Promise<BulkProcessingResult> {
    const job = bulkUpdateJobSchema.parse(rawJob);
    if (job.payload.contractVersion !== BULK_UPDATE_CONTRACT_VERSION) {
      throw new Error('Bulk update contract version mismatch');
    }
    const source = await this.getSource(job);
    if (!source) throw new Error('Bulk update batch or source file not found');
    if (source.batch_contract_version !== BULK_UPDATE_CONTRACT_VERSION) {
      throw new Error('Bulk update contract version mismatch');
    }

    if (source.batch_status === 'COMPLETED') {
      return this.getResult(source.batch_id, 'COMPLETED');
    }
    if (source.batch_status === 'FAILED') {
      return this.getResult(source.batch_id, 'FAILED');
    }
    if (!source.content) {
      await this.markFailed(source.batch_id, 'INVALID_FILE_FORMAT');
      return this.emptyFailed();
    }
    if (
      source.content.length !== source.size_bytes ||
      hashContent(source.content) !== source.source_sha256 ||
      source.source_sha256 !== source.batch_sha256
    ) {
      await this.markFailed(source.batch_id, 'INVALID_FILE_FORMAT');
      return this.emptyFailed();
    }

    const contract =
      bulkUpdateOperationContracts[
        source.batch_operation_type as keyof typeof bulkUpdateOperationContracts
      ];
    if (!contract || source.batch_operation_type !== 'ASSIGN_DISPENSATION_LOCATION') {
      await this.markFailed(source.batch_id, 'INVALID_FILE_FORMAT');
      return this.emptyFailed();
    }

    let parsed: ReturnType<typeof parseBulkFile>;
    try {
      parsed = parseBulkFile(
        source.content,
        source.original_filename,
        source.mime_type,
        contract.requiredColumns,
      );
    } catch (error) {
      if (!(error instanceof BulkFileError)) throw error;
      await this.markFailed(source.batch_id, error.code);
      return this.emptyFailed();
    }

    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const locked = await client.query<{ status: string }>(
        'select status from bulk_update_batches where id = $1 for update',
        [source.batch_id],
      );
      const batch = locked.rows[0];
      if (!batch) throw new Error('Bulk update batch not found');
      if (batch.status === 'COMPLETED') {
        await client.query('commit');
        return this.getResult(source.batch_id, 'COMPLETED');
      }

      await client.query('delete from bulk_update_rows where batch_id = $1', [source.batch_id]);
      await client.query(
        `update bulk_update_batches
         set status = 'PROCESSING', started_at = coalesce(started_at, now()), last_error_code = null,
             total_rows = 0, processed_rows = 0, updated_rows = 0, unchanged_rows = 0, rejected_rows = 0
         where id = $1`,
        [source.batch_id],
      );

      const mutableField = contract.mutableField;
      const seenKeys = new Set<string>();
      let updatedRows = 0;
      let unchangedRows = 0;
      let rejectedRows = 0;

      for (const row of parsed.rows) {
        const outcome = await this.processRow(client, {
          batchId: source.batch_id,
          organizationId: source.batch_organization_id,
          actorId: source.batch_created_by,
          correlationId: job.correlationId,
          row,
          mutableField,
          seenKeys,
        });
        if (outcome === 'ROW_UPDATED') updatedRows += 1;
        else if (outcome === 'UNCHANGED_VALUE') unchangedRows += 1;
        else rejectedRows += 1;
      }

      await client.query(
        `update bulk_update_batches
         set status = 'COMPLETED', completed_at = now(),
             total_rows = $2, processed_rows = $3, updated_rows = $4, unchanged_rows = $5, rejected_rows = $6
         where id = $1`,
        [source.batch_id, parsed.rows.length, parsed.rows.length, updatedRows, unchangedRows, rejectedRows],
      );
      await client.query(
        `update bulk_update_source_files set content = null, processed_at = now() where id = $1`,
        [source.source_file_id],
      );
      await client.query('commit');
      return {
        status: 'COMPLETED',
        totalRows: parsed.rows.length,
        processedRows: parsed.rows.length,
        updatedRows,
        unchangedRows,
        rejectedRows,
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async processRow(
    client: {
      query: <T = Record<string, unknown>>(
        query: string,
        values?: unknown[],
      ) => Promise<{ rows: T[]; rowCount?: number | null }>;
    },
    input: {
      batchId: string;
      organizationId: string;
      actorId: string;
      correlationId: string;
      row: { rowNumber: number; rawData: Record<string, unknown> };
      mutableField: string;
      seenKeys: Set<string>;
    },
  ): Promise<BulkUpdateRowResultCode> {
    let authorizationKey: string | null = null;
    const reject = async (
      code: BulkUpdateRowResultCode,
      itemId: string | null,
      extras: { fieldName?: string | null; previousValue?: string | null; newValue?: string | null } = {},
    ): Promise<BulkUpdateRowResultCode> => {
      await client.query(
        `insert into bulk_update_rows
           (batch_id, row_number, raw_data, authorization_key, authorization_item_id, field_name,
            previous_value, new_value, field_version, result_code, result_message)
         values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          input.batchId,
          input.row.rowNumber,
          JSON.stringify(input.row.rawData),
          authorizationKey,
          itemId,
          extras.fieldName === undefined ? input.mutableField : extras.fieldName,
          extras.previousValue ?? null,
          extras.newValue ?? null,
          null,
          code,
          bulkUpdateRowResultMessages[code],
        ],
      );
      return code;
    };

    const rawAuthorization = input.row.rawData['numero_autorizacion'];
    const rawMedication = input.row.rawData['codigo_medicamento'];
    if (
      !hasValue(input.row.rawData, 'numero_autorizacion') ||
      !hasValue(input.row.rawData, 'codigo_medicamento')
    ) {
      return await reject('MISSING_BUSINESS_KEY', null, { fieldName: null, newValue: null });
    }
    const keyComponents = buildAuthorizationKey(rawAuthorization, rawMedication);
    if (!keyComponents) {
      return await reject('MISSING_BUSINESS_KEY', null, { fieldName: null, newValue: null });
    }
    authorizationKey = keyComponents.authorizationKey;
    if (input.seenKeys.has(authorizationKey)) {
      return await reject('DUPLICATE_KEY_IN_FILE', null, { fieldName: null, newValue: null });
    }

    const newValue = normalizeOperationalText(input.row.rawData[input.mutableField]);
    if (!newValue) {
      return await reject('MISSING_VALUE', null, { newValue: null });
    }
    if (!isValidOperationalText(newValue)) {
      return await reject('INVALID_VALUE_FORMAT', null, { newValue });
    }
    // La llave solo se marca como vista cuando la fila alcanzó la validación
    // de valor: una fila inválida no convierte en duplicada a la fila válida.
    input.seenKeys.add(authorizationKey);

    const itemResult = await client.query<ItemRow>(
      `select id, authorization_key, lugar_dispensacion, operational_version, operation_status
       from authorization_items where authorization_key = $1`,
      [authorizationKey],
    );
    const item = itemResult.rows[0];
    if (!item) {
      return await reject('AUTHORIZATION_ITEM_NOT_FOUND', null, { newValue });
    }
    const relationship = await client.query(
      `select 1 from authorization_item_organizations
       where authorization_item_id = $1 and organization_id = $2`,
      [item.id, input.organizationId],
    );
    if (relationship.rowCount === 0) {
      return await reject('FORBIDDEN_ITEM_SCOPE', item.id, { newValue });
    }
    const allowedStates = ['READY_TO_DISPENSE', 'DISPENSATION_REPORTED', 'DISPENSED'];
    if (!item.operation_status || !allowedStates.includes(item.operation_status)) {
      return await reject('OPERATION_NOT_ALLOWED', item.id, {
        previousValue: item.lugar_dispensacion,
        newValue,
      });
    }

    const transition = evaluateOperationalFieldTransition(
      item.lugar_dispensacion,
      newValue,
      item.operational_version,
    );
    if (!transition.eventType) {
      await client.query(
        `insert into bulk_update_rows
           (batch_id, row_number, raw_data, authorization_key, authorization_item_id, field_name,
            previous_value, new_value, field_version, result_code, result_message)
         values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, 'UNCHANGED_VALUE', $10)`,
        [
          input.batchId,
          input.row.rowNumber,
          JSON.stringify(input.row.rawData),
          authorizationKey,
          item.id,
          input.mutableField,
          item.lugar_dispensacion,
          newValue,
          item.operational_version,
          bulkUpdateRowResultMessages.UNCHANGED_VALUE,
        ],
      );
      return 'UNCHANGED_VALUE';
    }

    const updated = await client.query<{ id: string }>(
      `update authorization_items
       set lugar_dispensacion = $2, operational_version = $3, version = version + 1, updated_at = now()
       where id = $1 and operational_version = $4
       returning id`,
      [item.id, newValue, transition.newVersion, item.operational_version],
    );
    if (updated.rowCount === 0) {
      return await reject('VERSION_CONFLICT', item.id, {
        previousValue: item.lugar_dispensacion,
        newValue,
      });
    }

    const rowInsert = await client.query<{ id: string }>(
      `insert into bulk_update_rows
         (batch_id, row_number, raw_data, authorization_key, authorization_item_id, field_name,
          previous_value, new_value, field_version, result_code, result_message)
       values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, 'ROW_UPDATED', $10)
       returning id`,
      [
        input.batchId,
        input.row.rowNumber,
        JSON.stringify(input.row.rawData),
        authorizationKey,
        item.id,
        input.mutableField,
        item.lugar_dispensacion,
        newValue,
        transition.newVersion,
        bulkUpdateRowResultMessages.ROW_UPDATED,
      ],
    );
    const bulkUpdateRowId = rowInsert.rows[0]?.id ?? null;

    await client.query(
      `insert into operational_field_changes
         (authorization_item_id, field_name, previous_value, new_value,
          previous_operational_version, new_operational_version, operation_type,
          bulk_update_batch_id, bulk_update_row_id, actor_type, actor_id, organization_id, correlation_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'USER', $10, $11, $12)`,
      [
        item.id,
        input.mutableField,
        item.lugar_dispensacion,
        newValue,
        transition.previousVersion,
        transition.newVersion,
        'ASSIGN_DISPENSATION_LOCATION',
        input.batchId,
        bulkUpdateRowId,
        input.actorId,
        input.organizationId,
        input.correlationId,
      ],
    );

    await client.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, before, after, correlation_id, request_id, result)
       values ('USER', $1, $2, $3, 'authorization_item', $4, $5::jsonb, $6::jsonb, $7, $8, 'SUCCESS')`,
      [
        input.actorId,
        input.organizationId,
        transition.eventType,
        item.id,
        JSON.stringify({
          lugarDispensacion: item.lugar_dispensacion,
          operationalVersion: item.operational_version,
        }),
        JSON.stringify({
          lugarDispensacion: newValue,
          operationalVersion: transition.newVersion,
          batchId: input.batchId,
          rowNumber: input.row.rowNumber,
        }),
        input.correlationId,
        input.correlationId,
      ],
    );

    const eventId = randomUUID();
    const notificationKey = `${transition.eventType}:${item.id}:${transition.newVersion}:OLP`.slice(
      0,
      200,
    );
    const payload = {
      eventId,
      notificationType: transition.eventType,
      itemId: item.id,
      recipientOrganizationId: null,
      period: null,
      correlationId: input.correlationId,
      idempotencyKey: notificationKey,
    };
    await client.query(
      `insert into outbox_events
         (id, event_type, version, payload, correlation_id, idempotency_key)
       values ($1, 'notification.email', 1, $2::jsonb, $3, $4)
       on conflict (idempotency_key) do nothing`,
      [eventId, JSON.stringify(payload), input.correlationId, notificationKey],
    );
    return 'ROW_UPDATED';
  }

  private async getSource(job: BulkUpdateJob): Promise<SourceRow | undefined> {
    const result = await this.database.pool.query<SourceRow>(
      `select b.id as batch_id, b.status as batch_status, b.operation_type as batch_operation_type,
              b.contract_version as batch_contract_version, b.organization_id as batch_organization_id,
              b.created_by as batch_created_by, f.id as source_file_id,
              f.original_filename, f.mime_type, f.size_bytes, f.sha256 as source_sha256,
              b.sha256 as batch_sha256, f.content
       from bulk_update_batches b
       inner join bulk_update_source_files f on f.batch_id = b.id
       where b.id = $1`,
      [job.payload.batchId],
    );
    return result.rows[0];
  }

  private async markFailed(batchId: string, code: string): Promise<void> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const failed = await client.query(
        `update bulk_update_batches
         set status = 'FAILED', completed_at = now(), last_error_code = $2
         where id = $1 and status in ('UPLOADED', 'QUEUED', 'PROCESSING')
         returning id`,
        [batchId, code],
      );
      if (failed.rowCount) {
        await client.query(
          `update bulk_update_source_files set content = null, processed_at = now() where batch_id = $1`,
          [batchId],
        );
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async getResult(
    batchId: string,
    status: 'COMPLETED' | 'FAILED',
  ): Promise<BulkProcessingResult> {
    const result = await this.database.pool.query<{
      total_rows: number;
      processed_rows: number;
      updated_rows: number;
      unchanged_rows: number;
      rejected_rows: number;
    }>(
      `select total_rows, processed_rows, updated_rows, unchanged_rows, rejected_rows
       from bulk_update_batches where id = $1`,
      [batchId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Bulk update batch not found');
    return {
      status,
      totalRows: row.total_rows,
      processedRows: row.processed_rows,
      updatedRows: row.updated_rows,
      unchangedRows: row.unchanged_rows,
      rejectedRows: row.rejected_rows,
    };
  }

  private emptyFailed(): BulkProcessingResult {
    return {
      status: 'FAILED',
      totalRows: 0,
      processedRows: 0,
      updatedRows: 0,
      unchangedRows: 0,
      rejectedRows: 0,
    };
  }
}
