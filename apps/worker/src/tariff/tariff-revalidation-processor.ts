import {
  tariffAnnexRevalidationJobSchema,
  type TariffAnnexRevalidationJob,
} from '@authorization/contracts';
import {
  currentBogotaDate,
  deriveEarlyProcessStatus,
  deriveEpsNovedadCausales,
  deriveOperationStatus,
  deriveTariffCoverageType,
  TARIFF_ANNEX_RULE_VERSION,
} from '@authorization/domain';
import { resolveNovelties, type createDatabase } from '@authorization/database';

type Database = ReturnType<typeof createDatabase>;

type ItemRow = {
  id: string;
  authorization_key: string;
  codigo_medicamento: string;
  enablement_status: 'ENABLED' | 'BLOCKED_SOURCE_STATUS';
  coverage_type: 'PBS' | 'NO_PBS';
  direction_status: 'NOT_APPLICABLE' | 'PENDING' | 'CONFIRMED' | 'QUERY_ERROR';
  operation_status: string | null;
  tariff_membership_status: string;
  version: number;
  fecha_final_vigencia: string | null;
};

export type TariffRevalidationResult = Readonly<{
  tariffProductId: string;
  codigoProducto: string;
  outcome: 'COMPLETED' | 'SKIPPED';
  skipReason?: string;
  evaluatedItems: number;
  revalidatedItems: number;
  becameReadyItems: number;
}>;

/**
 * SPEC-014 §16: revalidación dirigida tras crear o reactivar un producto del
 * Anexo Tarifario. Solo procesa autorizaciones con
 * `codigo_medicamento = codigo_producto` cuya causal activa sea
 * PRODUCT_NOT_IN_TARIFF_ANNEX (tariff_membership_status = NOT_LISTED); nunca
 * modifica ítems avanzados (DISPENSATION_REPORTED/DISPENSED). Resuelve la
 * causal y re-ejecuta la función central de dominio; la transición a
 * READY_TO_DISPENSE continúa el flujo normal de notificaciones. Idempotente:
 * un ítem cuya causal ya fue resuelta no produce efectos adicionales.
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

    const product = await this.database.pool.query<{
      id: string;
      codigo_producto: string;
      tipo_inclusion: string | null;
      active: boolean;
    }>(
      `select id, codigo_producto, tipo_inclusion, active
       from tariff_annex_products
       where id = $1`,
      [job.payload.tariffProductId],
    );
    const productRow = product.rows[0];
    if (!productRow) {
      return this.skipped(job, 'PRODUCT_NOT_FOUND');
    }
    if (!productRow.active) {
      return this.skipped(job, 'PRODUCT_INACTIVE');
    }
    const tariffCoverageType =
      deriveTariffCoverageType(productRow.tipo_inclusion);

    if (!tariffCoverageType) {
      return this.skipped(job, 'INVALID_TIPO_INCLUSION');
    }

    const candidates = await this.database.pool.query<{ id: string }>(
      `select id from authorization_items
       where codigo_medicamento = $1 and tariff_membership_status = 'NOT_LISTED'
       order by id`,
      [productRow.codigo_producto],
    );

    let revalidatedItems = 0;
    let becameReadyItems = 0;
    for (const candidate of candidates.rows) {
      const outcome = await this.revalidateItem(
        candidate.id,
        job,
        tariffCoverageType,
      );
      if (outcome.revalidated) revalidatedItems += 1;
      if (outcome.becameReady) becameReadyItems += 1;
    }

    return {
      tariffProductId: productRow.id,
      codigoProducto: productRow.codigo_producto,
      outcome: 'COMPLETED',
      evaluatedItems: candidates.rowCount ?? 0,
      revalidatedItems,
      becameReadyItems,
    };
  }

  private async revalidateItem(
    itemId: string,
    job: ReturnType<typeof tariffAnnexRevalidationJobSchema.parse>,
    tariffCoverageType: 'PBS' | 'NO_PBS',
  ): Promise<{ revalidated: boolean; becameReady: boolean }> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const itemResult = await client.query<ItemRow>(
        `select id, authorization_key, codigo_medicamento, enablement_status, coverage_type,
                direction_status, operation_status, tariff_membership_status, version,
                source_data->>'FECHA_FINAL_VIGENCIA' as fecha_final_vigencia
         from authorization_items where id = $1 for update`,
        [itemId],
      );
      const item = itemResult.rows[0];
      if (!item) {
        await client.query('commit');
        return { revalidated: false, becameReady: false };
      }
      if (item.tariff_membership_status !== 'NOT_LISTED') {
        await client.query('commit');
        return { revalidated: false, becameReady: false };
      }
      if (
        item.operation_status === 'DISPENSATION_REPORTED' ||
        item.operation_status === 'DISPENSED'
      ) {
        await client.query('commit');
        return { revalidated: false, becameReady: false };
      }
      const previousCoverageType = item.coverage_type;

      const effectiveDirectionStatus =
        tariffCoverageType === 'PBS'
          ? 'NOT_APPLICABLE'
          : previousCoverageType === 'NO_PBS' &&
              item.direction_status !== 'NOT_APPLICABLE'
            ? item.direction_status
            : 'PENDING';
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
            tariffProductId: job.payload.tariffProductId,
            previousOperationStatus: item.operation_status,
          }),
          job.correlationId,
          job.correlationId,
        ],
      );
      await client.query(
        `update authorization_items
         set tariff_membership_status = 'LISTED',
             tariff_membership_evaluated_at = now(),
             tariff_rule_version = $2,
             coverage_type = $3,
             direction_status = $4,
             updated_at = now()
         where id = $1`,
        [
          item.id,
          TARIFF_ANNEX_RULE_VERSION,
          tariffCoverageType,
          effectiveDirectionStatus,
        ],
      );
      await client.query(
        `insert into authorization_tariff_snapshots
           (authorization_item_id, product_id, codigo_producto, status, tarifa_unidad_raw,
            tarifa_unidad_canonical, tipo_inclusion, provenance)
         select $1, p.id, p.codigo_producto, 'RESOLVED', p.tarifa_unidad,
                p.tarifa_unidad_canonical, p.tipo_inclusion, 'TARIFF_REVALIDATION:active_product'
         from tariff_annex_products p
         where p.id = $2
         on conflict (authorization_item_id) do nothing`,
        [item.id, job.payload.tariffProductId],
      );
      await resolveNovelties(client, {
        authorizationItemId: item.id,
        codes: ['ANX_001', 'ANX_002', 'ANX_003'],
        reason: 'TARIFF_ANNEX_REVALIDATED',
        actorType: 'SYSTEM',
        actorId: job.payload.actorId,
        correlationId: job.correlationId,
      });
      const operationStatus = deriveOperationStatus({
        enablementStatus: item.enablement_status,
        coverageType: tariffCoverageType,
        directionStatus: effectiveDirectionStatus,
        productInTariffAnnex: true,
        fechaFinalVigencia: item.fecha_final_vigencia,
        today,
      });
      const remainingCausales = deriveEpsNovedadCausales({
        enablementStatus: item.enablement_status,
        operationStatus,
        coverageType: tariffCoverageType,
        directionStatus: effectiveDirectionStatus,
        tariffMembershipStatus: 'LISTED',
        fechaFinalVigencia: item.fecha_final_vigencia,
        today,
      });
      let becameReady = false;
      if (
        operationStatus !== item.operation_status ||
        tariffCoverageType !== item.coverage_type ||
        effectiveDirectionStatus !== item.direction_status
      ) {
        const processStatus = deriveEarlyProcessStatus({
          operationStatus,
          coverageType: tariffCoverageType,
          directionStatus: effectiveDirectionStatus,
        });
        const materialized = await client.query<{ version: number }>(
          `update authorization_items set operation_status = $2, process_status = $3, version = version + 1, updated_at = now()
           where id = $1 returning version`,
          [item.id, operationStatus, processStatus],
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
              tariffMembershipStatus: 'NOT_LISTED',
            }),
            JSON.stringify({
              operationStatus,
              tariffMembershipStatus: 'LISTED',
              rule: 'SPEC-014',
              revalidation: true,
            }),
            job.correlationId,
            job.correlationId,
          ],
        );
        if (operationStatus === 'READY_TO_DISPENSE') {
          becameReady = true;
          await client.query(
             `insert into audit_events
                (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
             values ('SYSTEM', $1, null, 'AUTHORIZATION_READY_TO_DISPENSE', 'authorization_item', $2, $3::jsonb, $4, $5, 'SUCCESS')`,
             [
               job.payload.actorId,
               item.id,
               JSON.stringify({ readinessVersion, revalidation: 'TARIFF_ANNEX' }),
               job.correlationId,
              job.correlationId,
            ],
          );
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
            previousOperationStatus: item.operation_status,
            resultOperationStatus: operationStatus,
            remainingCausales,
          }),
          job.correlationId,
          job.correlationId,
        ],
      );
      await client.query('commit');
      return { revalidated: true, becameReady };
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
      outcome: 'SKIPPED',
      skipReason: reason,
      evaluatedItems: 0,
      revalidatedItems: 0,
      becameReadyItems: 0,
    };
  }
}
