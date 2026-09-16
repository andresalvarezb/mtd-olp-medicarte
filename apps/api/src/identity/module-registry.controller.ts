import { Controller, Get, Headers, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ACCESS_MODULE_REGISTRY } from '@authorization/contracts';
import { z } from 'zod';
import { AuthGuard } from '../common/auth.guard';
import type { AuthenticatedRequest } from '../types';
import { AccessService } from './access.service';

const errorSchema = {
  type: 'object',
  required: ['code', 'message', 'correlationId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    correlationId: { type: 'string' },
  },
};

@ApiTags('modules')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ schema: errorSchema })
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('modules')
@UseGuards(AuthGuard)
export class ModuleRegistryController {
  constructor(private readonly access: AccessService) {}

  @Get()
  @ApiOkResponse({ description: 'Canonical modules and actions.' })
  @ApiForbiddenResponse({ schema: errorSchema })
  async list(
    @Headers('x-organization-id') rawOrganizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = z.string().uuid().parse(rawOrganizationId);
    await this.access.requirePermission(request.auth.sub, organizationId, 'users.manage');
    return { items: ACCESS_MODULE_REGISTRY };
  }
}
