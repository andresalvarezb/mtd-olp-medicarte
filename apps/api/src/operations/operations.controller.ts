import { Controller, Get, Header, Headers, Inject, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { createDatabase } from '@authorization/database';
import type Redis from 'ioredis';
import { Gauge, Registry } from 'prom-client';
import { IMPORT_QUEUE } from '@authorization/contracts';
import { DATABASE, REDIS } from '../tokens';
import { AuthGuard } from '../common/auth.guard';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';

type Database = ReturnType<typeof createDatabase>;

@ApiTags('operations')
@Controller()
export class OperationsController {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly registry: Registry,
    private readonly access: AccessService,
  ) {}

  @Get('health')
  @SkipThrottle()
  @ApiOkResponse({ schema: { type: 'object', required: ['status', 'checks'], properties: { status: { type: 'string', enum: ['ok'] }, checks: { type: 'object', additionalProperties: { type: 'string' } } } } })
  async health(): Promise<{ status: string; checks: Record<string, string> }> {
    const checks: Record<string, string> = { api: 'up', database: 'down', redis: 'down' };
    try {
      await this.database.pool.query('select 1');
      checks.database = 'up';
      if ((await this.redis.ping()) === 'PONG') checks.redis = 'up';
    } catch {
      throw new ServiceUnavailableException({ code: 'DEPENDENCY_UNAVAILABLE', message: 'A required dependency is unavailable', checks });
    }
    return { status: 'ok', checks };
  }

  @Get('metrics')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: 'X-Organization-Id', required: true })
  @Header('Content-Type', Registry.PROMETHEUS_CONTENT_TYPE)
  async metrics(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<string> {
    await this.access.requirePermission(request.auth.sub, organizationId, 'platform.jobs.manage');
    const metric = this.registry.getSingleMetric('authorization_queue_jobs');
    if (metric instanceof Gauge) {
      const [waiting, active, failed, deadLetter, importWaiting, importActive, importFailed, importDeadLetter] = await Promise.all([
        this.redis.llen('bull:foundation:wait'),
        this.redis.llen('bull:foundation:active'),
        this.redis.zcard('bull:foundation:failed'),
        this.redis.llen('bull:foundation.dead-letter:wait'),
        this.redis.llen(`bull:${IMPORT_QUEUE}:wait`),
        this.redis.llen(`bull:${IMPORT_QUEUE}:active`),
        this.redis.zcard(`bull:${IMPORT_QUEUE}:failed`),
        this.redis.llen(`bull:${IMPORT_QUEUE}.dead-letter:wait`),
      ]);
      metric.set({ queue: 'foundation', state: 'waiting' }, waiting);
      metric.set({ queue: 'foundation', state: 'active' }, active);
      metric.set({ queue: 'foundation', state: 'failed' }, failed);
      metric.set({ queue: 'foundation.dead-letter', state: 'waiting' }, deadLetter);
      metric.set({ queue: IMPORT_QUEUE, state: 'waiting' }, importWaiting);
      metric.set({ queue: IMPORT_QUEUE, state: 'active' }, importActive);
      metric.set({ queue: IMPORT_QUEUE, state: 'failed' }, importFailed);
      metric.set({ queue: `${IMPORT_QUEUE}.dead-letter`, state: 'waiting' }, importDeadLetter);
    }
    return this.registry.metrics();
  }
}
