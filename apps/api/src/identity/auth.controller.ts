import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { changePasswordRequestSchema, loginRequestSchema } from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import type { AuthenticatedRequest } from '../types';
import { AuthService } from './auth.service';

const errorSchema = {
  type: 'object',
  required: ['code', 'message', 'correlationId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    correlationId: { type: 'string' },
  },
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  // Fuerza bruta: 20 intentos por minuto por combinación IP+username
  // (el límite global de 100 req/min/IP sigue además como techo por IP).
  @Throttle({
    default: {
      limit: 20,
      ttl: 60_000,
      getTracker: (request: { ip?: string; body?: { username?: unknown } }) => {
        const username =
          typeof request.body?.username === 'string' ? request.body.username.toLowerCase() : '';
        return `${request.ip ?? 'unknown-ip'}:${username}`;
      },
    },
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['accessToken', 'tokenType', 'expiresAt', 'mustChangePassword', 'user'],
      properties: {
        accessToken: { type: 'string' },
        tokenType: { type: 'string', enum: ['Bearer'] },
        expiresAt: { type: 'string', format: 'date-time' },
        mustChangePassword: { type: 'boolean' },
        user: {
          type: 'object',
          required: ['id', 'username', 'displayName'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            username: { type: 'string' },
            displayName: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ schema: errorSchema, description: 'INVALID_CREDENTIALS' })
  @ApiTooManyRequestsResponse({ schema: errorSchema })
  async login(@Body() rawBody: unknown, @Req() request: AuthenticatedRequest) {
    const body = loginRequestSchema.parse(rawBody);
    return this.auth.login({
      username: body.username,
      password: body.password,
      requestId: request.correlationId,
      ipAddress: request.ip ? String(request.ip).slice(0, 64) : null,
      userAgent: request.header('user-agent')?.slice(0, 400) ?? null,
    });
  }

  @Post('change-password')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiUnauthorizedResponse({ schema: errorSchema })
  @ApiBadRequestResponse({ schema: errorSchema })
  async changePassword(@Body() rawBody: unknown, @Req() request: AuthenticatedRequest) {
    const body = changePasswordRequestSchema.parse(rawBody);
    await this.auth.changePassword({
      userId: request.auth.sub,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      requestId: request.correlationId,
    });
  }
}
