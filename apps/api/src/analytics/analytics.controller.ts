import { Controller, Get, Headers, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { analyticsDrilldownQuerySchema, analyticsQuerySchema } from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { AnalyticsService } from './analytics.service';
import { buildAnalyticsExportWorkbook } from './analytics-export';
import { OperationalAccessScopeService } from '../access-scopes/operational-access-scope.service';
import { throwIfPointAccessDenied } from '../common/point-access';
import type { Scope } from '../common/request-scope';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly access: AccessService,
    private readonly pointAccess: OperationalAccessScopeService,
  ) {}


  @Get('dashboard')
  async dashboard(
    @Headers('x-organization-id')
    organizationId: string | undefined,

    @Req()
    request: AuthenticatedRequest,
  ) {
    const id =
      z.string().uuid().parse(
        organizationId,
      );

    const profile =
      await this.require(
        id,
        request,
        'analytics.read',
      );

    const scope =
      scopeFromProfile(
        profile,
        id,
        request,
      );

    const includeEconomics =
      Boolean(
        profile.organizations
          .find(
            (organization) =>
              organization.id === id,
          )
          ?.permissions.includes(
            'analytics.economics.read',
          ),
      );

    return this.analytics.dashboard(
      scope,
      includeEconomics,
    );
  }

  @Get('operational')
  async operational(
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = analyticsQuerySchema.parse(raw ?? {});
    const profile = await this.require(organizationId, request, 'analytics.read');
    const scope = scopeFromProfile(profile, z.string().uuid().parse(organizationId), request);
    await this.assertPointFilter(scope, query.dispensingPointId);
    const includeEconomics = Boolean(
      profile.organizations
        .find((organization) => organization.id === z.string().uuid().parse(organizationId))
        ?.permissions.includes('analytics.economics.read'),
    );
    return this.analytics.operational(query, scope, includeEconomics);
  }

  @Get('novelties')
  async novelties(
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = analyticsQuerySchema.parse(raw ?? {});
    const scope = await this.scope(organizationId, request, 'analytics.read');
    await this.assertPointFilter(scope, query.dispensingPointId);
    return this.analytics.novelties(query, scope);
  }

  @Get('inventory')
  async inventory(
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = analyticsQuerySchema.parse(raw ?? {});
    const scope = await this.scope(organizationId, request, 'analytics.read');
    await this.assertPointFilter(scope, query.dispensingPointId);
    return this.analytics.inventory(query, scope);
  }

  @Get('economics')
  async economics(
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = analyticsQuerySchema.parse(raw ?? {});
    const scope = await this.scope(organizationId, request, 'analytics.economics.read');
    await this.assertPointFilter(scope, query.dispensingPointId);
    return this.analytics.economics(query, scope);
  }

  @Get('drilldown')
  async drilldown(
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = analyticsDrilldownQuerySchema.parse(raw ?? {});
    const scope = await this.scope(organizationId, request, 'analytics.read');
    await this.assertPointFilter(scope, query.dispensingPointId);
    return this.analytics.drilldown(query);
  }

  @Get('export.xlsx')
  async exportXlsx(
    @Query() raw: unknown,
    @Res() response: Response,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = analyticsQuerySchema.parse(raw ?? {});
    const profile = await this.require(organizationId, request, 'analytics.read');
    const scope = scopeFromProfile(profile, z.string().uuid().parse(organizationId), request);
    await this.assertPointFilter(scope, query.dispensingPointId);
    const includeEconomics = Boolean(
      profile.organizations
        .find((organization) => organization.id === z.string().uuid().parse(organizationId))
        ?.permissions.includes('analytics.economics.read'),
    );
    const payload = await this.analytics.operational(query, scope, includeEconomics);
    const buffer = buildAnalyticsExportWorkbook(payload, includeEconomics);
    response.setHeader(
      'content-type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'content-disposition',
      'attachment; filename="indicadores-operacionales.xlsx"',
    );
    response.send(buffer);
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

  private async assertPointFilter(
    scope: Scope,
    dispensingPointId: string | undefined,
  ): Promise<void> {
    if (!dispensingPointId) return;
    try {
      await this.pointAccess.assertCanAccessPoint(scope, dispensingPointId);
    } catch (error) {
      throwIfPointAccessDenied(error);
      throw error;
    }
  }
}
