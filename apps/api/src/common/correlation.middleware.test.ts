import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { correlationMiddleware } from './correlation.middleware';

describe('correlationMiddleware', () => {
  it('keeps only valid UUID trace headers and echoes the request correlation ID', () => {
    const correlationId = '11111111-1111-4111-8111-111111111111';
    const eventId = '22222222-2222-4222-8222-222222222222';
    const sourceCorrelationId = '33333333-3333-4333-8333-333333333333';
    const headers: Record<string, string> = {
      'x-correlation-id': correlationId,
      'x-realtime-batch-ids': `${eventId},not-a-uuid`,
      'x-realtime-event-ids': `${eventId},not-a-uuid`,
      'x-realtime-correlation-ids': sourceCorrelationId,
      'x-realtime-occurred-at': '2026-11-10T13:00:00.000Z',
    };
    const request = {
      method: 'GET',
      originalUrl: '/api/v1/authorization-query?patient=not-logged',
      header: (name: string) => headers[name.toLowerCase()],
    } as unknown as Request;
    const responseEmitter = new EventEmitter();
    const setHeader = vi.fn();
    Object.assign(responseEmitter, { setHeader, statusCode: 200, writableFinished: true });
    const response = responseEmitter as unknown as Response;
    const next = vi.fn();

    correlationMiddleware(request, response, next);

    expect((request as Request & { correlationId: string }).correlationId).toBe(correlationId);
    expect((request as Request & { realtimeBatchIds: string[] }).realtimeBatchIds).toEqual([eventId]);
    expect((request as Request & { realtimeEventIds: string[] }).realtimeEventIds).toEqual([eventId]);
    expect((request as Request & { realtimeCorrelationIds: string[] }).realtimeCorrelationIds).toEqual([
      sourceCorrelationId,
    ]);
    expect((request as Request & { realtimeOccurredAt: string }).realtimeOccurredAt).toBe(
      '2026-11-10T13:00:00.000Z',
    );
    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', correlationId);
    expect(next).toHaveBeenCalledOnce();
  });

  it('replaces malformed request correlation IDs with a valid UUID', () => {
    const request = {
      method: 'GET',
      originalUrl: '/api/v1/health',
      header: (name: string) => (name === 'x-correlation-id' ? 'invalid' : undefined),
    } as unknown as Request;
    const responseEmitter = new EventEmitter();
    const setHeader = vi.fn();
    Object.assign(responseEmitter, { setHeader, statusCode: 200, writableFinished: true });

    correlationMiddleware(request, responseEmitter as unknown as Response, vi.fn());

    const generated = setHeader.mock.calls[0]?.[1] as string | undefined;
    expect(generated).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
