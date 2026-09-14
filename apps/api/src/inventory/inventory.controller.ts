import { Controller, Get, Headers, Param, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { InventoryService } from './inventory.service';

const uuid = z.string().uuid();
const filters = z.object({
  commercialCode: z.string().trim().min(1).max(255).optional(),
  dispensingPointId: uuid.optional(),
  lotNumber: z.string().trim().min(1).max(255).optional(),
  expiration: z.enum(['expired', 'upcoming', 'current']).optional(),
  usable: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

@Controller('inventory')
@UseGuards(AuthGuard)
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly access: AccessService,
  ) {}
  private async scope(req: AuthenticatedRequest, org: string | undefined) {
    const id = uuid.parse(org);
    const profile = await this.access.requirePermission(req.auth.sub, id, 'inventory.read');
    return scopeFromProfile(profile, id, req);
  }
  @Get() async list(
    @Query() query: Record<string, unknown>,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return { items: await this.inventory.list(await this.scope(req, org), filters.parse(query)) };
  }
  @Get('fefo/recommendation') async fefo(
    @Query() query: Record<string, unknown>,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const parsed = z
      .object({ commercialCode: z.string().trim().min(1), dispensingPointId: uuid })
      .parse(query);
    return {
      recommendation: await this.inventory.fefo(
        await this.scope(req, org),
        parsed.commercialCode,
        parsed.dispensingPointId,
      ),
    };
  }
  @Get('lots/:id') async detail(
    @Param('id') id: string,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.inventory.detail(uuid.parse(id), await this.scope(req, org));
  }
  @Get('lots/:id/movements') async movements(
    @Param('id') id: string,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.scope(req, org);
    await this.inventory.detail(uuid.parse(id), scope);
    return { items: await this.inventory.movements(uuid.parse(id)) };
  }
}
