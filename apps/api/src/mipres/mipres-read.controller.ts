import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { z } from 'zod';

import { AuthGuard } from '../common/auth.guard';

import { scopeFromProfile } from '../common/request-scope';

import { AccessService } from '../identity/access.service';

import type { AuthenticatedRequest } from '../types';

import { MipresReadRepository } from './mipres-read.repository';

const uuid = z.string().uuid();

const listSchema = z
  .object({
    search: z.string().trim().max(250).optional(),

    directionStatus: z.enum(['CONFIRMED', 'PENDING', 'QUERY_ERROR']).optional(),

    manualDecision: z
      .enum(['PENDING_MANUAL_ENABLEMENT', 'MANUALLY_ENABLED', 'MANUALLY_DISABLED'])
      .optional(),

    state: z.enum(['OPERABLE', 'BLOCKED']).optional(),

    page: z.coerce.number().int().min(1).default(1),

    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const conceptsSchema = z
  .object({
    action: z.enum(['ENABLE', 'DISABLE']).optional(),
  })
  .strict();

@Controller('mipres')
@UseGuards(AuthGuard)
export class MipresReadController {
  constructor(
    private readonly repository: MipresReadRepository,

    private readonly access: AccessService,
  ) {}

  private async authorize(
    request: AuthenticatedRequest,

    organizationId: string | undefined,
  ) {
    const organization = uuid.parse(organizationId);

    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'view.mipres',
    );

    const scope = scopeFromProfile(profile, organization, request);

    if (scope.organizationCode !== 'MTD') {
      throw new ForbiddenException({
        code: 'MIPRES_MTD_ONLY',

        message: 'La operación MIPRES está disponible únicamente para MTD.',
      });
    }

    return scope;
  }

  @Get()
  async list(
    @Query()
    raw: unknown,

    @Headers('x-organization-id')
    organizationId: string | undefined,

    @Req()
    request: AuthenticatedRequest,
  ) {
    const parsed = listSchema.parse(raw ?? {});

    const scope = await this.authorize(request, organizationId);

    return this.repository.list(
      {
        page: parsed.page,

        limit: parsed.limit,

        ...(parsed.search
          ? {
              search: parsed.search,
            }
          : {}),

        ...(parsed.directionStatus
          ? {
              directionStatus: parsed.directionStatus,
            }
          : {}),

        ...(parsed.manualDecision
          ? {
              manualDecision: parsed.manualDecision,
            }
          : {}),

        ...(parsed.state
          ? {
              state: parsed.state,
            }
          : {}),
      },
      scope,
    );
  }

  @Get('decision-concepts')
  async concepts(
    @Query()
    raw: unknown,

    @Headers('x-organization-id')
    organizationId: string | undefined,

    @Req()
    request: AuthenticatedRequest,
  ) {
    const parsed = conceptsSchema.parse(raw ?? {});

    await this.authorize(request, organizationId);

    return this.repository.concepts(parsed.action);
  }

  @Get(':id/history')
  async history(
    @Param('id')
    rawId: string,

    @Headers('x-organization-id')
    organizationId: string | undefined,

    @Req()
    request: AuthenticatedRequest,
  ) {
    const scope = await this.authorize(request, organizationId);

    const result = await this.repository.history(uuid.parse(rawId), scope);

    if (!result) {
      throw new NotFoundException({
        code: 'MIPRES_AUTHORIZATION_NOT_FOUND',

        message: 'La autorización MIPRES no existe.',
      });
    }

    return result;
  }

  @Get(':id')
  async detail(
    @Param('id')
    rawId: string,

    @Headers('x-organization-id')
    organizationId: string | undefined,

    @Req()
    request: AuthenticatedRequest,
  ) {
    const scope = await this.authorize(request, organizationId);

    const result = await this.repository.detail(uuid.parse(rawId), scope);

    if (!result) {
      throw new NotFoundException({
        code: 'MIPRES_AUTHORIZATION_NOT_FOUND',

        message: 'La autorización MIPRES no existe.',
      });
    }

    return result;
  }
}
