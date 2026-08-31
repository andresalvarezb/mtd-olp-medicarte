import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
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
  ApiUnauthorizedResponse,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { operationalExportQuerySchema } from '@authorization/contracts';
import { z } from 'zod';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { ForbiddenExportError, OperationalExportsService } from './operational-exports.service';

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

@ApiTags('operational-exports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ schema: errorSchema })
@ApiTooManyRequestsResponse({ schema: errorSchema })
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('operational-exports')
@UseGuards(AuthGuard)
export class OperationalExportsController {
  constructor(
    private readonly exports: OperationalExportsService,
    private readonly access: AccessService,
  ) {}

  @Get('authorization-items')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    description: 'On-demand full export; not persisted',
    content: {
      'text/csv': { schema: { type: 'string', format: 'binary' } },
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiQuery({
    name: 'operationType',
    enum: ['ASSIGN_DISPENSATION_LOCATION', 'REPORT_DISPENSATION_DATE', 'REPORT_APPLICATION_DATE'],
  })
  @ApiQuery({ name: 'format', enum: ['csv', 'xlsx'], required: false })
  @ApiForbiddenResponse({ schema: errorSchema })
  async authorizationItems(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    const query = operationalExportQuerySchema.parse(request.query ?? {});
    const organization = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'operational_exports.create',
    );
    const scope = scopeFromProfile(profile, organization, request);
    let result: Awaited<ReturnType<OperationalExportsService['authorizationItems']>>;
    try {
      result = await this.exports.authorizationItems({ query, scope });
    } catch (error) {
      await this.exports
        .auditExport({
          scope,
          operationType: query.operationType,
          format: query.format,
          rowCount: 0,
          columns: [],
          result: error instanceof ForbiddenExportError ? 'DENIED' : 'FAILED',
        })
        .catch(() => undefined);
      if (error instanceof ForbiddenExportError) {
        throw new ForbiddenException({
          code: 'ACTOR_NOT_ALLOWED',
          message: `Solo ${error.requiredActor} o MTD con permiso explícito puede descargar esta base.`,
        });
      }
      throw error;
    }
    await this.exports.auditExport({
      scope,
      operationType: query.operationType,
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
