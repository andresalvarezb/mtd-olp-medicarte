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
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { epsNovedadesExportQuerySchema } from '@authorization/contracts';
import { z } from 'zod';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { EpsExportsService, ForbiddenEpsExportError } from './eps-exports.service';

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

@ApiTags('eps-exports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ schema: errorSchema })
@ApiTooManyRequestsResponse({ schema: errorSchema })
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('exports')
@UseGuards(AuthGuard)
export class EpsExportsController {
  constructor(
    private readonly epsExports: EpsExportsService,
    private readonly access: AccessService,
  ) {}

  @Get('eps-novedades')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    description:
      'On-demand export of authorization items that did not reach LISTO_PARA_DISPENSAR (EPS novedades); not persisted',
    content: {
      'text/csv': { schema: { type: 'string', format: 'binary' } },
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiQuery({ name: 'format', enum: ['csv', 'xlsx'], required: false })
  @ApiForbiddenResponse({ schema: errorSchema })
  async epsNovedades(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Query() rawQuery: unknown,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    const query = epsNovedadesExportQuerySchema.parse(rawQuery ?? {});
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'operational_exports.create',
    );
    const scope = scopeFromProfile(profile, organization, request);
    let result: Awaited<ReturnType<EpsExportsService['epsNovedades']>>;
    try {
      result = await this.epsExports.epsNovedades({ query, scope });
    } catch (error) {
      await this.epsExports
        .auditExport({
          scope,
          format: query.format,
          rowCount: 0,
          columns: [],
          result: error instanceof ForbiddenEpsExportError ? 'DENIED' : 'FAILED',
        })
        .catch(() => undefined);
      if (error instanceof ForbiddenEpsExportError) {
        throw new ForbiddenException({
          code: 'ACTOR_NOT_ALLOWED',
          message: error.message,
        });
      }
      throw error;
    }
    await this.epsExports.auditExport({
      scope,
      format: query.format,
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
