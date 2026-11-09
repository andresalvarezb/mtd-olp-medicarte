import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  patientMasterDetailSchema,
  patientMasterPersonalResponseSchema,
  patientMasterSearchRequestSchema,
  patientMasterSearchResponseSchema,
  patientMasterLiveLookupRequestSchema,
  patientMasterLiveLookupResponseSchema,
  patientReconciliationCasesQuerySchema,
  patientReconciliationCasesResponseSchema,
} from '@authorization/contracts';
import { z } from 'zod';
import type { ApiConfig } from '@authorization/config';
import { AuthGuard } from '../common/auth.guard';
import { AccessService } from '../identity/access.service';
import { API_CONFIG } from '../tokens';
import type { AuthenticatedRequest } from '../types';
import {
  assertPatientReconciliationReadAllowed,
  resolvePatientMasterLiveLookupScope,
  resolvePatientMasterScope,
} from './patient-master.access-policy';
import { PatientMasterService } from './patient-master.service';

const uuidSchema = z.string().uuid();

@ApiTags('patient-master')
@ApiBearerAuth()
@Controller('patient-master')
@UseGuards(AuthGuard)
export class PatientMasterController {
  constructor(
    private readonly service: PatientMasterService,
    private readonly access: AccessService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  private assertAccessEnabled(): void {
    if (!this.config.PATIENT_MASTER_ACCESS_ENABLED) {
      throw PatientMasterController.featureUnavailable();
    }
  }

  @Post('search')
  async search(
    @Body() rawBody: unknown,
    @Headers('x-organization-id') rawOrganizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    this.assertAccessEnabled();
    const body = patientMasterSearchRequestSchema.parse(rawBody);
    const organizationId = uuidSchema.parse(rawOrganizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      'patient_master.read',
    );
    const scope = resolvePatientMasterScope(
      profile,
      organizationId,
      request.auth.sub,
      body.dispensingPointId,
    );
    const response = await this.service.search(scope, body);
    return patientMasterSearchResponseSchema.parse(response);
  }

  @Post('lookup')
  async lookup(
    @Body() rawBody: unknown,
    @Headers('x-organization-id') rawOrganizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    this.assertAccessEnabled();
    if (!this.config.PATIENT_MASTER_DP07_APPROVED) {
      throw PatientMasterController.featureUnavailable();
    }
    const body = patientMasterLiveLookupRequestSchema.parse(rawBody);
    const organizationId = uuidSchema.parse(rawOrganizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      'patient_master.read',
    );
    const grantedPoints = await this.access.getMedicartePointGrants(request.auth.sub);
    const scope = resolvePatientMasterLiveLookupScope(
      profile,
      organizationId,
      request.auth.sub,
      grantedPoints,
      body.dispensingPointId,
    );
    const identity = {
      identificationType: body.identificationType,
      identificationValue: body.identificationValue,
    };
    if (!(await this.service.isAuthorizedLiveLookup(scope, identity))) {
      return patientMasterLiveLookupResponseSchema.parse({ status: 'NOT_FOUND' });
    }
    return patientMasterLiveLookupResponseSchema.parse(await this.service.lookupLive(identity));
  }

  @Get('reconciliation-cases')
  async reconciliationCases(
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') rawOrganizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    this.assertAccessEnabled();
    const query = patientReconciliationCasesQuerySchema.parse(rawQuery ?? {});
    const organizationId = uuidSchema.parse(rawOrganizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      'patient_reconciliation.read',
    );
    assertPatientReconciliationReadAllowed(profile, organizationId);
    const scope = resolvePatientMasterScope(
      profile,
      organizationId,
      request.auth.sub,
      undefined,
      'patient_reconciliation.read',
    );
    const items = await this.service.reconciliationCases(scope, query.limit);
    return patientReconciliationCasesResponseSchema.parse({ items });
  }

  @Get(':id')
  async detail(
    @Param('id') rawPatientId: string,
    @Query('dispensingPointId') rawPointId: string | undefined,
    @Headers('x-organization-id') rawOrganizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    this.assertAccessEnabled();
    const patientId = uuidSchema.parse(rawPatientId);
    const dispensingPointId = rawPointId ? uuidSchema.parse(rawPointId) : undefined;
    const organizationId = uuidSchema.parse(rawOrganizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      'patient_master.read',
    );
    const scope = resolvePatientMasterScope(
      profile,
      organizationId,
      request.auth.sub,
      dispensingPointId,
    );
    const response = await this.service.detail(
      scope,
      patientId,
      this.config.PATIENT_MASTER_DP07_APPROVED === true,
    );
    return patientMasterDetailSchema.parse({
      ...response,
      // DP-07 remains a hard runtime gate; actual services use the strict parsed
      // production config and the gate defaults closed.
      basicProfile: this.config.PATIENT_MASTER_DP07_APPROVED ? response.basicProfile : null,
      basicProfileMetadata: this.config.PATIENT_MASTER_DP07_APPROVED
        ? response.basicProfileMetadata
        : null,
    });
  }

  @Get(':id/personal')
  async personalProfile(
    @Param('id') rawPatientId: string,
    @Query('dispensingPointId') rawPointId: string | undefined,
    @Headers('x-organization-id') rawOrganizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    this.assertAccessEnabled();
    if (!this.config.PATIENT_MASTER_DP07_APPROVED) {
      throw PatientMasterController.featureUnavailable();
    }
    const patientId = uuidSchema.parse(rawPatientId);
    const dispensingPointId = rawPointId ? uuidSchema.parse(rawPointId) : undefined;
    const organizationId = uuidSchema.parse(rawOrganizationId);
    await this.access.requirePermission(request.auth.sub, organizationId, 'patient_master.read');
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      'patient_master.personal.read',
    );
    const scope = resolvePatientMasterScope(
      profile,
      organizationId,
      request.auth.sub,
      dispensingPointId,
    );
    return patientMasterPersonalResponseSchema.parse(
      await this.service.personalProfile(scope, patientId),
    );
  }

  static featureUnavailable(): ForbiddenException {
    return new ForbiddenException({ code: 'PATIENT_MASTER_ACCESS_DISABLED' });
  }
}
