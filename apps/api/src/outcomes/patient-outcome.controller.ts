import { Controller, Get, Headers, Param, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { markPatientNotAppliedRequestSchema } from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { PatientOutcomeService } from './patient-outcome.service';

@ApiTags('patient-operational-outcomes')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard)
export class PatientOutcomeController {
  constructor(
    private readonly outcomes: PatientOutcomeService,
    private readonly access: AccessService,
  ) {}
  private async scope(
    raw: string | undefined,
    request: AuthenticatedRequest,
    permission: 'patient_operational_outcomes.read' | 'patient_operational_outcomes.manage',
  ) {
    const organizationId = z.string().uuid().parse(raw);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      permission,
    );
    return scopeFromProfile(profile, organizationId, request);
  }
  @Get('operational-status')
  async statuses(
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      items: await this.outcomes.statuses(
        await this.scope(org, req, 'patient_operational_outcomes.read'),
      ),
    };
  }
  @Get('operational-status/:scheduleId')
  async status(
    @Param('scheduleId') id: string,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.outcomes.status(
      z.string().uuid().parse(id),
      await this.scope(org, req, 'patient_operational_outcomes.read'),
    );
  }
  @Get('operational-outcomes')
  async list(
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      items: await this.outcomes.list(
        await this.scope(org, req, 'patient_operational_outcomes.read'),
      ),
    };
  }
  @Get('operational-outcomes/:id')
  async detail(
    @Param('id') id: string,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.outcomes.detail(
      z.string().uuid().parse(id),
      await this.scope(org, req, 'patient_operational_outcomes.read'),
    );
  }
  @Post('medicarte/schedules/:scheduleId/not-applied')
  async mark(
    @Param('scheduleId') id: string,
    @Body() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.outcomes.markNotApplied(
      z.string().uuid().parse(id),
      markPatientNotAppliedRequestSchema.parse(raw),
      await this.scope(org, req, 'patient_operational_outcomes.manage'),
    );
  }
}
