import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  cancelPatientApplicationRequestSchema,
  confirmPatientApplicationRequestSchema,
  createPatientApplicationRequestSchema,
  patientApplicationListQuerySchema,
  updatePatientApplicationRequestSchema,
} from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { PatientApplicationService } from './patient-application.service';

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

@ApiTags('patient-applications')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('medicarte/applications')
@UseGuards(AuthGuard)
export class PatientApplicationController {
  constructor(
    private readonly applications: PatientApplicationService,
    private readonly access: AccessService,
  ) {}

  private async scope(
    raw: string | undefined,
    request: AuthenticatedRequest,
    permission: 'patient_applications.read' | 'patient_applications.manage',
  ) {
    const organizationId = uuidSchema.parse(raw);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      permission,
    );
    return scopeFromProfile(profile, organizationId, request);
  }

  @Get('eligible-schedules')
  @ApiOkResponse({ schema: { type: 'object', properties: { items: { type: 'array' } } } })
  @ApiForbiddenResponse({ schema: errorSchema })
  async eligible(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      items: await this.applications.eligibleSchedules(
        await this.scope(organizationId, request, 'patient_applications.read'),
      ),
    };
  }

  @Get()
  @ApiOkResponse({ schema: { type: 'object', properties: { items: { type: 'array' } } } })
  async list(
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      items: await this.applications.list(
        patientApplicationListQuerySchema.parse(raw ?? {}),
        await this.scope(organizationId, request, 'patient_applications.read'),
      ),
    };
  }

  @Get(':id')
  async detail(
    @Param('id') id: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.applications.detail(
      uuidSchema.parse(id),
      await this.scope(organizationId, request, 'patient_applications.read'),
    );
  }

  @Post()
  @ApiCreatedResponse({ schema: { type: 'object' } })
  async create(
    @Body() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.applications.create(
      createPatientApplicationRequestSchema.parse(raw),
      await this.scope(organizationId, request, 'patient_applications.manage'),
    );
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.applications.update(
      uuidSchema.parse(id),
      updatePatientApplicationRequestSchema.parse(raw),
      await this.scope(organizationId, request, 'patient_applications.manage'),
    );
  }

  @Post(':id/confirm')
  @ApiConflictResponse({ schema: errorSchema })
  async confirm(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = confirmPatientApplicationRequestSchema.parse(raw);
    return this.applications.confirm(
      uuidSchema.parse(id),
      body.expectedVersion,
      await this.scope(organizationId, request, 'patient_applications.manage'),
    );
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = cancelPatientApplicationRequestSchema.parse(raw);
    return this.applications.cancel(
      uuidSchema.parse(id),
      body.expectedVersion,
      await this.scope(organizationId, request, 'patient_applications.manage'),
    );
  }
}
