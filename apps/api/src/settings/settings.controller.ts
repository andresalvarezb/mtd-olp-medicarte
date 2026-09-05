import { Body, Controller, Get, Headers, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { SettingsService } from './settings.service';

const driveUrlSchema = z.object({
  url: z.string().url().max(2048).refine((value) => value.startsWith('https://'), 'Drive URL must use HTTPS'),
});

@ApiTags('settings')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('settings')
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly access: AccessService,
  ) {}

  @Get('drive')
  @ApiOkResponse({ schema: { type: 'object', required: ['url'], properties: { url: { type: 'string', nullable: true } } } })
  async getDrive(@Headers('x-organization-id') organizationId: string | undefined, @Req() request: AuthenticatedRequest) {
    await this.access.requirePermission(request.auth.sub, organizationId, 'view.supports');
    return this.settings.getDriveUrl();
  }

  @Put('drive')
  @ApiBody({ schema: { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' } } } })
  @ApiForbiddenResponse()
  async updateDrive(
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const profile = await this.access.requirePermission(request.auth.sub, organizationId, 'users.manage');
    return this.settings.setDriveUrl({
      url: driveUrlSchema.parse(rawBody).url,
      scope: scopeFromProfile(profile, organizationId!, request),
    });
  }
}
