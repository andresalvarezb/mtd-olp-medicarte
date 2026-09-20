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
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { projectedDemandListQuerySchema } from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile, type Scope } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { ProjectedDemandService } from './projected-demand.service';

const uuidSchema = z.string().uuid();
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

const demandLineSchema = {
  type: 'object',
  required: ['id', 'planningPeriodId', 'commercialCode', 'projectedQuantity'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    planningPeriodId: { type: 'string', format: 'uuid' },
    planningPeriodStartDate: { type: 'string', format: 'date' },
    planningPeriodEndDate: { type: 'string', format: 'date' },
    dispensingPointId: { type: 'string', format: 'uuid', nullable: true },
    dispensingPointCode: { type: 'string', nullable: true },
    dispensingPointName: { type: 'string', nullable: true },
    commercialCode: { type: 'string' },
    regularQuantity: { type: 'integer' },
    lateQuantity: { type: 'integer' },
    projectedQuantity: { type: 'integer' },
    sourceCount: { type: 'integer' },
    status: { type: 'string' },
    revision: { type: 'integer' },
    consolidatedAt: { type: 'string', format: 'date-time' },
  },
};

@ApiTags('projected-demand')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
@UseGuards(AuthGuard)
export class ProjectedDemandController {
  constructor(
    private readonly demand: ProjectedDemandService,
    private readonly access: AccessService,
  ) {}

  private async requireScope(
    rawOrganizationId: string | undefined,
    request: AuthenticatedRequest,
    permission: 'projected_demand.read' | 'projected_demand.manage',
  ): Promise<Scope> {
    const organizationId = uuidSchema.parse(rawOrganizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      permission,
    );
    return scopeFromProfile(profile, organizationId, request);
  }

  /** POST /planning-periods/:id/consolidate — consolidación del período. */
  @Post('planning-periods/:id/consolidate')
  @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object' } })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async consolidate(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const periodId = uuidSchema.parse(rawId);
    emptyBodySchema.parse(rawBody ?? {});
    const scope = await this.requireScope(organizationId, request, 'projected_demand.manage');
    return this.demand.consolidate(periodId, scope);
  }

  /** GET /projected-demand — líneas del período con filtros. */
  @Get('projected-demand')
  @ApiOkResponse({ schema: { type: 'object', properties: { items: { type: 'array' } } } })
  @ApiForbiddenResponse({ schema: errorSchema })
  async list(
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = projectedDemandListQuerySchema.parse(rawQuery ?? {});
    const scope = await this.requireScope(organizationId, request, 'projected_demand.read');
    return { items: await this.demand.list(query, scope) };
  }

  @Get('projected-demand/:id')
  @ApiOkResponse({ schema: demandLineSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async detail(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    await this.requireScope(organizationId, request, 'projected_demand.read');
    return this.demand.findById(id);
  }

  @Get('projected-demand/:id/coverage-projection')
  @ApiOkResponse({
    schema: {
      type: 'object',
    },
  })
  @ApiConflictResponse({
    schema: errorSchema,
  })
  @ApiForbiddenResponse({
    schema: errorSchema,
  })
  @ApiNotFoundResponse({
    schema: errorSchema,
  })
  async coverageProjection(
    @Param('id')
    rawId: string,
    @Headers('x-organization-id')
    organizationId: string | undefined,
    @Req()
    request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);

    await this.requireScope(organizationId, request, 'projected_demand.read');

    return this.demand.coverageProjection(id);
  }

  @Get('projected-demand/:id/sources')
  @ApiOkResponse({ schema: { type: 'object', properties: { items: { type: 'array' } } } })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async sources(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    await this.requireScope(organizationId, request, 'projected_demand.read');
    return { items: await this.demand.listSources(id) };
  }
}
