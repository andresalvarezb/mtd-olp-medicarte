import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Get,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiNotFoundResponse,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { idempotencyKeySchema } from '@authorization/contracts';
import { z } from 'zod';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { ImportsService } from './imports.service';

type UploadedImportFile = Readonly<{
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}>;

const uuidSchema = z.string().uuid();
const emptyBodySchema = z.object({}).strict();
const rowsQuerySchema = z.object({
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const errorSchema = {
  type: 'object',
  required: ['code', 'message', 'correlationId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    correlationId: { type: 'string' },
    fields: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
  },
};

const batchStatusEnum = [
  'UPLOADED',
  'VALIDATING',
  'READY_TO_CONFIRM',
  'CONFIRMING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

const importBatchResponseSchema = {
  type: 'object',
  required: [
    'id',
    'status',
    'originalFilename',
    'mimeType',
    'sizeBytes',
    'sha256',
    'totalRows',
    'validRows',
    'rejectedRows',
    'duplicateRows',
    'existingRows',
    'confirmedRows',
    'lastErrorCode',
    'createdAt',
    'completedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: batchStatusEnum },
    originalFilename: { type: 'string' },
    mimeType: { type: 'string' },
    sizeBytes: { type: 'integer' },
    sha256: { type: 'string' },
    totalRows: { type: 'integer' },
    validRows: { type: 'integer' },
    rejectedRows: { type: 'integer' },
    duplicateRows: { type: 'integer' },
    existingRows: { type: 'integer' },
    confirmedRows: { type: 'integer' },
    lastErrorCode: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    completedAt: { type: 'string', format: 'date-time', nullable: true },
  },
};

const paginatedRowsResponseSchema = {
  type: 'object',
  required: ['items', 'nextCursor'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'id',
          'rowNumber',
          'resultCode',
          'resultMessage',
          'confirmable',
          'authorizationItemId',
          'authorizationKey',
          'normalized',
          'validationErrors',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          rowNumber: { type: 'integer' },
          resultCode: { type: 'string' },
          resultMessage: { type: 'string' },
          confirmable: { type: 'boolean' },
          authorizationItemId: { type: 'string', format: 'uuid', nullable: true },
          authorizationKey: { type: 'string', nullable: true },
          normalized: { type: 'object', nullable: true },
          validationErrors: { type: 'array', items: { type: 'object' } },
        },
      },
    },
    nextCursor: { type: 'string', nullable: true },
  },
};

const confirmResponseSchema = {
  type: 'object',
  required: ['batchId', 'status', 'createdRows', 'existingRows', 'confirmedAt'],
  properties: {
    batchId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['COMPLETED'] },
    createdRows: { type: 'integer' },
    existingRows: { type: 'integer' },
    confirmedAt: { type: 'string', format: 'date-time' },
  },
};

@ApiTags('imports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ schema: errorSchema })
@ApiTooManyRequestsResponse({ schema: errorSchema })
@Controller('imports')
@UseGuards(AuthGuard)
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
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
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiAcceptedResponse({
    description: 'Import batch accepted for asynchronous processing',
    schema: importBatchResponseSchema,
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiPayloadTooLargeResponse({ schema: errorSchema })
  async create(
    @UploadedFile() file: UploadedImportFile | undefined,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!file)
      throw new BadRequestException({
        code: 'IMPORT_FILE_REQUIRED',
        message: 'An import file is required',
      });
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'imports.create',
    );
    return this.imports.create({
      file,
      idempotencyKey,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiOkResponse({
    description: 'Import batch progress and totals',
    schema: importBatchResponseSchema,
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async get(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'authorizations.read',
    );
    return this.imports.getBatch(id, scopeFromProfile(profile, organization, request));
  }

  @Get(':id/rows')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiOkResponse({
    description: 'Paginated import row report',
    schema: paginatedRowsResponseSchema,
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async rows(
    @Param('id') rawId: string,
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    const query = rowsQuerySchema.parse(rawQuery);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'authorizations.read',
    );
    return this.imports.getRows({
      batchId: id,
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  @ApiOkResponse({
    description: 'Import rows confirmed transactionally',
    schema: confirmResponseSchema,
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  @ApiServiceUnavailableResponse({ schema: errorSchema })
  async confirm(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    emptyBodySchema.parse(rawBody);
    const id = uuidSchema.parse(rawId);
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'imports.confirm',
    );
    return this.imports.confirm({
      batchId: id,
      idempotencyKey,
      scope: scopeFromProfile(profile, organization, request),
    });
  }
}
