import { randomUUID } from 'node:crypto';
import {
  tariffAnnexRevalidationJobSchema,
  type TariffAnnexRevalidationJob,
} from '@authorization/contracts';
import {
  currentBogotaDate,
  deriveEpsNovedadCausales,
  deriveOperationStatus,
  TARIFF_ANNEX_RULE_VERSION,
} from '@authorization/domain';
import type { createDatabase } from '@authorization/database';

type Database = ReturnType<typeof createDatabase>;

type ItemRow = {
  id: string;
  authorization_key: string;
  codigo_medicamento: string;
  enablement_status: string;
  coverage_type: string;
  direction_status: string;
  operation_status: string | null;
  tariff_membership_status: string;
  version: number;
  fecha_final_vigencia: string | null;
  lugar_dispensacion: string | null;
  fecha_dispensacion: string | null;
  fecha_aplicacion: string | null;
  operational_version: number;
};

export type TariffRevalidationResult = Readonly<{
  tariffProductId: string;
  codigoProducto: string;
  outcome: 'COMPLETADO' | 'OMITIDO' | 'DEDUPLICADO';
  skipReason?: string;
  evaluatedItems: number;
  revalidatedItems: number;
  becameReadyItems: number;
}>;

/**
 * SPEC-014 §16: revalidación dirigida tras crear o reactivar un producto del
 * Anexo Tarifario. Solo procesa autorizaciones con
 * `codigo_medicamento = codigo_producto` cuya causal activa sea
 * PRODUCT_NOT_IN_TARIFF_ANNEX (tariff_membership_status = NO_LISTADO); nunca
 * modifica ítems avanzados (DISPENSACION_REPORTADA/DISPENSADO) y re-ejecuta la
 * misma función de dominio del procesamiento normal. Es idempotente: un ítem
 * ya resuelto no produce efectos adicionales.
 */
export class TariffRevalidationProcessor {
  constructor(private readonly database: Database) {}

  async process(rawJob: TariffAnnexRevalidationJob): Promise<TariffRevalidationResult> {
    const job = tariffAnnexRevalidationJobSchema.parse(rawJob);
    const existing = await this.database.pool.query<{ result: TariffRevalidationResult }>(
      'select result from job_results where queue = $1 and idempotency_key = $2',
      ['tariff-annex', job.idempotencyKey],
    );
    const persisted = existing.rows[0]?.result;
    if (persisted) return persisted;

    const product = await this.database.pool.query<{ id: string; codigo_producto: string; active: boolean }>(
      'select id, codigo_producto, active from tariff_annex_products where id = $1',
      [job.payload.tariffProductId],
    );
    const productRow = product.rows[0];
    if (!productRow) {
      return this.skipped(job, 'PRODUCT_NOT_FOUND');
    }
    if (!productRow.active) {
      // Un producto desactivado no habilita nada; la revalidación solo aplica
      // a productos creados o reactivados (SPEC-014 §16.1).
      return this.skipped(job, 'PRODUCT_INACTIVE');
    }

    const candidates = await this.database.pool.query<{ id: string }>(
      `select id from authorization_items
       where codigo_medicamento = $1 and tariff_membership_status = 'NO_LISTADO'
       order by id`,
      [productRow.codigo_producto],
    );

    let revalidatedItems = 0;
    let becameReadyItems = 0;
    for (const candidate of candidates.rows) {
      const outcome = await this.revalidateItem(candidate.id, job, productRow.codigo_producto);
      if (outcome.revalidated) revalidatedItems += 1;
      if (outcome.becameReady) becameReadyItems += 1;
    }

    const result: TariffRevalidationResult = {
      tariffProductId: productRow.id,
      codigoProducto: productRow.codigo_producto,
      outcome: 'COMPLETADO',
      evaluatedItems: candidates.rowCount ?? 0,
      revalidatedItems,
      becameReadyItems,
    };
    return result;
  }

  private async revalidateItem(
    itemId: string,
    job: ReturnType<typeof tariffAnnexRevalidationJobSchema.parse>,
    codigoProducto: string,
  ): Promise<{ revalidated: boolean; becameReady: boolean }> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const itemResult = await client.query<ItemRow>(
        `select id, authorization_key, codigo_medicamento, enablement_status, coverage_type,
                direction_status, operation_status, tariff_membership_status, version,
                lugar_dispensacion, fecha_dispensacion::text, fecha_aplicacion::text,
                operational_version,
                source_data->>'FECHA_FINAL_VIGENCIA' as fecha_final_vigencia
         from authorization_items where id = $1 for update`,
        [itemId],
      );
      const item = itemResult.rows[0];
      if (!item) {
        await client.query('commit');
        return { revalidated: false, becameReady: false };
      }
      // Idempotencia por ítem: si otro intento ya resolvió la causal, no se
      // repiten efectos.
      if (item.tariff_membership_status !== 'NO_LISTADO') {
        await client.query('commit');
        return { revalidated: false, becameReady: false };
      }
      if (item.operation_status === 'DISPENSACION_REPORTADA' || item.operation_status === 'DISPENSADO') {
        await client.query('commit');
        return { revalidated: false, becameReady: false };
      }
      const today = currentBogotaDate();
      await client.query(
        `insert into audit_events
           (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
         values ('SYSTEM', $1, null, 'TARIFF_ANNEX_REVALIDATION_STARTED', 'authorization_item', $2, $3::jsonb, $4, $5, 'SUCCESS')`,
        [
          job.payload.actorId,
          item.id,
          JSON.stringify({
            codigoMedicamento: item.codigo_medicamento,
            codigoProducto,
            tariffProductId: job.payload.tariffProductId,
            previousOperationStatus: item.operation_status,
          }),
          job.correlationId,
          job.correlationId,
        ],
      );
      // 1. Resolver la causal del Anexo Tarifario.
      await client.query(
        `update authorization_items
         set tariff_membership_status = 'LISTADO', tariff_membership_evaluated_at = now(),
             tariff_rule_version = $2, updated_at = now()
         where id = $1`,
        [item.id, TARIFF_ANNEX_RULE_VERSION],
      );
      // 2. Re-ejecutar la función central de validaciones con el estado actual.
      const operationStatus = deriveOperationStatus({
        enablementStatus: item.enablement_status as 'HABILITADO' | 'BLOQUEADO_POR_ESTADO_ORIGEN',
        coverageType: item.coverage_type as 'PBS' | 'NO_PBS',
        directionStatus: item.direction_status as 'NO_APLICA' | 'PENDIENTE' | 'CONFIRMADO' | 'ERROR_DE_CONSULTA',
        tariffListed: true,
        fechaFinalVigencia: item.fecha_final_vigencia,
        today,
        hasOperationalIntervention:
          item.lugar_dispensacion !== null ||
          item.fecha_dispensacion !== null ||
          item.fecha_aplicacion !== null ||
          item.operational_version > 0,
      });
      const remainingCausales = deriveEpsNovedadCausales({
        enablementStatus: item.enablement_status as 'HABILITADO' | 'BLOQUEADO_POR_ESTADO_ORIGEN',
        operationStatus,
        coverageType: item.coverage_type as 'PBS' | 'NO_PBS',
        directionStatus: item.direction_status as 'NO_APLICA' | 'PENDIENTE' | 'CONFIRMADO' | 'ERROR_DE_CONSULTA',
        tariffMembershipStatus: 'LISTADO',
        fechaFinalVigencia: item.fecha_final_vigencia,
        today,
      });
      let becameReady = false;
      if (operationStatus !== item.operation_status) {
        const materialized = await client.query<{ version: number }>(
          `update authorization_items set operation_status = $2, version = version + 1, updated_at = now()
           where id = $1 returning version`,
          [item.id, operationStatus],
        );
        const readinessVersion = materialized.rows[0]?.version ?? item.version + 1;
        await client.query(
          `insert into audit_events
             (actor_type, actor_id, organization_id, action, resource_type, resource_id, before, after, correlation_id, request_id, result)
           values ('SYSTEM', $1, null, 'OPERATION_STATUS_MATERIALIZED', 'authorization_item', $2, $3::jsonb, $4::jsonb, $5, $6, 'SUCCESS')`,
          [
            job.payload.actorId,
            item.id,
            JSON.stringify({
              previousOperationStatus: item.operation_status,
              tariffMembershipStatus: 'NO_LISTADO',
            }),
            JSON.stringify({
              operationStatus,
              tariffMembershipStatus: 'LISTADO',
              rule: 'SPEC-014',
              revalidation: true,
            }),
            job.correlationId,
            job.correlationId,
          ],
        );
        if (operationStatus === 'LISTO_PARA_DISPENSAR') {
          becameReady = true;
          await client.query(
            `insert into audit_events
               (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
             values ('SYSTEM', $1, null, 'AUTHORIZATION_BECAME_READY_TO_DISPENSE', 'authorization_item', $2, $3::jsonb, $4, $5, 'SUCCESS')`,
            [
              job.payload.actorId,
              item.id,
              JSON.stringify({
                readinessVersion,
                codigoMedicamento: item.codigo_medicamento,
                tariffProductId: job.payload.tariffProductId,
              }),
              job.correlationId,
              job.correlationId,
            ],
          );
          await client.query(
            `insert into audit_events
               (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
             values ('SYSTEM', $1, null, 'AUTHORIZATION_READY_TO_DISPENSE', 'authorization_item', $2, $3::jsonb, $4, $5, 'SUCCESS')`,
            [
              job.payload.actorId,
              item.id,
              JSON.stringify({
                readinessVersion,
                revalidation: 'TARIFF_ANNEX',
              }),
              job.correlationId,
              job.correlationId,
            ],
          );
          // Mismo flujo de notificaciones del procesamiento inicial: outbox +
          // idempotencia `ready:{item}:{readinessVersion}:{destinatario}`.
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
           (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
         values ('SYSTEM', $1, null, $2, 'authorization_item', $3, $4::jsonb, $5, $6, 'SUCCESS')`,
        [
          job.payload.actorId,
          remainingCausales.length === 0
            ? 'TARIFF_ANNEX_VALIDATION_PASSED'
            : 'TARIFF_ANNEX_VALIDATION_FAILED',
          item.id,
          JSON.stringify({
            codigoMedicamento: item.codigo_medicamento,
            authorizationKey: item.authorization_key,
            codigoProducto,
            previousOperationStatus: item.operation_status,
            resultOperationStatus: operationStatus,
            remainingCausales,
          }),
          job.correlationId,
          job.correlationId,
        ],
      );
      await client.query('commit');
      return {
        revalidated: true,
        becameReady,
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private skipped(
    job: ReturnType<typeof tariffAnnexRevalidationJobSchema.parse>,
    reason: string,
  ): TariffRevalidationResult {
    return {
      tariffProductId: job.payload.tariffProductId,
      codigoProducto: job.payload.codigoProducto,
      outcome: 'OMITIDO',
      skipReason: reason,
      evaluatedItems: 0,
      revalidatedItems: 0,
      becameReadyItems: 0,
    };
  }
}
