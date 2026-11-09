import { beforeEach, describe, expect, it, vi } from 'vitest';

const poolState = vi.hoisted(() => ({
  listeners: new Map<string, (value: never) => void>(),
}));

vi.mock('pg', () => ({
  Pool: class {
    constructor() {}
    on(event: string, listener: (value: never) => void) {
      poolState.listeners.set(event, listener);
      return this;
    }
  },
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn(() => ({})),
}));

import { createDatabase } from './index';

describe('createDatabase', () => {
  beforeEach(() => {
    poolState.listeners.clear();
  });

  it('handles errors from checked-out PostgreSQL clients', () => {
    createDatabase('postgresql://synthetic');

    const onConnect = poolState.listeners.get('connect');
    expect(onConnect).toBeDefined();

    const client = { on: vi.fn() };
    onConnect?.(client as never);

    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(poolState.listeners.has('error')).toBe(true);
  });
});
