import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
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
import {
  ProductDeliveryPointService,
  type UploadedProductDeliveryPointFile,
} from './product-delivery-point.service';

const uuidSchema = z.string().uuid();

@Controller('admin/product-delivery-points')
@UseGuards(AuthGuard)
export class ProductDeliveryPointController {
  constructor(
    private readonly service: ProductDeliveryPointService,
    private readonly access: AccessService,
  ) {}

  @Post('import')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 20 * 1024 * 1024,
      },
    }),
  )
  async import(
    @UploadedFile() file: UploadedProductDeliveryPointFile | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'DELIVERY_POINT_IMPORT_FILE_REQUIRED',
        message: 'El archivo de relación medicamento-sede es obligatorio.',
      });
    }

    const organization = uuidSchema.parse(organizationId);

    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.import',
    );

    return this.service.import({
      file,
      scope: scopeFromProfile(profile, organization, request),
    });
  }

  @Get()
  async list(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const organization = uuidSchema.parse(organizationId);

    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'tariff_annex.read',
    );

    return this.service.list(scopeFromProfile(profile, organization, request));
  }
}
