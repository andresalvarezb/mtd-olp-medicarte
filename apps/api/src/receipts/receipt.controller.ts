import { Body, Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import {
  confirmReceiptRequestSchema,
  createReceiptRequestSchema,
  purchaseOrderDirectReceiptRequestSchema,
  updateReceiptRequestSchema,
} from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { ReceiptService } from './receipt.service';
const uuid = z.string().uuid();
@Controller()
@UseGuards(AuthGuard)
export class ReceiptController {
  constructor(
    private readonly receipts: ReceiptService,
    private readonly access: AccessService,
  ) {}
  private async scope(req: AuthenticatedRequest, org: string | undefined, permission: string) {
    const id = uuid.parse(org);
    const profile = await this.access.requirePermission(req.auth.sub, id, permission);
    return scopeFromProfile(profile, id, req);
  }
  @Post('medicarte/purchase-orders/:id/receipts')
  async createPurchaseOrderReceipt(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('x-organization-id')
    org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.receipts.createPurchaseOrderReceipt(
      uuid.parse(id),
      purchaseOrderDirectReceiptRequestSchema.parse(
        raw,
      ),
      await this.scope(
        req,
        org,
        'medicarte_receipts.manage',
      ),
    );
  }


  @Post('medicarte/receipts') async create(
    @Body() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.receipts.create(
      createReceiptRequestSchema.parse(raw).deliveryId,
      await this.scope(req, org, 'medicarte_receipts.manage'),
    );
  }
  @Get('medicarte/receipts') async list(
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      items: await this.receipts.list(await this.scope(req, org, 'medicarte_receipts.read')),
    };
  }
  @Get('medicarte/receipts/pending') async pending(
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      items: await this.receipts.list(await this.scope(req, org, 'medicarte_receipts.read'), true),
    };
  }
  @Get('medicarte/receipts/:id') async detail(
    @Param('id') id: string,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.receipts.detail(
      uuid.parse(id),
      await this.scope(req, org, 'medicarte_receipts.read'),
    );
  }
  @Patch('medicarte/receipts/:id') async update(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.receipts.update(
      uuid.parse(id),
      updateReceiptRequestSchema.parse(raw),
      await this.scope(req, org, 'medicarte_receipts.manage'),
    );
  }
  @Post('medicarte/receipts/:id/confirm') async confirm(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.receipts.confirm(
      uuid.parse(id),
      confirmReceiptRequestSchema.parse(raw).expectedVersion,
      await this.scope(req, org, 'medicarte_receipts.manage'),
    );
  }
}

@Controller('olp')
@UseGuards(AuthGuard)
export class OlpReceiptController {
  constructor(
    private readonly receipts: ReceiptService,
    private readonly access: AccessService,
  ) {}
  @Get('receipts') async list(
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const id = uuid.parse(org);
    const profile = await this.access.requirePermission(
      req.auth.sub,
      id,
      'medicarte_receipts.read',
    );
    return { items: await this.receipts.list(scopeFromProfile(profile, id, req)) };
  }
  @Get('receipts/:id') async detail(
    @Param('id') id: string,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const oid = uuid.parse(org);
    const profile = await this.access.requirePermission(
      req.auth.sub,
      oid,
      'medicarte_receipts.read',
    );
    return this.receipts.detail(uuid.parse(id), scopeFromProfile(profile, oid, req));
  }
}
