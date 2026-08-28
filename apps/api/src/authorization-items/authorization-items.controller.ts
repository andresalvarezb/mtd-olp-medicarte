import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  authorizationItemListQuerySchema,
  idempotencyKeySchema,
  sourceUpdateRequestSchema,
} from '@authorization/contracts';
import { z } from 'zod';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { AuthorizationItemsService } from './authorization-items.service';

const uuidSchema = z.string().uuid();
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

const authorizationItemResponseSchema = {
  type: 'object',
  required: ['id', 'numeroAutorizacion', 'codigoMedicamento', 'authorizationKey', 'enablementStatus', 'coverageType', 'directionStatus', 'operationStatus', 'sourceData', 'sourceCupsPrincipalNormalized', 'coverageRuleVersion', 'version', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    numeroAutorizacion: { type: 'string' },
    codigoMedicamento: { type: 'string' },
    authorizationKey: { type: 'string' },
    enablementStatus: { type: 'string' },
    coverageType: { type: 'string' },
    directionStatus: { type: 'string' },
    operationStatus: { type: 'string', nullable: true },
    sourceData: { type: 'object', additionalProperties: true, nullable: true },
    sourceCupsPrincipalNormalized: { type: 'string' },
    coverageRuleVersion: { type: 'string' },
    version: { type: 'integer' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const paginatedItemsResponseSchema = {
  type: 'object',
  required: ['items', 'nextCursor'],
  properties: {
    items: { type: 'array', items: authorizationItemResponseSchema },
    nextCursor: { type: 'string', nullable: true },
  },
};

const itemDetailResponseSchema = {
  type: 'object',
  required: ['item', 'importHistory'],
  properties: {
    item: authorizationItemResponseSchema,
    importHistory: { type: 'array', items: { type: 'object' } },
  },
};

const sourceUpdateResponseSchema = {
  type: 'object',
  required: ['item', 'rowId', 'resultCode'],
  properties: {
    item: authorizationItemResponseSchema,
    rowId: { type: 'string', format: 'uuid' },
    resultCode: { type: 'string', enum: ['ITEM_UPDATED'] },
  },
};

@ApiTags('authorization-items')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ schema: errorSchema })
@ApiTooManyRequestsResponse({ schema: errorSchema })
@Controller('authorization-items')
@UseGuards(AuthGuard)
export class AuthorizationItemsController {
  constructor(
    private readonly authorizationItems: AuthorizationItemsService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiOkResponse({ description: 'Scoped authorization item inbox', schema: paginatedItemsResponseSchema })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  async list(
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = authorizationItemListQuerySchema.parse(rawQuery);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(request.auth.sub, organization, 'authorizations.read');
    return this.authorizationItems.list({ query, scope: scopeFromProfile(profile, organization, request) });
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiOkResponse({ description: 'Authorization item detail and import history', schema: itemDetailResponseSchema })
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
    const profile = await this.access.requirePermission(request.auth.sub, organization, 'authorizations.read');
    return this.authorizationItems.get(id, scopeFromProfile(profile, organization, request));
  }

  @Post(':id/source-updates')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiBody({ schema: { type: 'object', required: ['importRowId', 'expectedVersion'], properties: { importRowId: { type: 'string', format: 'uuid' }, expectedVersion: { type: 'integer', minimum: 1 } } } })
  @ApiOkResponse({ description: 'Explicit source update completed', schema: sourceUpdateResponseSchema })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async updateSource(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    const body = sourceUpdateRequestSchema.parse(rawBody);
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(request.auth.sub, organization, 'imports.confirm');
    const scope = scopeFromProfile(profile, organization, request);
    return this.authorizationItems.updateFromImport({ itemId: id, ...body, idempotencyKey, scope });
  }
}
