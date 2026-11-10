import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeTopic } from '@authorization/contracts';
import {
  createRealtimeInvalidationBatcher,
  parseSseBlock,
  type RealtimeRequestTrace,
} from './realtime-context';

describe('realtime SSE parser', () => {
  it('parses invalidate events', () => {
    expect(
      parseSseBlock('id: 1\nevent: invalidate\ndata: {"topics":["DASHBOARD"]}'),
    ).toEqual({
      event: 'invalidate',
      data: '{"topics":["DASHBOARD"]}',
    });
  });

  it('ignores heartbeat-only blocks', () => {
    expect(parseSseBlock(': heartbeat 123')).toBeNull();
  });
});

describe('realtime invalidation batching', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces repeated topics within one fixed one-second window', () => {
    const onFlush = vi.fn();
    const batcher = createRealtimeInvalidationBatcher(onFlush);

    batcher.invalidate(['AUTHORIZATIONS']);
    vi.advanceTimersByTime(300);
    batcher.invalidate(['AUTHORIZATIONS']);
    vi.advanceTimersByTime(300);
    batcher.invalidate(['AUTHORIZATIONS']);

    vi.advanceTimersByTime(399);
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith(
      ['AUTHORIZATIONS'],
      expect.objectContaining({ eventIds: [], correlationIds: [], oldestOccurredAt: null }),
    );
    batcher.cancel();
  });

  it('keeps valid event and source correlation IDs in the flushed batch', () => {
    const onFlush = vi.fn<(
      topics: readonly RealtimeTopic[],
      trace: RealtimeRequestTrace,
    ) => void>();
    const batcher = createRealtimeInvalidationBatcher(onFlush);

    batcher.invalidate(['AUTHORIZATIONS'], {
      eventId: '11111111-1111-4111-8111-111111111111',
      correlationId: '22222222-2222-4222-8222-222222222222',
      occurredAt: '2026-11-10T13:00:01.000Z',
    });
    batcher.invalidate(['AUTHORIZATIONS'], {
      eventId: '33333333-3333-4333-8333-333333333333',
      correlationId: '44444444-4444-4444-8444-444444444444',
      occurredAt: '2026-11-10T13:00:00.000Z',
    });
    vi.advanceTimersByTime(1_000);

    const trace = onFlush.mock.calls[0]?.[1];
    expect(trace).toBeDefined();
    if (!trace) throw new Error('Expected the invalidation batch trace');
    expect(trace.batchIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(trace.eventIds).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(trace.correlationIds).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '44444444-4444-4444-8444-444444444444',
    ]);
    expect(trace.oldestOccurredAt).toBe('2026-11-10T13:00:00.000Z');
    batcher.cancel();
  });

  it('flushes a later invalidation in the next window', () => {
    const onFlush = vi.fn();
    const batcher = createRealtimeInvalidationBatcher(onFlush);

    batcher.invalidate(['AUTHORIZATIONS']);
    vi.advanceTimersByTime(1_000);
    batcher.invalidate(['AUTHORIZATIONS']);
    vi.advanceTimersByTime(1_000);

    expect(onFlush).toHaveBeenCalledTimes(2);
    batcher.cancel();
  });
});
