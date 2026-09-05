import { createHash } from 'node:crypto';
import {
  bulkUpdateJobSchema,
  BULK_UPDATE_CONTRACT_VERSION,
  bulkUpdateOperationContracts,
  bulkUpdateRowResultMessages,
  type BulkUpdateJob,
  type BulkUpdateOperationType,
  type BulkUpdateRowResultCode,
  type AuditStatus,
} from '@authorization/contracts';
import {
  buildAuthorizationKey,
  parseAuthorizationKeyInput,
  evaluateOperationalFieldTransition,
  normalizeOperationalText,
  isValidOperationalText,
  normalizeOperationalDate,
  isValidOperationalDate,
  isOperationalUpdateAllowed,
  deriveOperationalStatuses,
  noveltyForBulkResult,
} from '@authorization/domain';
import { insertNovelty, resolveNovelties, type createDatabase } from '@authorization/database';
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
  fecha_programada: string | null;
  fecha_dispensacion: string | null;
  fecha_aplicacion: string | null;
  cod_autorizacion_medicarte: string | null;
  orden_compra: string | null;
  audit_status: AuditStatus;
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
 * Fases 4/5 (SPEC-013/ADR-022): pipeline genérico de bulk updates. El catálogo
 * cerrado selecciona actor, permiso, columna y efectos de dominio. Cada fila válida actualiza el
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
    if (!contract) {
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
          operationType: source.batch_operation_type as BulkUpdateOperationType,
          requiredPermission: contract.permission,
          actorOrganizationCode: contract.actorOrganizationCode,
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
        [
          source.batch_id,
          parsed.rows.length,
          parsed.rows.length,
          updatedRows,
          unchangedRows,
          rejectedRows,
        ],
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
      operationType: BulkUpdateOperationType;
      requiredPermission: string;
      actorOrganizationCode: string;
      mutableField: string;
      seenKeys: Set<string>;
    },
  ): Promise<BulkUpdateRowResultCode> {
    let authorizationKey: string | null = null;
    const reject = async (
      code: BulkUpdateRowResultCode,
      itemId: string | null,
      extras: {
        fieldName?: string | null;
        previousValue?: string | null;
        newValue?: string | null;
      } = {},
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
      const novelty = noveltyForBulkResult(code);
      if (novelty) {
        await insertNovelty(client, {
          authorizationItemId: itemId,
          bulkUpdateBatchId: input.batchId,
          sourceRowNumber: input.row.rowNumber,
          originalRow: input.row.rawData,
          code: novelty.code,
          stage: input.operationType,
          field: extras.fieldName === undefined ? input.mutableField : extras.fieldName,
          receivedValue: extras.newValue ?? null,
          description: bulkUpdateRowResultMessages[code],
          actorId: input.actorId,
        });
      }
      return code;
    };

    // Los tipos de dispensación traen la llave ya formada (authorization_key);
    // el resto conserva la pareja numero_autorizacion + codigo_medicamento.
    let keyComponents: ReturnType<typeof buildAuthorizationKey> | null = null;
    if (hasValue(input.row.rawData, 'CLAVE_AUTORIZACION')) {
      keyComponents = parseAuthorizationKeyInput(input.row.rawData['CLAVE_AUTORIZACION']);
    } else if (
      hasValue(input.row.rawData, 'NUMERO_AUTORIZACION') &&
      hasValue(input.row.rawData, 'CODIGO_PRODUCTO')
    ) {
      keyComponents = buildAuthorizationKey(
        input.row.rawData['NUMERO_AUTORIZACION'],
        input.row.rawData['CODIGO_PRODUCTO'],
      );
    }
    if (!keyComponents) {
      return await reject('MISSING_BUSINESS_KEY', null, { fieldName: null, newValue: null });
    }
    authorizationKey = keyComponents.authorizationKey;
    if (input.seenKeys.has(authorizationKey)) {
      return await reject('DUPLICATE_KEY_IN_FILE', null, { fieldName: null, newValue: null });
    }

    const newValue =
      input.operationType === 'ASSIGN_DISPENSATION_LOCATION' ||
      input.operationType === 'ASSIGN_PURCHASE_ORDER'
        ? normalizeOperationalText(input.row.rawData[input.mutableField])
        : normalizeOperationalDate(input.row.rawData[input.mutableField]);
    if (!newValue) {
      return await reject('MISSING_VALUE', null, { newValue: null });
    }
    if (
      input.operationType === 'ASSIGN_DISPENSATION_LOCATION' ||
      input.operationType === 'ASSIGN_PURCHASE_ORDER'
        ? !isValidOperationalText(newValue)
        : !isValidOperationalDate(newValue)
    ) {
      return await reject('INVALID_VALUE_FORMAT', null, { newValue });
    }
    const scheduledDate =
      input.operationType === 'ASSIGN_DISPENSATION_LOCATION'
        ? normalizeOperationalDate(input.row.rawData['FECHA_PROGRAMADA'])
        : null;
    if (input.operationType === 'ASSIGN_DISPENSATION_LOCATION' && !scheduledDate) {
      return await reject('MISSING_VALUE', null, {
        fieldName: 'FECHA_PROGRAMADA',
        newValue: null,
      });
    }
    if (
      input.operationType === 'ASSIGN_DISPENSATION_LOCATION' &&
      !isValidOperationalDate(scheduledDate!)
    ) {
      return await reject('INVALID_VALUE_FORMAT', null, {
        fieldName: 'FECHA_PROGRAMADA',
        newValue: scheduledDate,
      });
    }
    const medicarteCode =
      input.operationType === 'REPORT_APPLICATION_DATE'
        ? normalizeOperationalText(input.row.rawData['COD_AUTORIZACION_MEDICARTE'])
        : null;
    if (input.operationType === 'REPORT_APPLICATION_DATE' && !medicarteCode) {
      return await reject('MISSING_VALUE', null, {
        fieldName: 'COD_AUTORIZACION_MEDICARTE',
        newValue: null,
      });
    }
    // La llave solo se marca como vista cuando la fila alcanzó la validación
    // de valor: una fila inválida no convierte en duplicada a la fila válida.
    input.seenKeys.add(authorizationKey);

    const permission = await client.query(
      `select 1
       from users u
       inner join user_organization_roles uor on uor.user_id = u.id and uor.organization_id = $2
       inner join organizations o on o.id = uor.organization_id
       inner join roles r on r.id = uor.role_id
       inner join role_permissions rp on rp.role_id = r.id
       inner join permissions p on p.id = rp.permission_id
       where u.id = $1 and u.active = true and uor.active = true and o.active = true
         and (o.code = $3 or (o.code = 'MTD' and r.code = 'MTD_ADMIN'))
         and p.code = $4`,
      [input.actorId, input.organizationId, input.actorOrganizationCode, input.requiredPermission],
    );
    if (permission.rowCount === 0) {
      return await reject('FORBIDDEN_ITEM_SCOPE', null, { newValue });
    }
    const itemResult = await client.query<ItemRow>(
      `select i.id, i.authorization_key, i.lugar_dispensacion, i.fecha_programada::text,
               i.fecha_dispensacion::text, i.fecha_aplicacion::text, i.cod_autorizacion_medicarte,
               i.orden_compra, i.audit_status,
              i.operational_version, i.operation_status
       from authorization_items i
       inner join authorization_item_organizations aio
         on aio.authorization_item_id = i.id and aio.organization_id = $2
       where i.authorization_key = $1
       for update of i`,
      [authorizationKey, input.organizationId],
    );
    const item = itemResult.rows[0];
    if (!item) {
      const exists = await client.query(
        `select 1 from authorization_items where authorization_key = $1`,
        [authorizationKey],
      );
      return await reject(
        exists.rowCount ? 'FORBIDDEN_ITEM_SCOPE' : 'AUTHORIZATION_ITEM_NOT_FOUND',
        null,
        { newValue },
      );
    }
    if (input.operationType === 'REPORT_APPLICATION_DATE' && !item.fecha_dispensacion) {
      return await reject('INVALID_OPERATION_STATE', item.id, { newValue });
    }
    const previousValue =
      input.operationType === 'ASSIGN_DISPENSATION_LOCATION'
        ? item.lugar_dispensacion
        : input.operationType === 'ASSIGN_PURCHASE_ORDER'
          ? item.orden_compra
        : input.operationType === 'REPORT_DISPENSATION_DATE'
          ? item.fecha_dispensacion
          : item.fecha_aplicacion;
    const previousScheduledDate = item.fecha_programada;
    if (
      !isOperationalUpdateAllowed({
        operationType: input.operationType,
        operationStatus: item.operation_status,
        auditStatus: item.audit_status,
        lugarDispensacion: item.lugar_dispensacion,
      })
    ) {
      const code =
        input.operationType === 'REPORT_APPLICATION_DATE' && item.audit_status === 'APPROVED'
          ? 'OPERATION_NOT_ALLOWED'
          : 'INVALID_OPERATION_STATE';
      return await reject(code, item.id, {
        previousValue,
        newValue,
      });
    }

    const locationTransition =
      input.operationType === 'ASSIGN_DISPENSATION_LOCATION'
        ? evaluateOperationalFieldTransition(
            item.lugar_dispensacion,
            newValue,
            item.operational_version,
          )
        : null;
    if (
      previousValue === newValue &&
      previousScheduledDate === scheduledDate &&
      (input.operationType !== 'REPORT_APPLICATION_DATE' ||
        item.cod_autorizacion_medicarte === medicarteCode)
    ) {
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
          previousValue,
          newValue,
          item.operational_version,
          bulkUpdateRowResultMessages.UNCHANGED_VALUE,
        ],
      );
      return 'UNCHANGED_VALUE';
    }

    const newOperationalVersion = item.operational_version + 1;
    const statuses = deriveOperationalStatuses({
      operationType: input.operationType,
      operationStatus: item.operation_status!,
      auditStatus: item.audit_status,
      fechaDispensacion: item.fecha_dispensacion,
      fechaAplicacion: item.fecha_aplicacion,
      newValue,
    });
    const updateSql =
      input.operationType === 'ASSIGN_DISPENSATION_LOCATION'
        ? `update authorization_items set lugar_dispensacion = $2, fecha_programada = $3::date,
             process_status = 'PENDIENTE_ORDEN_COMPRA', operation_status = $4, audit_status = $5,
             operational_version = $6, version = version + 1, updated_at = now(), updated_by = $7
           where id = $1 and operational_version = $8 returning id`
        : input.operationType === 'ASSIGN_PURCHASE_ORDER'
          ? `update authorization_items set orden_compra = $2, process_status = 'PENDIENTE_DISPENSACION',
               operation_status = 'READY_TO_DISPENSE', version = version + 1, updated_at = now(),
               updated_by = $3, operational_version = operational_version + 1
             where id = $1 and operational_version = $4 returning id`
          : input.operationType === 'REPORT_DISPENSATION_DATE'
            ? `update authorization_items set fecha_dispensacion = $2::date, process_status = 'PENDIENTE_APLICACION',
                 operation_status = $3, audit_status = $4, operational_version = $5,
                 version = version + 1, updated_at = now(), updated_by = $6
               where id = $1 and operational_version = $7 returning id`
             : `update authorization_items set fecha_aplicacion = $2::date,
                  cod_autorizacion_medicarte = $3, process_status = 'LISTO_PARA_AUDITORIA',
                  operation_status = $4, audit_status = $5, operational_version = $6,
                  version = version + 1, updated_at = now(), updated_by = $7
                where id = $1 and operational_version = $8 returning id`;
    const updateValues =
      input.operationType === 'ASSIGN_DISPENSATION_LOCATION'
        ? [
            item.id,
            newValue,
            scheduledDate,
            statuses.operationStatus,
            statuses.auditStatus,
            newOperationalVersion,
            input.actorId,
            item.operational_version,
          ]
        : input.operationType === 'ASSIGN_PURCHASE_ORDER'
          ? [item.id, newValue, input.actorId, item.operational_version]
          : [
              item.id,
              newValue,
              medicarteCode,
              statuses.operationStatus,
              statuses.auditStatus,
              newOperationalVersion,
              input.actorId,
              item.operational_version,
            ];
    const updated = await client.query<{ id: string }>(updateSql, updateValues);
    if (updated.rowCount === 0) {
      return await reject('VERSION_CONFLICT', item.id, {
        previousValue,
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
        previousValue,
        newValue,
        newOperationalVersion,
        bulkUpdateRowResultMessages.ROW_UPDATED,
      ],
    );
    const bulkUpdateRowId = rowInsert.rows[0]?.id ?? null;

    await resolveNovelties(client, {
      authorizationItemId: item.id,
      authorizationKey,
      codes: ['CSV_002', 'CSV_004', 'CSV_005', 'LOCK_001', 'CONC_001', 'TECH_001'],
      reason: `BULK_UPDATE_APPLIED:${input.operationType}`,
      actorType: 'USER',
      actorId: input.actorId,
      organizationId: input.organizationId,
      correlationId: input.correlationId,
    });

    await client.query(
      `insert into operational_field_changes
         (authorization_item_id, field_name, previous_value, new_value,
          previous_operational_version, new_operational_version, operation_type,
           bulk_update_batch_id, bulk_update_row_id, actor_type, actor_id, organization_id, correlation_id,
           idempotency_key)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'USER', $10, $11, $12, $13)`,
      [
        item.id,
        input.mutableField,
        previousValue,
        newValue,
        item.operational_version,
        newOperationalVersion,
        input.operationType,
        input.batchId,
        bulkUpdateRowId,
        input.actorId,
        input.organizationId,
        input.correlationId,
        `${input.batchId}:${input.row.rowNumber}:${newOperationalVersion}`,
      ],
    );

    if (
      input.operationType === 'ASSIGN_DISPENSATION_LOCATION' &&
      previousScheduledDate !== scheduledDate
    ) {
      await client.query(
        `insert into operational_field_changes
           (authorization_item_id, field_name, previous_value, new_value,
            previous_operational_version, new_operational_version, operation_type,
            bulk_update_batch_id, bulk_update_row_id, actor_type, actor_id, organization_id, correlation_id,
            idempotency_key)
         values ($1, 'FECHA_PROGRAMADA', $2, $3, $4, $5, $6, $7, $8, 'USER', $9, $10, $11, $12)`,
        [
          item.id,
          previousScheduledDate,
          scheduledDate,
          item.operational_version,
          newOperationalVersion,
          input.operationType,
          input.batchId,
          bulkUpdateRowId,
          input.actorId,
          input.organizationId,
          input.correlationId,
          `${input.batchId}:${input.row.rowNumber}:${newOperationalVersion}:fecha-programada`,
        ],
      );
    }

    const auditAction =
      input.operationType === 'ASSIGN_DISPENSATION_LOCATION'
        ? locationTransition!.eventType!
        : input.operationType === 'REPORT_DISPENSATION_DATE'
          ? 'DISPENSATION_DATE_REPORTED'
          : 'APPLICATION_DATE_REPORTED';
    await client.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, before, after, correlation_id, request_id, result)
       values ('USER', $1, $2, $3, 'authorization_item', $4, $5::jsonb, $6::jsonb, $7, $8, 'SUCCESS')`,
      [
        input.actorId,
        input.organizationId,
        auditAction,
        item.id,
        JSON.stringify({
          field: input.mutableField,
          value: previousValue,
          operationalVersion: item.operational_version,
          operationStatus: item.operation_status,
          auditStatus: item.audit_status,
        }),
        JSON.stringify({
          field: input.mutableField,
          value: newValue,
          operationalVersion: newOperationalVersion,
          operationStatus: statuses.operationStatus,
          auditStatus: statuses.auditStatus,
          batchId: input.batchId,
          rowNumber: input.row.rowNumber,
        }),
        input.correlationId,
        input.correlationId,
      ],
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
