import { Controller, Get, Headers, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { analyticsDrilldownQuerySchema, analyticsQuerySchema } from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly access: AccessService,
  ) {}

  @Get('operational')
  async operational(
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = analyticsQuerySchema.parse(raw ?? {});
    const profile = await this.require(organizationId, request, 'analytics.read');
    const includeEconomics = Boolean(
      profile.organizations
        .find((organization) => organization.id === z.string().uuid().parse(organizationId))
        ?.permissions.includes('analytics.economics.read'),
    );
    return this.analytics.operational(
      query,
      scopeFromProfile(profile, z.string().uuid().parse(organizationId), request),
      includeEconomics,
    );
  }

  @Get('novelties')
  async novelties(
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.analytics.novelties(
      analyticsQuerySchema.parse(raw ?? {}),
      await this.scope(organizationId, request, 'analytics.read'),
    );
  }

  @Get('inventory')
  async inventory(
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.analytics.inventory(
      analyticsQuerySchema.parse(raw ?? {}),
      await this.scope(organizationId, request, 'analytics.read'),
    );
  }

  @Get('economics')
  async economics(
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.analytics.economics(
      analyticsQuerySchema.parse(raw ?? {}),
      await this.scope(organizationId, request, 'analytics.economics.read'),
    );
  }

  @Get('drilldown')
  async drilldown(
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.scope(organizationId, request, 'analytics.read');
    return this.analytics.drilldown(analyticsDrilldownQuerySchema.parse(raw ?? {}));
  }

  private async require(
    organizationId: string | undefined,
    request: AuthenticatedRequest,
    permission: 'analytics.read' | 'analytics.economics.read',
  ) {
    return this.access.requirePermission(
      request.auth.sub,
      z.string().uuid().parse(organizationId),
      permission,
    );
  }

  private async scope(
    organizationId: string | undefined,
    request: AuthenticatedRequest,
    permission: 'analytics.read' | 'analytics.economics.read',
  ) {
    const id = z.string().uuid().parse(organizationId);
    const profile = await this.require(id, request, permission);
    return scopeFromProfile(profile, id, request);
  }
}
