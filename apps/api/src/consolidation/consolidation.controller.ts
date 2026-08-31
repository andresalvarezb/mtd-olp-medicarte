import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { consolidatedExportQuerySchema, type MeResponse } from '@authorization/contracts';
import { z } from 'zod';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { ConsolidationService } from './consolidation.service';

const uuidSchema = z.string().uuid();
const errorSchema = {
  type: 'object',
  required: ['code', 'message', 'correlationId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    correlationId: { type: 'string' },
  },
};

@ApiTags('exports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ schema: errorSchema })
@ApiTooManyRequestsResponse({ schema: errorSchema })
@ApiHeader({ name: 'X-Organization-Id', required: true })
@UseGuards(AuthGuard)
@Controller('exports')
export class ConsolidationController {
  constructor(
    private readonly consolidation: ConsolidationService,
    private readonly access: AccessService,
  ) {}

  @Get('authorization-items.csv')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    description: 'On-demand consolidated export of APPROVED items only; not persisted',
    content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiQuery({ name: 'coverageType', enum: ['PBS', 'NO_PBS'], required: false })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  async exportCsv(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Query() query: Record<string, string>,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    return this.export(organizationId, { ...query, format: 'csv' }, request, response);
  }

  @Get('authorization-items.xlsx')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    description: 'On-demand consolidated XLSX export of APPROVED items only; not persisted',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiQuery({ name: 'coverageType', enum: ['PBS', 'NO_PBS'], required: false })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  async exportXlsx(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Query() query: Record<string, string>,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    return this.export(organizationId, { ...query, format: 'xlsx' }, request, response);
  }

  private async export(
    organizationId: string | undefined,
    rawQuery: Record<string, string>,
    request: AuthenticatedRequest,
    response: Response,
  ) {
    const query = consolidatedExportQuerySchema.parse(rawQuery);
    const organization = uuidSchema.parse(organizationId);
    let profile: MeResponse;
    try {
      profile = await this.access.requirePermission(
        request.auth.sub,
        organization,
        'exports.create',
      );
    } catch (error) {
      if (error instanceof ForbiddenException && organizationId) {
        await this.consolidation
          .auditExport({
            scope: {
              organizationId: organization,
              organizationCode: '',
              userId: request.auth.sub,
              correlationId: request.correlationId,
              readSensitive: false,
              isFoundationAdmin: false,
            },
            format: query.format,
            coverageType: query.coverageType ?? null,
            rowCount: 0,
            columns: [],
            result: 'DENIED',
          })
          .catch(() => undefined);
      }
      throw error;
    }
    const scope = scopeFromProfile(profile, organization, request);
    const result = await this.consolidation.consolidatedExport({ query, scope });
    await this.consolidation.auditExport({
      scope,
      format: query.format,
      coverageType: query.coverageType ?? null,
      rowCount: result.rowCount,
      columns: result.columns,
      result: 'SUCCESS',
    });
    response.setHeader(
      'Content-Type',
      query.format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv; charset=utf-8',
    );
    response.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    response.setHeader('Content-Length', String(result.content.length));
    response.end(result.content);
  }
}
