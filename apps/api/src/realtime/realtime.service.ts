import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  REALTIME_REDIS_CHANNEL,
  realtimeInvalidationMessageSchema,
  type RealtimeInvalidationMessage,
} from '@authorization/contracts';
import Redis from 'ioredis';
import { REDIS } from '../tokens';

type RealtimeListener = (message: RealtimeInvalidationMessage) => void;

@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly subscriber: Redis;
  private readonly listeners = new Map<string, Set<RealtimeListener>>();

  constructor(@Inject(REDIS) redis: Redis) {
    this.subscriber = redis.duplicate({
      lazyConnect: false,
      maxRetriesPerRequest: null,
    });
  }

  async onModuleInit(): Promise<void> {
    this.subscriber.on('message', (channel, raw) => {
      if (channel !== REALTIME_REDIS_CHANNEL) return;

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw) as unknown;
      } catch {
        this.logger.warn('Ignoring malformed realtime JSON payload');
        return;
      }

      const parsed = realtimeInvalidationMessageSchema.safeParse(parsedJson);
      if (!parsed.success) {
        this.logger.warn('Ignoring invalid realtime payload');
        return;
      }

      const listeners = this.listeners.get(parsed.data.organizationId);
      if (!listeners?.size) return;

      for (const listener of listeners) listener(parsed.data);
    });

    this.subscriber.on('error', (error) => {
      this.logger.error(
        'Realtime Redis subscriber error',
        error instanceof Error ? error.stack : undefined,
      );
    });

    await this.subscriber.subscribe(REALTIME_REDIS_CHANNEL);
  }

  subscribe(organizationId: string, listener: RealtimeListener): () => void {
    const current = this.listeners.get(organizationId) ?? new Set<RealtimeListener>();
    current.add(listener);
    this.listeners.set(organizationId, current);

    return () => {
      const listeners = this.listeners.get(organizationId);
      if (!listeners) return;
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(organizationId);
    };
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.subscriber.unsubscribe(REALTIME_REDIS_CHANNEL);
    } finally {
      await this.subscriber.quit();
    }
  }
}
