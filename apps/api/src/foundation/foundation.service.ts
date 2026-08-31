import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { idempotencyRecords, auditEvents, outboxEvents } from '@authorization/database';
import type { createDatabase } from '@authorization/database';
import { and, eq, sql } from 'drizzle-orm';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;

@Injectable()
export class FoundationService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async createEvent(input: {
    message: string;
    idempotencyKey: string;
    correlationId: string;
    userId: string;
    organizationId: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ eventId: string; status: 'ACEPTADO' }> {
    const scope = `foundation.event.v1:${input.organizationId}`;
    const requestHash = createHash('sha256').update(input.message).digest('hex');
    const outboxIdempotencyKey = createHash('sha256')
      .update(`${input.organizationId}:${input.idempotencyKey}`)
      .digest('hex');

    return this.database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${scope}:${input.idempotencyKey}`}))`,
      );
      const existing = await transaction.query.idempotencyRecords.findFirst({
        where: and(
          eq(idempotencyRecords.scope, scope),
          eq(idempotencyRecords.key, input.idempotencyKey),
        ),
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'Idempotency key reused with another payload',
          });
        }
        return existing.response as { eventId: string; status: 'ACEPTADO' };
      }

      const eventId = randomUUID();
      const response = { eventId, status: 'ACEPTADO' as const };
      const payload = {
        eventId,
        message: input.message,
        correlationId: input.correlationId,
        idempotencyKey: outboxIdempotencyKey,
      };
      await transaction.insert(auditEvents).values({
        actorType: 'USER',
        actorId: input.userId,
        organizationId: input.organizationId,
        action: 'FOUNDATION_EVENT_CREATED',
        resourceType: 'foundation_event',
        resourceId: eventId,
        after: { message: input.message },
        correlationId: input.correlationId,
        requestId: input.correlationId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        result: 'SUCCESS',
      });
      await transaction.insert(outboxEvents).values({
        id: eventId,
        eventType: 'foundation.event',
        version: 1,
        payload,
        correlationId: input.correlationId,
        organizationId: input.organizationId,
        idempotencyKey: outboxIdempotencyKey,
      });
      await transaction.insert(idempotencyRecords).values({
        scope,
        key: input.idempotencyKey,
        requestHash,
        statusCode: 202,
        response,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      return response;
    });
  }

  async listFailedJobs(input: {
    organizationId: string;
    userId: string;
    correlationId: string;
  }): Promise<
    Array<{ id: string; eventType: string; attempts: number; lastError: string | null }>
  > {
    return this.database.db.transaction(async (transaction) => {
      const failures = await transaction
        .select({
          id: outboxEvents.id,
          eventType: outboxEvents.eventType,
          attempts: outboxEvents.attempts,
          lastError: outboxEvents.lastError,
        })
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.status, 'FALLIDO'),
            eq(outboxEvents.organizationId, input.organizationId),
          ),
        );
      await transaction.insert(auditEvents).values({
        actorType: 'USER',
        actorId: input.userId,
        organizationId: input.organizationId,
        action: 'DEAD_LETTER_JOBS_READ',
        resourceType: 'outbox_event',
        resourceId: input.organizationId,
        correlationId: input.correlationId,
        requestId: input.correlationId,
        result: 'SUCCESS',
      });
      return failures;
    });
  }
}
