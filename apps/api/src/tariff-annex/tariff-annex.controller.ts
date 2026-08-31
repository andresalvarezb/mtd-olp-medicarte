import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Patch,
  Delete,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  createTariffProductRequestSchema,
  idempotencyKeySchema,
  tariffProductListQuerySchema,
  updateTariffProductRequestSchema,
} from '@authorization/contracts';
import { z } from 'zod';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { TariffAnnexService } from './tariff-annex.service';

type UploadedTariffFile = Readonly<{
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}>;

const uuidSchema = z.string().uuid();
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

const tariffProductResponseSchema = {
  type: 'object',
  required: ['id', 'codigoProducto', 'active', 'version', 'createdBy', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    codigoProducto: { type: 'string' },
    active: { type: 'boolean' },
    version: { type: 'integer' },
    createdBy: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const createTariffProductResponseSchema = {
  type: 'object',
  required: ['product', 'resultCode'],
  properties: {
    product: tariffProductResponseSchema,
    resultCode: {
      type: 'string',
      enum: ['PRODUCT_CREATED', 'PRODUCT_EXISTING', 'PRODUCT_REACTIVATED'],
    },
  },
};

const updateTariffProductResponseSchema = {
  type: 'object',
  required: ['product', 'changed'],
  properties: {
    product: tariffProductResponseSchema,
    changed: { type: 'boolean' },
  },
};

const paginatedProductsResponseSchema = {
  type: 'object',
  required: ['items', 'nextCursor'],
  properties: {
    items: { type: 'array', items: tariffProductResponseSchema },
    nextCursor: { type: 'string', nullable: true },
  },
};

const tariffImportBatchResponseSchema = {
  type: 'object',
  required: [
    'id',
    'status',
    'originalFilename',
    'mimeType',
    'sizeBytes',
    'sha256',
    'totalRows',
    'createdRows',
    'reactivatedRows',
    'existingRows',
    'rejectedRows',
    'duplicateRows',
    'lastErrorCode',
    'createdAt',
    'completedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
     status: { type: 'string', enum: ['CARGADO', 'VALIDANDO', 'COMPLETADO', 'FALLIDO'] },
    originalFilename: { type: 'string' },
    mimeType: { type: 'string' },
    sizeBytes: { type: 'integer' },
    sha256: { type: 'string' },
    totalRows: { type: 'integer' },
    createdRows: { type: 'integer' },
    reactivatedRows: { type: 'integer' },
    existingRows: { type: 'integer' },
    rejectedRows: { type: 'integer' },
    duplicateRows: { type: 'integer' },
    lastErrorCode: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    completedAt: { type: 'string', format: 'date-time', nullable: true },
  },
};

const paginatedImportRowsResponseSchema = {
  type: 'object',
  required: ['items', 'nextCursor'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'rowNumber', 'codigoProducto', 'resultCode', 'resultMessage', 'productId', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          rowNumber: { type: 'integer' },
          codigoProducto: { type: 'string', nullable: true },
          resultCode: { type: 'string' },
          resultMessage: { type: 'string' },
          productId: { type: 'string', format: 'uuid', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    nextCursor: { type: 'string', nullable: true },
  },
};

@ApiTags('tariff-annex')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ schema: errorSchema })
@ApiTooManyRequestsResponse({ schema: errorSchema })
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('admin/tariff-annex')
@UseGuards(AuthGuard)
export class TariffAnnexController {
  constructor(
    private readonly tariffAnnex: TariffAnnexService,
    private readonly access: AccessService,
  ) {}

  @Get('products')
  @SkipThrottle()
  @ApiOkResponse({
    description: 'Paginated tariff annex products (MTD only)',
    schema: paginatedProductsResponseSchema,
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  async list(
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = tariffProductListQuerySchema.parse(rawQuery);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.read',
    );
    return this.tariffAnnex.list({
      query,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Post('products')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['codigoProducto'],
      properties: { codigoProducto: { type: 'string', minLength: 1, maxLength: 255 } },
    },
  })
  @ApiOkResponse({
    description:
      'Creates or reactivates a tariff product; activating emits the revalidation event',
    schema: createTariffProductResponseSchema,
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  async create(
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = createTariffProductRequestSchema.parse(rawBody);
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.create',
    );
    return this.tariffAnnex.create({
      body,
      idempotencyKey,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Patch('products/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['active'],
      properties: { active: { type: 'boolean' } },
    },
  })
  @ApiOkResponse({
    description: 'Activates or deactivates the product (soft delete)',
    schema: updateTariffProductResponseSchema,
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async update(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    const body = updateTariffProductRequestSchema.parse(rawBody);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.update',
    );
    return this.tariffAnnex.update({
      productId: id,
      body,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Delete('products/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Deactivates the product preserving history (logical delete)',
    schema: updateTariffProductResponseSchema,
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async deactivate(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.delete',
    );
    return this.tariffAnnex.deactivate({
      productId: id,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Post('imports')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({
    description: 'Tariff annex import accepted for asynchronous processing',
    schema: tariffImportBatchResponseSchema,
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiPayloadTooLargeResponse({ schema: errorSchema })
  async createImport(
    @UploadedFile() file: UploadedTariffFile | undefined,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'TARIFF_IMPORT_FILE_REQUIRED',
        message: 'El archivo del Anexo Tarifario es obligatorio',
      });
    }
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.import',
    );
    return this.tariffAnnex.createImport({
      file,
      idempotencyKey,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Get('imports/:id')
  @SkipThrottle()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Tariff annex import progress and totals',
    schema: tariffImportBatchResponseSchema,
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async getImport(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.read',
    );
    return this.tariffAnnex.getImport(id, scopeFromProfile(profile, organization, request));
  }

  @Get('imports/:id/rows')
  @SkipThrottle()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Paginated per-row import result with stable codes',
    schema: paginatedImportRowsResponseSchema,
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async getImportRows(
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
      'tariff_annex.read',
    );
    return this.tariffAnnex.getImportRows({
      batchId: id,
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      scope: scopeFromProfile(profile, organization, request),
    });
  }
}
