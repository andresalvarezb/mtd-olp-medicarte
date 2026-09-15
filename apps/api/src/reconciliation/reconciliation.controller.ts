import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createReconciliationRunRequestSchema,
  reconciliationFindingListQuerySchema,
} from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { ReconciliationService } from './reconciliation.service';

@ApiTags('reconciliation')
@ApiBearerAuth()
@Controller('reconciliation')
@UseGuards(AuthGuard)
export class ReconciliationController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly access: AccessService,
  ) {}

  private async mtdScope(
    raw: string | undefined,
    request: AuthenticatedRequest,
    permission: 'reconciliation.read' | 'reconciliation.run',
  ) {
    const organizationId = z.string().uuid().parse(raw);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      permission,
    );
    const scope = scopeFromProfile(profile, organizationId, request);
    if (scope.organizationCode !== 'MTD') {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'Operational reconciliation is MTD-only',
      });
    }
    return scope;
  }

  @Post('runs')
  async start(
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation.run');
    return this.reconciliation.start(
      scope.organizationId,
      scope.userId,
      createReconciliationRunRequestSchema.parse(rawBody ?? {}),
    );
  }

  @Get('runs')
  async list(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation.read');
    return this.reconciliation.list(scope.organizationId);
  }

  @Get('runs/:id')
  async detail(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation.read');
    return this.reconciliation.get(scope.organizationId, z.string().uuid().parse(rawId));
  }

  @Get('runs/:id/findings')
  async findings(
    @Param('id') rawId: string,
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation.read');
    return this.reconciliation.findings(
      scope.organizationId,
      z.string().uuid().parse(rawId),
      reconciliationFindingListQuerySchema.parse(raw ?? {}),
    );
  }

  @Get('rules')
  async rules(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.mtdScope(organizationId, request, 'reconciliation.read');
    return { items: this.reconciliation.listRules() };
  }
}
