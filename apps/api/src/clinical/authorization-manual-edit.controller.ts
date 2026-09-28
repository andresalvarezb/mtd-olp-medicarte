import {
  Body,
  Controller,
  Headers,
  Param,
  Patch,
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
  AuthorizationManualEditService,
} from './authorization-manual-edit.service';


const uuid =
  z.string().uuid();


function isRealIsoDate(
  value: string,
) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/
      .exec(value);

  if (!match) {
    return false;
  }

  const year =
    Number(match[1]);

  const month =
    Number(match[2]);

  const day =
    Number(match[3]);

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
      ),
    );

  return (
    date.getUTCFullYear() === year
    &&
    date.getUTCMonth() === month - 1
    &&
    date.getUTCDate() === day
  );
}


const manualEditSchema =
  z.object({
    commercialCode:
      z.string()
        .trim()
        .min(1)
        .max(255),

    quantity:
      z.coerce
        .number()
        .int()
        .positive(),

    validityEndDate:
      z.string()
        .refine(
          isRealIsoDate,
          'Fecha final de vigencia inválida',
        ),

    expectedVersion:
      z.coerce
        .number()
        .int()
        .positive(),
  });


@Controller('authorizations')
@UseGuards(AuthGuard)
export class AuthorizationManualEditController {
  constructor(
    private readonly service:
      AuthorizationManualEditService,

    private readonly access:
      AccessService,
  ) {}


  @Patch(':id/manual-edit')
  async edit(
    @Param('id')
    rawId:
      string,

    @Body()
    rawBody:
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
    const orgId =
      uuid.parse(
        organizationId,
      );

    const profile =
      await this.access.requirePermission(
        request.auth.sub,
        orgId,
        'authorizations.manual_edit',
      );

    const scope =
      scopeFromProfile(
        profile,
        orgId,
        request,
      );

    return this.service.edit(
      uuid.parse(
        rawId,
      ),

      manualEditSchema.parse(
        rawBody,
      ),

      scope,
    );
  }
}
