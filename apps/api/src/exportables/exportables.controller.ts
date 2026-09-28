import {
  Controller,
  Get,
  Headers,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';

import type {
  Response,
} from 'express';

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
  ExportablesService,
  type ExportedWorkbook,
} from './exportables.service';


const uuid =
  z.string()
    .uuid();


const authorizationExportQuerySchema =
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

    lifecycleEnablement:
      z.enum([
        'ENABLED',
        'PENDING',
        'DISABLED',
      ])
        .optional(),

    operationalStatus:
      z.enum([
        'UNASSIGNED',
        'PARTIALLY_ASSIGNED',
        'ASSIGNED',
        'OUT_OF_OPERATION',
        'CLOSED',
      ])
        .optional(),

    coverageType:
      z.enum([
        'PBS',
        'NO_PBS',
      ])
        .optional(),
  });


@Controller(
  'exportables',
)
@UseGuards(
  AuthGuard,
)
export class ExportablesController {
  constructor(
    private readonly exports:
      ExportablesService,

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
        'operational_exports.create',
      );

    return scopeFromProfile(
      profile,
      organization,
      request,
    );
  }


  private send(
    response:
      Response,

    result:
      ExportedWorkbook,
  ): void {
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );

    response.setHeader(
      'Content-Length',
      String(
        result.content.length,
      ),
    );

    response.setHeader(
      'Cache-Control',
      'no-store',
    );

    response.end(
      result.content,
    );
  }


  @Get(
    'purchase-order-candidates.xlsx',
  )
  async purchaseOrderCandidates(
    @Headers(
      'x-organization-id',
    )
    organizationId:
      string | undefined,

    @Req()
    request:
      AuthenticatedRequest,

    @Res()
    response:
      Response,
  ) {
    const result =
      await this.exports
        .purchaseOrderCandidates(
          await this.scope(
            request,
            organizationId,
          ),
        );

    this.send(
      response,
      result,
    );
  }


  @Get(
    'purchase-orders.xlsx',
  )
  async purchaseOrders(
    @Headers(
      'x-organization-id',
    )
    organizationId:
      string | undefined,

    @Req()
    request:
      AuthenticatedRequest,

    @Res()
    response:
      Response,
  ) {
    const result =
      await this.exports
        .purchaseOrders(
          await this.scope(
            request,
            organizationId,
          ),
        );

    this.send(
      response,
      result,
    );
  }


  @Get(
    'authorizations.xlsx',
  )
  async authorizations(
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

    @Res()
    response:
      Response,
  ) {
    const parsed =
      authorizationExportQuerySchema.parse(
        raw ?? {},
      );

    const filters = {
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

      ...(parsed.lifecycleEnablement
        ? {
            lifecycleEnablement:
              parsed.lifecycleEnablement,
          }
        : {}),

      ...(parsed.operationalStatus
        ? {
            operationalStatus:
              parsed.operationalStatus,
          }
        : {}),

      ...(parsed.coverageType
        ? {
            coverageType:
              parsed.coverageType,
          }
        : {}),
    };

    const result =
      await this.exports
        .authorizations(
          await this.scope(
            request,
            organizationId,
          ),
          filters,
        );

    this.send(
      response,
      result,
    );
  }
}
