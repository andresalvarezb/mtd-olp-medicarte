import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';

import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { authorizationBillingAuditDecisionRequestSchema } from '@authorization/contracts';

import { z } from 'zod';

import { AuthGuard } from '../common/auth.guard';

import { scopeFromProfile } from '../common/request-scope';

import { AccessService } from '../identity/access.service';

import type { AuthenticatedRequest } from '../types';

import { AuthorizationBillingAuditService } from './authorization-billing-audit.service';

@ApiTags('authorization-billing-audits')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard)
export class AuthorizationBillingAuditController {
  constructor(
    private readonly audits: AuthorizationBillingAuditService,

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

    return scopeFromProfile(profile, organizationId, request);
  }

  @Get('authorization-billing-audits/authorization/:authorizationItemId')
  async detail(
    @Param('authorizationItemId')
    rawAuthorizationItemId: string,

    @Headers('x-organization-id')
    organizationId: string | undefined,

    @Req()
    request: AuthenticatedRequest,
  ) {
    return this.audits.detail(
      z.string().uuid().parse(rawAuthorizationItemId),

      await this.scope(organizationId, request, 'application_audits.read'),
    );
  }

  @Post('authorization-billing-audits/authorization/:authorizationItemId/start')
  async start(
    @Param('authorizationItemId')
    rawAuthorizationItemId: string,

    @Headers('x-organization-id')
    organizationId: string | undefined,

    @Req()
    request: AuthenticatedRequest,
  ) {
    return this.audits.start(
      z.string().uuid().parse(rawAuthorizationItemId),

      await this.scope(organizationId, request, 'application_audits.manage'),
    );
  }

  @Post('authorization-billing-audits/:auditId/evidence/drive/search')
  async searchDriveEvidence(
    @Param('auditId')
    rawAuditId: string,

    @Headers('x-organization-id')
    organizationId: string | undefined,

    @Req()
    request: AuthenticatedRequest,
  ) {
    return this.audits.searchDriveEvidence(
      z.string().uuid().parse(rawAuditId),

      await this.scope(organizationId, request, 'application_audits.manage'),
    );
  }

  @Post('authorization-billing-audits/:auditId/decision')
  async decide(
    @Param('auditId')
    rawAuditId: string,

    @Body()
    rawBody: unknown,

    @Headers('x-organization-id')
    organizationId: string | undefined,

    @Req()
    request: AuthenticatedRequest,
  ) {
    const body = authorizationBillingAuditDecisionRequestSchema.parse(rawBody);

    return this.audits.decide(
      z.string().uuid().parse(rawAuditId),

      body,

      await this.scope(organizationId, request, 'application_audits.manage'),
    );
  }
}
