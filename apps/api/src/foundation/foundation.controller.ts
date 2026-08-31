import { Body, Controller, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiHeader,
  ApiTags,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { Throttle } from '@nestjs/throttler';
import { idempotencyKeySchema } from '@authorization/contracts';
import { z } from 'zod';
import { AuthGuard } from '../common/auth.guard';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { FoundationService } from './foundation.service';

const requestSchema = z.object({ message: z.string().min(1).max(200) });
const errorSchema: SchemaObject = {
  type: 'object',
  required: ['code', 'message', 'correlationId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    fields: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
    correlationId: { type: 'string' },
  },
};

@ApiTags('foundation')
@ApiBearerAuth()
@Controller('foundation/events')
export class FoundationController {
  constructor(
    private readonly foundation: FoundationService,
    private readonly access: AccessService,
  ) {}

  @Post()
  @HttpCode(202)
  @Throttle({ default: { limit: 50, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['message'],
      properties: { message: { type: 'string', minLength: 1, maxLength: 200 } },
    },
  })
  @ApiAcceptedResponse({
    schema: {
      type: 'object',
      required: ['eventId', 'status'],
      properties: {
        eventId: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: ['ACEPTADO'] },
      },
    },
  })
  @ApiBadRequestResponse({ schema: errorSchema })
  @ApiForbiddenResponse({ schema: errorSchema })
  async create(
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ eventId: string; status: 'ACEPTADO' }> {
    const body = requestSchema.parse(rawBody);
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      'platform.foundation.execute',
    );
    return this.foundation.createEvent({
      message: body.message,
      idempotencyKey,
      correlationId: request.correlationId,
      userId: profile.id,
      organizationId: organizationId!,
      ...(request.ip ? { ipAddress: request.ip } : {}),
      ...(request.header('user-agent') ? { userAgent: request.header('user-agent')! } : {}),
    });
  }
}
