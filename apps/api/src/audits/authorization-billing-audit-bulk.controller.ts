import { Inject, Controller, Get, Post, Header, Headers, HttpCode, Param, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Response } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { BILLING_AUDIT_BULK_MAX_BYTES } from './authorization-billing-audit-bulk.xlsx';
import { AuthorizationBillingAuditBulkService } from './authorization-billing-audit-bulk.service';

const uuid = z.string().uuid();
const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('authorization-billing-audit-bulk')
@ApiBearerAuth()
@Controller('authorization-billing-audits/bulk')
@UseGuards(AuthGuard)
export class AuthorizationBillingAuditBulkController {
  constructor(
    @Inject(AuthorizationBillingAuditBulkService)
    private readonly bulk: AuthorizationBillingAuditBulkService,

    @Inject(AccessService)
    private readonly access: AccessService,
  ) {}

  private async scope(organizationId: string | undefined, request: AuthenticatedRequest,
    permission: 'application_audits.read' | 'application_audits.manage') {
    const id = uuid.parse(organizationId);
    const profile = await this.access.requirePermission(request.auth.sub, id, permission);
    return scopeFromProfile(profile, id, request);
  }

  @Get('template.xlsx')
  @Header('Cache-Control', 'private, no-store')
  async template(@Res() response: Response, @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest) {
    const file = this.bulk.template(await this.scope(organizationId, request, 'application_audits.read'));
    response.setHeader('Content-Type', xlsxType);
    response.setHeader('Content-Disposition', 'attachment; filename="plantilla-auditoria-facturacion.xlsx"');
    response.send(file);
  }

  @Post('jobs')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: BILLING_AUDIT_BULK_MAX_BYTES } }))
  async upload(@UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
    @Headers('x-organization-id') organizationId: string | undefined, @Req() request: AuthenticatedRequest) {
    return this.bulk.upload(file, await this.scope(organizationId, request, 'application_audits.manage'));
  }

  @Get('jobs/:id')
  async detail(@Param('id') id: string, @Query() query: unknown,
    @Headers('x-organization-id') organizationId: string | undefined, @Req() request: AuthenticatedRequest) {
    const pagination = z.object({
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(query ?? {});
    return this.bulk.getJob(uuid.parse(id), await this.scope(organizationId, request, 'application_audits.read'),
      pagination.limit, pagination.offset);
  }

  @Post('jobs/:id/confirm')
  @HttpCode(200)
  async confirm(@Param('id') id: string, @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest) {
    return this.bulk.confirm(uuid.parse(id), await this.scope(organizationId, request, 'application_audits.manage'));
  }

  @Get('jobs/:id/result.xlsx')
  @Header('Cache-Control', 'private, no-store')
  async result(@Param('id') id: string, @Res() response: Response,
    @Headers('x-organization-id') organizationId: string | undefined, @Req() request: AuthenticatedRequest) {
    const file = await this.bulk.resultWorkbook(uuid.parse(id),
      await this.scope(organizationId, request, 'application_audits.read'));
    response.setHeader('Content-Type', xlsxType);
    response.setHeader('Content-Disposition', 'attachment; filename="resultado-auditoria-facturacion.xlsx"');
    response.send(file);
  }
}
