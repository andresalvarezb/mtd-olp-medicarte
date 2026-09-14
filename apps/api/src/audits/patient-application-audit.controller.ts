import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  applicationAuditListQuerySchema,
  approveApplicationAuditRequestSchema,
  rejectApplicationAuditRequestSchema,
} from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { PatientApplicationAuditService } from './patient-application-audit.service';

@ApiTags('application-audits')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard)
export class PatientApplicationAuditController {
  constructor(
    private readonly audits: PatientApplicationAuditService,
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

  @Get('application-audits')
  async list(
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      items: await this.audits.list(
        applicationAuditListQuerySchema.parse(raw ?? {}),
        await this.scope(organizationId, request, 'application_audits.read'),
      ),
    };
  }

  @Get('application-audits/:id')
  async detail(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.audits.detail(
      z.string().uuid().parse(rawId),
      await this.scope(organizationId, request, 'application_audits.read'),
    );
  }

  @Post('applications/:applicationId/audit/start')
  async start(
    @Param('applicationId') rawApplicationId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.audits.start(
      z.string().uuid().parse(rawApplicationId),
      await this.scope(organizationId, request, 'application_audits.manage'),
    );
  }

  @Post('application-audits/:id/approve')
  async approve(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.audits.approve(
      z.string().uuid().parse(rawId),
      approveApplicationAuditRequestSchema.parse(rawBody),
      await this.scope(organizationId, request, 'application_audits.manage'),
    );
  }

  @Post('application-audits/:id/reject')
  async reject(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.audits.reject(
      z.string().uuid().parse(rawId),
      rejectApplicationAuditRequestSchema.parse(rawBody),
      await this.scope(organizationId, request, 'application_audits.manage'),
    );
  }
}
