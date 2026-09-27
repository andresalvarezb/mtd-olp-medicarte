import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../common/auth.guard';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { RealtimeService } from './realtime.service';

@ApiTags('realtime')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('realtime')
@UseGuards(AuthGuard)
export class RealtimeController {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly access: AccessService,
  ) {}

  @Get('stream')
  async stream(
    @Headers('x-organization-id') organizationIdRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const organizationId = z.string().uuid().parse(organizationIdRaw);
    const profile = await this.access.getProfile(request.auth.sub);
    const organization = profile.organizations.find((candidate) => candidate.id === organizationId);

    if (!organization) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_REQUIRED',
        message: 'Organization is not available for this user',
      });
    }

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    response.write(
      `event: ready\ndata: ${JSON.stringify({
        organizationId,
        connectedAt: new Date().toISOString(),
      })}\n\n`,
    );

    const unsubscribe = this.realtime.subscribe(organizationId, (message) => {
      response.write(
        `id: ${message.eventId}\nevent: invalidate\ndata: ${JSON.stringify(message)}\n\n`,
      );
    });

    const heartbeat = setInterval(() => {
      response.write(`: heartbeat ${Date.now()}\n\n`);
    }, 15_000);

    let closed = false;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };

    request.on('close', cleanup);
    response.on('close', cleanup);
  }
}
