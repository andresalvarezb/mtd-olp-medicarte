import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  registerModeratorFeeRequestSchema,
} from '@authorization/contracts';

import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';

import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';

import {
  AuthorizationModeratorFeeService,
} from './authorization-moderator-fee.service';

const uuid = z.string().uuid();

@ApiTags('authorization-moderator-fee')
@ApiBearerAuth()
@Controller('medicarte/authorizations')
@UseGuards(AuthGuard)
export class AuthorizationModeratorFeeController {
  constructor(
    private readonly service: AuthorizationModeratorFeeService,
    private readonly access: AccessService,
  ) {}

  private async scope(
    request: AuthenticatedRequest,
    organizationId: string | undefined,
    permission: 'authorizations.read' | 'moderator_fees.manage',
  ) {
    const id = uuid.parse(organizationId);

    const profile = await this.access.requirePermission(
      request.auth.sub,
      id,
      permission,
    );

    return scopeFromProfile(profile, id, request);
  }

  @Get(':id/moderator-fee')
  async detail(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.detail(
      uuid.parse(rawId),
      await this.scope(request, organizationId, 'authorizations.read'),
    );
  }

  @Post(':id/moderator-fee')
  async register(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = registerModeratorFeeRequestSchema.parse(rawBody);

    return this.service.register(
      uuid.parse(rawId),
      body,
      await this.scope(request, organizationId, 'moderator_fees.manage'),
    );
  }
}
