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
  InventoryAvailabilityService,
} from './inventory-availability.service';


const uuid = z.string().uuid();

const listSchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),

  purchaseOrder: z.string().trim().min(1).max(255).optional(),

  dispensingPoint: z.string().trim().min(1).max(255).optional(),

  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const assignmentSchema = z.object({
  authorizationKey: z.string().trim().min(1).max(511),

  purchaseOrderCode: z.string().trim().min(1).max(255),

  quantity: z.number().int().positive(),
});

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('inventory/availability')
@UseGuards(AuthGuard)
export class InventoryAvailabilityController {
  constructor(
    private readonly availability: InventoryAvailabilityService,

    private readonly access: AccessService,
  ) {}

  private async scope(
    req: AuthenticatedRequest,

    organizationId: string | undefined,

    permission: 'inventory.read' | 'inventory.allocate',
  ) {
    const orgId = uuid.parse(organizationId);

    const profile = await this.access.requirePermission(req.auth.sub, orgId, permission);

    return scopeFromProfile(profile, orgId, req);
  }

  @Get()
  async list(
    @Query()
    raw: Record<string, unknown>,

    @Headers('x-organization-id')
    organizationId: string | undefined,

    @Req()
    req: AuthenticatedRequest,
  ) {
    const parsed = listSchema.parse(raw);

    return this.availability.list(await this.scope(req, organizationId, 'inventory.read'), {
      limit: parsed.limit,

      ...(parsed.search !== undefined
        ? {
            search: parsed.search,
          }
        : {}),

      ...(parsed.purchaseOrder !== undefined
        ? {
            purchaseOrder: parsed.purchaseOrder,
          }
        : {}),

      ...(parsed.dispensingPoint !== undefined
        ? {
            dispensingPoint: parsed.dispensingPoint,
          }
        : {}),
    });
  }

  @Get('export.xlsx')
  async exportWorkbook(
    @Query()
    raw: Record<string, unknown>,

    @Headers('x-organization-id')
    organizationId: string | undefined,

    @Req()
    req: AuthenticatedRequest,

    @Res()
    response: Response,
  ) {
    const parsed =
      listSchema
        .omit({
          limit: true,
        })
        .parse(raw);

    const content =
      await this.availability.exportWorkbook(
        await this.scope(
          req,
          organizationId,
          'inventory.read',
        ),
        {
          ...(parsed.search !== undefined
            ? {
                search:
                  parsed.search,
              }
            : {}),

          ...(parsed.purchaseOrder !== undefined
            ? {
                purchaseOrder:
                  parsed.purchaseOrder,
              }
            : {}),

          ...(parsed.dispensingPoint !== undefined
            ? {
                dispensingPoint:
                  parsed.dispensingPoint,
              }
            : {}),
        },
      );

    response.setHeader(
      'Content-Type',
      XLSX_MIME,
    );

    response.setHeader(
      'Content-Disposition',
      'attachment; filename="disponibilidad.xlsx"',
    );

    response.send(
      content,
    );
  }
}
