import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { BULK_IMPORT_MAX_FILE_BYTES, bulkImportRowListQuerySchema } from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { BulkImportService, type BulkImportUploadFile } from './bulk-import.service';

const uuidSchema = z.string().uuid();
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('bulk-imports')
@UseGuards(AuthGuard)
export class BulkImportController {
  constructor(
    private readonly bulk: BulkImportService,
    private readonly access: AccessService,
  ) {}

  @Get('authorizations/template.xlsx')
  async template(
    @Res() response: Response,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.scope(organizationId, request, 'bulk_imports.read');
    const buffer = this.bulk.buildAuthorizationTemplate();
    response.setHeader('content-type', XLSX_CONTENT_TYPE);
    response.setHeader(
      'content-disposition',
      'attachment; filename="plantilla-autorizaciones-esp014.xlsx"',
    );
    response.send(buffer);
  }

  @Post('authorizations/upload')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: BULK_IMPORT_MAX_FILE_BYTES } }))
  async upload(
    @UploadedFile() file: BulkImportUploadFile | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = await this.scope(organizationId, request, 'bulk_imports.manage');
    return this.bulk.uploadAuthorizations({ file, actor });
  }

  @Get()
  async list(
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = await this.scope(organizationId, request, 'bulk_imports.read');
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .parse((raw as { limit?: unknown })?.limit);
    return { items: await this.bulk.listJobs(actor, limit) };
  }

  @Get(':id/rows')
  async rows(
    @Param('id') rawId: string,
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = await this.scope(organizationId, request, 'bulk_imports.read');
    return {
      items: await this.bulk.listRows(
        uuidSchema.parse(rawId),
        actor,
        bulkImportRowListQuerySchema.parse(rawQuery ?? {}),
      ),
    };
  }

  @Get(':id/result.xlsx')
  async result(
    @Param('id') rawId: string,
    @Res() response: Response,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = await this.scope(organizationId, request, 'bulk_imports.read');
    const buffer = await this.bulk.resultWorkbook(uuidSchema.parse(rawId), actor);
    response.setHeader('content-type', XLSX_CONTENT_TYPE);
    response.setHeader('content-disposition', 'attachment; filename="resultado-importacion.xlsx"');
    response.send(buffer);
  }

  @Get(':id/rejected.xlsx')
  async rejected(
    @Param('id') rawId: string,
    @Res() response: Response,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = await this.scope(organizationId, request, 'bulk_imports.read');
    const buffer = await this.bulk.rejectedRowsWorkbook(uuidSchema.parse(rawId), actor);
    response.setHeader('content-type', XLSX_CONTENT_TYPE);
    response.setHeader(
      'content-disposition',
      'attachment; filename="filas-rechazadas-importacion.xlsx"',
    );
    response.send(buffer);
  }

  @Get(':id')
  async detail(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = await this.scope(organizationId, request, 'bulk_imports.read');
    return this.bulk.getJob(uuidSchema.parse(rawId), actor);
  }

  @Post(':id/validate')
  @HttpCode(200)
  async validate(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = await this.scope(organizationId, request, 'bulk_imports.manage');
    return this.bulk.getJob(uuidSchema.parse(rawId), actor);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = await this.scope(organizationId, request, 'bulk_imports.manage');
    return this.bulk.confirm(uuidSchema.parse(rawId), actor);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = await this.scope(organizationId, request, 'bulk_imports.manage');
    return this.bulk.cancel(uuidSchema.parse(rawId), actor);
  }

  @Post(':id/retry-failed')
  @HttpCode(200)
  async retryFailed(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = await this.scope(organizationId, request, 'bulk_imports.manage');
    return this.bulk.retryFailed(uuidSchema.parse(rawId), actor);
  }

  private async scope(
    organizationId: string | undefined,
    request: AuthenticatedRequest,
    permission: 'bulk_imports.read' | 'bulk_imports.manage',
  ) {
    const id = uuidSchema.parse(organizationId);
    const profile = await this.access.requirePermission(request.auth.sub, id, permission);
    return scopeFromProfile(profile, id, request);
  }
}
