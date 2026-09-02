import {
  Body,
  Controller,
  Delete,
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
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiTooManyRequestsResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import { idempotencyKeySchema } from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { NotificationsAdminService } from './notifications-admin.service';

const uuidSchema = z.string().uuid();
const listQuerySchema = z.object({
  status: z.string().min(1).max(20).optional(),
  notificationType: z.string().min(1).max(60).optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const emptyBodySchema = z.object({}).strict();

const errorSchema = {
  type: 'object',
  required: ['code', 'message', 'correlationId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    correlationId: { type: 'string' },
  },
};

const notificationResponseSchema = {
  type: 'object',
  required: [
    'id',
    'notificationType',
    'status',
    'attempts',
    'subject',
    'recipients',
    'templateVersion',
    'createdAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    notificationType: { type: 'string' },
    recipientOrganizationId: { type: 'string', format: 'uuid', nullable: true },
    itemId: { type: 'string', format: 'uuid', nullable: true },
    period: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] },
    attempts: { type: 'integer' },
    subject: { type: 'string' },
    recipients: { type: 'array', items: { type: 'string' } },
    templateVersion: { type: 'integer' },
    gmailMessageId: { type: 'string', nullable: true },
    lastError: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    sentAt: { type: 'string', format: 'date-time', nullable: true },
  },
};

@ApiTags('admin-notifications')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ schema: errorSchema })
@ApiTooManyRequestsResponse({ schema: errorSchema })
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
@UseGuards(AuthGuard)
export class NotificationsAdminController {
  constructor(
    private readonly notificationsAdmin: NotificationsAdminService,
    private readonly access: AccessService,
  ) {}

  @Get('admin/notifications')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['items', 'nextCursor'],
      properties: {
        items: { type: 'array', items: notificationResponseSchema },
        nextCursor: { type: 'string', nullable: true },
      },
    },
  })
  @ApiForbiddenResponse({ schema: errorSchema })
  async list(
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = listQuerySchema.parse(rawQuery ?? {});
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'notifications.manage',
    );
    return this.notificationsAdmin.list({
      ...(query.status ? { status: query.status } : {}),
      ...(query.notificationType ? { notificationType: query.notificationType } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Post('admin/notifications/:id/retry')
  @HttpCode(202)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['notificationId', 'status'],
      properties: {
        notificationId: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: ['QUEUED'] },
      },
    },
  })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  async retry(
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
      'notifications.manage',
    );
    return this.notificationsAdmin.retry({
      notificationId: id,
      idempotencyKey,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Get('admin/notification-recipients')
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'object' } } })
  @ApiForbiddenResponse({ schema: errorSchema })
  async listRecipients(
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = z
      .object({ notificationType: z.string().min(1).max(60).optional() })
      .parse(rawQuery ?? {});
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'notifications.manage',
    );
    return this.notificationsAdmin.listRecipients({
      ...(query.notificationType ? { notificationType: query.notificationType } : {}),
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Get('admin/notification-sender')
  @ApiOkResponse({ schema: { type: 'object' } })
  async getSender(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const organization = uuidSchema.parse(organizationId);
    await this.access.requirePermission(
      request.auth.sub,
      organization,
      'notifications.manage',
    );
    return this.notificationsAdmin.getSender();
  }

  @Post('admin/notification-sender')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email'],
      properties: { email: { type: 'string', format: 'email' } },
    },
  })
  async setSender(
    @Body() body: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'notifications.manage',
    );
    return this.notificationsAdmin.setSender({
      body,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Post('admin/notification-recipients')
  @HttpCode(201)
  @ApiBody({ schema: { type: 'object' } })
  @ApiOkResponse({ schema: { type: 'object' } })
  @ApiForbiddenResponse({ schema: errorSchema })
  async createRecipient(
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'notifications.manage',
    );
    return this.notificationsAdmin.createRecipient({
      body: rawBody,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Delete('admin/notification-recipients/:id')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['id', 'status'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: ['INACTIVE'] },
      },
    },
  })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async deactivateRecipient(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'notifications.manage',
    );
    return this.notificationsAdmin.deactivateRecipient({
      recipientId: id,
      scope: scopeFromProfile(profile, organization, request),
    });
  }
}
