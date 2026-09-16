import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  BulkImportJobResponse,
  BulkImportRowListQuery,
  BulkImportRowResponse,
} from '@authorization/contracts';
import {
  BULK_IMPORT_MAX_FILE_BYTES,
  canCancelBulkImportJob,
  canConfirmBulkImportJob,
  canResumeBulkImportJob,
  canRetryFailedBulkImportJob,
  initialExecutionStatus,
  phiSafeBulkImportLog,
  PointAccessDeniedError,
} from '@authorization/domain';
import type { ApiConfig } from '@authorization/config';
import type { Scope } from '../common/request-scope';
import { API_CONFIG } from '../tokens';
import { BulkImportRepository, type BulkImportRowInsert } from './bulk-import.repository';
import {
  BulkImportFileError,
  buildBulkImportResultWorkbook,
  buildAuthorizationTemplate,
  isAcceptedXlsxMime,
  parseAuthorizationWorkbook,
} from './bulk-import-xlsx';

export type BulkImportUploadFile = Readonly<{
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}>;

@Injectable()
export class BulkImportService {
  private readonly logger = new Logger(BulkImportService.name);

  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly repository: BulkImportRepository,
  ) {}

  buildAuthorizationTemplate(): Buffer {
    return buildAuthorizationTemplate();
  }

  async uploadAuthorizations(input: {
    file: BulkImportUploadFile | undefined;
    actor: Scope;
  }): Promise<BulkImportJobResponse> {
    const file = this.assertFile(input.file);
    let parsed;
    try {
      parsed = parseAuthorizationWorkbook(file.buffer);
    } catch (error) {
      if (error instanceof BulkImportFileError) {
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      throw error;
    }
    if (parsed.rows.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_FILE',
        message: 'The XLSX file has no data rows',
      });
    }
    const commercialCodes = [...new Set(
      parsed.rows
        .map((row) => textValue(row.values.CODIGO_COMERCIAL))
        .filter((value): value is string => Boolean(value)),
    )];
    const activeTariffCodes = await this.repository.findActiveTariffAnnexProductCodes(
      input.actor.organizationId,
      commercialCodes,
    );
    const rows: BulkImportRowInsert[] = parsed.rows.map((row) => {
      const payload = Object.fromEntries(
        Object.entries(row.values).map(([key, value]) => [
          key,
          key === 'FECHA_ASIGNACION' || key === 'FECHA_FINAL_VIGENCIA'
            ? dateValue(value)
            : textValue(value),
        ]),
      );
      const required = ['NUMERO_AUTORIZACION', 'CODIGO_COMERCIAL', 'CANTIDAD', 'FECHA_ASIGNACION'];
      const missing = required.filter((key) => !payload[key]);
      const quantity = Number(payload.CANTIDAD);
      const assignmentDate = payload.FECHA_ASIGNACION;
      const commercialCode = typeof payload.CODIGO_COMERCIAL === 'string' ? payload.CODIGO_COMERCIAL : null;
      const tariffMatch = commercialCode ? activeTariffCodes.has(commercialCode) : false;
      const valid =
        missing.length === 0 &&
        Number.isInteger(quantity) &&
        quantity > 0 &&
        typeof assignmentDate === 'string' &&
        isIsoDate(assignmentDate) &&
        tariffMatch;
      return {
        rowNumber: row.rowNumber,
        rawPayload: row.rawData,
        normalizedPayload: payload,
        validationStatus: valid ? 'VALID' : 'INVALID',
        errorCode: valid
          ? null
          : !tariffMatch
            ? 'TARIFF_ANNEX_PRODUCT_NOT_FOUND'
            : 'INVALID_AUTHORIZATION_ROW',
        errorMessage: valid
          ? null
          : !tariffMatch
            ? `El código comercial ${commercialCode ?? '(vacío)'} no existe en el anexo tarifario activo`
            : `Missing or invalid fields: ${missing.join(', ') || 'CANTIDAD or FECHA_ASIGNACION'}`,
        errorColumn: null,
        executionStatus: initialExecutionStatus(valid ? 'VALID' : 'INVALID'),
        authorizationNumber: typeof payload.NUMERO_AUTORIZACION === 'string' ? payload.NUMERO_AUTORIZACION : null,
        commercialCode,
        dispensingPointCode: null,
        assignmentDate: typeof payload.FECHA_ASIGNACION === 'string' ? payload.FECHA_ASIGNACION : null,
        quantity: valid ? quantity : null,
      };
    });
    const validRows = rows.filter((row) => row.validationStatus === 'VALID').length;
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const duplicateFile = await this.repository.hasDuplicateHash(input.actor.userId, fileHash);
    return this.repository.createJob({
      actor: input.actor,
      templateVersion: parsed.templateVersion,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      fileHash,
      duplicateFile,
      rows,
      status: validRows > 0 ? 'READY' : 'INVALID',
    });
  }

  async getJob(jobId: string, actor: Scope): Promise<BulkImportJobResponse> {
    const job = await this.repository.findJob(jobId, actor);
    if (!job) throw jobNotFound();
    return job;
  }

  async listJobs(actor: Scope, limit: number): Promise<BulkImportJobResponse[]> {
    return this.repository.listJobs(actor, limit);
  }

  async listRows(
    jobId: string,
    actor: Scope,
    query: BulkImportRowListQuery,
  ): Promise<BulkImportRowResponse[]> {
    await this.getJob(jobId, actor);
    return this.repository.listRows(jobId, query.filter, actor);
  }

  async confirm(jobId: string, actor: Scope): Promise<BulkImportJobResponse> {
    const job = await this.getJob(jobId, actor);
    if (!canConfirmBulkImportJob(job.status) && !canResumeBulkImportJob(job.status)) {
      throw new ConflictException({
        code: 'BULK_IMPORT_NOT_CONFIRMABLE',
        message: `The import is in status ${job.status} and cannot be confirmed`,
      });
    }
    const claimed = await this.repository.markJobProcessing(jobId, randomUUID());
    if (!claimed) {
      return this.getJob(jobId, actor);
    }
    if (claimed.previousStatus === 'READY') {
      await this.repository.recordAudit(actor, 'BULK_IMPORT_CONFIRMED', jobId, {
        importType: 'AUTHORIZATIONS',
        totalRows: job.totalRows,
      });
    }
    return this.processRows(jobId, actor, 'confirm', claimed.waveStartedAt);
  }

  async retryFailed(jobId: string, actor: Scope): Promise<BulkImportJobResponse> {
    const job = await this.getJob(jobId, actor);
    if (!canRetryFailedBulkImportJob(job.status)) {
      throw new ConflictException({
        code: 'BULK_IMPORT_NOT_RETRYABLE',
        message: `The import is in status ${job.status} and cannot retry failed rows`,
      });
    }
    const claimed = await this.repository.markJobProcessing(jobId, randomUUID());
    if (!claimed) {
      return this.getJob(jobId, actor);
    }
    return this.processRows(jobId, actor, 'retry', claimed.waveStartedAt);
  }

  async cancel(jobId: string, actor: Scope): Promise<BulkImportJobResponse> {
    const job = await this.getJob(jobId, actor);
    if (!canCancelBulkImportJob(job.status) && job.status !== 'INVALID') {
      throw new ConflictException({
        code: 'BULK_IMPORT_NOT_CANCELLABLE',
        message: `The import is in status ${job.status} and cannot be cancelled`,
      });
    }
    const cancelled = await this.repository.cancelJob(jobId, actor);
    if (!cancelled) {
      throw new ConflictException({
        code: 'BULK_IMPORT_NOT_CANCELLABLE',
        message: 'The import can no longer be cancelled',
      });
    }
    return cancelled;
  }

  async resultWorkbook(jobId: string, actor: Scope): Promise<Buffer> {
    await this.getJob(jobId, actor);
    const rows = await this.repository.listRows(jobId, 'ALL', actor);
    return buildBulkImportResultWorkbook(rows);
  }

  async rejectedRowsWorkbook(jobId: string, actor: Scope): Promise<Buffer> {
    await this.getJob(jobId, actor);
    const rows = await this.repository.listRows(jobId, 'ALL', actor);
    const rejectedRows = rows.filter(
      (row) => row.validationStatus !== 'VALID' || row.executionStatus === 'FAILED',
    );
    return buildBulkImportResultWorkbook(rejectedRows);
  }

  private async processRows(
    jobId: string,
    actor: Scope,
    mode: 'confirm' | 'retry',
    waveStartedAt: Date | string,
  ): Promise<BulkImportJobResponse> {
    for (;;) {
      const claimed = await this.repository.claimNextRow(jobId, mode, randomUUID(), waveStartedAt);
      if (!claimed) break;
      if (claimed.reclaimed) {
        await this.repository.recordAudit(actor, 'BULK_IMPORT_ROW_RECLAIMED', jobId, {
           importType: 'AUTHORIZATIONS',
          rowNumber: claimed.rowNumber,
          claimGeneration: claimed.claimGeneration,
        });
      }
      const payload = claimed.normalizedPayload ?? {};
      try {
        const executed = await this.repository.executeClaimedRow({
          rowId: claimed.id,
          attemptNumber: claimed.attemptCount,
          claimToken: claimed.claimToken,
          claimGeneration: claimed.claimGeneration,
          execute: (tx) => this.repository.upsertAuthorizationInTx(tx, {
            actor,
            payload,
            jobId,
          }),
        });
        if (executed === 'stale') {
          this.logger.warn(
            JSON.stringify(
              phiSafeBulkImportLog({
                jobId,
                rowNumber: claimed.rowNumber,
                errorCode: 'STALE_CLAIM',
              }),
            ),
          );
        }
      } catch (error) {
        const mapped = mapDomainError(error);
        this.logger.warn(
          JSON.stringify(
            phiSafeBulkImportLog({
              jobId,
              rowNumber: claimed.rowNumber,
              errorCode: mapped.code,
            }),
          ),
        );
        if (!isBulkDomainFailure(error)) continue;
        const completed = await this.repository.markRowResult({
          rowId: claimed.id,
          attemptNumber: claimed.attemptCount,
          claimToken: claimed.claimToken,
          claimGeneration: claimed.claimGeneration,
          status: 'FAILED',
          errorCode: mapped.code,
          errorMessage: mapped.message,
        });
        if (!completed) {
          this.logger.warn(
            JSON.stringify(
              phiSafeBulkImportLog({
                jobId,
                rowNumber: claimed.rowNumber,
                errorCode: 'STALE_CLAIM',
              }),
            ),
          );
        }
      }
    }
    return this.repository.finalizeFromRows(jobId, actor);
  }

  private assertFile(file: BulkImportUploadFile | undefined): BulkImportUploadFile {
    if (!file) {
      throw new BadRequestException({
        code: 'BULK_IMPORT_FILE_REQUIRED',
        message: 'An XLSX file is required',
      });
    }
    if (file.size === 0) {
      throw new BadRequestException({
        code: 'BULK_IMPORT_EMPTY_FILE',
        message: 'The uploaded file is empty',
      });
    }
    const maxBytes = Math.min(this.config.IMPORT_MAX_FILE_BYTES, BULK_IMPORT_MAX_FILE_BYTES);
    if (file.size > maxBytes) {
      throw new BadRequestException({
        code: 'BULK_IMPORT_FILE_TOO_LARGE',
        message: `The file exceeds the ${maxBytes} bytes limit`,
      });
    }
    if (!/\.xlsx$/i.test(file.originalname)) {
      throw new BadRequestException({
        code: 'INVALID_FILE_FORMAT',
        message: 'Only .xlsx files are accepted',
      });
    }
    if (!isAcceptedXlsxMime(file.mimetype)) {
      throw new BadRequestException({
        code: 'INVALID_FILE_FORMAT',
        message: 'The file MIME type is not an XLSX type',
      });
    }
    return file;
  }
}

function jobNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'BULK_IMPORT_NOT_FOUND',
    message: 'Bulk import job not found',
  });
}

function isBulkDomainFailure(error: unknown): boolean {
  return error instanceof HttpException || error instanceof PointAccessDeniedError;
}

function textValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return null;
}

function dateValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000)
      .toISOString()
      .slice(0, 10);
  }
  const text = textValue(value);
  if (!text) return null;
  const match = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/.exec(text);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : text;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function mapDomainError(error: unknown): { code: string; message: string } {
  if (error instanceof PointAccessDeniedError) {
    return {
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response && 'code' in response) {
      const payload = response as { code?: string; message?: string };
      return {
        code: payload.code ?? 'PROCESSING_ERROR',
        message: payload.message ?? error.message,
      };
    }
    return { code: 'PROCESSING_ERROR', message: error.message };
  }
  return {
    code: 'PROCESSING_ERROR',
    message: error instanceof Error ? error.message : 'Confirmation failed',
  };
}
