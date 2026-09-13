import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  createPlanningPeriodRequestSchema,
  planningPeriodListQuerySchema,
  transitionPlanningPeriodRequestSchema,
  updatePlanningPeriodRequestSchema,
} from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { PlanningPeriodService } from './planning-period.service';

const uuidSchema = z.string().uuid();

const errorSchema = {
  type: 'object',
  required: ['code', 'message', 'correlationId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    correlationId: { type: 'string' },
  },
};

const planningPeriodSchema = {
  type: 'object',
  required: [
    'id',
    'startDate',
    'endDate',
    'schedulingCutoffAt',
    'purchaseOrderDeadlineAt',
    'expectedDeliveryDate',
    'status',
    'version',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    startDate: { type: 'string', format: 'date' },
    endDate: { type: 'string', format: 'date' },
    schedulingCutoffAt: { type: 'string', format: 'date-time' },
    purchaseOrderDeadlineAt: { type: 'string', format: 'date-time' },
    expectedDeliveryDate: { type: 'string', format: 'date' },
    status: { type: 'string' },
    version: { type: 'integer' },
    createdBy: { type: 'string', format: 'uuid' },
    updatedBy: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

@ApiTags('planning-periods')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('planning-periods')
@UseGuards(AuthGuard)
export class PlanningPeriodController {
  constructor(
    private readonly planning: PlanningPeriodService,
    private readonly access: AccessService,
  ) {}

  private async requireScope(
    rawOrganizationId: string | undefined,
    request: AuthenticatedRequest,
    permission: 'planning_periods.read' | 'planning_periods.manage',
  ) {
    const organizationId = uuidSchema.parse(rawOrganizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      permission,
    );
    return scopeFromProfile(profile, organizationId, request);
  }

  @Get()
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['items'],
      properties: { items: { type: 'array', items: planningPeriodSchema } },
    },
  })
  @ApiForbiddenResponse({ schema: errorSchema })
  async list(
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = planningPeriodListQuerySchema.parse(rawQuery ?? {});
    await this.requireScope(organizationId, request, 'planning_periods.read');
    return { items: await this.planning.list(query) };
  }

  @Get(':id')
  @ApiOkResponse({ schema: planningPeriodSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async detail(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    await this.requireScope(organizationId, request, 'planning_periods.read');
    return this.planning.findById(id);
  }

  @Post()
  @ApiCreatedResponse({ schema: planningPeriodSchema })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  async create(
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = createPlanningPeriodRequestSchema.parse(rawBody);
    const scope = await this.requireScope(organizationId, request, 'planning_periods.manage');
    return this.planning.create({ body, actor: scope });
  }

  @Patch(':id')
  @ApiOkResponse({ schema: planningPeriodSchema })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async update(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    const body = updatePlanningPeriodRequestSchema.parse(rawBody);
    const scope = await this.requireScope(organizationId, request, 'planning_periods.manage');
    return this.planning.update({ id, body, actor: scope });
  }

  @Post(':id/transition')
  @HttpCode(200)
  @ApiOkResponse({ schema: planningPeriodSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async transition(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    const body = transitionPlanningPeriodRequestSchema.parse(rawBody);
    const scope = await this.requireScope(organizationId, request, 'planning_periods.manage');
    return this.planning.transition({
      id,
      to: body.to,
      expectedVersion: body.expectedVersion,
      actor: scope,
    });
  }
}
