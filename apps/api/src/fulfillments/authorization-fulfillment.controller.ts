import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  z,
} from 'zod';

import {
  fulfillAuthorizationRequestSchema,
} from '@authorization/contracts';

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
  AuthorizationFulfillmentService,
} from './authorization-fulfillment.service';

const uuid =
  z.string().uuid();

@Controller(
  'medicarte/authorizations',
)
@UseGuards(AuthGuard)
export class AuthorizationFulfillmentController {
  constructor(
    private readonly fulfillments:
      AuthorizationFulfillmentService,

    private readonly access:
      AccessService,
  ) {}

  @Post(':id/fulfill')
  async fulfill(
    @Param('id')
    rawId: string,

    @Body()
    rawBody: unknown,

    @Headers(
      'x-organization-id',
    )
    organizationId:
      string | undefined,

    @Req()
    request:
      AuthenticatedRequest,
  ) {
    const orgId =
      uuid.parse(
        organizationId,
      );

    const profile =
      await this.access.requirePermission(
        request.auth.sub,
        orgId,
        'patient_applications.manage',
      );

    const scope =
      scopeFromProfile(
        profile,
        orgId,
        request,
      );

    return this.fulfillments.fulfill(
      uuid.parse(rawId),

      fulfillAuthorizationRequestSchema.parse(
        rawBody,
      ),

      scope,

      'UI',
    );
  }
}
