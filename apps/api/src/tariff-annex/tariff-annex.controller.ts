import {
  BadRequestException,
  Body as NestBody,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  createTariffProductRequestSchema,
  idempotencyKeySchema,
  tariffImportListQuerySchema,
  tariffProductListQuerySchema,
  updateTariffProductRequestSchema,
} from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { TariffAnnexService } from './tariff-annex.service';

const uuidSchema = z.string().uuid();
const rowsQuerySchema = z.object({
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const exportQuerySchema = z.object({ format: z.literal('xlsx').default('xlsx') });

type UploadedTariffFile = Readonly<{
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

const productSchema = {
  type: 'object',
  required: [
    'id',
    'codigoProducto',
    'active',
    'version',
    'createdBy',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    codigoProducto: { type: 'string' },
    active: { type: 'boolean' },
    version: { type: 'integer' },
    createdBy: { type: 'string', format: 'uuid' },
    tarifaUnidad: { type: 'string', nullable: true },
    numeroExpedienteInvima: { type: 'string', nullable: true },
    consecutivoInvimaPresentacion: { type: 'string', nullable: true },
    descripcionGenerica: { type: 'string', nullable: true },
    descripcionComercial: { type: 'string', nullable: true },
    laboratorio: { type: 'string', nullable: true },
    tipoInclusion: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const productResultSchema = {
  type: 'object',
  required: ['product', 'resultCode'],
  properties: {
    product: productSchema,
    resultCode: {
      type: 'string',
      enum: ['PRODUCT_CREATED', 'PRODUCT_EXISTING', 'PRODUCT_REACTIVATED'],
    },
  },
};

const paginatedProductsSchema = {
  type: 'object',
  required: ['items', 'nextCursor'],
  properties: {
    items: { type: 'array', items: productSchema },
    nextCursor: { type: 'string', nullable: true },
  },
};

const importBatchSchema = {
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
    status: { type: 'string', enum: ['UPLOADED', 'VALIDATING', 'COMPLETED', 'FAILED'] },
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

const importRowsSchema = {
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
          codigoProducto: { type: 'string', nullable: true },
          resultCode: {
            type: 'string',
            enum: [
              'PRODUCT_CREATED',
              'PRODUCT_REACTIVATED',
              'PRODUCT_EXISTING',
              'INVALID_PRODUCT_CODE',
              'DUPLICATE_IN_FILE',
              'INVALID_FILE_FORMAT',
              'PROCESSING_ERROR',
            ],
          },
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
  @ApiOkResponse({ schema: paginatedProductsSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  async listProducts(
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = tariffProductListQuerySchema.parse(rawQuery ?? {});
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
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['codigoProducto'],
      properties: {
        codigoProducto: { type: 'string', minLength: 1, maxLength: 255 },
        tarifaUnidad: { type: 'string' },
        numeroExpedienteInvima: { type: 'string' },
        consecutivoInvimaPresentacion: { type: 'string' },
        descripcionGenerica: { type: 'string' },
        descripcionComercial: { type: 'string' },
        laboratorio: { type: 'string' },
        tipoInclusion: { type: 'string' },
      },
    },
  })
  @ApiCreatedResponse({ schema: productResultSchema })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  async createProduct(
    @NestBody() body: unknown,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = createTariffProductRequestSchema.parse(body);
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.create',
    );
    return this.tariffAnnex.create({
      body: parsed,
      idempotencyKey,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Get('products/:productId')
  @SkipThrottle()
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOkResponse({ schema: productSchema })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async getProduct(
    @Param('productId') productId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.read',
    );
    return this.tariffAnnex.get({
      productId,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Patch('products/:productId')
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['active'],
      properties: { active: { type: 'boolean' } },
    },
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['product', 'changed'],
      properties: { product: productSchema, changed: { type: 'boolean' } },
    },
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async updateProduct(
    @Param('productId') productId: string,
    @NestBody() body: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = updateTariffProductRequestSchema.parse(body);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.update',
    );
    return this.tariffAnnex.update({
      productId,
      body: parsed,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Delete('products/:productId')
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['product', 'changed'],
      properties: { product: productSchema, changed: { type: 'boolean' } },
    },
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async deleteProduct(
    @Param('productId') productId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.delete',
    );
    return this.tariffAnnex.deactivate({
      productId,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Get('imports')
  @SkipThrottle()
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['items', 'nextCursor'],
      properties: {
        items: { type: 'array', items: importBatchSchema },
        nextCursor: { type: 'string', nullable: true },
      },
    },
  })
  @ApiForbiddenResponse({ schema: errorSchema })
  async listImports(
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = tariffImportListQuerySchema.parse(rawQuery ?? {});
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.read',
    );
    return this.tariffAnnex.listImports({
      query,
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
  @ApiAcceptedResponse({ schema: importBatchSchema })
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
        message: 'Un archivo de Anexo Tarifario es obligatorio.',
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

  @Get('imports/:batchId')
  @SkipThrottle()
  @ApiParam({ name: 'batchId', format: 'uuid' })
  @ApiOkResponse({ schema: importBatchSchema })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async getImport(
    @Param('batchId') batchId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.read',
    );
    return this.tariffAnnex.getImport(batchId, scopeFromProfile(profile, organization, request));
  }

  @Get('imports/:batchId/rows')
  @SkipThrottle()
  @ApiParam({ name: 'batchId', format: 'uuid' })
  @ApiOkResponse({ schema: importRowsSchema })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async getImportRows(
    @Param('batchId') batchId: string,
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = rowsQuerySchema.parse(rawQuery ?? {});
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.read',
    );
    return this.tariffAnnex.getImportRows({
      batchId,
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Get('eps-novedades')
  @Header('Cache-Control', 'no-store')
  @ApiQuery({ name: 'format', enum: ['xlsx'], required: false })
  @ApiOkResponse({
    description: 'On-demand EPS novedades export; not persisted',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiForbiddenResponse({ schema: errorSchema })
  async epsNovedades(
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    const query = exportQuerySchema.parse(rawQuery ?? {});
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'operational_exports.create',
    );
    const result = await this.tariffAnnex.epsNovedadesExport({
      format: query.format,
      scope: scopeFromProfile(profile, organization, request),
    });
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    response.setHeader('Content-Length', String(result.content.length));
    response.end(result.content);
  }
}
