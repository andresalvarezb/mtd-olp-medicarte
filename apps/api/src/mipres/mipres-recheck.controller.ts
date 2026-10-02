import { Controller, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';

import { z } from 'zod';

import { AuthGuard } from '../common/auth.guard';

import { scopeFromProfile } from '../common/request-scope';

import { AccessService } from '../identity/access.service';

import type { AuthenticatedRequest } from '../types';

import { MipresRecheckService } from './mipres-recheck.service';

const uuidSchema = z.string().uuid();

const idempotencySchema = z.string().trim().min(1).max(200);

@Controller('mipres')
@UseGuards(AuthGuard)
export class MipresRecheckController {
  constructor(
    private readonly service: MipresRecheckService,

    private readonly access: AccessService,
  ) {}

  @Post(':id/recheck')
  @HttpCode(200)
  async recheck(
    @Param('id')
    rawId: string,

    @Headers('idempotency-key')
    rawIdempotencyKey: string | undefined,

    @Headers('x-organization-id')
    rawOrganizationId: string | undefined,

    @Req()
    request: AuthenticatedRequest,
  ) {
    const itemId = uuidSchema.parse(rawId);

    const organizationId = uuidSchema.parse(rawOrganizationId);

    const idempotencyKey = idempotencySchema.parse(rawIdempotencyKey);

    const profile = await this.access.requirePermission(
      request.auth.sub,

      organizationId,

      'mipres.recheck',
    );

    return this.service.recheck({
      itemId,

      idempotencyKey,

      scope: scopeFromProfile(
        profile,

        organizationId,

        request,
      ),
    });
  }
}
