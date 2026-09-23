import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BULK_IMPORT_MAX_FILE_BYTES } from '@authorization/contracts';
import type { Response } from 'express';
import { z } from 'zod';

import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';

import { PurchaseOrderImportService } from './purchase-order-import.service';

const uuidSchema = z.string().uuid();

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('purchase-orders/import')
@UseGuards(AuthGuard)
export class PurchaseOrderImportController {
  constructor(
    private readonly importer: PurchaseOrderImportService,
    private readonly access: AccessService,
  ) {}

  @Get('template.xlsx')
  async template(
    @Headers('x-organization-id')
    organizationId: string | undefined,
    @Req()
    request: AuthenticatedRequest,
    @Res()
    response: Response,
  ) {
    await this.scope(
      organizationId,
      request,
    );

    response.setHeader(
      'content-type',
      XLSX_CONTENT_TYPE,
    );

    response.setHeader(
      'content-disposition',
      'attachment; filename="plantilla-ordenes-compra.xlsx"',
    );

    response.send(
      this.importer.buildTemplate(),
    );
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize:
          BULK_IMPORT_MAX_FILE_BYTES,
      },
    }),
  )
  async upload(
    @UploadedFile()
    file:
      | {
          buffer: Buffer;
          originalname: string;
          mimetype: string;
          size: number;
        }
      | undefined,
    @Headers('x-organization-id')
    organizationId: string | undefined,
    @Req()
    request: AuthenticatedRequest,
  ) {
    const actor =
      await this.scope(
        organizationId,
        request,
      );

    if (!file) {
      throw new BadRequestException({
        code: 'PURCHASE_ORDER_IMPORT_FILE_REQUIRED',
        message: 'Debe seleccionar un archivo XLSX para cargar la orden de compra.',
      });
    }

    return this.importer.import(
      file,
      actor,
    );
  }

  private async scope(
    organizationId: string | undefined,
    request: AuthenticatedRequest,
  ) {
    const org =
      uuidSchema.parse(
        organizationId,
      );

    const profile =
      await this.access.requirePermission(
        request.auth.sub,
        org,
        'purchase_orders.manage',
      );

    return scopeFromProfile(
      profile,
      org,
      request,
    );
  }
}
