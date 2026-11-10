import { describe, expect, it, vi } from 'vitest';
import type { RealtimeRequestTrace } from '@/components/realtime/realtime-context';
import { listAuthorizationQuery } from './authorization-query-api';
import { apiRequest } from './api-client';

vi.mock('./api-client', () => ({
  apiRequest: vi.fn(() => Promise.resolve({})),
}));

describe('authorization query request cancellation', () => {
  it('transmits the AbortSignal to the HTTP client', () => {
    vi.mocked(apiRequest).mockClear();

    const controller = new AbortController();

    void listAuthorizationQuery(
      'organization-1',
      { patient: '123', page: 2, limit: 10 },
      controller.signal,
    );

    expect(apiRequest).toHaveBeenCalledWith(
      '/authorization-query?patient=123&page=2&limit=10',
      {
        organizationId: 'organization-1',
        signal: controller.signal,
      },
    );
  });

  it('preserves calls without a cancellation signal', () => {
    vi.mocked(apiRequest).mockClear();

    void listAuthorizationQuery(
      'organization-1',
      { page: 1, limit: 10 },
    );

    expect(apiRequest).toHaveBeenCalledWith(
      '/authorization-query?page=1&limit=10',
      { organizationId: 'organization-1' },
    );
  });

  it('forwards the trace from its realtime invalidation batch', () => {
    vi.mocked(apiRequest).mockClear();
    const trace: RealtimeRequestTrace = {
      batchIds: ['11111111-1111-4111-8111-111111111111'],
      eventIds: ['22222222-2222-4222-8222-222222222222'],
      correlationIds: ['33333333-3333-4333-8333-333333333333'],
      oldestOccurredAt: '2026-11-10T13:00:00.000Z',
    };

    void listAuthorizationQuery(
      'organization-1',
      { page: 1, limit: 10 },
      undefined,
      trace,
    );

    expect(apiRequest).toHaveBeenCalledWith(
      '/authorization-query?page=1&limit=10',
      { organizationId: 'organization-1', realtimeTrace: trace },
    );
  });
});
