import { Body, Controller, Get, Headers, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { replaceOperationalPointScopeRequestSchema } from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { OperationalAccessScopeService } from './operational-access-scope.service';

const uuidSchema = z.string().uuid();

@ApiTags('access-scopes')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('access-scopes')
@UseGuards(AuthGuard)
export class AccessScopeController {
  constructor(
    private readonly access: AccessService,
    private readonly scopes: OperationalAccessScopeService,
  ) {}

  @Get('assignable-points')
  async assignablePoints(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.require(organizationId, request, 'operational_scopes.read');
    return { items: await this.scopes.listAssignablePoints() };
  }

  @Get('users/:userId/points')
  async getUserPoints(
    @Param('userId') userId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.require(organizationId, request, 'operational_scopes.read');
    return this.scopes.getUserPointScope(uuidSchema.parse(userId));
  }

  @Put('users/:userId/points')
  async replaceUserPoints(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = await this.require(organizationId, request, 'operational_scopes.manage');
    return this.scopes.replaceUserPointScope(
      uuidSchema.parse(userId),
      replaceOperationalPointScopeRequestSchema.parse(body ?? {}),
      actor,
    );
  }

  private async require(
    rawOrganizationId: string | undefined,
    request: AuthenticatedRequest,
    permission: 'operational_scopes.read' | 'operational_scopes.manage',
  ) {
    const organizationId = uuidSchema.parse(rawOrganizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      permission,
    );
    return scopeFromProfile(profile, organizationId, request);
  }
}
