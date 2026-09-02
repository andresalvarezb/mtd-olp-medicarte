import { createHash } from 'node:crypto';
import {
  notificationJobSchema,
  type NotificationJob,
  type NotificationType,
} from '@authorization/contracts';
import { currentBogotaDate, type GmailPort } from '@authorization/domain';
import type { createDatabase } from '@authorization/database';

type Database = ReturnType<typeof createDatabase>;

type TemplateRow = {
  subject_template: string;
  body_template: string;
  version: number;
};

type NotificationContent = {
  notificationType: NotificationType;
  /** Clave de idempotencia lógica: para tipos consolidados incluye el hash del conjunto. */
  idempotencyKey: string;
  recipientOrganizationId: string | null;
  itemId: string | null;
  period: string | null;
  itemSetHash: string | null;
  templateVersion: number;
  subject: string;
  body: string;
  recipients: string[];
  params: Record<string, unknown>;
};

export type NotificationProcessingResult = Readonly<{
  status: 'SENT' | 'SKIPPED' | 'DEDUPLICATED';
  notificationId: string | null;
  skipReason?: string;
}>;

export function renderTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = params[key];
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  });
}

function bogotaDayBounds(period: string): { from: string; to: string } {
  const day = new Date(`${period}T00:00:00Z`);
  const next = new Date(day.getTime() + 24 * 60 * 60 * 1000);
  // America/Bogota es UTC-5 todo el año: el día calendario inicia a las 05:00 UTC.
  const format = (instant: Date) => new Date(instant.getTime() - 5 * 60 * 60 * 1000).toISOString();
  return { from: format(day), to: format(next) };
}

/**
 * Fase 4 (SPEC-004/ADR-006): handler de outbox para Gmail. Persiste el
 * mensaje lógico con su idempotency key antes de enviar; un reintento del
 * mismo job no duplica correo. Gmail caído no revierte el negocio: el fallo
 * se registra, es reintentable y termina visible en la bandeja de fallos.
 */
export class NotificationProcessor {
  constructor(
    private readonly database: Database,
    private readonly gmail: GmailPort,
  ) {}

  async process(rawJob: NotificationJob): Promise<NotificationProcessingResult> {
    const job = notificationJobSchema.parse(rawJob);
    const content = await this.buildContent(job);
    if (!content) {
      return { status: 'SKIPPED', notificationId: null, skipReason: 'NO_CONTENT' };
    }
    const existing = await this.database.pool.query<{
      id: string;
      status: string;
    }>(
      `select id, status from notifications where idempotency_key = $1`,
      [content.idempotencyKey],
    );
    const previous = existing.rows[0];
    if (previous?.status === 'SENT') {
      return { status: 'DEDUPLICATED', notificationId: previous.id };
    }

    let notificationId: string;
    if (previous) {
      notificationId = previous.id;
      await this.database.pool.query(
        `update notifications
         set subject = $2, body = $3, recipients = $4::jsonb, params = $5::jsonb, template_version = $6
         where id = $1`,
        [
          notificationId,
          content.subject,
          content.body,
          JSON.stringify(content.recipients),
          JSON.stringify(content.params),
          content.templateVersion,
        ],
      );
    } else {
      const inserted = await this.database.pool.query<{ id: string }>(
        `insert into notifications
           (notification_type, recipient_organization_id, item_id, period, item_set_hash,
            template_version, subject, body, recipients, params, payload, status, correlation_id, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, 'PENDING', $12, $13)
         returning id`,
        [
          content.notificationType,
          content.recipientOrganizationId,
          content.itemId,
          content.period,
          content.itemSetHash,
          content.templateVersion,
          content.subject,
          content.body,
          JSON.stringify(content.recipients),
          JSON.stringify(content.params),
          JSON.stringify(job.payload),
          job.correlationId,
          content.idempotencyKey,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('Notification row was not created');
      notificationId = id;
    }

    if (content.recipients.length === 0) {
      await this.database.pool.query(
        `update notifications set status = 'SKIPPED', last_error = $2, attempts = attempts + 1 where id = $1`,
        [notificationId, 'No hay destinatarios activos configurados para esta notificación.'],
      );
      return { status: 'SKIPPED', notificationId, skipReason: 'NO_RECIPIENTS' };
    }

    let messageId: string;
    try {
      const result = await this.gmail.send({
        to: content.recipients,
        subject: content.subject,
        body: content.body,
      });
      messageId = result.messageId;
    } catch (error) {
      await this.database.pool.query(
        `update notifications
         set attempts = attempts + 1,
             last_error = $2
         where id = $1`,
        [notificationId, error instanceof Error ? error.message.slice(0, 500) : 'Gmail send failed'],
      );
      throw error;
    }

    await this.database.pool.query(
      `update notifications
       set status = 'SENT', gmail_message_id = $2, sent_at = now(), attempts = attempts + 1, last_error = null
       where id = $1`,
      [notificationId, messageId],
    );
    await this.auditSent(job, notificationId);
    return { status: 'SENT', notificationId };
  }

  private async auditSent(job: NotificationJob, notificationId: string): Promise<void> {
    const organizationCode = await this.database.pool.query<{ code: string }>(
      `select o.code from organizations o
       inner join notifications n on n.recipient_organization_id = o.id
       where n.id = $1`,
      [notificationId],
    );
    const code = organizationCode.rows[0]?.code;
    const action =
      code === 'OLP'
        ? 'OLP_NOTIFICATION_SENT'
        : code === 'MEDICARTE'
          ? 'MEDICARTE_NOTIFICATION_SENT'
          : code === 'COMPENSAR'
            ? 'EPS_NOTIFICATION_SENT'
            : 'NOTIFICATION_SENT';
    await this.database.pool.query(
      `insert into audit_events
         (actor_type, action, resource_type, resource_id, after, correlation_id, request_id, result)
       values ('SYSTEM', $1, 'notification', $2, $3::jsonb, $4, $5, 'SUCCESS')`,
      [
        action,
        notificationId,
        JSON.stringify({ notificationType: job.payload.notificationType }),
        job.correlationId,
        job.correlationId,
      ],
    );
  }

  private async buildContent(job: NotificationJob): Promise<NotificationContent | null> {
    const type = job.payload.notificationType;
    switch (type) {
      case 'AUTHORIZATION_READY_TO_DISPENSE':
        return this.buildReadyToDispense(job);
      case 'DISPENSATION_LOCATION_ASSIGNED':
      case 'DISPENSATION_LOCATION_CHANGED':
        return this.buildLocation(job, type);
      case 'EPS_DIRECTION_PENDING':
        return this.buildEpsPending(job);
      case 'EPS_TARIFF_ANNEX_REJECTED':
        return this.buildEpsTariffRejected(job);
      case 'DAILY_OPERATIONAL_REPORT':
        return this.buildDailyReport(job);
      default:
        return null;
    }
  }

  private async loadTemplate(type: NotificationType): Promise<TemplateRow | null> {
    const result = await this.database.pool.query<TemplateRow>(
      `select subject_template, body_template, version
       from notification_templates
       where notification_type = $1 and active = true
       order by version desc limit 1`,
      [type],
    );
    return result.rows[0] ?? null;
  }

  private async loadRecipients(
    type: NotificationType,
    organizationId: string,
  ): Promise<string[]> {
    const result = await this.database.pool.query<{ email: string }>(
      `select email from notification_recipients
       where notification_type = $1 and organization_id = $2 and active = true
       order by email`,
      [type, organizationId],
    );
    return result.rows.map((row) => row.email);
  }

  private async resolveOrganizationId(code: string): Promise<string | null> {
    const result = await this.database.pool.query<{ id: string }>(
      'select id from organizations where code = $1',
      [code],
    );
    return result.rows[0]?.id ?? null;
  }

  private async buildReadyToDispense(job: NotificationJob): Promise<NotificationContent | null> {
    const itemId = job.payload.itemId;
    const recipientOrganizationId = job.payload.recipientOrganizationId;
    if (!itemId || !recipientOrganizationId) return null;
    const template = await this.loadTemplate('AUTHORIZATION_READY_TO_DISPENSE');
    if (!template) return null;
    const item = await this.database.pool.query<{
      authorization_key: string;
      codigo_medicamento: string;
      coverage_type: string;
      version: number;
    }>(
      `select authorization_key, codigo_medicamento, coverage_type, version
       from authorization_items where id = $1`,
      [itemId],
    );
    const row = item.rows[0];
    if (!row) return null;
    const recipients = await this.loadRecipients('AUTHORIZATION_READY_TO_DISPENSE', recipientOrganizationId);
    const params = {
      authorizationKey: row.authorization_key,
      codigoMedicamento: row.codigo_medicamento,
      coverageType: row.coverage_type,
      itemId,
      readinessVersion: row.version,
    };
    return {
      notificationType: 'AUTHORIZATION_READY_TO_DISPENSE',
      idempotencyKey: job.payload.idempotencyKey,
      recipientOrganizationId,
      itemId,
      period: null,
      itemSetHash: null,
      templateVersion: template.version,
      subject: renderTemplate(template.subject_template, params),
      body: renderTemplate(template.body_template, params),
      recipients,
      params,
    };
  }

  private async buildLocation(
    job: NotificationJob,
    type: 'DISPENSATION_LOCATION_ASSIGNED' | 'DISPENSATION_LOCATION_CHANGED',
  ): Promise<NotificationContent | null> {
    const itemId = job.payload.itemId;
    if (!itemId) return null;
    const recipientOrganizationId =
      job.payload.recipientOrganizationId ?? (await this.resolveOrganizationId('OLP'));
    if (!recipientOrganizationId) return null;
    const template = await this.loadTemplate(type);
    if (!template) return null;
    const item = await this.database.pool.query<{
      authorization_key: string;
      codigo_medicamento: string;
      lugar_dispensacion: string | null;
      operational_version: number;
      updated_at: Date;
    }>(
      `select authorization_key, codigo_medicamento, lugar_dispensacion, operational_version, updated_at
       from authorization_items where id = $1`,
      [itemId],
    );
    const row = item.rows[0];
    if (!row?.lugar_dispensacion) return null;
    const recipients = await this.loadRecipients(type, recipientOrganizationId);
    const params = {
      authorizationKey: row.authorization_key,
      codigoMedicamento: row.codigo_medicamento,
      lugarDispensacion: row.lugar_dispensacion,
      fieldVersion: row.operational_version,
      changedAt: row.updated_at.toISOString(),
    };
    return {
      notificationType: type,
      idempotencyKey: job.payload.idempotencyKey,
      recipientOrganizationId,
      itemId,
      period: null,
      itemSetHash: null,
      templateVersion: template.version,
      subject: renderTemplate(template.subject_template, params),
      body: renderTemplate(template.body_template, params),
      recipients,
      params,
    };
  }

  private async buildEpsPending(job: NotificationJob): Promise<NotificationContent | null> {
    const period = job.payload.period ?? currentBogotaDate();
    const recipientOrganizationId =
      job.payload.recipientOrganizationId ?? (await this.resolveOrganizationId('COMPENSAR'));
    if (!recipientOrganizationId) return null;
    const template = await this.loadTemplate('EPS_DIRECTION_PENDING');
    if (!template) return null;
    const pending = await this.database.pool.query<{ authorization_key: string }>(
      `select authorization_key from authorization_items
       where coverage_type = 'NO_PBS' and enablement_status = 'ENABLED'
         and direction_status = 'PENDING'
       order by authorization_key`,
    );
    const keys = pending.rows.map((row) => row.authorization_key);
    const itemSetHash = createHash('sha256')
      .update(keys.join('\n'))
      .digest('hex');
    const recipients = await this.loadRecipients('EPS_DIRECTION_PENDING', recipientOrganizationId);
    const itemList = keys
      .slice(0, 30)
      .map((key) => `\n- ${key}`)
      .join('');
    if (keys.length === 0) return null;
    const params = {
      period,
      itemList: `\nAutorizaciones pendientes (${keys.length}):${itemList}`,
      pendingCount: keys.length,
    };
    return {
      notificationType: 'EPS_DIRECTION_PENDING',
      idempotencyKey: `eps-pending:${recipientOrganizationId}:${period}:${itemSetHash}`.slice(0, 200),
      recipientOrganizationId,
      itemId: null,
      period,
      itemSetHash,
      templateVersion: template.version,
      subject: renderTemplate(template.subject_template, params),
      body: renderTemplate(template.body_template, params),
      recipients,
      params,
    };
  }

  private async buildEpsTariffRejected(job: NotificationJob): Promise<NotificationContent | null> {
    const batchId = job.payload.batchId;
    const recipientOrganizationId =
      job.payload.recipientOrganizationId ?? (await this.resolveOrganizationId('COMPENSAR'));
    if (!batchId || !recipientOrganizationId) return null;
    const template = await this.loadTemplate('EPS_TARIFF_ANNEX_REJECTED');
    if (!template) return null;
    const rejected = await this.database.pool.query<{
      numero_autorizacion: string;
      codigo_medicamento: string;
      numero_documento: string | null;
    }>(
      `select i.numero_autorizacion, i.codigo_medicamento,
              i.source_data->>'NUM_DOCUMENTO' as numero_documento
       from import_rows r inner join authorization_items i on i.id = r.authorization_item_id
       where r.import_batch_id = $1 and r.result_code = 'PRODUCT_NOT_IN_TARIFF_ANNEX'
       order by r.row_number`,
      [batchId],
    );
    if (rejected.rows.length === 0) return null;
    const itemList = rejected.rows
      .map((row) => `\n- Autorización: ${row.numero_autorizacion}; Código: ${row.codigo_medicamento}; Paciente: ${row.numero_documento ?? 'N/D'}`)
      .join('');
    const keys = rejected.rows.map((row) => `${row.numero_autorizacion}:${row.codigo_medicamento}`);
    const itemSetHash = createHash('sha256').update(keys.join('\n')).digest('hex');
    const recipients = await this.loadRecipients('EPS_TARIFF_ANNEX_REJECTED', recipientOrganizationId);
    const params = { batchId, itemList, rejectedCount: rejected.rows.length };
    return {
      notificationType: 'EPS_TARIFF_ANNEX_REJECTED',
      idempotencyKey: `eps-tariff:${batchId}`,
      recipientOrganizationId,
      itemId: null,
      period: null,
      itemSetHash,
      templateVersion: template.version,
      subject: renderTemplate(template.subject_template, params),
      body: renderTemplate(template.body_template, params),
      recipients,
      params,
    };
  }

  private async buildDailyReport(job: NotificationJob): Promise<NotificationContent | null> {
    const period = job.payload.period ?? currentBogotaDate();
    const recipientOrganizationId = job.payload.recipientOrganizationId;
    if (!recipientOrganizationId) return null;
    const template = await this.loadTemplate('DAILY_OPERATIONAL_REPORT');
    if (!template) return null;
    const organization = await this.database.pool.query<{ code: string; name: string }>(
      'select code, name from organizations where id = $1',
      [recipientOrganizationId],
    );
    const organizationRow = organization.rows[0];
    if (!organizationRow) return null;
    const isMtd = organizationRow.code === 'MTD';
    const { from, to } = bogotaDayBounds(period);
    const created = await this.database.pool.query<{ count: string }>(
      `select count(*)::text as count
       from authorization_items i
       where i.created_at >= $1 and i.created_at < $2
         and ($3::boolean = true or exists (
           select 1 from authorization_item_organizations aio
           where aio.authorization_item_id = i.id and aio.organization_id = $4))`,
      [from, to, isMtd, recipientOrganizationId],
    );
    const ready = await this.database.pool.query<{ count: string }>(
      `select count(*)::text as count
       from audit_events
       where action = 'AUTHORIZATION_READY_TO_DISPENSE'
         and occurred_at >= $1 and occurred_at < $2
         and ($3::boolean = true or organization_id = $4)`,
      [from, to, isMtd, recipientOrganizationId],
    );
    const locationChanges = await this.database.pool.query<{ count: string }>(
      `select count(*)::text as count
       from operational_field_changes
       where created_at >= $1 and created_at < $2
         and ($3::boolean = true or organization_id = $4)`,
      [from, to, isMtd, recipientOrganizationId],
    );
    const bulkBatches = await this.database.pool.query<{ count: string }>(
      `select count(*)::text as count
       from bulk_update_batches
       where completed_at >= $1 and completed_at < $2
         and ($3::boolean = true or organization_id = $4)`,
      [from, to, isMtd, recipientOrganizationId],
    );
    const summaryValues = {
      createdCount: Number(created.rows[0]?.count ?? '0'),
      readyCount: Number(ready.rows[0]?.count ?? '0'),
      locationChangesCount: Number(locationChanges.rows[0]?.count ?? '0'),
      bulkBatchesCount: Number(bulkBatches.rows[0]?.count ?? '0'),
    };
    const summary = [
      `\nAutorizaciones creadas: ${summaryValues.createdCount}`,
      `\nEntradas a READY_TO_DISPENSE: ${summaryValues.readyCount}`,
      `\nCambios de lugar de dispensacion: ${summaryValues.locationChangesCount}`,
      `\nLotes masivos completados: ${summaryValues.bulkBatchesCount}`,
    ].join('');
    const itemSetHash = createHash('sha256')
      .update(JSON.stringify({ organization: organizationRow.code, period, summaryValues }))
      .digest('hex');
    const recipients = await this.loadRecipients('DAILY_OPERATIONAL_REPORT', recipientOrganizationId);
    const params = { period, organizationName: organizationRow.name, summary };
    return {
      notificationType: 'DAILY_OPERATIONAL_REPORT',
      idempotencyKey: `daily:${organizationRow.code}:${period}:${itemSetHash}`.slice(0, 200),
      recipientOrganizationId,
      itemId: null,
      period,
      itemSetHash,
      templateVersion: template.version,
      subject: renderTemplate(template.subject_template, params),
      body: renderTemplate(template.body_template, params),
      recipients,
      params,
    };
  }
}

export function dailyReportIdempotencyKey(
  organizationCode: string,
  period: string,
): string {
  // SPEC-004: DAILY_REPORT + recipient_group + local_date (+ item_set_hash que
  // resuelve el handler al momento del envío).
  return `daily-report:${organizationCode}:${period}`.slice(0, 200);
}
