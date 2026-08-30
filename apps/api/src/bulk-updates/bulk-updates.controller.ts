import {
  BadRequestException,
  Body as NestBody,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Header,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiQuery,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import { idempotencyKeySchema, bulkUpdateOperationTypeSchema } from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { BulkUpdatesService } from './bulk-updates.service';

const uuidSchema = z.string().uuid();
const rowsQuerySchema = z.object({
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const reportQuerySchema = z.object({ format: z.literal('csv').default('csv') });

type UploadedBulkFile = Readonly<{
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}>;

const errorSchema = {
  type: 'object',
  required: ['code', 'message', 'correlationId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    correlationId: { type: 'string' },
  },
};

const bulkBatchResponseSchema = {
  type: 'object',
  required: [
    'id',
    'operationType',
    'status',
    'originalFilename',
    'mimeType',
    'sizeBytes',
    'sha256',
    'contractVersion',
    'totalRows',
    'processedRows',
    'updatedRows',
    'unchangedRows',
    'rejectedRows',
    'lastErrorCode',
    'createdAt',
    'completedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    operationType: { type: 'string' },
    status: { type: 'string', enum: ['UPLOADED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'] },
    originalFilename: { type: 'string' },
    mimeType: { type: 'string' },
    sizeBytes: { type: 'integer' },
    sha256: { type: 'string' },
    contractVersion: { type: 'integer' },
    totalRows: { type: 'integer' },
    processedRows: { type: 'integer' },
    updatedRows: { type: 'integer' },
    unchangedRows: { type: 'integer' },
    rejectedRows: { type: 'integer' },
    lastErrorCode: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    completedAt: { type: 'string', format: 'date-time', nullable: true },
  },
};

const bulkRowsResponseSchema = {
  type: 'object',
  required: ['items', 'nextCursor'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'rowNumber', 'resultCode', 'resultMessage', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          rowNumber: { type: 'integer' },
          resultCode: { type: 'string' },
          resultMessage: { type: 'string' },
          authorizationItemId: { type: 'string', format: 'uuid', nullable: true },
          authorizationKey: { type: 'string', nullable: true },
          fieldName: { type: 'string', nullable: true },
          previousValue: { type: 'string', nullable: true },
          newValue: { type: 'string', nullable: true },
          fieldVersion: { type: 'integer', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    nextCursor: { type: 'string', nullable: true },
  },
};

@ApiTags('bulk-updates')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ schema: errorSchema })
@ApiTooManyRequestsResponse({ schema: errorSchema })
@Controller('bulk-updates')
@UseGuards(AuthGuard)
export class BulkUpdatesController {
  constructor(
    private readonly bulkUpdates: BulkUpdatesService,
    private readonly access: AccessService,
  ) {}

  @Post()
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['operationType', 'file'],
      properties: {
        operationType: { type: 'string', enum: ['ASSIGN_DISPENSATION_LOCATION'] },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiPayloadTooLargeResponse({ schema: errorSchema })
  async create(
    @NestBody('operationType') rawOperationType: string | undefined,
    @UploadedFile() file: UploadedBulkFile | undefined,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!file)
      throw new BadRequestException({
        code: 'BULK_FILE_REQUIRED',
        message: 'Un archivo de actualización masiva es obligatorio.',
      });
    const operationType = bulkUpdateOperationTypeSchema.parse(rawOperationType);
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      operationType === 'ASSIGN_DISPENSATION_LOCATION'
        ? 'bulk_updates.dispensation_location'
        : 'dispensing.register',
    );
    return this.bulkUpdates.create({
      operationType,
      file,
      idempotencyKey,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Get(':batchId')
  @SkipThrottle()
  @ApiParam({ name: 'batchId', format: 'uuid' })
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiOkResponse({ schema: bulkBatchResponseSchema })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async get(
    @Param('batchId') rawBatchId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const batchId = uuidSchema.parse(rawBatchId);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'bulk_updates.read',
    );
    return this.bulkUpdates.getBatch(batchId, scopeFromProfile(profile, organization, request));
  }

  @Get(':batchId/rows')
  @SkipThrottle()
  @ApiParam({ name: 'batchId', format: 'uuid' })
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiOkResponse({ schema: bulkRowsResponseSchema })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async rows(
    @Param('batchId') rawBatchId: string,
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const batchId = uuidSchema.parse(rawBatchId);
    const query = rowsQuerySchema.parse(rawQuery);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'bulk_updates.read',
    );
    return this.bulkUpdates.getRows({
      batchId,
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Get(':batchId/report')
  @ApiParam({ name: 'batchId', format: 'uuid' })
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiQuery({ name: 'format', enum: ['csv'], required: false })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOkResponse({ schema: { type: 'string' } })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async report(
    @Param('batchId') rawBatchId: string,
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    reportQuerySchema.parse(rawQuery);
    const batchId = uuidSchema.parse(rawBatchId);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'bulk_updates.read',
    );
    const report = await this.bulkUpdates.getReport({
      batchId,
      scope: scopeFromProfile(profile, organization, request),
    });
    return report.content;
  }
}
