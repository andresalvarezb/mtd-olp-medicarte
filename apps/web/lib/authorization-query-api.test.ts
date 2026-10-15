import { describe, expect, it, vi } from 'vitest';
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
});
