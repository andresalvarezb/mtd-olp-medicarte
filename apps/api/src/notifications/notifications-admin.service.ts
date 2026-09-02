import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  notificationRecipientRequestSchema,
  notificationResponseSchema,
  notificationStatusSchema,
  notificationTypeSchema,
  type NotificationResponse,
  notificationSenderRequestSchema,
  notificationSenderResponseSchema,
  notificationRecipientOrganizations,
} from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';

type Database = ReturnType<typeof createDatabase>;

type NotificationRow = {
  id: string;
  notification_type: string;
  recipient_organization_id: string | null;
  item_id: string | null;
  period: string | null;
  status: string;
  attempts: number;
  subject: string;
  recipients: unknown;
  template_version: number;
  gmail_message_id: string | null;
  last_error: string | null;
  created_at: Date;
  sent_at: Date | null;
  sender_email: string | null;
};

type RecipientRow = {
  id: string;
  notification_type: string;
  organization_id: string;
  email: string;
  active: boolean;
  created_at: Date;
};

function parseUuid(value: string, field: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException({
      code: 'INVALID_IDENTIFIER',
      message: `${field} must be a UUID`,
    });
  }
  return value;
}

function toNotificationResponse(row: NotificationRow): NotificationResponse {
  const recipients = Array.isArray(row.recipients)
    ? row.recipients.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return notificationResponseSchema.parse({
    id: row.id,
    notificationType: notificationTypeSchema.parse(row.notification_type),
    recipientOrganizationId: row.recipient_organization_id,
    itemId: row.item_id,
    period: row.period,
    status: notificationStatusSchema.parse(row.status),
    attempts: row.attempts,
    subject: row.subject,
    recipients,
    templateVersion: row.template_version,
    gmailMessageId: row.gmail_message_id,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    sentAt: row.sent_at?.toISOString() ?? null,
    senderEmail: row.sender_email,
  });
}

/**
 * Fase 4 (SPEC-004/DEC-005): bandeja administrativa de notificaciones,
 * reintento de fallos y administración de destinatarios parametrizables.
 * Todas las mutaciones quedan auditadas y protegidas por permiso
 * administrativo en el controller.
 */
@Injectable()
export class NotificationsAdminService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async getSender(): Promise<unknown> {
    const result = await this.database.pool.query<{
      sender_email: string | null;
      updated_at: Date | null;
    }>('select sender_email, updated_at from notification_email_settings where id = 1');
    return notificationSenderResponseSchema.parse({
      email: result.rows[0]?.sender_email ?? null,
      updatedAt: result.rows[0]?.updated_at?.toISOString() ?? null,
    });
  }

  async setSender(input: { body: unknown; scope: Scope }): Promise<unknown> {
    const body = notificationSenderRequestSchema.parse(input.body);
    const email = body.email.toLowerCase();
    await this.database.pool.query(
      `insert into notification_email_settings (id, sender_email, updated_by, updated_at)
       values (1, $1, $2, now())
       on conflict (id) do update set sender_email = excluded.sender_email,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [email, input.scope.userId],
    );
    await this.database.pool.query(
      `insert into audit_events
       (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
       values ('USER', $1, $2, 'NOTIFICATION_SENDER_SET', 'notification_email_settings', '1', $3::jsonb, $4, $5, 'SUCCESS')`,
      [
        input.scope.userId,
        input.scope.organizationId,
        JSON.stringify({ email }),
        input.scope.correlationId,
        input.scope.correlationId,
      ],
    );
    return this.getSender();
  }

  async list(input: {
    status?: string;
    notificationType?: string;
    cursor?: string;
    limit: number;
    scope: Scope;
  }): Promise<{ items: NotificationResponse[]; nextCursor: string | null }> {
    const status = input.status ? notificationStatusSchema.parse(input.status) : undefined;
    const notificationType = input.notificationType
      ? notificationTypeSchema.parse(input.notificationType)
      : undefined;
    let cursorDate: Date | undefined;
    let cursorId: string | undefined;
    if (input.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as {
          createdAt?: unknown;
          id?: unknown;
        };
        if (
          typeof decoded.createdAt !== 'string' ||
          Number.isNaN(Date.parse(decoded.createdAt)) ||
          typeof decoded.id !== 'string'
        )
          throw new Error('invalid');
        cursorDate = new Date(decoded.createdAt);
        cursorId = parseUuid(decoded.id, 'cursor.id');
      } catch {
        throw new BadRequestException({
          code: 'INVALID_CURSOR',
          message: 'Invalid pagination cursor',
        });
      }
    }
    const values: unknown[] = [];
    const conditions: string[] = [];
    if (status) {
      values.push(status);
      conditions.push(`n.status = $${values.length}`);
    }
    if (notificationType) {
      values.push(notificationType);
      conditions.push(`n.notification_type = $${values.length}`);
    }
    if (cursorDate && cursorId) {
      values.push(cursorDate);
      values.push(cursorId);
      conditions.push(
        `(n.created_at < $${values.length - 1} or (n.created_at = $${values.length - 1} and n.id < $${values.length}))`,
      );
    }
    values.push(input.limit + 1);
    const result = await this.database.pool.query<NotificationRow>(
      `select n.id, n.notification_type, n.recipient_organization_id, n.item_id, n.period,
              n.status, n.attempts, n.subject, n.recipients, n.template_version,
              n.gmail_message_id, n.last_error, n.created_at, n.sent_at, n.sender_email
       from notifications n
       ${conditions.length > 0 ? `where ${conditions.join(' and ')}` : ''}
       order by n.created_at desc, n.id desc
       limit $${values.length}`,
      values,
    );
    const hasNext = result.rows.length > input.limit;
    const rows = hasNext ? result.rows.slice(0, input.limit) : result.rows;
    const items = rows.map(toNotificationResponse);
    const last = rows.at(-1);
    const nextCursor =
      hasNext && last
        ? Buffer.from(
            JSON.stringify({ createdAt: last.created_at.toISOString(), id: last.id }),
            'utf8',
          ).toString('base64url')
        : null;
    return { items, nextCursor };
  }

  async retry(input: {
    notificationId: string;
    idempotencyKey: string;
    scope: Scope;
  }): Promise<{ notificationId: string; status: 'QUEUED' }> {
    const notificationId = parseUuid(input.notificationId, 'notificationId');
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const notification = await client.query<{
        id: string;
        status: string;
        attempts: number;
        payload: unknown;
      }>('select id, status, attempts, payload from notifications where id = $1 for update', [
        notificationId,
      ]);
      const row = notification.rows[0];
      if (!row) {
        throw new NotFoundException({
          code: 'NOTIFICATION_NOT_FOUND',
          message: 'Notification not found',
        });
      }
      if (row.status === 'SENT') {
        throw new ConflictException({
          code: 'NOTIFICATION_ALREADY_SENT',
          message: 'La notificación ya fue enviada.',
        });
      }
      const requestHash = createHash('sha256')
        .update(`${notificationId}:${row.attempts}`)
        .digest('hex');
      await client.query(
        'delete from idempotency_records where scope = $1 and key = $2 and expires_at <= now()',
        [`${this.retryScope}:${input.scope.organizationId}`, input.idempotencyKey],
      );
      const existing = await client.query<{ request_hash: string; response: unknown }>(
        'select request_hash, response from idempotency_records where scope = $1 and key = $2',
        [`${this.retryScope}:${input.scope.organizationId}`, input.idempotencyKey],
      );
      const previous = existing.rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'Idempotency key reused with another payload',
          });
        }
        await client.query('commit');
        return { notificationId, status: 'QUEUED' };
      }

      const retryKey = createHash('sha256')
        .update(`notification-retry:${notificationId}:${row.attempts}:${input.idempotencyKey}`)
        .digest('hex')
        .slice(0, 200);
      const payloadRecord = (row.payload ?? {}) as Record<string, unknown>;
      const eventId = randomUUID();
      const payload = {
        ...payloadRecord,
        eventId,
        correlationId: input.scope.correlationId,
        idempotencyKey:
          typeof payloadRecord.idempotencyKey === 'string'
            ? payloadRecord.idempotencyKey
            : retryKey,
      };
      await client.query(
        `insert into outbox_events
           (id, event_type, version, payload, correlation_id, organization_id, idempotency_key)
         values ($1, 'notification.email', 1, $2::jsonb, $3, $4, $5)
         on conflict (idempotency_key) do nothing`,
        [
          eventId,
          JSON.stringify(payload),
          input.scope.correlationId,
          input.scope.organizationId,
          retryKey,
        ],
      );
      await client.query(
        `update notifications set status = 'PENDING' where id = $1 and status = 'FAILED'`,
        [notificationId],
      );
      await client.query(
        `insert into audit_events
           (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
         values ('USER', $1, $2, 'NOTIFICATION_RETRY_REQUESTED', 'notification', $3, $4::jsonb, $5, $6, 'SUCCESS')`,
        [
          input.scope.userId,
          input.scope.organizationId,
          notificationId,
          JSON.stringify({ attempts: row.attempts, outboxEventId: eventId }),
          input.scope.correlationId,
          input.scope.correlationId,
        ],
      );
      await client.query(
        `insert into idempotency_records (scope, key, request_hash, status_code, response, expires_at)
         values ($1, $2, $3, 202, $4::jsonb, now() + interval '24 hours')`,
        [
          `${this.retryScope}:${input.scope.organizationId}`,
          input.idempotencyKey,
          requestHash,
          JSON.stringify({ notificationId, status: 'QUEUED' }),
        ],
      );
      await client.query('commit');
      return { notificationId, status: 'QUEUED' };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private readonly retryScope = 'notifications.retry';

  async listRecipients(input: { notificationType?: string; scope: Scope }): Promise<unknown> {
    const notificationType = input.notificationType
      ? notificationTypeSchema.parse(input.notificationType)
      : undefined;
    const values: unknown[] = [];
    let where = '';
    if (notificationType) {
      values.push(notificationType);
      where = `where notification_type = $1`;
    }
    const result = await this.database.pool.query<RecipientRow>(
      `select id, notification_type, organization_id, email, active, created_at
       from notification_recipients ${where} order by notification_type, email`,
      values,
    );
    return result.rows.map((row) => ({
      id: row.id,
      notificationType: notificationTypeSchema.parse(row.notification_type),
      organizationId: row.organization_id,
      email: row.email,
      active: row.active,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async createRecipient(input: { body: unknown; scope: Scope }): Promise<unknown> {
    const body = notificationRecipientRequestSchema.parse(input.body);
    const organization = await this.database.pool.query<{ code: string }>(
      'select code from organizations where id = $1 and active = true',
      [body.organizationId],
    );
    const organizationCode = organization.rows[0]?.code;
    if (
      !organizationCode ||
      !notificationRecipientOrganizations[body.notificationType].includes(organizationCode)
    ) {
      throw new BadRequestException({
        code: 'RECIPIENT_ORGANIZATION_NOT_ALLOWED',
        message: 'El tipo de notificación no admite esa organización destinataria.',
      });
    }
    if (!input.scope.isFoundationAdmin && body.organizationId !== input.scope.organizationId) {
      throw new NotFoundException({
        code: 'NOTIFICATION_RECIPIENT_NOT_FOUND',
        message: 'Organization not found',
      });
    }
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query<{ id: string }>(
        `insert into notification_recipients (notification_type, organization_id, email, created_by)
         values ($1, $2, $3, $4)
         on conflict (notification_type, organization_id, email)
         do update set active = true, updated_at = now()
         returning id`,
        [body.notificationType, body.organizationId, body.email.toLowerCase(), input.scope.userId],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('Notification recipient was not created');
      await client.query(
        `insert into audit_events
           (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
         values ('USER', $1, $2, 'NOTIFICATION_RECIPIENT_SET', 'notification_recipient', $3, $4::jsonb, $5, $6, 'SUCCESS')`,
        [
          input.scope.userId,
          input.scope.organizationId,
          id,
          JSON.stringify({
            notificationType: body.notificationType,
            organizationId: body.organizationId,
            email: body.email.toLowerCase(),
          }),
          input.scope.correlationId,
          input.scope.correlationId,
        ],
      );
      await client.query('commit');
      return { id, status: 'ACTIVE' };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async deactivateRecipient(input: {
    recipientId: string;
    scope: Scope;
  }): Promise<{ id: string; status: 'INACTIVE' }> {
    const recipientId = parseUuid(input.recipientId, 'recipientId');
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const updated = await client.query<{ id: string }>(
        `update notification_recipients set active = false, updated_at = now()
         where id = $1 and ($2::boolean = true or organization_id = $3) returning id`,
        [recipientId, input.scope.isFoundationAdmin, input.scope.organizationId],
      );
      const id = updated.rows[0]?.id;
      if (!id) {
        throw new NotFoundException({
          code: 'NOTIFICATION_RECIPIENT_NOT_FOUND',
          message: 'Notification recipient not found',
        });
      }
      await client.query(
        `insert into audit_events
           (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
         values ('USER', $1, $2, 'NOTIFICATION_RECIPIENT_REMOVED', 'notification_recipient', $3, null, $4, $5, 'SUCCESS')`,
        [
          input.scope.userId,
          input.scope.organizationId,
          id,
          input.scope.correlationId,
          input.scope.correlationId,
        ],
      );
      await client.query('commit');
      return { id, status: 'INACTIVE' };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
