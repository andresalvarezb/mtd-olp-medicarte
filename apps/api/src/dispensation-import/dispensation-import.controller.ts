import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import {
  FileInterceptor,
} from '@nestjs/platform-express';

import {
  z,
} from 'zod';

import {
  AuthGuard,
} from '../common/auth.guard';

import {
  scopeFromProfile,
  type Scope,
} from '../common/request-scope';

import {
  AccessService,
} from '../identity/access.service';

import type {
  AuthenticatedRequest,
} from '../types';

import {
  DispensationImportService,
  type UploadedDispensationFile,
} from './dispensation-import.service';


const uuidSchema =
  z.string().uuid();


@Controller(
  'authorizations/dispensation',
)
@UseGuards(
  AuthGuard,
)
export class DispensationImportController {
  constructor(
    private readonly service:
      DispensationImportService,

    private readonly access:
      AccessService,
  ) {}


  @Get(
    'template',
  )
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Header(
    'Content-Disposition',
    'attachment; filename="plantilla-dispensacion.xlsx"',
  )
  async template(
    @Headers(
      'x-organization-id',
    )
    organizationId:
      string | undefined,

    @Req()
    request:
      AuthenticatedRequest,
  ) {
    await this.requireScope(
      organizationId,
      request,
    );

    return new StreamableFile(
      this.service.template(),
    );
  }


  @Post(
    'import',
  )
  @UseInterceptors(
    FileInterceptor(
      'file',
      {
        limits: {
          fileSize:
            20 *
            1024 *
            1024,
        },
      },
    ),
  )
  async importFile(
    @UploadedFile()
    file:
      | UploadedDispensationFile
      | undefined,

    @Headers(
      'x-organization-id',
    )
    organizationId:
      string | undefined,

    @Req()
    request:
      AuthenticatedRequest,
  ) {
    if (
      !file
    ) {
      throw new BadRequestException({
        code:
          'DISPENSATION_FILE_REQUIRED',

        message:
          'Debe seleccionar un archivo XLSX.',
      });
    }

    const scope =
      await this.requireScope(
        organizationId,
        request,
      );

    return this.service.import(
      file,
      scope,
    );
  }


  private async requireScope(
    rawOrganizationId:
      string | undefined,

    request:
      AuthenticatedRequest,
  ): Promise<Scope> {
    const organizationId =
      uuidSchema.parse(
        rawOrganizationId,
      );

    const profile =
      await this.access.requirePermission(
        request.auth.sub,
        organizationId,
        'bulk_updates.dispensation_date',
      );

    const scope =
      scopeFromProfile(
        profile,
        organizationId,
        request,
      );

    if (
      scope.organizationCode !==
        'MEDICARTE' &&
      !scope.isFoundationAdmin
    ) {
      throw new ForbiddenException({
        code:
          'DISPENSATION_MEDICARTE_ONLY',

        message:
          'Solo MEDICARTE puede cargar fechas de dispensación.',
      });
    }

    return scope;
  }
}
