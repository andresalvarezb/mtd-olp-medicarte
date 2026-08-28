import * as Sentry from '@sentry/node';
import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import type { AuthenticatedRequest } from '../types';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<AuthenticatedRequest>();
    const response = context.getResponse<Response>();
    const status = exception instanceof ZodError
      ? HttpStatus.BAD_REQUEST
      : exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = exception instanceof ZodError
      ? 'Request validation failed'
      : typeof raw === 'object' && raw && 'message' in raw
      ? (Array.isArray(raw.message) ? raw.message.join(', ') : String(raw.message))
      : status === 500 ? 'Internal server error' : typeof raw === 'string' ? raw : 'Request failed';
    const code = exception instanceof ZodError
      ? 'VALIDATION_ERROR'
      : typeof raw === 'object' && raw && 'code' in raw ? String(raw.code) : `HTTP_${status}`;
    const fields = exception instanceof ZodError
      ? Object.fromEntries(exception.issues.map((issue) => [issue.path.join('.') || 'request', [issue.message]]))
      : undefined;

    if (status >= 500) {
      this.logger.error({ correlationId: request.correlationId, error: exception });
      Sentry.captureException(exception, { tags: { correlationId: request.correlationId } });
    }

    response.status(status).json({ code, message, ...(fields ? { fields } : {}), correlationId: request.correlationId });
  }
}
