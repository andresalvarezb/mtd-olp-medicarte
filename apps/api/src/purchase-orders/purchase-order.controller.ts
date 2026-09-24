import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createPurchaseOrderRequestSchema,
  purchaseOrderListQuerySchema,
  reviewPurchaseOrderLineRequestSchema,
  updatePurchaseOrderRequestSchema,
} from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { PurchaseOrderService } from './purchase-order.service';

const uuid = z.string().uuid();
const actionSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

const acceptPurchaseOrderSchema = z
  .object({
    expectedVersion:
      z.number()
        .int()
        .positive(),

    committedDate:
      z.string()
        .regex(
          /^\d{4}-\d{2}-\d{2}$/,
          'committedDate must use YYYY-MM-DD',
        ),

    lines:
      z.array(
        z
          .object({
            purchaseOrderLineId:
              z.string().uuid(),

            managedQuantity:
              z.number()
                .int()
                .positive(),
          })
          .strict(),
      )
        .min(1),

    observation:
      z.string()
        .trim()
        .min(3)
        .max(2000)
        .optional(),
  })
  .strict();

const supplierReturnSchema = z.object({
  expectedVersion: z.number().int().positive(),
  observation: z.string().trim().min(3).max(2000),
});

@ApiTags('purchase-orders')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
@UseGuards(AuthGuard)
export class PurchaseOrderController {
  constructor(
    private readonly orders: PurchaseOrderService,
    private readonly access: AccessService,
  ) {}
  private async scope(
    request: AuthenticatedRequest,
    organizationId: string | undefined,
    permission: string,
  ) {
    const org = uuid.parse(organizationId);
    const profile = await this.access.requirePermission(request.auth.sub, org, permission);
    return scopeFromProfile(profile, org, request);
  }
  @Post('purchase-orders') async create(
    @Body() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orders.create(
      createPurchaseOrderRequestSchema.parse(raw),
      await this.scope(req, org, 'purchase_orders.manage'),
    );
  }
  @Get('purchase-orders') async list(
    @Query() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.scope(req, org, 'purchase_orders.read');
    return { items: await this.orders.list(purchaseOrderListQuerySchema.parse(raw ?? {}), scope) };
  }
  @Get('purchase-orders/:id') async detail(
    @Param('id') id: string,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    uuid.parse(id);
    return this.orders.detail(id, false, await this.scope(req, org, 'purchase_orders.read'));
  }
  @Get('purchase-orders/:id/operational')
  async operationalDetail(
    @Param('id') id: string,
    @Headers('x-organization-id')
    org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    uuid.parse(id);

    return this.orders.operationalDetail(
      id,
      await this.scope(
        req,
        org,
        'purchase_orders.read',
      ),
    );
  }

  @Patch('purchase-orders/:id') async update(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    uuid.parse(id);
    return this.orders.update(
      id,
      updatePurchaseOrderRequestSchema.parse(raw),
      await this.scope(req, org, 'purchase_orders.manage'),
    );
  }
  @Post('purchase-orders/:id/issue') @HttpCode(200) async issue(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orders.issue(
      id,
      actionSchema.parse(raw).expectedVersion,
      await this.scope(req, org, 'purchase_orders.manage'),
    );
  }
  @Post('purchase-orders/:id/cancel') @HttpCode(200) async cancel(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orders.cancel(
      id,
      actionSchema.parse(raw).expectedVersion,
      await this.scope(req, org, 'purchase_orders.manage'),
    );
  }
  @Get('purchase-demand/available') async available(
    @Query('planningPeriodId') periodId: string,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.scope(req, org, 'purchase_orders.manage');
    return { items: await this.orders.available(uuid.parse(periodId)) };
  }
}

@ApiTags('supplier-purchase-orders')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('supplier')
@UseGuards(AuthGuard)
export class SupplierPurchaseOrderController {
  constructor(
    private readonly orders: PurchaseOrderService,
    private readonly access: AccessService,
  ) {}
  private async scope(
    request: AuthenticatedRequest,
    organizationId: string | undefined,
    permission: string,
  ) {
    const org = uuid.parse(organizationId);
    const profile = await this.access.requirePermission(request.auth.sub, org, permission);
    return scopeFromProfile(profile, org, request);
  }
  @Get('purchase-orders') async list(
    @Query() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.scope(req, org, 'purchase_orders.read');
    return {
      items: await this.orders.list(purchaseOrderListQuerySchema.parse(raw ?? {}), scope, true),
    };
  }
  @Get('purchase-orders/:id') async detail(
    @Param('id') id: string,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    uuid.parse(id);
    return this.orders.detail(id, true, await this.scope(req, org, 'purchase_orders.read'));
  }
  @Post('purchase-orders/:id/accept')
  @HttpCode(200)
  async accept(
    @Param('id')
    id: string,

    @Body()
    raw: unknown,

    @Headers('x-organization-id')
    org: string | undefined,

    @Req()
    req: AuthenticatedRequest,
  ) {
    uuid.parse(id);

    /*
     * Autorización antes de validar el payload.
     *
     * Un actor sin permiso debe recibir 403 y no obtener
     * información sobre la forma del contrato de OLP.
     */
    const scope =
      await this.scope(
        req,
        org,
        'purchase_orders.review_supplier',
      );

    const body =
      acceptPurchaseOrderSchema.parse(
        raw,
      );

    return this.orders.acceptBySupplier(
      id,
      {
        expectedVersion:
          body.expectedVersion,

        committedDate:
          body.committedDate,

        lines:
          body.lines,

        ...(body.observation === undefined
          ? {}
          : {
              observation:
                body.observation,
            }),
      },
      scope,
    );
  }

  @Post('purchase-orders/:id/lines/:lineId/review') @HttpCode(200) async review(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const body = reviewPurchaseOrderLineRequestSchema.parse(raw);
    return this.orders.review(
      id,
      lineId,
      {
        expectedVersion: body.expectedVersion,
        acceptedQuantity: body.acceptedQuantity,
        ...(body.supplierUnitCost === undefined ? {} : { supplierUnitCost: body.supplierUnitCost }),
      },
      await this.scope(req, org, 'purchase_orders.review_supplier'),
    );
  }
  @Post('purchase-orders/:id/return')
  @HttpCode(200)
  async returnToMtd(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    uuid.parse(id);

    const body = supplierReturnSchema.parse(raw);

    return this.orders.returnBySupplier(
      id,
      body.expectedVersion,
      body.observation,
      await this.scope(req, org, 'purchase_orders.review_supplier'),
    );
  }

  @Post('purchase-orders/:id/complete-review') @HttpCode(200) async complete(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orders.completeReview(
      id,
      actionSchema.parse(raw).expectedVersion,
      await this.scope(req, org, 'purchase_orders.review_supplier'),
    );
  }
}
