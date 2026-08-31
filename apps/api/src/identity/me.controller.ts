import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { MeResponse } from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import type { AuthenticatedRequest } from '../types';
import { AccessService } from './access.service';

@ApiTags('identity')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly access: AccessService) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['id', 'subject', 'email', 'displayName', 'organizations'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        subject: { type: 'string' },
        email: { type: 'string', format: 'email' },
        displayName: { type: 'string' },
        organizations: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'code', 'name', 'roles', 'permissions'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              code: { type: 'string' },
              name: { type: 'string' },
              roles: { type: 'array', items: { type: 'string' } },
              permissions: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  })
  getMe(@Req() request: AuthenticatedRequest): Promise<MeResponse> {
    const claims = request.auth;
    const displayName =
      (typeof claims.name === 'string' ? claims.name : undefined) ??
      (typeof claims.preferred_username === 'string' ? claims.preferred_username : undefined);
    return this.access.getProfile(claims.sub, {
      ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
      ...(displayName ? { displayName } : {}),
    });
  }
}
