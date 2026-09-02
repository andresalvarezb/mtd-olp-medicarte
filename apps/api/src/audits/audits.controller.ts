import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  approveAuditReviewRequestSchema,
  auditFindingRequestSchema,
  idempotencyKeySchema,
  rejectAuditReviewRequestSchema,
  startAuditReviewRequestSchema,
} from '@authorization/contracts';
import { z } from 'zod';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { AuditsService } from './audits.service';

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

const auditReviewResponseSchema = {
  type: 'object',
  required: [
    'id',
    'authorizationItemId',
    'reviewNumber',
    'status',
    'observations',
    'decidedBy',
    'decidedAt',
    'startedBy',
    'startedAt',
    'findings',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    authorizationItemId: { type: 'string', format: 'uuid' },
    reviewNumber: { type: 'integer' },
    status: { type: 'string', enum: ['IN_REVIEW', 'APPROVED', 'REJECTED'] },
    observations: { type: 'string', nullable: true },
    decidedBy: { type: 'string', format: 'uuid', nullable: true },
    decidedAt: { type: 'string', format: 'date-time', nullable: true },
    startedBy: { type: 'string', format: 'uuid' },
    startedAt: { type: 'string', format: 'date-time' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'code', 'description', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          code: { type: 'string' },
          description: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
};

const authorizationItemSummarySchema = {
  type: 'object',
  required: [
    'id',
    'authorizationKey',
    'auditStatus',
    'admissionStatus',
    'operationStatus',
    'version',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    authorizationKey: { type: 'string' },
    auditStatus: {
      type: 'string',
      enum: ['NOT_STARTED', 'READY', 'IN_REVIEW', 'REJECTED', 'APPROVED'],
    },
    admissionStatus: {
      type: 'string',
      enum: ['NOT_READY', 'READY'],
    },
    operationStatus: { type: 'string', nullable: true },
    version: { type: 'integer' },
  },
};

@ApiTags('audit-reviews')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ schema: errorSchema })
@ApiTooManyRequestsResponse({ schema: errorSchema })
@UseGuards(AuthGuard)
@Controller()
export class AuditsController {
  constructor(
    private readonly audits: AuditsService,
    private readonly access: AccessService,
  ) {}

  @Post('authorization-items/:id/audit-reviews')
  @HttpCode(201)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion'],
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
    },
  })
  @ApiCreatedResponse({
    description: 'Human audit review started from READY or REJECTED',
    schema: {
      type: 'object',
      required: ['review', 'item'],
      properties: { review: auditReviewResponseSchema, item: authorizationItemSummarySchema },
    },
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async startReview(
    @Param('id') rawItemId: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const itemId = uuidSchema.parse(rawItemId);
    const body = startAuditReviewRequestSchema.parse(rawBody);
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'audit.write',
    );
    const scope = scopeFromProfile(profile, organization, request);
    return this.audits.startReview({ itemId, body, idempotencyKey, scope });
  }

  @Post('audit-reviews/:id/findings')
  @HttpCode(201)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['code', 'description'],
      properties: {
        code: { type: 'string', minLength: 1, maxLength: 80 },
        description: { type: 'string', minLength: 1, maxLength: 2000 },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Finding recorded for an in-progress review',
    schema: {
      type: 'object',
      required: ['id', 'auditReviewId', 'code', 'description', 'createdAt'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        auditReviewId: { type: 'string', format: 'uuid' },
        code: { type: 'string' },
        description: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async addFinding(
    @Param('id') rawReviewId: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const reviewId = uuidSchema.parse(rawReviewId);
    const body = auditFindingRequestSchema.parse(rawBody);
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'audit.write',
    );
    const scope = scopeFromProfile(profile, organization, request);
    return this.audits.addFinding({ reviewId, body, idempotencyKey, scope });
  }

  @Post('audit-reviews/:id/reject')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion', 'observations'],
      properties: {
        expectedVersion: { type: 'integer', minimum: 1 },
        observations: { type: 'string', minLength: 1, maxLength: 2000 },
      },
    },
  })
  @ApiOkResponse({
    description: 'Human rejection with observations; item returns to REJECTED',
    schema: {
      type: 'object',
      required: ['review', 'item'],
      properties: { review: auditReviewResponseSchema, item: authorizationItemSummarySchema },
    },
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async reject(
    @Param('id') rawReviewId: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const reviewId = uuidSchema.parse(rawReviewId);
    const body = rejectAuditReviewRequestSchema.parse(rawBody);
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'audit.write',
    );
    const scope = scopeFromProfile(profile, organization, request);
    return this.audits.rejectReview({ reviewId, body, idempotencyKey, scope });
  }

  @Post('audit-reviews/:id/approve')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion'],
      properties: {
        expectedVersion: { type: 'integer', minimum: 1 },
        observations: { type: 'string', maxLength: 2000 },
      },
    },
  })
  @ApiOkResponse({
    description: 'Human approval; item becomes APPROVED, DISPENSED and admission READY',
    schema: {
      type: 'object',
      required: ['review', 'item'],
      properties: { review: auditReviewResponseSchema, item: authorizationItemSummarySchema },
    },
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async approve(
    @Param('id') rawReviewId: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const reviewId = uuidSchema.parse(rawReviewId);
    const body = approveAuditReviewRequestSchema.parse(rawBody);
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'audit.write',
    );
    const scope = scopeFromProfile(profile, organization, request);
    return this.audits.approveReview({ reviewId, body, idempotencyKey, scope });
  }

  @Get('audit-reviews/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiOkResponse({
    description: 'Audit review detail with findings',
    schema: auditReviewResponseSchema,
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async getReview(
    @Param('id') rawReviewId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const reviewId = uuidSchema.parse(rawReviewId);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'audit.read',
    );
    const scope = scopeFromProfile(profile, organization, request);
    if (scope.organizationCode !== 'MTD') {
      throw new ForbiddenException({
        code: 'AUDIT_REVIEW_NOT_VISIBLE',
        message: 'El historial de revisiones solo está disponible para MTD.',
      });
    }
    return this.audits.getReview(reviewId);
  }
}
