import { Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../common/auth.guard';
import type { AuthenticatedRequest } from '../types';
import { automaticReconciliationRequestSchema } from './inventory-availability-reconciliation.contract';
import { InventoryAvailabilityReconciliationService } from './inventory-availability-reconciliation.service';

@Controller('inventory/availability/auto-reconcile')
@UseGuards(AuthGuard)
export class InventoryAvailabilityReconciliationController {
  constructor(private readonly reconciliation: InventoryAvailabilityReconciliationService) {}

  @Post()
  async run(
    @Body() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const { confirm, ...options } = automaticReconciliationRequestSchema.parse(raw ?? {});
    void confirm;
    return this.reconciliation.runPage({
      userId: request.auth.sub,
      organizationId: z.string().uuid().parse(organizationId),
      correlationId: request.correlationId,
    }, options);
  }
}
