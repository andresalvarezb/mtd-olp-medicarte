import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_TRACE_IDS = 20;
const logger = new Logger('CorrelationMiddleware');

function uuidHeaderValues(request: Request, header: string): string[] {
  return (request.header(header) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => UUID_PATTERN.test(value))
    .slice(-MAX_TRACE_IDS);
}

function occurredAtHeader(request: Request): string | undefined {
  const value = request.header('x-realtime-occurred-at');
  if (!value || value.length > 40 || !ISO_DATETIME_PATTERN.test(value)) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

export function correlationMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const candidate = request.header('x-correlation-id');
  const correlationId = candidate && UUID_PATTERN.test(candidate) ? candidate : randomUUID();
  const realtimeBatchIds = uuidHeaderValues(request, 'x-realtime-batch-ids');
  const realtimeEventIds = uuidHeaderValues(request, 'x-realtime-event-ids');
  const realtimeCorrelationIds = uuidHeaderValues(request, 'x-realtime-correlation-ids');
  const realtimeOccurredAt = occurredAtHeader(request);
  Object.assign(request, {
    correlationId,
    realtimeBatchIds,
    realtimeEventIds,
    realtimeCorrelationIds,
    realtimeOccurredAt,
  });
  response.setHeader('x-correlation-id', correlationId);

  const pathname = (request.originalUrl.split('?')[0] ?? '').replace(/\/+$/, '');
  const isAuthorizationQueryList =
    request.method === 'GET' && pathname.endsWith('/api/v1/authorization-query');
  if (isAuthorizationQueryList) {
    const startedAt = performance.now();
    let recorded = false;
    const recordResponse = (clientClosed: boolean): void => {
      if (recorded) return;
      recorded = true;
      const durationMs = Math.round(performance.now() - startedAt);
      const realtimeElapsedMs = realtimeOccurredAt
        ? Math.max(0, Date.now() - Date.parse(realtimeOccurredAt))
        : null;
      logger.log(JSON.stringify({
        code: 'AUTHORIZATION_QUERY_HTTP',
        correlationId,
        realtimeBatchIds,
        realtimeEventIds,
        realtimeCorrelationIds,
        realtimeOccurredAt: realtimeOccurredAt ?? null,
        eventToResponseMs: clientClosed ? null : realtimeElapsedMs,
        eventToClientCloseMs: clientClosed ? realtimeElapsedMs : null,
        durationMs,
        statusCode: clientClosed ? null : response.statusCode,
        clientClosed,
      }));
    };

    response.on('finish', () => recordResponse(false));
    response.on('close', () => {
      if (!response.writableFinished) recordResponse(true);
    });
  }

  next();
}
