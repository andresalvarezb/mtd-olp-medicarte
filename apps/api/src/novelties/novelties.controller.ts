import { Controller, Get, Headers, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { NoveltiesService } from './novelties.service';

@ApiTags('novelties')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('novelties')
@UseGuards(AuthGuard)
export class NoveltiesController {
  constructor(
    private readonly novelties: NoveltiesService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Cross-module processing novelties filtered by ADR-027 criteria' })
  async list(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, string | undefined>,
  ) {
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      'authorizations.read',
    );
    const scope = scopeFromProfile(profile, organizationId!, request);
    return this.novelties.list(toQuery(query), scope);
  }

  @Get('xlsx')
  @ApiOkResponse({ description: 'Rejected records with original columns and ADR-027 diagnostics' })
  async exportXlsx(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
    @Query() query: Record<string, string | undefined>,
  ): Promise<void> {
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      'authorizations.read',
    );
    const scope = scopeFromProfile(profile, organizationId!, request);
    const exported = await this.novelties.exportXlsx(toQuery(query), scope);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    response.end(exported.content);
  }
}

function toQuery(query: Record<string, string | undefined>): Record<string, unknown> {
  const entries = Object.entries(query).filter(
    ([key, value]) =>
      ['authorization', 'document', 'stage', 'errorType', 'status', 'batchId', 'code', 'limit'].includes(key) &&
      value !== undefined &&
      value !== '',
  );
  return Object.fromEntries(entries);
}
