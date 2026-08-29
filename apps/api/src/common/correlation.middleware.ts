import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function correlationMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const candidate = request.header('x-correlation-id');
  const correlationId = candidate && UUID_PATTERN.test(candidate) ? candidate : randomUUID();
  Object.assign(request, { correlationId });
  response.setHeader('x-correlation-id', correlationId);
  next();
}
