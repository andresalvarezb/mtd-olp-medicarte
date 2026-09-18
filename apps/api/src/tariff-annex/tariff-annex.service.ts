import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import type { Scope } from '../common/request-scope';
import { DATABASE } from '../tokens';
import {
  TariffAnnexRepository,
  type TariffConfirmOutcome,
  type TariffPrepareOutcome,
} from './tariff-annex.repository';

type Database = ReturnType<typeof createDatabase>;

export type UploadedTariffFile = Readonly<{
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}>;

export type TariffImportResponse = Readonly<{
  id: string;
  status: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  preview: unknown;
  previewTotal: number;
  previewUnchanged: number;
  previewChanged: number;
  previewAnomalous: number;
  previewRejected: number;
  previewScalePatternDetected: boolean;
  confirmedAt: string | null;
  completedAt: string | null;
}>;

type ImportResponseRow = {
  id: string;
  status: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  preview: unknown;
  preview_total: number;
  preview_unchanged: number;
  preview_changed: number;
  preview_anomalous: number;
  preview_rejected: number;
  preview_scale_pattern_detected: boolean;
  confirmed_at: Date | null;
  completed_at: Date | null;
};

@Injectable()
export class TariffAnnexService {
  constructor(
    private readonly repository: TariffAnnexRepository,
    @Inject(DATABASE) private readonly database: Database,
  ) {}

  async createImport(input: {
    file: UploadedTariffFile;
    scope: Scope;
  }): Promise<TariffImportResponse> {
    requireMtd(input.scope);

    if (!input.file.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException({
        code: 'TARIFF_IMPORT_INVALID_FILE',
        message: 'Solo se admiten archivos XLSX.',
      });
    }

    if (input.file.buffer.length === 0) {
      throw new BadRequestException({
        code: 'TARIFF_IMPORT_EMPTY_FILE',
        message: 'El archivo del Anexo Tarifario está vacío.',
      });
    }

    const sha256 = createHash('sha256').update(input.file.buffer).digest('hex');

    const existing = await this.database.db.execute<ImportResponseRow>(sql`
      select
        id,
        status,
        original_filename,
        mime_type,
        size_bytes,
        sha256,
        preview,
        preview_total,
        preview_unchanged,
        preview_changed,
        preview_anomalous,
        preview_rejected,
        preview_scale_pattern_detected,
        confirmed_at,
        completed_at
      from tariff_annex_imports
      where organization_id = ${input.scope.organizationId}
        and sha256 = ${sha256}
      limit 1
    `);

    const duplicate = existing.rows[0];

    if (duplicate) {
      return toImportResponse(duplicate);
    }

    const importId = randomUUID();
    const sourceFileId = randomUUID();

    await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into tariff_annex_imports (
          id,
          organization_id,
          created_by,
          original_filename,
          mime_type,
          size_bytes,
          sha256,
          status,
          correlation_id,
          idempotency_key
        )
        values (
          ${importId},
          ${input.scope.organizationId},
          ${input.scope.userId},
          ${input.file.originalname},
          ${input.file.mimetype},
          ${input.file.size},
          ${sha256},
          'UPLOADED',
          ${input.scope.correlationId},
          ${`tariff-upload:${input.scope.organizationId}:${sha256}`}
        )
      `);

      await tx.execute(sql`
        insert into tariff_annex_import_source_files (
          id,
          import_id,
          original_filename,
          mime_type,
          size_bytes,
          sha256,
          content
        )
        values (
          ${sourceFileId},
          ${importId},
          ${input.file.originalname},
          ${input.file.mimetype},
          ${input.file.size},
          ${sha256},
          ${input.file.buffer}
        )
      `);
    });

    return this.getImport(importId, input.scope);
  }

  async prepareImport(input: { importId: string; scope: Scope }): Promise<TariffPrepareOutcome> {
    requireMtd(input.scope);

    const result = await this.repository.prepareImport({
      importId: input.importId,
      actor: {
        userId: input.scope.userId,
        organizationId: input.scope.organizationId,
        correlationId: input.scope.correlationId,
      },
    });

    switch (result.outcome) {
      case 'prepared':
        return result;

      case 'not_found':
        throw new NotFoundException({
          code: 'TARIFF_IMPORT_NOT_FOUND',
          message: 'Tariff annex import not found',
        });

      case 'invalid_status':
        throw new ConflictException({
          code: 'TARIFF_IMPORT_INVALID_STATUS',
          message: `Import cannot be prepared from status ${result.status}`,
        });

      case 'source_not_found':
        throw new ConflictException({
          code: 'TARIFF_IMPORT_SOURCE_NOT_FOUND',
          message: 'Tariff annex source file is not available',
        });
    }
  }

  async confirmImport(input: {
    importId: string;
    overrideReason?: string;
    scope: Scope;
  }): Promise<TariffConfirmOutcome> {
    requireMtd(input.scope);

    const result = await this.repository.confirmImport({
      importId: input.importId,
      ...(input.overrideReason ? { overrideReason: input.overrideReason } : {}),
      actor: {
        userId: input.scope.userId,
        organizationId: input.scope.organizationId,
        correlationId: input.scope.correlationId,
      },
    });

    switch (result.outcome) {
      case 'completed':
        return result;

      case 'not_found':
        throw new NotFoundException({
          code: 'TARIFF_IMPORT_NOT_FOUND',
          message: 'Tariff annex import not found',
        });

      case 'invalid_status':
        throw new ConflictException({
          code: 'TARIFF_IMPORT_NOT_PREPARED',
          message: `Import cannot be confirmed from status ${result.status}`,
        });

      case 'override_required':
        throw new ConflictException({
          code: 'TARIFF_IMPORT_OVERRIDE_REQUIRED',
          message: 'Anomaly override reason of at least 10 characters is required',
        });
    }
  }

  async getImport(importId: string, scope: Scope): Promise<TariffImportResponse> {
    requireMtd(scope);

    const result = await this.database.db.execute<ImportResponseRow>(sql`
      select
        id,
        status,
        original_filename,
        mime_type,
        size_bytes,
        sha256,
        preview,
        preview_total,
        preview_unchanged,
        preview_changed,
        preview_anomalous,
        preview_rejected,
        preview_scale_pattern_detected,
        confirmed_at,
        completed_at
      from tariff_annex_imports
      where id = ${importId}
        and organization_id = ${scope.organizationId}
      limit 1
    `);

    const row = result.rows[0];

    if (!row) {
      throw new NotFoundException({
        code: 'TARIFF_IMPORT_NOT_FOUND',
        message: 'Tariff annex import not found',
      });
    }

    return toImportResponse(row);
  }
}

function requireMtd(scope: Scope): void {
  if (scope.organizationCode !== 'MTD') {
    throw new ForbiddenException({
      code: 'TARIFF_ANNEX_MTD_ONLY',
      message: 'El Anexo Tarifario solo puede administrarse desde MTD',
    });
  }
}

function timestampToIso(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  throw new TypeError('Invalid timestamp value');
}

function toImportResponse(row: ImportResponseRow): TariffImportResponse {
  return {
    id: row.id,
    status: row.status,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    preview: row.preview,
    previewTotal: Number(row.preview_total),
    previewUnchanged: Number(row.preview_unchanged),
    previewChanged: Number(row.preview_changed),
    previewAnomalous: Number(row.preview_anomalous),
    previewRejected: Number(row.preview_rejected),
    previewScalePatternDetected: row.preview_scale_pattern_detected,
    confirmedAt: timestampToIso(row.confirmed_at),
    completedAt: timestampToIso(row.completed_at),
  };
}
