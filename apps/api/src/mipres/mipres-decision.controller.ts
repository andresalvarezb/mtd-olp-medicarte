import { Body, Controller, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';

import { idempotencyKeySchema, mipresManualDecisionRequestSchema } from '@authorization/contracts';

import { z } from 'zod';

import { AuthGuard } from '../common/auth.guard';

import { scopeFromProfile } from '../common/request-scope';

import { AccessService } from '../identity/access.service';

import type { AuthenticatedRequest } from '../types';

import { MipresDecisionService } from './mipres-decision.service';

const uuid = z.string().uuid();

@Controller('mipres')
@UseGuards(AuthGuard)
export class MipresDecisionController {
  constructor(
    private readonly decisions: MipresDecisionService,

    private readonly access: AccessService,
  ) {}

  @Post(':id/decision')
  @HttpCode(200)
  async decide(
    @Param('id')
    rawId: string,

    @Body()
    rawBody: unknown,

    @Headers('idempotency-key')
    rawIdempotencyKey: string | undefined,

    @Headers('x-organization-id')
    rawOrganizationId: string | undefined,

    @Req()
    request: AuthenticatedRequest,
  ) {
    const itemId = uuid.parse(rawId);

    const organizationId = uuid.parse(rawOrganizationId);

    const body = mipresManualDecisionRequestSchema.parse(rawBody);

    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);

    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      'mipres.decision.manage',
    );

    return this.decisions.decide({
      itemId,
      body,
      idempotencyKey,

      scope: scopeFromProfile(profile, organizationId, request),
    });
  }
}
