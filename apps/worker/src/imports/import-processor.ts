import { createHash } from 'node:crypto';
import type { WorkerConfig } from '@authorization/config';
import {
  authorizationImportJobSchema,
  importRowResultMessages,
  type AuthorizationClassification,
  type AuthorizationImportJob,
  type ImportRowResultCode,
} from '@authorization/contracts';
import { deriveAuthorizationClassification } from '@authorization/domain';
import type { createDatabase } from '@authorization/database';
import { parseImportFile, ImportFileError, type ParsedImportRow } from './import-parser';
import { importTerminalErrorClassifications, NonRetryableImportError } from './import-errors';

type Database = ReturnType<typeof createDatabase>;

type SourceFileRow = {
  batch_id: string;
  organization_id: string;
  batch_status: string;
  batch_sha256: string;
  batch_processor_version: number;
  source_file_id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  source_sha256: string;
  content: Buffer | null;
};

type ExistingItem = { id: string; authorization_key: string };

export type ImportProcessingResult = Readonly<{
  status: 'READY_TO_CONFIRM' | 'COMPLETED' | 'FAILED';
  totalRows: number;
  validRows: number;
  rejectedRows: number;
  duplicateRows: number;
  existingRows: number;
}>;

const messages: Record<ImportRowResultCode, string> = importRowResultMessages;

function hasValue(row: Record<string, unknown>, field: string): boolean {
  const value = row[field];
  return (
    value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '')
  );
}

function missingFields(row: Record<string, unknown>, headers: string[]): string[] {
  const missing = ['NUMERO_AUTORIZACION', 'CODIGO_COMERCIAL', 'ESTADO_AUTORIZACION'].filter(
    (field) => !headers.includes(field) || !hasValue(row, field),
  );
  if (!headers.includes('NUMERO_PRESCRIPCION')) missing.push('NUMERO_PRESCRIPCION');
  return missing;
}

function hashContent(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export class ImportProcessor {
  constructor(
    private readonly database: Database,
    private readonly config: WorkerConfig,
  ) {}

  async process(rawJob: AuthorizationImportJob): Promise<ImportProcessingResult> {
    const job = authorizationImportJobSchema.parse(rawJob);
    if (job.payload.processorVersion !== this.config.IMPORT_PROCESSOR_VERSION) {
      throw new NonRetryableImportError(
        importTerminalErrorClassifications.processorVersionMismatch,
      );
    }
    const source = await this.getSource(job);
    if (!source) throw new Error('Import batch or source file not found');
    if (job.payload.processorVersion !== source.batch_processor_version) {
      throw new NonRetryableImportError(
        importTerminalErrorClassifications.processorVersionMismatch,
      );
    }

    // Defensa secundaria: el request HTTP no es la única entrada al worker.
    const tariff = await this.database.pool.query<{ id: string }>(
      `select id from tariff_annex_products
       where organization_id = $1 and active = true limit 1`,
      [source.organization_id],
    );
    if (tariff.rows.length === 0) {
      await this.markFailed(source.batch_id, 'TARIFF_ANNEX_REQUIRED');
      return {
        status: 'FAILED',
        totalRows: 0,
        validRows: 0,
        rejectedRows: 0,
        duplicateRows: 0,
        existingRows: 0,
      };
    }

    if (source.batch_status === 'READY_TO_CONFIRM' || source.batch_status === 'COMPLETED') {
      return this.getResult(
        source.batch_id,
        source.batch_status === 'COMPLETED' ? 'COMPLETED' : 'READY_TO_CONFIRM',
      );
    }
    if (!source.content) {
      await this.markFailed(source.batch_id, 'PROCESSING_ERROR');
      return {
        status: 'FAILED',
        totalRows: 0,
        validRows: 0,
        rejectedRows: 0,
        duplicateRows: 0,
        existingRows: 0,
      };
    }
    if (
      source.content.length !== source.size_bytes ||
      hashContent(source.content) !== source.source_sha256 ||
      source.source_sha256 !== source.batch_sha256
    ) {
      await this.markFailed(source.batch_id, 'INVALID_FIELD_FORMAT');
      return {
        status: 'FAILED',
        totalRows: 0,
        validRows: 0,
        rejectedRows: 0,
        duplicateRows: 0,
        existingRows: 0,
      };
    }

    let parsed: ReturnType<typeof parseImportFile>;
    try {
      parsed = parseImportFile(source.content, source.original_filename, source.mime_type);
    } catch (error) {
      if (!(error instanceof ImportFileError)) throw error;
      await this.markFailed(source.batch_id, error.code);
      return {
        status: 'FAILED',
        totalRows: 0,
        validRows: 0,
        rejectedRows: 0,
        duplicateRows: 0,
        existingRows: 0,
      };
    }

    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const locked = await client.query<{ status: string; processor_version: number }>(
        'select status, processor_version from import_batches where id = $1 for update',
        [source.batch_id],
      );
      const batch = locked.rows[0];
      if (!batch) throw new Error('Import batch not found');
      if (
        job.payload.processorVersion !== this.config.IMPORT_PROCESSOR_VERSION ||
        job.payload.processorVersion !== batch.processor_version
      ) {
        throw new NonRetryableImportError(
          importTerminalErrorClassifications.processorVersionMismatch,
        );
      }
      if (batch.status === 'READY_TO_CONFIRM' || batch.status === 'COMPLETED') {
        await client.query('commit');
        return this.getResult(
          source.batch_id,
          batch.status === 'COMPLETED' ? 'COMPLETED' : 'READY_TO_CONFIRM',
        );
      }

      await client.query('delete from import_rows where import_batch_id = $1', [source.batch_id]);
      await client.query(
        `update import_batches
         set status = 'VALIDATING', started_at = coalesce(started_at, now()), last_error_code = null
         where id = $1`,
        [source.batch_id],
      );

      const classifiedRows = parsed.rows.map((row) => this.classifyRow(row, parsed.headers));
      const candidateKeys = classifiedRows
        .filter((row) => row.resultCode === 'ROW_VALID' && row.classification)
        .map((row) => row.classification!.authorizationKey);
      const existingResult =
        candidateKeys.length > 0
          ? await client.query<ExistingItem>(
              'select id, authorization_key from authorization_items where authorization_key = any($1::text[])',
              [candidateKeys],
            )
          : { rows: [] as ExistingItem[] };
      const existingByKey = new Map(
        existingResult.rows.map((row) => [row.authorization_key, row.id]),
      );
      const seenKeys = new Set<string>();
      let validRows = 0;
      let rejectedRows = 0;
      let duplicateRows = 0;
      let existingRows = 0;

      for (const classified of classifiedRows) {
        let resultCode = classified.resultCode;
        let resultMessage = messages[resultCode];
        let confirmable = resultCode === 'ROW_VALID';
        let authorizationItemId: string | null = null;
        if (classified.classification) {
          const key = classified.classification.authorizationKey;
          if (seenKeys.has(key)) {
            resultCode = 'DUPLICATE_IN_FILE';
            resultMessage = messages[resultCode];
            confirmable = false;
            duplicateRows += 1;
          } else {
            seenKeys.add(key);
            const existingId = existingByKey.get(key);
            if (existingId) {
              resultCode = 'EXISTING_ITEM_REVIEW_REQUIRED';
              resultMessage = messages[resultCode];
              confirmable = false;
              authorizationItemId = existingId;
              existingRows += 1;
            } else {
              validRows += 1;
            }
          }
        } else if (resultCode !== 'ROW_VALID') {
          rejectedRows += 1;
        }

        const inserted = await client.query<{ id: string }>(
          `insert into import_rows
             (import_batch_id, row_number, raw_data, normalized_data, authorization_key, result_code, result_message, confirmable, authorization_item_id)
           values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9)
           returning id`,
          [
            source.batch_id,
            classified.row.rowNumber,
            JSON.stringify(classified.row.rawData),
            classified.classification ? JSON.stringify(classified.classification) : null,
            classified.classification?.authorizationKey ?? null,
            resultCode,
            resultMessage,
            confirmable,
            authorizationItemId,
          ],
        );
        const rowId = inserted.rows[0]?.id;
        if (!rowId) throw new Error('Import row was not created');
        for (const error of classified.errors) {
          await client.query(
            `insert into validation_errors (import_row_id, field_name, code, message)
             values ($1, $2, $3, $4)`,
            [rowId, error.field, error.code, error.message],
          );
        }
      }

      await client.query(
        `update import_batches
         set status = 'READY_TO_CONFIRM', total_rows = $2, valid_rows = $3, rejected_rows = $4,
             duplicate_rows = $5, existing_rows = $6, completed_at = null, last_error_code = null
         where id = $1`,
        [source.batch_id, parsed.rows.length, validRows, rejectedRows, duplicateRows, existingRows],
      );
      await client.query(
        `update import_source_files set content = null, processed_at = now() where id = $1`,
        [source.source_file_id],
      );
      await client.query('commit');
      return {
        status: 'READY_TO_CONFIRM',
        totalRows: parsed.rows.length,
        validRows,
        rejectedRows,
        duplicateRows,
        existingRows,
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private classifyRow(
    row: ParsedImportRow,
    headers: string[],
  ): {
    row: ParsedImportRow;
    classification: AuthorizationClassification | null;
    resultCode: ImportRowResultCode;
    errors: Array<{ field: string; code: string; message: string }>;
  } {
    const missing = missingFields(row.rawData, headers);
    if (missing.length > 0) {
      return {
        row,
        classification: null,
        resultCode: 'MISSING_REQUIRED_FIELD',
        errors: missing.map((field) => ({
          field,
          code: 'MISSING_REQUIRED_FIELD',
          message: `Falta el campo obligatorio ${field}.`,
        })),
      };
    }
    const classification = deriveAuthorizationClassification({
      numeroAutorizacion: row.rawData.NUMERO_AUTORIZACION,
      codigoComercial: row.rawData.CODIGO_COMERCIAL,
      noPrescripcion: row.rawData.NUMERO_PRESCRIPCION,
      estadoAutorizacion: row.rawData.ESTADO_AUTORIZACION,
    });
    if (!classification) {
      return {
        row,
        classification: null,
        resultCode: 'INVALID_FIELD_FORMAT',
        errors: [
          {
            field: 'NUMERO_PRESCRIPCION',
            code: 'INVALID_FIELD_FORMAT',
            message: messages.INVALID_FIELD_FORMAT,
          },
        ],
      };
    }
    return { row, classification, resultCode: 'ROW_VALID', errors: [] };
  }

  private async getSource(job: AuthorizationImportJob): Promise<SourceFileRow | undefined> {
    const result = await this.database.pool.query<SourceFileRow>(
      `select b.id as batch_id, b.organization_id, b.status as batch_status, b.sha256 as batch_sha256,
              b.processor_version as batch_processor_version, f.id as source_file_id,
              f.original_filename, f.mime_type, f.size_bytes, f.sha256 as source_sha256, f.content
       from import_batches b
       inner join import_source_files f on f.import_batch_id = b.id
       where b.id = $1 and f.id = $2`,
      [job.payload.batchId, job.payload.sourceFileId],
    );
    return result.rows[0];
  }

  private async markFailed(batchId: string, code: string): Promise<void> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const failedBatch = await client.query(
        `update import_batches
         set status = 'FAILED', completed_at = now(), last_error_code = $2
         where id = $1 and status in ('UPLOADED', 'VALIDATING')
         returning id`,
        [batchId, code],
      );
      if (failedBatch.rowCount) {
        await client.query(
          `update import_source_files set content = null, processed_at = now() where import_batch_id = $1`,
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
    status: 'READY_TO_CONFIRM' | 'COMPLETED',
  ): Promise<ImportProcessingResult> {
    const result = await this.database.pool.query<{
      total_rows: number;
      valid_rows: number;
      rejected_rows: number;
      duplicate_rows: number;
      existing_rows: number;
    }>(
      `select total_rows, valid_rows, rejected_rows, duplicate_rows, existing_rows from import_batches where id = $1`,
      [batchId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Import batch not found');
    return {
      status,
      totalRows: row.total_rows,
      validRows: row.valid_rows,
      rejectedRows: row.rejected_rows,
      duplicateRows: row.duplicate_rows,
      existingRows: row.existing_rows,
    };
  }
}
