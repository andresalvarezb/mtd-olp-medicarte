import {
  mipresRecheckJobSchema,
  type MipresRecheckJob,
  type MipresRecheckPayload,
} from '@authorization/contracts';
import {
  currentBogotaDate,
  deriveOperationStatus,
  evaluateMipresVigencia,
  MIPRES_VIGENCIA_RULE_VERSION,
  type MipresPort,
} from '@authorization/domain';
import type { createDatabase } from '@authorization/database';
import { randomUUID } from 'node:crypto';
import { MipresNotConfiguredError, MipresQueryError } from './mipres-token-provider';

type Database = ReturnType<typeof createDatabase>;

type ItemRow = {
  id: string;
  no_prescripcion: string;
  enablement_status: string;
  coverage_type: string;
  direction_status: string | null;
  operation_status: string | null;
  tariff_membership_status: string;
  fecha_final_vigencia: string | null;
};

export type MipresProcessingResult = Readonly<{
  itemId: string;
  outcome: 'CONFIRMED' | 'PENDING' | 'QUERY_ERROR' | 'SKIPPED' | 'DEDUPLICATED';
  directionStatus: 'PENDING' | 'CONFIRMED' | 'QUERY_ERROR' | null;
  directionCount: number;
  hasCurrentDirection: boolean | null;
  httpStatus: number | null;
  skipReason?: string;
}>;

  /**
   * Fase 3 (SPEC-003): consulta de direccionamientos MIPRES para ítems
   * NO_PBS + ENABLED. Persiste evidencia histórica (checks + direcciones),
   * actualiza `direction_status` y deja auditoría sin tokens. Un reintento del
   * mismo job no duplica checks: job_results y la ventana item/día lo garantizan.
   * Fase 4 (SPEC-002/ADR-021): materializa `operation_status` con la regla
   * pura centralizada del dominio y notifica la entrada a `READY_TO_DISPENSE`.
   */
export class MipresProcessor {
  constructor(
    private readonly database: Database,
    private readonly mipresPort: MipresPort,
  ) {}

  async process(rawJob: MipresRecheckJob): Promise<MipresProcessingResult> {
    const job = mipresRecheckJobSchema.parse(rawJob);
    const existing = await this.database.pool.query<{ result: MipresProcessingResult }>(
      'select result from job_results where queue = $1 and idempotency_key = $2',
      ['mipres', job.idempotencyKey],
    );
    const persisted = existing.rows[0]?.result;
    if (persisted) return persisted;

    const item = await this.loadItem(job.payload.itemId);
    if (!item) return this.skipped(job, 'ITEM_NOT_FOUND');
    if (item.coverage_type !== 'NO_PBS' || item.enablement_status !== 'ENABLED') {
      return this.skipped(job, 'NOT_ELIGIBLE');
    }
    if (!item.no_prescripcion) return this.skipped(job, 'MISSING_PRESCRIPTION_NUMBER');
    if (job.payload.queryType === 'AUTO' && (item.direction_status ?? 'PENDING') !== 'PENDING') {
      return this.skipped(job, 'AUTO_ONLY_FOR_PENDING');
    }

    const checkDate = currentBogotaDate();
    let outcome: 'PENDING' | 'CONFIRMED' | 'QUERY_ERROR';
    let httpStatus: number | null = null;
    let evaluation = { hasCurrent: false as boolean | null, directionCount: 0 };
    let directions: Awaited<ReturnType<MipresPort['getDirectionsByPrescription']>>['directions'] =
      [];
    let rawPayload: unknown = null;

    try {
      const result = await this.mipresPort.getDirectionsByPrescription(item.no_prescripcion);
      httpStatus = result.httpStatus;
      rawPayload = result.rawPayload;
      directions = result.directions;
      const vigencia = evaluateMipresVigencia(directions, checkDate);
      outcome = vigencia.outcome;
      evaluation = { hasCurrent: vigencia.hasCurrent, directionCount: vigencia.directionCount };
    } catch (error) {
      if (error instanceof MipresQueryError || error instanceof MipresNotConfiguredError) {
        outcome = 'QUERY_ERROR';
        httpStatus = error instanceof MipresQueryError ? error.httpStatus : null;
      } else {
        throw error;
      }
    }

    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query<{ id: string }>(
        `insert into mipres_checks
           (authorization_item_id, prescription_number, query_type, outcome, http_status,
            direction_count, has_current_direction, rule_version, check_date, response_payload,
            correlation_id, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
         returning id`,
        [
          item.id,
          item.no_prescripcion,
          job.payload.queryType,
          outcome,
          httpStatus,
          evaluation.directionCount,
          outcome === 'QUERY_ERROR' ? null : evaluation.hasCurrent,
          MIPRES_VIGENCIA_RULE_VERSION,
          checkDate,
          JSON.stringify(rawPayload),
          job.correlationId,
          job.idempotencyKey,
        ],
      );
      const checkId = inserted.rows[0]?.id;
      if (!checkId) throw new Error('MIPRES check was not created');
      for (const direction of directions) {
        await client.query(
          `insert into mipres_directions
             (mipres_check_id, authorization_item_id, external_id, direction_id, prescription_number,
              technology_type, technology_consecutive, maximum_delivery_date, external_status,
              annulled, current)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            checkId,
            item.id,
            direction.externalId,
            direction.directionId,
            direction.prescriptionNumber,
            direction.technologyType,
            direction.technologyConsecutive,
            direction.maximumDeliveryDate,
            direction.externalStatus,
            direction.annulled,
            !direction.annulled && checkDate < direction.maximumDeliveryDate,
          ],
        );
      }
      await client.query(
        `update authorization_items set direction_status = $2, updated_at = now() where id = $1`,
        [item.id, outcome],
      );
      const operationStatus = deriveOperationStatus({
        enablementStatus: item.enablement_status as 'ENABLED' | 'BLOCKED_SOURCE_STATUS',
        coverageType: item.coverage_type as 'PBS' | 'NO_PBS',
        directionStatus: outcome,
        productInTariffAnnex: item.tariff_membership_status === 'LISTED',
        fechaFinalVigencia: item.fecha_final_vigencia,
        today: checkDate,
      });
      if (operationStatus !== item.operation_status) {
        const materialized = await client.query<{ version: number }>(
          `update authorization_items set operation_status = $2, version = version + 1, updated_at = now()
           where id = $1 returning version`,
          [item.id, operationStatus],
        );
        const readinessVersion = materialized.rows[0]?.version ?? 0;
        await client.query(
          `insert into audit_events
             (actor_type, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
           values ('SYSTEM', null, $1, 'authorization_item', $2, $3::jsonb, $4, $5, 'SUCCESS')`,
          [
            'OPERATION_STATUS_MATERIALIZED',
            item.id,
            JSON.stringify({
              previousOperationStatus: item.operation_status,
              operationStatus,
              directionStatus: outcome,
              rule: 'ADR-021',
            }),
            job.correlationId,
            job.correlationId,
          ],
        );
        if (operationStatus === 'READY_TO_DISPENSE') {
          await client.query(
            `insert into audit_events
               (actor_type, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
             values ('SYSTEM', null, 'AUTHORIZATION_READY_TO_DISPENSE', 'authorization_item', $1, $2::jsonb, $3, $4, 'SUCCESS')`,
            [
              item.id,
              JSON.stringify({ readinessVersion, directionStatus: outcome }),
              job.correlationId,
              job.correlationId,
            ],
          );
          const recipients = await client.query<{ id: string; code: string }>(
            `select id, code from organizations where code = any($1::text[])`,
            [['OLP', 'MEDICARTE']],
          );
          for (const recipient of recipients.rows) {
            const key = `ready:${item.id}:${readinessVersion}:${recipient.code}`.slice(0, 200);
            const eventId = randomUUID();
            const payload = {
              eventId,
              notificationType: 'AUTHORIZATION_READY_TO_DISPENSE',
              itemId: item.id,
              recipientOrganizationId: recipient.id,
              period: null,
              correlationId: job.correlationId,
              idempotencyKey: key,
            };
            await client.query(
              `insert into outbox_events
                 (id, event_type, version, payload, correlation_id, organization_id, idempotency_key)
               values ($1, 'notification.email', 1, $2::jsonb, $3, $4, $5)
               on conflict (idempotency_key) do nothing`,
              [eventId, JSON.stringify(payload), job.correlationId, recipient.id, key],
            );
          }
        }
      }
      await client.query(
        `insert into audit_events
           (actor_type, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
         values ('SYSTEM', null, $1, 'authorization_item', $2, $3::jsonb, $4, $5, 'SUCCESS')`,
        [
          outcome === 'CONFIRMED'
            ? 'DIRECTION_CONFIRMED'
            : outcome === 'QUERY_ERROR'
              ? 'MIPRES_CHECK_COMPLETED'
              : 'DIRECTION_NOT_FOUND',
          item.id,
          JSON.stringify({
            prescriptionNumber: item.no_prescripcion,
            queryType: job.payload.queryType,
            outcome,
            httpStatus,
            directionCount: evaluation.directionCount,
            hasCurrentDirection: evaluation.hasCurrent,
            ruleVersion: MIPRES_VIGENCIA_RULE_VERSION,
            checkId,
          }),
          job.correlationId,
          job.correlationId,
        ],
      );
      const processingResult: MipresProcessingResult = {
        itemId: item.id,
        outcome,
        directionStatus: outcome,
        directionCount: evaluation.directionCount,
        hasCurrentDirection: outcome === 'QUERY_ERROR' ? null : evaluation.hasCurrent,
        httpStatus,
      };
      await client.query(
        `insert into job_results (queue, job_name, idempotency_key, result, correlation_id)
         values ('mipres', 'authorization.mipres.v1', $1, $2::jsonb, $3)
         on conflict (queue, idempotency_key) do nothing`,
        [job.idempotencyKey, JSON.stringify(processingResult), job.correlationId],
      );
      await client.query('commit');
      return processingResult;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadItem(itemId: string): Promise<ItemRow | undefined> {
    const result = await this.database.pool.query<ItemRow>(
      `select id, no_prescripcion, enablement_status, coverage_type, direction_status, operation_status,
              tariff_membership_status,
              source_data->>'FECHA_FINAL_VIGENCIA' as fecha_final_vigencia
       from authorization_items where id = $1`,
      [itemId],
    );
    return result.rows[0];
  }

  private skipped(job: MipresRecheckJob, reason: string): MipresProcessingResult {
    return {
      itemId: (job.payload as MipresRecheckPayload).itemId,
      outcome: 'SKIPPED',
      directionStatus: null,
      directionCount: 0,
      hasCurrentDirection: null,
      httpStatus: null,
      skipReason: reason,
    };
  }
}

export function mipresAutoIdempotencyKey(itemId: string, checkDate: string): string {
  // SPEC-009: clave MIPRES = item + query_type + time_window (ventana diaria
  // America/Bogota). Una ventana produce un único efecto lógico por ítem.
  return `mipres:auto:${itemId}:${checkDate}`.slice(0, 200);
}

export function mipresManualIdempotencyKey(
  itemId: string,
  requestedBy: string,
  nonce: string,
): string {
  return `mipres:manual:${itemId}:${requestedBy}:${nonce}`.slice(0, 200);
}
