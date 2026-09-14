import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { createDeliveryRequestSchema, deliveryActionRequestSchema, updateDeliveryRequestSchema } from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { DeliveryService } from './delivery.service';

const uuid = z.string().uuid();

@Controller()
@UseGuards(AuthGuard)
export class DeliveryController {
  constructor(private readonly deliveries: DeliveryService, private readonly access: AccessService) {}
  private async scope(req: AuthenticatedRequest, organizationId: string | undefined, permission: string) { const org = uuid.parse(organizationId); const profile = await this.access.requirePermission(req.auth.sub, org, permission); return scopeFromProfile(profile, org, req); }
  @Post('supplier/deliveries') async create(@Body() raw: unknown, @Headers('x-organization-id') org: string | undefined, @Req() req: AuthenticatedRequest) { return this.deliveries.create(createDeliveryRequestSchema.parse(raw), await this.scope(req, org, 'supplier_deliveries.manage')); }
  @Get('supplier/deliveries') async list(@Headers('x-organization-id') org: string | undefined, @Req() req: AuthenticatedRequest) { return { items: await this.deliveries.list(await this.scope(req, org, 'supplier_deliveries.read')) }; }
  @Get('supplier/deliveries/:id') async detail(@Param('id') id: string, @Headers('x-organization-id') org: string | undefined, @Req() req: AuthenticatedRequest) { uuid.parse(id); return this.deliveries.detail(id, await this.scope(req, org, 'supplier_deliveries.read')); }
  @Patch('supplier/deliveries/:id') async update(@Param('id') id: string, @Body() raw: unknown, @Headers('x-organization-id') org: string | undefined, @Req() req: AuthenticatedRequest) { uuid.parse(id); return this.deliveries.update(id, updateDeliveryRequestSchema.parse(raw), await this.scope(req, org, 'supplier_deliveries.manage')); }
  @Post('supplier/deliveries/:id/dispatch') @HttpCode(200) async dispatch(@Param('id') id: string, @Body() raw: unknown, @Headers('x-organization-id') org: string | undefined, @Req() req: AuthenticatedRequest) { uuid.parse(id); return this.deliveries.dispatch(id, deliveryActionRequestSchema.parse(raw).expectedVersion, await this.scope(req, org, 'supplier_deliveries.manage')); }
  @Post('supplier/deliveries/:id/cancel') @HttpCode(200) async cancel(@Param('id') id: string, @Body() raw: unknown, @Headers('x-organization-id') org: string | undefined, @Req() req: AuthenticatedRequest) { uuid.parse(id); return this.deliveries.cancel(id, deliveryActionRequestSchema.parse(raw).expectedVersion, await this.scope(req, org, 'supplier_deliveries.manage')); }
}

@Controller('medicarte')
@UseGuards(AuthGuard)
export class MedicarteDeliveryController {
  constructor(private readonly deliveries: DeliveryService, private readonly access: AccessService) {}
  @Get('deliveries') async list(@Headers('x-organization-id') org: string | undefined, @Req() req: AuthenticatedRequest) { const organizationId = uuid.parse(org); const profile = await this.access.requirePermission(req.auth.sub, organizationId, 'supplier_deliveries.read'); return { items: await this.deliveries.list(scopeFromProfile(profile, organizationId, req)) }; }
  @Get('deliveries/:id') async detail(@Param('id') id: string, @Headers('x-organization-id') org: string | undefined, @Req() req: AuthenticatedRequest) { const organizationId = uuid.parse(org); const profile = await this.access.requirePermission(req.auth.sub, organizationId, 'supplier_deliveries.read'); uuid.parse(id); return this.deliveries.detail(id, scopeFromProfile(profile, organizationId, req)); }
}
