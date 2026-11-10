import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeRequestTrace } from '@/components/realtime/realtime-context';
import { apiRequest } from './api-client';

vi.mock('./auth', () => ({
  SESSION_EXPIRED_EVENT: 'session-expired',
  clearSession: vi.fn(),
  getAccessToken: vi.fn(() => null),
}));
vi.mock('./config', () => ({ API_BASE_URL: 'https://api.example.test/api/v1' }));

describe('apiRequest correlation headers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends a valid request ID and the realtime trace metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const trace: RealtimeRequestTrace = {
      batchIds: ['11111111-1111-4111-8111-111111111111'],
      eventIds: ['22222222-2222-4222-8222-222222222222'],
      correlationIds: ['33333333-3333-4333-8333-333333333333'],
      oldestOccurredAt: '2026-11-10T13:00:00.000Z',
    };

    await apiRequest('/authorization-query?page=1&limit=10', {
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      realtimeTrace: trace,
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = request.headers as Record<string, string>;
    expect(headers['X-Correlation-Id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(headers['X-Realtime-Batch-Ids']).toBe(trace.batchIds.join(','));
    expect(headers['X-Realtime-Event-Ids']).toBe(trace.eventIds.join(','));
    expect(headers['X-Realtime-Correlation-Ids']).toBe(trace.correlationIds.join(','));
    expect(headers['X-Realtime-Occurred-At']).toBe(trace.oldestOccurredAt);
  });
});
