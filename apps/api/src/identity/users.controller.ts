import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiTooManyRequestsResponse,
  ApiConflictResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  createAssignmentRequestSchema,
  createUserRequestSchema,
  resetUserPasswordRequestSchema,
  updateUserRequestSchema,
  userListQuerySchema,
} from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from './access.service';
import type { AuthenticatedRequest } from '../types';
import { UsersService } from './users.service';

const uuidSchema = z.string().uuid();

const errorSchema = {
  type: 'object',
  required: ['code', 'message', 'correlationId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    correlationId: { type: 'string' },
  },
};

const assignmentSchema = {
  type: 'object',
  required: ['organizationId', 'organizationCode', 'organizationName', 'roleCode', 'active'],
  properties: {
    organizationId: { type: 'string', format: 'uuid' },
    organizationCode: { type: 'string' },
    organizationName: { type: 'string' },
    roleCode: { type: 'string' },
    active: { type: 'boolean' },
  },
};

const userResponseSchema = {
  type: 'object',
  required: [
    'id',
    'username',
    'email',
    'displayName',
    'active',
    'passwordConfigured',
    'mustChangePassword',
    'assignments',
    'lastLoginAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    username: { type: 'string' },
    email: { type: 'string', nullable: true },
    displayName: { type: 'string' },
    active: { type: 'boolean' },
    passwordConfigured: { type: 'boolean' },
    mustChangePassword: { type: 'boolean' },
    assignments: { type: 'array', items: assignmentSchema },
    lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ schema: errorSchema })
@ApiTooManyRequestsResponse({ schema: errorSchema })
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly access: AccessService,
  ) {}

  private async requireUsersManage(
    rawOrganizationId: string | undefined,
    request: AuthenticatedRequest,
  ) {
    const organization = uuidSchema.parse(rawOrganizationId);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organization,
      'users.manage',
    );
    return scopeFromProfile(profile, organization, request);
  }

  @Get()
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['items'],
      properties: { items: { type: 'array', items: userResponseSchema } },
    },
  })
  @ApiForbiddenResponse({ schema: errorSchema })
  async list(
    @Query() rawQuery: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const query = userListQuerySchema.parse(rawQuery ?? {});
    await this.requireUsersManage(organizationId, request);
    return this.users.list(query.active === undefined ? undefined : query.active === 'true');
  }

  @Post()
  @ApiOkResponse({ schema: userResponseSchema })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  async create(
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = createUserRequestSchema.parse(rawBody);
    const scope = await this.requireUsersManage(organizationId, request);
    return this.users.create({ body, scope });
  }

  @Patch(':id')
  @ApiOkResponse({ schema: userResponseSchema })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async update(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const userId = uuidSchema.parse(rawId);
    const body = updateUserRequestSchema.parse(rawBody);
    const scope = await this.requireUsersManage(organizationId, request);
    return this.users.update({ userId, body, scope });
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @ApiOkResponse({ schema: userResponseSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async resetPassword(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const userId = uuidSchema.parse(rawId);
    const body = resetUserPasswordRequestSchema.parse(rawBody);
    const scope = await this.requireUsersManage(organizationId, request);
    return this.users.resetPassword({
      userId,
      password: body.password,
      mustChangePassword: body.mustChangePassword ?? true,
      scope,
    });
  }

  @Put(':id/assignments')
  @ApiOkResponse({ schema: userResponseSchema })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async addAssignment(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const userId = uuidSchema.parse(rawId);
    const body = createAssignmentRequestSchema.parse(rawBody);
    const scope = await this.requireUsersManage(organizationId, request);
    return this.users.addAssignment({ userId, body, scope });
  }

  @Delete(':id/assignments/:organizationId')
  @ApiOkResponse({ schema: userResponseSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  async revokeAssignment(
    @Param('id') rawId: string,
    @Param('organizationId') rawOrganizationId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const userId = uuidSchema.parse(rawId);
    const targetOrganizationId = uuidSchema.parse(rawOrganizationId);
    const scope = await this.requireUsersManage(organizationId, request);
    return this.users.revokeAssignment({ userId, organizationId: targetOrganizationId, scope });
  }
}
