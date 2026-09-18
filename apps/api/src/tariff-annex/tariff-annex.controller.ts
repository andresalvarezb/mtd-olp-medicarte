import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { TariffAnnexService, type UploadedTariffFile } from './tariff-annex.service';

const uuidSchema = z.string().uuid();

const confirmSchema = z
  .object({
    overrideReason: z.string().trim().min(10).max(500).optional(),
  })
  .strict();

@Controller('admin/tariff-annex')
@UseGuards(AuthGuard)
export class TariffAnnexController {
  constructor(
    private readonly service: TariffAnnexService,
    private readonly access: AccessService,
  ) {}

  @Post('imports')
  @HttpCode(202)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 20 * 1024 * 1024,
      },
    }),
  )
  async createImport(
    @UploadedFile() file: UploadedTariffFile | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'TARIFF_IMPORT_FILE_REQUIRED',
        message: 'Un archivo de Anexo Tarifario es obligatorio.',
      });
    }

    const organization = uuidSchema.parse(organizationId);

    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.import',
    );

    return this.service.createImport({
      file,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Post('imports/:importId/prepare')
  @HttpCode(200)
  async prepareImport(
    @Param('importId') importId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsedImportId = uuidSchema.parse(importId);
    const organization = uuidSchema.parse(organizationId);

    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.import',
    );

    return this.service.prepareImport({
      importId: parsedImportId,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Get('imports/:importId')
  async getImport(
    @Param('importId') importId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsedImportId = uuidSchema.parse(importId);
    const organization = uuidSchema.parse(organizationId);

    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.read',
    );

    return this.service.getImport(parsedImportId, scopeFromProfile(profile, organization, request));
  }

  @Post('imports/:importId/confirm')
  @HttpCode(200)
  async confirmImport(
    @Param('importId') importId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsedImportId = uuidSchema.parse(importId);
    const body = confirmSchema.parse(rawBody ?? {});
    const organization = uuidSchema.parse(organizationId);

    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.import',
    );

    return this.service.confirmImport({
      importId: parsedImportId,
      ...(body.overrideReason
        ? {
            overrideReason: body.overrideReason,
          }
        : {}),
      scope: scopeFromProfile(profile, organization, request),
    });
  }
}
