import { Registry } from 'prom-client';
import { describe, expect, it, vi } from 'vitest';
import type { createDatabase } from '@authorization/database';
import type Redis from 'ioredis';
import { OperationsController } from './operations.controller';

function fixture(databaseQuery: () => Promise<unknown>, redisPing: () => Promise<string>) {
  const query = vi.fn(databaseQuery);
  const ping = vi.fn(redisPing);
  const database = { pool: { query } } as unknown as ReturnType<typeof createDatabase>;
  const redis = { ping } as unknown as Redis;
  return {
    controller: new OperationsController(database, redis, new Registry(), {} as never),
    database,
    ping,
    query,
    redis,
  };
}

describe('OperationsController.health', () => {
  it('checks Redis even when PostgreSQL is unavailable', async () => {
    const { controller, query, ping } = fixture(
      () => Promise.reject(new Error('database unavailable')),
      () => Promise.resolve('PONG'),
    );

    await expect(controller.health()).rejects.toMatchObject({
      response: {
        checks: { api: 'up', database: 'down', redis: 'up' },
      },
    });
    expect(query).toHaveBeenCalledWith('select 1');
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('checks PostgreSQL even when Redis is unavailable', async () => {
    const { controller, query, ping } = fixture(
      () => Promise.resolve({ rows: [{ '?column?': 1 }] }),
      () => Promise.reject(new Error('redis unavailable')),
    );

    await expect(controller.health()).rejects.toMatchObject({
      response: {
        checks: { api: 'up', database: 'up', redis: 'down' },
      },
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('reports both dependencies up only after both checks pass', async () => {
    const { controller } = fixture(
      () => Promise.resolve({ rows: [{ '?column?': 1 }] }),
      () => Promise.resolve('PONG'),
    );

    await expect(controller.health()).resolves.toEqual({
      status: 'ok',
      checks: { api: 'up', database: 'up', redis: 'up' },
    });
  });
});
