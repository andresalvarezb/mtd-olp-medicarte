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

import {
  FileInterceptor,
} from '@nestjs/platform-express';

import {
  BULK_IMPORT_MAX_FILE_BYTES,
} from '@authorization/contracts';

import type {
  Response,
} from 'express';

import {
  z,
} from 'zod';

import {
  AuthGuard,
} from '../common/auth.guard';

import {
  scopeFromProfile,
} from '../common/request-scope';

import {
  AccessService,
} from '../identity/access.service';

import type {
  AuthenticatedRequest,
} from '../types';

import {
  AuthorizationFulfillmentImportService,
  type UploadedAuthorizationFulfillmentFile,
} from './authorization-fulfillment-import.service';


const uuid =
  z.string().uuid();


const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';


@Controller(
  'medicarte/authorizations/fulfillment-import',
)
@UseGuards(AuthGuard)
export class AuthorizationFulfillmentImportController {
  constructor(
    private readonly importer:
      AuthorizationFulfillmentImportService,

    private readonly access:
      AccessService,
  ) {}


  @Get('template.xlsx')
  async template(
    @Headers(
      'x-organization-id',
    )
    rawOrganizationId:
      string | undefined,

    @Req()
    request:
      AuthenticatedRequest,

    @Res()
    response:
      Response,
  ) {
    await this.scope(
      rawOrganizationId,
      request,
    );


    response.setHeader(
      'content-type',
      XLSX_CONTENT_TYPE,
    );

    response.setHeader(
      'content-disposition',
      'attachment; filename="plantilla-entrega-aplicacion.xlsx"',
    );

    response.send(
      this.importer.buildTemplate(),
    );
  }


  @Post()
  @UseInterceptors(
    FileInterceptor(
      'file',
      {
        limits: {
          fileSize:
            BULK_IMPORT_MAX_FILE_BYTES,
        },
      },
    ),
  )
  async upload(
    @UploadedFile()
    file:
      | UploadedAuthorizationFulfillmentFile
      | undefined,

    @Headers(
      'x-organization-id',
    )
    rawOrganizationId:
      string | undefined,

    @Req()
    request:
      AuthenticatedRequest,
  ) {
    if (!file) {
      throw new BadRequestException({
        code:
          'AUTHORIZATION_FULFILLMENT_FILE_REQUIRED',

        message:
          'Debe seleccionar un archivo XLSX.',
      });
    }


    const scope =
      await this.scope(
        rawOrganizationId,
        request,
      );


    return this.importer.import(
      file,
      scope,
    );
  }


  private async scope(
    rawOrganizationId:
      string | undefined,

    request:
      AuthenticatedRequest,
  ) {
    const organizationId =
      uuid.parse(
        rawOrganizationId,
      );


    const profile =
      await this.access.requirePermission(
        request.auth.sub,
        organizationId,
        'patient_applications.manage',
      );


    return scopeFromProfile(
      profile,
      organizationId,
      request,
    );
  }
}
