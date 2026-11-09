import { describe, expect, it, vi } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

function responseFor(exception: unknown) {
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ correlationId: 'test-correlation' }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  new ApiExceptionFilter().catch(exception, host);
  return response;
}

describe('ApiExceptionFilter transient database errors', () => {
  it('returns a controlled 503 for pool connection timeouts', () => {
    const response = responseFor(new Error('timeout exceeded when trying to connect'));

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database is temporarily unavailable',
      correlationId: 'test-correlation',
    });
  });

  it('returns a controlled 503 for PostgreSQL connection failures', () => {
    const error = Object.assign(new Error('connection lost'), { code: '08006' });
    const response = responseFor(error);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DATABASE_UNAVAILABLE' }),
    );
  });

  it('keeps unrelated errors as internal server errors', () => {
    const response = responseFor(new Error('unexpected application error'));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'HTTP_500', message: 'Internal server error' }),
    );
  });
});
