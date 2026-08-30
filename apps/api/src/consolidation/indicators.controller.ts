import { Controller, Get, Headers, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { ConsolidationService } from './consolidation.service';

@ApiTags('indicators')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@UseGuards(AuthGuard)
@Controller('indicators')
export class IndicatorsController {
  constructor(
    private readonly consolidation: ConsolidationService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @ApiOkResponse({
    description: 'Derived operational indicators for the current organization scope',
    schema: {
      type: 'object',
      required: [
        'byAuditStatus',
        'byOperationStatus',
        'byCoverageType',
        'pendingDispensationLocation',
        'pendingDispensationDate',
        'pendingApplicationDate',
        'readyForReview',
        'approvedForAdmission',
      ],
      properties: {
        byAuditStatus: { type: 'object', additionalProperties: { type: 'integer' } },
        byOperationStatus: { type: 'object', additionalProperties: { type: 'integer' } },
        byCoverageType: { type: 'object', additionalProperties: { type: 'integer' } },
        pendingDispensationLocation: { type: 'integer' },
        pendingDispensationDate: { type: 'integer' },
        pendingApplicationDate: { type: 'integer' },
        readyForReview: { type: 'integer' },
        approvedForAdmission: { type: 'integer' },
      },
    },
  })
  async get(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      'authorizations.read',
    );
    const scope = scopeFromProfile(profile, organizationId!, request);
    return this.consolidation.indicators(scope);
  }
}
