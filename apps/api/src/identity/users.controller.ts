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
  approvePendingUserRequestSchema,
  createAssignmentRequestSchema,
  createUserRequestSchema,
  rejectPendingUserRequestSchema,
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
    'subject',
    'email',
    'displayName',
    'active',
    'assignments',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    subject: { type: 'string', nullable: true },
    email: { type: 'string' },
    displayName: { type: 'string' },
    active: { type: 'boolean' },
    assignments: { type: 'array', items: assignmentSchema },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const pendingRequestSchema = {
  type: 'object',
  required: ['id', 'subject', 'email', 'displayName', 'status', 'requestedAt', 'resolvedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    subject: { type: 'string' },
    email: { type: 'string' },
    displayName: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['PENDIENTE', 'APROBADO', 'RECHAZADO'] },
    requestedAt: { type: 'string', format: 'date-time' },
    resolvedAt: { type: 'string', format: 'date-time', nullable: true },
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

  @Get('pending-requests')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['items'],
      properties: { items: { type: 'array', items: pendingRequestSchema } },
    },
  })
  @ApiForbiddenResponse({ schema: errorSchema })
  async listPendingRequests(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.requireUsersManage(organizationId, request);
    return this.users.listPendingRequests();
  }

  @Post('pending-requests/:id/approve')
  @HttpCode(200)
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['userId'],
      properties: { userId: { type: 'string', format: 'uuid' } },
    },
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  async approvePendingRequest(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const requestId = uuidSchema.parse(rawId);
    const body = approvePendingUserRequestSchema.parse(rawBody);
    const scope = await this.requireUsersManage(organizationId, request);
    return this.users.approvePendingRequest({ requestId, body, scope });
  }

  @Post('pending-requests/:id/reject')
  @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: false } })
  @ApiForbiddenResponse({ schema: errorSchema })
  @ApiNotFoundResponse({ schema: errorSchema })
  @ApiConflictResponse({ schema: errorSchema })
  async rejectPendingRequest(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const requestId = uuidSchema.parse(rawId);
    rejectPendingUserRequestSchema.parse(rawBody);
    const scope = await this.requireUsersManage(organizationId, request);
    await this.users.rejectPendingRequest({ requestId, scope });
    return {};
  }
}
