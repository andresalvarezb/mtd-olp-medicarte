import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  createStockTransferRequestSchema,
  stockTransferActionRequestSchema,
  stockTransferListQuerySchema,
  updateStockTransferRequestSchema,
} from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { StockTransferService } from './stock-transfer.service';
const uuid = z.string().uuid();

@Controller('inventory/transfers')
@UseGuards(AuthGuard)
export class StockTransferController {
  constructor(
    private readonly transfers: StockTransferService,
    private readonly access: AccessService,
  ) {}
  private async scope(req: AuthenticatedRequest, org: string | undefined, permission: string) {
    const id = uuid.parse(org);
    const profile = await this.access.requirePermission(req.auth.sub, id, permission);
    return scopeFromProfile(profile, id, req);
  }
  @Post() async create(
    @Body() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.transfers.create(
      createStockTransferRequestSchema.parse(raw),
      await this.scope(req, org, 'stock_transfers.manage'),
    );
  }
  @Get() async list(
    @Query() query: Record<string, unknown>,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.scope(req, org, 'stock_transfers.read');
    return {
      items: await this.transfers.list(scope, stockTransferListQuerySchema.parse(query).status),
    };
  }
  @Get(':id') async detail(
    @Param('id') id: string,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.transfers.detail(
      uuid.parse(id),
      await this.scope(req, org, 'stock_transfers.read'),
    );
  }
  @Patch(':id') async update(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.transfers.update(
      uuid.parse(id),
      updateStockTransferRequestSchema.parse(raw),
      await this.scope(req, org, 'stock_transfers.manage'),
    );
  }
  @Post(':id/dispatch') async dispatch(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.transfers.dispatch(
      uuid.parse(id),
      stockTransferActionRequestSchema.parse(raw).expectedVersion,
      await this.scope(req, org, 'stock_transfers.manage'),
    );
  }
  @Post(':id/receive') async receive(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.transfers.receive(
      uuid.parse(id),
      stockTransferActionRequestSchema.parse(raw).expectedVersion,
      await this.scope(req, org, 'stock_transfers.manage'),
    );
  }
  @Post(':id/cancel') async cancel(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('x-organization-id') org: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.transfers.cancel(
      uuid.parse(id),
      stockTransferActionRequestSchema.parse(raw).expectedVersion,
      await this.scope(req, org, 'stock_transfers.manage'),
    );
  }
}
