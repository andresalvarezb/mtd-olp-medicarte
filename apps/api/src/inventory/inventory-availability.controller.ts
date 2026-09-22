import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';

import type { Response } from 'express';

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { AuthGuard } from '../common/auth.guard';

import { scopeFromProfile } from '../common/request-scope';

import { AccessService } from '../identity/access.service';

import type { AuthenticatedRequest } from '../types';

import { InventoryAvailabilityService } from './inventory-availability.service';

import { buildInventoryAvailabilityTemplate } from './inventory-availability-xlsx';

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

  @Post('assign')
  async assign(
    @Body()
    raw: unknown,

    @Headers('x-organization-id')
    organizationId: string | undefined,

    @Req()
    req: AuthenticatedRequest,
  ) {
    const body = z
      .object({
        assignments: z.array(assignmentSchema).min(1).max(500),
      })
      .parse(raw);

    return this.availability.assign(
      await this.scope(req, organizationId, 'inventory.allocate'),
      body.assignments,
    );
  }

  @Get('template.xlsx')
  async template(
    @Headers('x-organization-id')
    organizationId: string | undefined,

    @Req()
    req: AuthenticatedRequest,

    @Res()
    response: Response,
  ) {
    await this.scope(req, organizationId, 'inventory.read');

    const content = buildInventoryAvailabilityTemplate();

    response.setHeader('Content-Type', XLSX_MIME);

    response.setHeader(
      'Content-Disposition',
      'attachment; filename="plantilla-disponibilidad.xlsx"',
    );

    response.send(content);
  }

  @Post('imports/prepare')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 20 * 1024 * 1024,
      },
    }),
  )
  async prepare(
    @UploadedFile()
    file:
      | {
          originalname: string;

          mimetype: string;

          size: number;

          buffer: Buffer;
        }
      | undefined,

    @Headers('x-organization-id')
    organizationId: string | undefined,

    @Req()
    req: AuthenticatedRequest,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'INVENTORY_AVAILABILITY_FILE_REQUIRED',
      });
    }

    if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException({
        code: 'INVENTORY_AVAILABILITY_INVALID_XLSX',
      });
    }

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    return this.availability.prepareImport(
      await this.scope(req, organizationId, 'inventory.allocate'),
      file,
      sha256,
    );
  }

  @Get('imports/:id')
  async importDetail(
    @Param('id')
    id: string,

    @Headers('x-organization-id')
    organizationId: string | undefined,

    @Req()
    req: AuthenticatedRequest,
  ) {
    return this.availability.importDetail(
      await this.scope(req, organizationId, 'inventory.read'),
      uuid.parse(id),
    );
  }

  @Post('imports/:id/confirm')
  async confirmImport(
    @Param('id')
    id: string,

    @Headers('x-organization-id')
    organizationId: string | undefined,

    @Req()
    req: AuthenticatedRequest,
  ) {
    return this.availability.confirmImport(
      await this.scope(req, organizationId, 'inventory.allocate'),
      uuid.parse(id),
    );
  }
}
