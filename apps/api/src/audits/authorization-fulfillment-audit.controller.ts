import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiTags,
} from '@nestjs/swagger';

import {
  z,
} from 'zod';

import {
  approveFulfillmentAuditRequestSchema,
  fulfillmentAuditListQuerySchema,
  rejectFulfillmentAuditRequestSchema,
} from '@authorization/contracts';

import {
  AuthGuard,
} from '../common/auth.guard';

import {
  scopeFromProfile,
} from '../common/request-scope';

import {
  AccessService,
} from '../identity/access.service';

import type {
  AuthenticatedRequest,
} from '../types';

import {
  AuthorizationFulfillmentAuditService,
} from './authorization-fulfillment-audit.service';

@ApiTags('fulfillment-audits')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard)
export class AuthorizationFulfillmentAuditController {
  constructor(
    private readonly audits: AuthorizationFulfillmentAuditService,
    private readonly access: AccessService,
  ) {}

  private async scope(
    raw: string | undefined,
    request: AuthenticatedRequest,
    permission: 'application_audits.read' | 'application_audits.manage',
  ) {
    const organizationId = z.string().uuid().parse(raw);

    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      permission,
    );

    return scopeFromProfile(
      profile,
      organizationId,
      request,
    );
  }

  @Get('fulfillment-audits')
  async list(
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      items: await this.audits.list(
        fulfillmentAuditListQuerySchema.parse(raw ?? {}),
        await this.scope(
          organizationId,
          request,
          'application_audits.read',
        ),
      ),
    };
  }

  @Get('fulfillment-audits/:id')
  async detail(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.audits.detail(
      z.string().uuid().parse(rawId),
      await this.scope(
        organizationId,
        request,
        'application_audits.read',
      ),
    );
  }

  @Post('fulfillments/:fulfillmentId/audit/start')
  async start(
    @Param('fulfillmentId') rawFulfillmentId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.audits.start(
      z.string().uuid().parse(rawFulfillmentId),
      await this.scope(
        organizationId,
        request,
        'application_audits.manage',
      ),
    );
  }

  @Post('fulfillment-audits/:id/approve')
  async approve(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    approveFulfillmentAuditRequestSchema.parse(rawBody ?? {});

    return this.audits.approve(
      z.string().uuid().parse(rawId),
      await this.scope(
        organizationId,
        request,
        'application_audits.manage',
      ),
    );
  }

  @Post('fulfillment-audits/:id/reject')
  async reject(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const body =
      rejectFulfillmentAuditRequestSchema.parse(rawBody);

    return this.audits.reject(
      z.string().uuid().parse(rawId),
      body.observation,
      await this.scope(
        organizationId,
        request,
        'application_audits.manage',
      ),
    );
  }
}
