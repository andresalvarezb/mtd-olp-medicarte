import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import {
  cancelPatientScheduleRequestSchema,
  createPatientScheduleRequestSchema,
  patientScheduleListQuerySchema,
  reschedulePatientScheduleRequestSchema,
  scheduleAuthorizationSearchQuerySchema,
  updatePatientScheduleRequestSchema,
} from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import {
  PatientScheduleImportService,
  type PatientScheduleUploadFile,
} from './patient-schedule-import.service';
import { PatientScheduleService } from './patient-schedule.service';

const uuidSchema = z.string().uuid();
const timingPreviewQuerySchema = z.object({ scheduledDate: z.string().date() });
const importListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const errorSchema = {
  type: 'object',
  required: ['code', 'message', 'correlationId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    correlationId: { type: 'string' },
  },
};

const patientScheduleSchema = {
  type: 'object',
  required: ['id', 'authorizationItemId', 'planningPeriodId', 'dispensingPointId', 'status'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    authorizationItemId: { type: 'string', format: 'uuid' },
    authorizationNumber: { type: 'string' },
    planningPeriodId: { type: 'string', format: 'uuid' },
    planningPeriodStartDate: { type: 'string', format: 'date' },
    planningPeriodEndDate: { type: 'string', format: 'date' },
    schedulingCutoffAt: { type: 'string', format: 'date-time' },
    dispensingPointId: { type: 'string', format: 'uuid' },
    dispensingPointCode: { type: 'string' },
    dispensingPointName: { type: 'string' },
    commercialCode: { type: 'string' },
    patientDocument: { type: 'string', nullable: true },
    patientName: { type: 'string', nullable: true },
    scheduledDate: { type: 'string', format: 'date' },
    quantity: { type: 'integer' },
    status: { type: 'string' },
    scheduleTiming: { type: 'string' },
    lateHandling: { type: 'string', nullable: true },
    deferredPlanningPeriodId: { type: 'string', format: 'uuid', nullable: true },
    revision: { type: 'integer' },
    authorizationExpiresOn: { type: 'string', format: 'date', nullable: true },
    daysUntilExpiration: { type: 'integer', nullable: true },
    priorityLevel: { type: 'string', nullable: true },
  },
};

@ApiTags('patient-schedules')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('patient-schedules')
@UseGuards(AuthGuard)
export class PatientScheduleController {
  constructor(
    private readonly schedules: PatientScheduleService,
    private readonly imports: PatientScheduleImportService,
    private readonly access: AccessService,
  ) {}

  private async requireScope(
    rawOrganizationId: string | undefined,
    request: AuthenticatedRequest,
    permission: 'patient_schedules.read' | 'patient_schedules.manage',
  ) {
    const organizationId = uuidSchema.parse(rawOrganizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      permission,
    );
    return scopeFromProfile(profile, organizationId, request);
  }

  @Get()
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['items'],
      properties: { items: { type: 'array', items: patientScheduleSchema } },
    },
  })
  @ApiForbiddenResponse({ schema: errorSchema })
  async list(
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = patientScheduleListQuerySchema.parse(rawQuery ?? {});
    const scope = await this.requireScope(organizationId, request, 'patient_schedules.read');
    return { items: await this.schedules.list(query, scope) };
  }

  @Get('authorizations')
  @ApiOkResponse({ schema: { type: 'object', properties: { items: { type: 'array' } } } })
  @ApiForbiddenResponse({ schema: errorSchema })
  async searchAuthorizations(
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = scheduleAuthorizationSearchQuerySchema.parse(rawQuery ?? {});
    const scope = await this.requireScope(organizationId, request, 'patient_schedules.read');
    return { items: await this.schedules.searchAuthorizations(query, scope) };
  }

  @Get('dispensing-points')
  @ApiOkResponse({ schema: { type: 'object', properties: { items: { type: 'array' } } } })
  @ApiForbiddenResponse({ schema: errorSchema })
  async listDispensingPoints(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.requireScope(organizationId, request, 'patient_schedules.read');
    return { items: await this.schedules.listDispensingPoints() };
  }

  @Get('timing-preview')
  @ApiOkResponse({ schema: { type: 'object' } })
  @ApiForbiddenResponse({ schema: errorSchema })
  async timingPreview(
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = timingPreviewQuerySchema.parse(rawQuery ?? {});
    const scope = await this.requireScope(organizationId, request, 'patient_schedules.read');
    return this.schedules.timingPreview(query.scheduledDate, scope);
  }

  @Get('imports/template')
  @ApiOkResponse({ description: 'XLSX template with the required columns' })
  @ApiForbiddenResponse({ schema: errorSchema })
  async downloadTemplate(
    @Res() response: Response,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.requireScope(organizationId, request, 'patient_schedules.read');
    const buffer = this.imports.buildTemplate();
    response.setHeader('content-type', XLSX_CONTENT_TYPE);
    response.setHeader(
      'content-disposition',
      'attachment; filename="plantilla-programacion-pacientes.xlsx"',
    );
    response.setHeader('content-length', String(buffer.length));
    response.send(buffer);
  }

  @Post('imports')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @ApiCreatedResponse({ schema: { type: 'object' } })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  async createImport(
    @UploadedFile() file: PatientScheduleUploadFile | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.requireScope(organizationId, request, 'patient_schedules.manage');
    return this.imports.createImport({ file, actor: scope });
  }

  @Get('imports')
  @ApiOkResponse({ schema: { type: 'object', properties: { items: { type: 'array' } } } })
  @ApiForbiddenResponse({ schema: errorSchema })
  async listImports(
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = importListQuerySchema.parse(rawQuery ?? {});
    const scope = await this.requireScope(organizationId, request, 'patient_schedules.read');
    return { items: await this.imports.listImports(scope, query.limit) };
  }

  @Get('imports/:importId')
  @ApiOkResponse({ schema: { type: 'object' } })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async importDetail(
    @Param('importId') rawImportId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const importId = uuidSchema.parse(rawImportId);
    const scope = await this.requireScope(organizationId, request, 'patient_schedules.read');
    return this.imports.getImport(importId, scope);
  }

  @Get('imports/:importId/rows')
  @ApiOkResponse({ schema: { type: 'object', properties: { items: { type: 'array' } } } })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async importRows(
    @Param('importId') rawImportId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const importId = uuidSchema.parse(rawImportId);
    const scope = await this.requireScope(organizationId, request, 'patient_schedules.read');
    return { items: await this.imports.getImportRows(importId, scope) };
  }

  @Post('imports/:importId/confirm')
  @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object' } })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async confirmImport(
    @Param('importId') rawImportId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const importId = uuidSchema.parse(rawImportId);
    const scope = await this.requireScope(organizationId, request, 'patient_schedules.manage');
    return this.imports.confirmImport(importId, scope);
  }

  @Get(':id')
  @ApiOkResponse({ schema: patientScheduleSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async detail(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    const scope = await this.requireScope(organizationId, request, 'patient_schedules.read');
    return this.schedules.findById(id, scope);
  }

  @Get(':id/history')
  @ApiOkResponse({ schema: { type: 'object', properties: { items: { type: 'array' } } } })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async history(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    const scope = await this.requireScope(organizationId, request, 'patient_schedules.read');
    return { items: await this.schedules.listHistory(id, scope) };
  }

  @Post()
  @ApiCreatedResponse({ schema: patientScheduleSchema })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  async create(
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = createPatientScheduleRequestSchema.parse(rawBody);
    const scope = await this.requireScope(organizationId, request, 'patient_schedules.manage');
    return this.schedules.create({ body, actor: scope });
  }

  @Patch(':id')
  @ApiOkResponse({ schema: patientScheduleSchema })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async update(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    const body = updatePatientScheduleRequestSchema.parse(rawBody);
    const scope = await this.requireScope(organizationId, request, 'patient_schedules.manage');
    return this.schedules.update({ id, body, actor: scope });
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  @ApiOkResponse({ schema: patientScheduleSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async reschedule(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    const body = reschedulePatientScheduleRequestSchema.parse(rawBody);
    const scope = await this.requireScope(organizationId, request, 'patient_schedules.manage');
    return this.schedules.reschedule({ id, body, actor: scope });
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ schema: patientScheduleSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async cancel(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = uuidSchema.parse(rawId);
    const body = cancelPatientScheduleRequestSchema.parse(rawBody);
    const scope = await this.requireScope(organizationId, request, 'patient_schedules.manage');
    return this.schedules.cancel({ id, body, actor: scope });
  }
}
