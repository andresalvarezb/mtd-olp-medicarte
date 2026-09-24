import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  z,
} from 'zod';

import {
  AuthGuard,
} from '../common/auth.guard';

import {
  scopeFromProfile,
} from '../common/request-scope';

import {
  AccessService,
} from '../identity/access.service';

import type {
  AuthenticatedRequest,
} from '../types';

import {
  AuthorizationQueryRepository,
} from './authorization-query.repository';

const uuid =
  z.string().uuid();

const querySchema =
  z.object({
    authorizationNumber:
      z.string()
        .trim()
        .max(250)
        .optional(),

    commercialCode:
      z.string()
        .trim()
        .max(250)
        .optional(),

    patient:
      z.string()
        .trim()
        .max(250)
        .optional(),

    enablementStatus:
      z.enum([
        'ENABLED',
        'BLOCKED_SOURCE_STATUS',
      ])
        .optional(),

    operationalStatus:
      z.enum([
        'UNASSIGNED',
        'ASSIGNED',
        'CLOSED',
      ])
        .optional(),

    coverageType:
      z.enum([
        'PBS',
        'NO_PBS',
      ])
        .optional(),

    page:
      z.coerce
        .number()
        .int()
        .min(1)
        .default(1),

    limit:
      z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .default(50),
  });

@Controller('authorization-query')
@UseGuards(AuthGuard)
export class AuthorizationQueryController {
  constructor(
    private readonly repository:
      AuthorizationQueryRepository,

    private readonly access:
      AccessService,
  ) {}

  private async scope(
    request:
      AuthenticatedRequest,

    organizationId:
      string | undefined,
  ) {
    const organization =
      uuid.parse(
        organizationId,
      );

    const profile =
      await this.access.requirePermission(
        request.auth.sub,
        organization,
        'authorizations.read',
      );

    return scopeFromProfile(
      profile,
      organization,
      request,
    );
  }

  @Get()
  async list(
    @Query()
    raw:
      unknown,

    @Headers(
      'x-organization-id',
    )
    organizationId:
      string | undefined,

    @Req()
    request:
      AuthenticatedRequest,
  ) {
    const parsed =
      querySchema.parse(
        raw ?? {},
      );

    const filters = {
      page:
        parsed.page,

      limit:
        parsed.limit,

      ...(parsed.authorizationNumber
        ? {
            authorizationNumber:
              parsed.authorizationNumber,
          }
        : {}),

      ...(parsed.commercialCode
        ? {
            commercialCode:
              parsed.commercialCode,
          }
        : {}),

      ...(parsed.patient
        ? {
            patient:
              parsed.patient,
          }
        : {}),

      ...(parsed.enablementStatus
        ? {
            enablementStatus:
              parsed.enablementStatus,
          }
        : {}),

      ...(parsed.coverageType
        ? {
            coverageType:
              parsed.coverageType,
          }
        : {}),

      ...(parsed.operationalStatus
        ? {
            operationalStatus:
              parsed.operationalStatus,
          }
        : {}),
    };

    return this.repository.list(
      filters,
      await this.scope(
        request,
        organizationId,
      ),
    );
  }

  @Get(':id')
  async detail(
    @Param('id')
    rawId:
      string,

    @Headers(
      'x-organization-id',
    )
    organizationId:
      string | undefined,

    @Req()
    request:
      AuthenticatedRequest,
  ) {
    const id =
      uuid.parse(rawId);

    const result =
      await this.repository.detail(
        id,
        await this.scope(
          request,
          organizationId,
        ),
      );

    if (!result) {
      throw new NotFoundException({
        code:
          'AUTHORIZATION_NOT_FOUND',

        message:
          'La autorización no existe o no está disponible para la organización.',
      });
    }

    return result;
  }
}
