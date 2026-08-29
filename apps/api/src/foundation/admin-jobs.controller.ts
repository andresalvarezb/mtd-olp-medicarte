import { Controller, Get, Headers, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../common/auth.guard';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { FoundationService } from './foundation.service';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/dead-letter-jobs')
export class AdminJobsController {
  constructor(
    private readonly foundation: FoundationService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'eventType', 'attempts'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          eventType: { type: 'string' },
          attempts: { type: 'integer' },
          lastError: { type: 'string', nullable: true },
        },
      },
    },
  })
  @ApiForbiddenResponse({ description: 'Organization scope or platform.jobs.manage denied' })
  async list(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      'platform.jobs.manage',
    );
    return this.foundation.listFailedJobs({
      organizationId: organizationId!,
      userId: profile.id,
      correlationId: request.correlationId,
    });
  }
}
