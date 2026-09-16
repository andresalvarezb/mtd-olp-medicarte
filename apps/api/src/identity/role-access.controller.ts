import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  createRoleRequestSchema,
  updateRoleAccessRequestSchema,
  updateRoleRequestSchema,
} from '@authorization/contracts';
import { z } from 'zod';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import type { AuthenticatedRequest } from '../types';
import { AccessService } from './access.service';
import { RoleAccessService } from './role-access.service';

const roleCodeSchema = z.string().min(1).max(80);

const errorSchema = {
  type: 'object',
  required: ['code', 'message', 'correlationId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    correlationId: { type: 'string' },
  },
};

@ApiTags('roles')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ schema: errorSchema })
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('roles')
@UseGuards(AuthGuard)
export class RoleAccessController {
  constructor(
    private readonly roles: RoleAccessService,
    private readonly access: AccessService,
  ) {}

  private async requireUsersManage(
    rawOrganizationId: string | undefined,
    request: AuthenticatedRequest,
  ) {
    const organizationId = z.string().uuid().parse(rawOrganizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      'users.manage',
    );
    return scopeFromProfile(profile, organizationId, request);
  }

  @Get()
  @ApiOkResponse({ description: 'Roles and their current usage.' })
  @ApiForbiddenResponse({ schema: errorSchema })
  async list(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.requireUsersManage(organizationId, request);
    return this.roles.list();
  }

  @Post()
  @ApiOkResponse({ description: 'Created custom role.' })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  async create(
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.requireUsersManage(organizationId, request);
    return this.roles.createRole({
      body: createRoleRequestSchema.parse(rawBody),
      scope,
    });
  }

  @Patch(':roleCode')
  @ApiOkResponse({ description: 'Updated custom role.' })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async update(
    @Param('roleCode') rawRoleCode: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.requireUsersManage(organizationId, request);
    return this.roles.updateRole({
      roleCode: roleCodeSchema.parse(rawRoleCode),
      body: updateRoleRequestSchema.parse(rawBody),
      scope,
    });
  }

  @Delete(':roleCode')
  @ApiOkResponse({ description: 'Deleted custom role.' })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async delete(
    @Param('roleCode') rawRoleCode: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.requireUsersManage(organizationId, request);
    return this.roles.deleteRole({
      roleCode: roleCodeSchema.parse(rawRoleCode),
      scope,
    });
  }

  @Get(':roleCode/access')
  @ApiOkResponse({ description: 'Canonical module/action access for a role.' })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async getAccess(
    @Param('roleCode') rawRoleCode: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.requireUsersManage(organizationId, request);
    return this.roles.getAccess(roleCodeSchema.parse(rawRoleCode));
  }

  @Put(':roleCode/access')
  @ApiOkResponse({ description: 'Updated role access.' })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async updateAccess(
    @Param('roleCode') rawRoleCode: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.requireUsersManage(organizationId, request);
    return this.roles.updateAccess({
      roleCode: roleCodeSchema.parse(rawRoleCode),
      body: updateRoleAccessRequestSchema.parse(rawBody),
      scope,
    });
  }
}
