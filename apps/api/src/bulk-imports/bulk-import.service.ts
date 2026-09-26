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
import { PatientScheduleImportService } from '../scheduling/patient-schedule-import.service';
import { isScheduleDuplicateError } from '../scheduling/patient-schedule.repository';
import { PatientScheduleService } from '../scheduling/patient-schedule.service';
import { BulkImportRepository, type BulkImportRowInsert } from './bulk-import.repository';
import {
  BulkImportFileError,
  buildBulkImportResultWorkbook,
  buildEsp014SchedulingTemplate,
  buildAuthorizationTemplate,
  isAcceptedXlsxMime,
  parseEsp014SchedulingWorkbook,
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
    classifier?: PatientScheduleImportService,
    schedules?: PatientScheduleService,
  ) {
    this.classifier = classifier;
    this.schedules = schedules;
  }

  buildAuthorizationTemplate(): Buffer {
    return buildAuthorizationTemplate();
  }

  buildSchedulingTemplate(): Buffer {
    return buildEsp014SchedulingTemplate();
  }

  async uploadScheduling(input: {
    file: BulkImportUploadFile | undefined;
    actor: Scope;
  }): Promise<BulkImportJobResponse> {
    const file = this.assertFile(input.file);
    if (!this.classifier) throw new ConflictException('Scheduling import is unavailable');
    let parsed;
    try {
      parsed = parseEsp014SchedulingWorkbook(file.buffer);
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
    const classified = await this.classifier.classifyParsedRows(parsed.rows, input.actor);
    const rows: BulkImportRowInsert[] = classified.map((row) => ({
      rowNumber: row.rowNumber,
      rawPayload: row.rawData,
      normalizedPayload: {
        ...(row.normalizedData && typeof row.normalizedData === 'object'
          ? (row.normalizedData as Record<string, unknown>)
          : {}),
        authorizationNumber: row.authorizationNumber,
        commercialCode: row.commercialCode,
        dispensingPointCode: row.dispensingPointCode,
        scheduledDate: row.scheduledDate,
        quantity: row.quantity,
      },
      validationStatus: row.stagingStatus,
      errorCode: row.resultCode === 'ROW_VALID' ? null : row.resultCode,
      errorMessage: row.resultMessage,
      errorColumn: null,
      executionStatus: initialExecutionStatus(row.stagingStatus),
      authorizationNumber: row.authorizationNumber,
      commercialCode: row.commercialCode,
      dispensingPointCode: row.dispensingPointCode,
      scheduledDate: row.scheduledDate,
      quantity: row.quantity,
      assignmentDate: null,
    }));
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    return this.repository.createJob({
      actor: input.actor,
      templateVersion: parsed.templateVersion,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      fileHash,
      duplicateFile: await this.repository.hasDuplicateHash(input.actor.userId, fileHash),
      rows,
      status: rows.some((row) => row.validationStatus === 'VALID') ? 'READY' : 'INVALID',
      importType: 'SCHEDULING',
    });
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
    /*
     * INGESTA COMPLETA DE AUTORIZACIONES
     * ==================================
     *
     * El upload valida únicamente si la fila tiene identidad operacional:
     *
     *   NUMERO_AUTORIZACION + CODIGO_COMERCIAL
     *
     * Las reglas de negocio NO impiden persistir la AUTO:
     *
     * - producto ausente del AT;
     * - PBS / NO PBS;
     * - cantidad inferior al mínimo;
     * - cantidad inválida;
     * - vigencia vencida;
     * - fechas inválidas;
     * - estado de autorización no habilitante.
     *
     * Esas condiciones se conservan y se proyectan después como
     * validación / vigencia de la autorización.
     */
    const rows: BulkImportRowInsert[] =
      parsed.rows.map((row) => {
        const payload =
          Object.fromEntries(
            Object.entries(
              row.values,
            ).map(
              ([key, value]) => [
                key,

                key ===
                    'FECHA_ASIGNACION' ||
                key ===
                    'FECHA_FINAL_VIGENCIA'
                  ? dateValue(value)
                  : textValue(value),
              ],
            ),
          );

        const authorizationNumber =
          typeof payload
            .NUMERO_AUTORIZACION ===
            'string' &&
          payload
            .NUMERO_AUTORIZACION
            .trim()
            ? payload
                .NUMERO_AUTORIZACION
                .trim()
            : null;

        const commercialCode =
          typeof payload
            .CODIGO_COMERCIAL ===
            'string' &&
          payload
            .CODIGO_COMERCIAL
            .trim()
            ? payload
                .CODIGO_COMERCIAL
                .trim()
            : null;

        const hasIdentity =
          authorizationNumber !==
            null &&
          commercialCode !==
            null;

        const quantityRaw =
          Number(
            payload.CANTIDAD,
          );

        const quantity =
          Number.isInteger(
            quantityRaw,
          )
            ? quantityRaw
            : null;

        return {
          rowNumber:
            row.rowNumber,

          rawPayload:
            row.rawData,

          normalizedPayload:
            payload,

          validationStatus:
            hasIdentity
              ? 'VALID'
              : 'INVALID',

          errorCode:
            hasIdentity
              ? null
              : 'AUTHORIZATION_IDENTITY_REQUIRED',

          errorMessage:
            hasIdentity
              ? null
              : 'NUMERO_AUTORIZACION y CODIGO_COMERCIAL son obligatorios para identificar la autorización',

          errorColumn:
            null,

          executionStatus:
            initialExecutionStatus(
              hasIdentity
                ? 'VALID'
                : 'INVALID',
            ),

          authorizationNumber,

          commercialCode,

          dispensingPointCode:
            null,

          assignmentDate:
            typeof payload
              .FECHA_ASIGNACION ===
              'string'
              ? payload
                  .FECHA_ASIGNACION
              : null,

          quantity,
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
          execute: (tx) =>
            payload.authorizationItemId
              ? this.schedules!.createInTx(tx, {
                  actor,
                  body: {
                    authorizationItemId: textValue(payload.authorizationItemId) ?? '',
                    commercialCode: textValue(payload.commercialCode) ?? '',
                    dispensingPointId: textValue(payload.dispensingPointId) ?? '',
                    scheduledDate: textValue(payload.scheduledDate) ?? '',
                    quantity: Number(payload.quantity),
                    ...(payload.lateHandling
                      ? {
                          lateHandling: payload.lateHandling as
                            | 'COMPLEMENTARY_PURCHASE_ORDER'
                            | 'NEXT_PERIOD',
                        }
                      : {}),
                  },
                })
              : this.repository.upsertAuthorizationInTx(tx, { actor, payload, jobId }),
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

  private readonly classifier: PatientScheduleImportService | undefined;
  private readonly schedules: PatientScheduleService | undefined;

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
  return (
    error instanceof HttpException ||
    error instanceof PointAccessDeniedError ||
    isScheduleDuplicateError(error)
  );
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
  if (isScheduleDuplicateError(error)) {
    return {
      code: 'PATIENT_SCHEDULE_DUPLICATE',
      message: 'An active schedule already exists for the same authorization, point and date',
    };
  }
  return {
    code: 'PROCESSING_ERROR',
    message: error instanceof Error ? error.message : 'Confirmation failed',
  };
}
