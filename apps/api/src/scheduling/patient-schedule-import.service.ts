import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  PATIENT_SCHEDULE_IMPORT_MAX_ROWS,
  type LateHandling,
  type PatientScheduleImportBatchResponse,
  type PatientScheduleImportRowResponse,
  type ScheduleTiming,
} from '@authorization/contracts';
import {
  classifyScheduleTiming,
  evaluateScheduleAuthorizationEligibility,
  scheduleToday,
} from '@authorization/domain';
import type { ApiConfig } from '@authorization/config';
import {
  ClinicalAuthorizationRepository,
  type SchedulingAuthorization,
} from '../clinical/clinical-authorization.repository';
import type { Scope } from '../common/request-scope';
import { API_CONFIG } from '../tokens';
import type {
  PatientScheduleImportBatchRecord,
  StagedImportRowInsert,
} from './patient-schedule.repository';
import { PatientScheduleRepository } from './patient-schedule.repository';
import {
  PatientScheduleFileError,
  buildPatientScheduleTemplateXlsx,
  normalizeImportDate,
  normalizeImportQuantity,
  normalizeImportText,
  parsePatientScheduleFile,
  sanitizeImportHeader,
  type ParsedPatientScheduleRow,
} from './patient-schedule-xlsx';
import { toPatientScheduleScope, toSchedulingSearchScope } from './patient-schedule.service';

export type PatientScheduleUploadFile = Readonly<{
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}>;

const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  '',
]);

const LATE_HANDLING_ALIASES: Record<string, LateHandling> = {
  COMPLEMENTARY_PURCHASE_ORDER: 'COMPLEMENTARY_PURCHASE_ORDER',
  ORDEN_COMPRA_COMPLEMENTARIA: 'COMPLEMENTARY_PURCHASE_ORDER',
  OC_COMPLEMENTARIA: 'COMPLEMENTARY_PURCHASE_ORDER',
  NEXT_PERIOD: 'NEXT_PERIOD',
  SIGUIENTE_PERIODO: 'NEXT_PERIOD',
  PERIODO_SIGUIENTE: 'NEXT_PERIOD',
};

/**
 * ESP-003: carga masiva XLSX con staging (VALID/INVALID/DUPLICATE/CONFLICT),
 * preview y confirmación transaccional por fila elegible. El procesamiento es
 * síncrono dentro del request: el archivo nunca viaja por la cola.
 */
@Injectable()
export class PatientScheduleImportService {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly repository: PatientScheduleRepository,
    private readonly clinical: ClinicalAuthorizationRepository,
  ) {}

  buildTemplate(): Buffer {
    return buildPatientScheduleTemplateXlsx();
  }

  async createImport(input: {
    file: PatientScheduleUploadFile | undefined;
    actor: Scope;
  }): Promise<PatientScheduleImportBatchResponse> {
    const file = input.file;
    if (!file) {
      throw new BadRequestException({
        code: 'PATIENT_SCHEDULE_IMPORT_FILE_REQUIRED',
        message: 'An XLSX file is required',
      });
    }
    if (file.size === 0) {
      throw new BadRequestException({
        code: 'PATIENT_SCHEDULE_IMPORT_EMPTY_FILE',
        message: 'The uploaded file is empty',
      });
    }
    if (file.size > this.config.IMPORT_MAX_FILE_BYTES) {
      throw new BadRequestException({
        code: 'PATIENT_SCHEDULE_IMPORT_FILE_TOO_LARGE',
        message: `The file exceeds the ${this.config.IMPORT_MAX_FILE_BYTES} bytes limit`,
      });
    }
    if (!/\.xlsx$/i.test(file.originalname)) {
      throw new BadRequestException({
        code: 'PATIENT_SCHEDULE_IMPORT_INVALID_FILE_FORMAT',
        message: 'Only .xlsx files are accepted',
      });
    }
    if (!XLSX_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException({
        code: 'PATIENT_SCHEDULE_IMPORT_INVALID_FILE_FORMAT',
        message: 'The file MIME type is not an XLSX type',
      });
    }

    let parsed: ParsedPatientScheduleRow[];
    try {
      parsed = parsePatientScheduleFile(file.buffer);
    } catch (error) {
      if (error instanceof PatientScheduleFileError) {
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      throw error;
    }
    if (parsed.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_FILE',
        message: 'The XLSX file has no data rows',
      });
    }
    if (parsed.length > PATIENT_SCHEDULE_IMPORT_MAX_ROWS) {
      throw new BadRequestException({
        code: 'PATIENT_SCHEDULE_IMPORT_TOO_MANY_ROWS',
        message: `The file exceeds ${PATIENT_SCHEDULE_IMPORT_MAX_ROWS} data rows`,
      });
    }

    const rows = await this.classifyParsedRows(parsed, input.actor);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const batch = await this.repository.createImportBatch({
      actor: input.actor,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      sha256,
      content: file.buffer,
      rows,
    });
    return toImportBatchResponse(batch);
  }

  async getImport(importId: string, actor: Scope): Promise<PatientScheduleImportBatchResponse> {
    const batch = await this.repository.findImportById(importId, toPatientScheduleScope(actor));
    if (!batch) throw importNotFound();
    return toImportBatchResponse(batch);
  }

  async listImports(actor: Scope, limit: number): Promise<PatientScheduleImportBatchResponse[]> {
    const batches = await this.repository.listImportBatches(toPatientScheduleScope(actor), limit);
    return batches.map(toImportBatchResponse);
  }

  async getImportRows(importId: string, actor: Scope): Promise<PatientScheduleImportRowResponse[]> {
    const batch = await this.repository.findImportById(importId, toPatientScheduleScope(actor));
    if (!batch) throw importNotFound();
    const rows = await this.repository.listImportRows(importId);
    return rows.map(toImportRowResponse);
  }

  async confirmImport(importId: string, actor: Scope): Promise<PatientScheduleImportBatchResponse> {
    const scope = toPatientScheduleScope(actor);
    const batch = await this.repository.findImportById(importId, scope);
    if (!batch) throw importNotFound();
    if (batch.status !== 'READY_TO_CONFIRM' && batch.status !== 'CONFIRMING') {
      throw new ConflictException({
        code: 'PATIENT_SCHEDULE_IMPORT_NOT_CONFIRMABLE',
        message: `The import is in status ${batch.status} and cannot be confirmed`,
      });
    }
    await this.repository.beginConfirmation(importId);
    const rows = await this.repository.listConfirmableRows(importId);
    for (const row of rows) {
      if (!row.authorizationItemId || !row.commercialCode) {
        await this.repository.markImportRowConflict(
          row.id,
          'The staged row has no resolved authorization item',
        );
        continue;
      }
      try {
        // La revalidación de la autorización ocurre DENTRO de la transacción
        // de la fila (lock + reevaluación), no aquí.
        const result = await this.repository.confirmImportRow({ rowId: row.id, actor });
        if (result.outcome === 'conflict') {
          await this.repository.markImportRowConflict(
            row.id,
            result.message,
            result.code ?? 'CONFIRMATION_CONFLICT',
          );
        }
      } catch (error) {
        await this.repository.markImportRowConflict(
          row.id,
          error instanceof Error ? error.message : 'Confirmation failed',
        );
      }
    }
    const finalized = await this.repository.finalizeImport({ importId, actor });
    return toImportBatchResponse(finalized ?? batch);
  }

  async classifyParsedRows(
    parsed: readonly ParsedPatientScheduleRow[],
    actor: Scope,
  ): Promise<StagedImportRowInsert[]> {
    const searchScope = toSchedulingSearchScope(actor);
    const authorizationNumbers = unique(
      parsed
        .map((row) => normalizeImportText(row.values.AUTORIZACION))
        .filter((value): value is string => value !== null),
    );
    const pointCodes = unique(
      parsed
        .map((row) => normalizeImportText(row.values.PUNTO)?.toUpperCase())
        .filter((value): value is string => value !== null && value !== undefined),
    );
    const dates = unique(
      parsed
        .map((row) => normalizeImportDate(row.values.FECHA_PROGRAMADA))
        .filter((value): value is string => value !== null),
    );

    const items = await this.clinical.loadForImportByNumbers(authorizationNumbers, searchScope);
    const itemsByNumber = new Map<string, SchedulingAuthorization[]>();
    for (const item of items) {
      const key = item.authorizationNumber.toUpperCase();
      const bucket = itemsByNumber.get(key) ?? [];
      bucket.push(item);
      itemsByNumber.set(key, bucket);
    }
    const points = await this.repository.findDispensingPointsByCodes(pointCodes);
    const periods =
      dates.length === 0
        ? []
        : await this.repository.loadPeriodsCovering(
            dates.reduce((min, date) => (date < min ? date : min), dates[0] as string),
            dates.reduce((max, date) => (date > max ? date : max), dates[0] as string),
          );
    const existing = await this.repository.loadActiveSchedulesForItems(
      unique(items.map((item) => item.id)),
    );
    const existingKeys = new Set(
      existing.map(
        (schedule) =>
          `${schedule.authorizationItemId}|${schedule.dispensingPointId}|${schedule.scheduledDate}`,
      ),
    );

    const staged: StagedImportRowInsert[] = [];
    const seenKeys = new Set<string>();
    for (const row of parsed) {
      staged.push(
        await this.classifyRow({
          row,
          itemsByNumber,
          points,
          periods,
          existingKeys,
          seenKeys,
        }),
      );
    }
    return staged;
  }

  private async classifyRow(input: {
    row: ParsedPatientScheduleRow;
    itemsByNumber: Map<string, SchedulingAuthorization[]>;
    points: Awaited<ReturnType<PatientScheduleRepository['findDispensingPointsByCodes']>>;
    periods: Awaited<ReturnType<PatientScheduleRepository['loadPeriodsCovering']>>;
    existingKeys: Set<string>;
    seenKeys: Set<string>;
  }): Promise<StagedImportRowInsert> {
    const { row } = input;
    const authorizationNumber = normalizeImportText(row.values.AUTORIZACION);
    const patientDocument = normalizeImportText(row.values.DOCUMENTO);
    const commercialCode = normalizeImportText(row.values.COD_COMERCIAL)?.toUpperCase() ?? null;
    const pointCode = normalizeImportText(row.values.PUNTO)?.toUpperCase() ?? null;
    const scheduledDate = normalizeImportDate(row.values.FECHA_PROGRAMADA);
    const quantity = normalizeImportQuantity(row.values.CANTIDAD);
    const handlingRaw = normalizeImportText(row.values.MANEJO_TARDIO);

    const base = {
      rowNumber: row.rowNumber,
      rawData: row.rawData,
      patientDocument,
      authorizationNumber,
      commercialCode,
      quantity: quantity !== null && quantity > 0 ? quantity : null,
      dispensingPointCode: pointCode,
      scheduledDate,
    };
    const reject = (
      stagingStatus: StagedImportRowInsert['stagingStatus'],
      resultCode: string,
      resultMessage: string,
      normalizedData: unknown = null,
    ): StagedImportRowInsert => ({
      ...base,
      normalizedData,
      stagingStatus,
      resultCode,
      resultMessage,
      authorizationItemId: null,
      planningPeriodId: null,
      dispensingPointId: null,
      scheduleTiming: null,
      lateHandling: null,
      deferredPlanningPeriodId: null,
      confirmable: false,
    });

    const missing: string[] = [];
    if (authorizationNumber === null) missing.push('AUTORIZACION');
    if (patientDocument === null) missing.push('DOCUMENTO');
    if (commercialCode === null) missing.push('COD_COMERCIAL');
    if (quantity === null) missing.push('CANTIDAD');
    if (pointCode === null) missing.push('PUNTO');
    if (scheduledDate === null) missing.push('FECHA_PROGRAMADA');
    if (
      authorizationNumber === null ||
      patientDocument === null ||
      commercialCode === null ||
      pointCode === null ||
      scheduledDate === null ||
      quantity === null
    ) {
      return reject(
        'INVALID',
        'MISSING_REQUIRED_FIELD',
        `Missing or unreadable fields: ${missing.join(', ')}`,
      );
    }
    if (quantity <= 0) {
      return reject('INVALID', 'INVALID_QUANTITY', 'CANTIDAD must be an integer greater than zero');
    }

    const candidates = input.itemsByNumber.get(authorizationNumber.toUpperCase()) ?? [];
    if (candidates.length === 0) {
      return reject(
        'INVALID',
        'AUTHORIZATION_ITEM_NOT_FOUND',
        `Authorization ${authorizationNumber} was not found`,
      );
    }
    const documentMatches = candidates.filter(
      (item) => normalizeDocument(item.patientDocument) === normalizeDocument(patientDocument),
    );
    if (documentMatches.length === 0) {
      return reject(
        'INVALID',
        'PATIENT_DOCUMENT_MISMATCH',
        `DOCUMENTO does not match authorization ${authorizationNumber}`,
      );
    }
    const item = documentMatches.find((candidate) => candidate.commercialCode === commercialCode);
    if (!item) {
      return reject(
        'INVALID',
        'AUTHORIZATION_CODE_MISMATCH',
        `${commercialCode} does not belong to authorization ${authorizationNumber}`,
      );
    }
    const point = input.points.find((candidate) => candidate.code.toUpperCase() === pointCode);
    if (!point) {
      return reject('INVALID', 'DISPENSING_POINT_NOT_FOUND', `Point ${pointCode} was not found`);
    }
    const period = input.periods.find(
      (candidate) => candidate.startDate <= scheduledDate && candidate.endDate >= scheduledDate,
    );
    if (!period) {
      return reject(
        'INVALID',
        'PLANNING_PERIOD_NOT_FOUND',
        `No planning period covers ${scheduledDate}`,
      );
    }
    const eligibility = evaluateScheduleAuthorizationEligibility({
      enablementStatus: item.enablementStatus,
      coverageType: item.coverageType,
      directionStatus: item.directionStatus,
      expirationDate: item.authorizationExpiresOn,
      todayBogota: scheduleToday(),
    });
    if (!eligibility.eligible) {
      return reject(
        'CONFLICT',
        eligibility.code ?? 'AUTHORIZATION_NOT_SCHEDULABLE',
        eligibility.message ?? 'The authorization is not schedulable',
      );
    }

    const timing = classifyScheduleTiming(period, new Date());
    let lateHandling: LateHandling | null = null;
    if (handlingRaw !== null) {
      const alias = LATE_HANDLING_ALIASES[sanitizeImportHeader(handlingRaw)];
      if (!alias) {
        return reject(
          'INVALID',
          'INVALID_FIELD_FORMAT',
          `MANEJO_TARDIO value ${handlingRaw} is not recognized`,
        );
      }
      if (timing === 'LATE') lateHandling = alias;
    }
    if (timing === 'LATE' && lateHandling === null) {
      return reject(
        'INVALID',
        'LATE_HANDLING_REQUIRED',
        'MANEJO_TARDIO is required when the schedule is after the period cutoff',
      );
    }
    let deferredPlanningPeriodId: string | null = null;
    if (lateHandling === 'NEXT_PERIOD') {
      const next = await this.repository.findNextPeriod(period.endDate);
      if (!next) {
        return reject(
          'CONFLICT',
          'NEXT_PERIOD_NOT_FOUND',
          'There is no next planning period to defer the schedule to',
        );
      }
      deferredPlanningPeriodId = next.id;
    }

    const duplicateKey = `${authorizationNumber.toUpperCase()}|${commercialCode}|${point.id}|${scheduledDate}`;
    if (input.seenKeys.has(duplicateKey)) {
      return reject('DUPLICATE', 'DUPLICATE_IN_FILE', 'The row is duplicated inside the file');
    }
    input.seenKeys.add(duplicateKey);
    const existingKey = `${item.id}|${point.id}|${scheduledDate}`;
    if (input.existingKeys.has(existingKey)) {
      return reject(
        'DUPLICATE',
        'DUPLICATE_EXISTING_SCHEDULE',
        'An active schedule already exists for the same authorization, point and date',
      );
    }

    return {
      ...base,
      normalizedData: {
        authorizationItemId: item.id,
        authorizationNumber,
        commercialCode,
        patientDocument,
        quantity,
        dispensingPointId: point.id,
        dispensingPointCode: point.code,
        planningPeriodId: period.id,
        scheduledDate,
        scheduleTiming: timing,
        lateHandling,
        deferredPlanningPeriodId,
      },
      stagingStatus: 'VALID',
      resultCode: 'ROW_VALID',
      resultMessage: null,
      authorizationItemId: item.id,
      planningPeriodId: period.id,
      dispensingPointId: point.id,
      scheduleTiming: timing as ScheduleTiming,
      lateHandling,
      deferredPlanningPeriodId,
      confirmable: true,
    };
  }
}

function importNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'PATIENT_SCHEDULE_IMPORT_NOT_FOUND',
    message: 'Patient schedule import not found',
  });
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalizeDocument(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized === '' ? null : normalized;
}

export function toImportBatchResponse(
  batch: PatientScheduleImportBatchRecord,
): PatientScheduleImportBatchResponse {
  return {
    id: batch.id,
    status: batch.status,
    originalFilename: batch.originalFilename,
    mimeType: batch.mimeType,
    sizeBytes: batch.sizeBytes,
    sha256: batch.sha256,
    totalRows: batch.totalRows,
    validRows: batch.validRows,
    invalidRows: batch.invalidRows,
    duplicateRows: batch.duplicateRows,
    conflictRows: batch.conflictRows,
    confirmedRows: batch.confirmedRows,
    lastErrorCode: batch.lastErrorCode,
    createdAt: batch.createdAt,
    completedAt: batch.completedAt,
    confirmedAt: batch.confirmedAt,
  };
}

function toImportRowResponse(row: {
  id: string;
  rowNumber: number;
  stagingStatus: 'VALID' | 'INVALID' | 'DUPLICATE' | 'CONFLICT';
  resultCode: string;
  resultMessage: string | null;
  patientDocument: string | null;
  authorizationNumber: string | null;
  commercialCode: string | null;
  quantity: number | null;
  dispensingPointCode: string | null;
  scheduledDate: string | null;
  scheduleTiming: ScheduleTiming | null;
  lateHandling: LateHandling | null;
  confirmable: boolean;
  patientScheduleId: string | null;
  confirmedAt: string | null;
}): PatientScheduleImportRowResponse {
  return {
    id: row.id,
    rowNumber: row.rowNumber,
    stagingStatus: row.stagingStatus,
    resultCode: row.resultCode,
    resultMessage: row.resultMessage,
    patientDocument: row.patientDocument,
    authorizationNumber: row.authorizationNumber,
    commercialCode: row.commercialCode,
    quantity: row.quantity,
    dispensingPointCode: row.dispensingPointCode,
    scheduledDate: row.scheduledDate,
    scheduleTiming: row.scheduleTiming,
    lateHandling: row.lateHandling,
    confirmable: row.confirmable,
    patientScheduleId: row.patientScheduleId,
    confirmedAt: row.confirmedAt,
  };
}
