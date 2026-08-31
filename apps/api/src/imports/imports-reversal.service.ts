import { createHash } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  type ImportReversalBlockReason,
  type ImportReversalBlockedItem,
  type ImportReversalPreviewResponse,
  type RevertImportResponse,
} from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';

type Database = ReturnType<typeof createDatabase>;

type QueryableClient = {
  query: <T = unknown>(
    query: string,
    values?: unknown[],
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
};

type BatchRevertRow = {
  id: string;
  organization_id: string;
  original_filename: string;
  status: string;
  total_rows: number;
  rejected_rows: number;
  duplicate_rows: number;
  existing_rows: number;
  confirmed_rows: number;
  created_by: string;
  created_at: Date;
  created_by_email: string | null;
  created_by_name: string | null;
  reverted_at: Date | null;
  reverted_removed_items: number;
  reverted_blocked_items: number;
};

type PlanRow = {
  id: string;
  authorization_key: string;
  has_audit: boolean;
  has_mipres: boolean;
  has_operational: boolean;
  has_notifications: boolean;
  has_source_update: boolean;
  has_later_reference: boolean;
};

export const REVERSAL_BLOCKED_ITEMS_DETAIL_LIMIT = 50;

const BLOCKED_ITEMS_DETAIL_LIMIT = REVERSAL_BLOCKED_ITEMS_DETAIL_LIMIT;

function isRetryableTransactionError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === '40P01' || error.code === '40001';
}

function planRowToBlockedItem(row: PlanRow): ImportReversalBlockedItem {
  const reasons: ImportReversalBlockReason[] = [];
  if (row.has_audit) reasons.push('ITEM_HAS_AUDIT_ACTIVITY');
  if (row.has_mipres) reasons.push('ITEM_HAS_MIPRES_ACTIVITY');
  if (row.has_operational) reasons.push('ITEM_HAS_OPERATIONAL_UPDATES');
  if (row.has_notifications) reasons.push('ITEM_HAS_NOTIFICATIONS');
  if (row.has_source_update) reasons.push('ITEM_HAS_UPDATED_SOURCE_EVIDENCE');
  if (row.has_later_reference) reasons.push('ITEM_REFERENCED_BY_LATER_IMPORT');
  return { itemId: row.id, authorizationKey: row.authorization_key, reasons };
}

/**
 * Devuelve el plan de reversión del lote: ítems creados por el batch
 * (created_from_batch_id) con sus causales de bloqueo por actividad posterior.
 * La selección nunca usa criterios indirectos (fecha, usuario, llave).
 */
export async function computeReversalPlan(
  client: QueryableClient,
  batchId: string,
): Promise<PlanRow[]> {
  const result = await client.query<PlanRow>(
    `select i.id, i.authorization_key,
            (i.audit_status <> 'NO_INICIADO' or exists (
               select 1 from audit_reviews ar where ar.authorization_item_id = i.id)) as has_audit,
            exists (select 1 from mipres_checks mc where mc.authorization_item_id = i.id) as has_mipres,
            (i.operational_version > 0
              or i.lugar_dispensacion is not null
              or i.fecha_dispensacion is not null
              or i.fecha_aplicacion is not null
              or exists (select 1 from operational_field_changes ofc where ofc.authorization_item_id = i.id)
              or exists (select 1 from bulk_update_rows bur where bur.authorization_item_id = i.id)) as has_operational,
            exists (select 1 from notifications n
                     where n.item_id = i.id
                       and n.notification_type not in ('AUTHORIZATION_READY_TO_DISPENSE', 'EPS_DIRECTION_PENDING')) as has_notifications,
            exists (select 1 from coverage_evaluations ce
                     where ce.authorization_item_id = i.id and ce.evaluation_version > 1) as has_source_update,
            exists (select 1 from import_rows ir
                     where ir.authorization_item_id = i.id and ir.import_batch_id <> $1) as has_later_reference
     from authorization_items i
     where i.created_from_batch_id = $1
     order by i.created_at asc, i.id asc`,
    [batchId],
  );
  return result.rows;
}

function summarize(plan: PlanRow[]): {
  itemsCreatedByBatch: number;
  itemsEligibleForRemoval: number;
  itemsBlocked: number;
  blockedReasonCounts: Array<{ reason: ImportReversalBlockReason; count: number }>;
  blockedItems: ImportReversalBlockedItem[];
  blockedItemsTruncated: boolean;
} {
  const blockedItems = plan.map(planRowToBlockedItem).filter((item) => item.reasons.length > 0);
  const reasonCounts = new Map<ImportReversalBlockReason, number>();
  for (const item of blockedItems) {
    for (const reason of item.reasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }
  return {
    itemsCreatedByBatch: plan.length,
    itemsEligibleForRemoval: plan.length - blockedItems.length,
    itemsBlocked: blockedItems.length,
    blockedReasonCounts: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => a.reason.localeCompare(b.reason)),
    blockedItems: blockedItems.slice(0, BLOCKED_ITEMS_DETAIL_LIMIT),
    blockedItemsTruncated: blockedItems.length > BLOCKED_ITEMS_DETAIL_LIMIT,
  };
}

@Injectable()
export class ImportsReversalService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private async findRevertibleBatch(
    client: QueryableClient,
    batchId: string,
    organizationId: string,
    lock: boolean,
  ): Promise<BatchRevertRow> {
    const result = await client.query<BatchRevertRow>(
      `select b.id, b.organization_id, b.original_filename, b.status, b.total_rows, b.rejected_rows,
              b.duplicate_rows, b.existing_rows, b.confirmed_rows, b.created_by, b.created_at,
              u.email as created_by_email, u.display_name as created_by_name,
              b.reverted_at, b.reverted_removed_items, b.reverted_blocked_items
       from import_batches b
       inner join users u on u.id = b.created_by
       where b.id = $1 and b.organization_id = $2${lock ? ' for update' : ''}`,
      [batchId, organizationId],
    );
    const batch = result.rows[0];
    if (!batch) {
      throw new NotFoundException({ code: 'IMPORT_NOT_FOUND', message: 'Import batch not found' });
    }
    return batch;
  }

  async preview(batchId: string, scope: Scope): Promise<ImportReversalPreviewResponse> {
    const client = await this.database.pool.connect();
    try {
      const batch = await this.findRevertibleBatch(client, batchId, scope.organizationId, false);
      if (batch.status !== 'COMPLETADO' && batch.status !== 'REVERTIDO') {
        throw new ConflictException({
          code: 'IMPORT_NOT_REVERTIBLE',
          message: 'Only completed import batches can be reverted',
        });
      }
      const plan = await computeReversalPlan(client, batch.id);
      const summary = summarize(plan);
      return {
        batchId: batch.id,
        batchStatus: batch.status as ImportReversalPreviewResponse['batchStatus'],
        originalFilename: batch.original_filename,
        createdAt: batch.created_at.toISOString(),
        createdBy: batch.created_by,
        createdByEmail: batch.created_by_email ?? '',
        createdByName: batch.created_by_name,
        totalRows: batch.total_rows,
        confirmedRows: batch.confirmed_rows,
        rejectedRows: batch.rejected_rows,
        duplicateRows: batch.duplicate_rows,
        existingRows: batch.existing_rows,
        alreadyReverted: batch.status === 'REVERTIDO',
        revertedAt: batch.reverted_at?.toISOString() ?? null,
        revertedRemovedItems: batch.reverted_removed_items,
        revertedBlockedItems: batch.reverted_blocked_items,
        ...summary,
      };
    } finally {
      client.release();
    }
  }

  async revert(input: {
    batchId: string;
    idempotencyKey: string;
    scope: Scope;
  }): Promise<RevertImportResponse> {
    const batchId = input.batchId;
    const idempotencyScope = `imports.revert:${input.scope.organizationId}:${batchId}`;
    const requestHash = createHash('sha256').update(batchId).digest('hex');
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      // Serializa reversiones concurrentes del mismo lote aunque usen claves
      // de idempotencia distintas; la fila del batch se bloquea además for update.
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `imports.revert:${batchId}`,
      ]);
      await client.query(
        'delete from idempotency_records where scope = $1 and key = $2 and expires_at <= now()',
        [idempotencyScope, input.idempotencyKey],
      );
      const existing = await client.query<{ request_hash: string; response: RevertImportResponse }>(
        'select request_hash, response from idempotency_records where scope = $1 and key = $2',
        [idempotencyScope, input.idempotencyKey],
      );
      const previous = existing.rows[0] as
        | { request_hash: string; response: RevertImportResponse }
        | undefined;
      if (previous) {
        await client.query('commit');
        return previous.response;
      }

      const batch = await this.findRevertibleBatch(
        client,
        batchId,
        input.scope.organizationId,
        true,
      );
      if (batch.status === 'REVERTIDO') {
        // Segunda ejecución sobre un lote ya revertido: resultado estable sin
        // nuevos efectos, con el detalle de bloqueados recalculado.
        const plan = await computeReversalPlan(client, batch.id);
        const summary = summarize(plan);
        const response: RevertImportResponse = {
          batchId: batch.id,
          status: 'REVERTIDO',
          alreadyReverted: true,
          evaluatedItems: batch.reverted_removed_items + batch.reverted_blocked_items,
          removedItems: batch.reverted_removed_items,
          blockedItems: batch.reverted_blocked_items,
          blockedItemsDetail: summary.blockedItems,
          blockedItemsTruncated: summary.blockedItemsTruncated,
          revertedAt: (batch.reverted_at ?? new Date()).toISOString(),
        };
        await this.storeIdempotency(
          client,
          idempotencyScope,
          requestHash,
          input.idempotencyKey,
          response,
        );
        await client.query('commit');
        return response;
      }
      if (batch.status !== 'COMPLETADO') {
        throw new ConflictException({
          code: 'IMPORT_NOT_REVERTIBLE',
          message: 'Only completed import batches can be reverted',
        });
      }

      await client.query(`update import_batches set status = 'REVIRTIENDO' where id = $1`, [batchId]);
      const plan = await computeReversalPlan(client, batchId);
      const summary = summarize(plan);
      const eligibleIds = plan
        .filter((row) => !planRowToBlockedItem(row).reasons.length)
        .map((row) => row.id);

      let removedItems = 0;
      if (eligibleIds.length > 0) {
        // 1) Eventos de outbox aún no despachados del propio cargue: jamás
        // produjeron efectos externos y su procesamiento fallaría tras el borrado.
        await client.query(
          `delete from outbox_events
              where status = 'PENDIENTE' and payload->>'itemId' = any($1::text[])`,
          [eligibleIds],
        );
        // 2) El puntero de las filas del propio cargue se libera; la evidencia
        // de la fila (resultado, mensaje, llave, datos crudos) se conserva.
        await client.query(
          `update import_rows set authorization_item_id = null
            where import_batch_id = $1 and authorization_item_id = any($2::uuid[])`,
          [batchId, eligibleIds],
        );
        // 3) Notificaciones generadas por la propia confirmación del cargue
        // (anuncios de creación LISTO_PARA_DISPENSAR / EPS_DIRECTION_PENDING):
        // son parte de la unidad revertida y bloquearían el borrado físico por
        // FK RESTRICT. Los correos ya enviados y su auditoría se conservan;
        // cualquier otra notificación del ítem lo habría bloqueado antes.
        await client.query(
          `delete from notifications
            where item_id = any($1::uuid[])
              and notification_type in ('AUTHORIZATION_READY_TO_DISPENSE', 'EPS_DIRECTION_PENDING')`,
          [eligibleIds],
        );
        // 4) Clasificación de cobertura creada por la confirmación del cargue.
        await client.query(
          `delete from coverage_evaluations where authorization_item_id = any($1::uuid[])`,
          [eligibleIds],
        );
        // 5) Relación explícita con organizaciones (DEC-012).
        await client.query(
          `delete from authorization_item_organizations where authorization_item_id = any($1::uuid[])`,
          [eligibleIds],
        );
        // 6) Los ítems se eliminan al final; cualquier FK RESTRICT restante
        // aborta la transacción completa y el lote permanece COMPLETADO.
        const deleted = await client.query(
          `delete from authorization_items where id = any($1::uuid[])`,
          [eligibleIds],
        );
        removedItems = deleted.rowCount ?? 0;
        await this.insertItemRemovalAudits(client, {
          actorId: input.scope.userId,
          organizationId: input.scope.organizationId,
          batchId,
          removedIds: eligibleIds,
          removedKeys: plan
            .filter((row) => !planRowToBlockedItem(row).reasons.length)
            .map((row) => row.authorization_key),
          correlationId: input.scope.correlationId,
        });
      }

      await client.query(
        `update import_batches
          set status = 'REVERTIDO', reverted_at = now(), reverted_by = $2,
              reverted_removed_items = $3, reverted_blocked_items = $4
          where id = $1`,
        [batchId, input.scope.userId, removedItems, summary.itemsBlocked],
      );
      await this.insertAudit(client, {
        actorId: input.scope.userId,
        organizationId: input.scope.organizationId,
        action: 'IMPORT_BATCH_REVERTED',
        resourceType: 'import_batch',
        resourceId: batchId,
        after: {
          originalFilename: batch.original_filename,
          evaluatedItems: summary.itemsCreatedByBatch,
          removedItems,
          blockedItems: summary.itemsBlocked,
          blockedReasonCounts: summary.blockedReasonCounts,
          blockedItemIds: summary.blockedItems.map((item) => item.itemId),
          blockedItemsTruncated: summary.blockedItemsTruncated,
        },
        correlationId: input.scope.correlationId,
      });

      const response: RevertImportResponse = {
        batchId,
        status: 'REVERTIDO',
        alreadyReverted: false,
        evaluatedItems: summary.itemsCreatedByBatch,
        removedItems,
        blockedItems: summary.itemsBlocked,
        blockedItemsDetail: summary.blockedItems,
        blockedItemsTruncated: summary.blockedItemsTruncated,
        revertedAt: new Date().toISOString(),
      };
      await this.storeIdempotency(
        client,
        idempotencyScope,
        requestHash,
        input.idempotencyKey,
        response,
      );
      await client.query('commit');
      return response;
    } catch (error) {
      await client.query('rollback');
      if (isRetryableTransactionError(error)) {
        throw new ServiceUnavailableException({
          code: 'TRANSACTION_RETRY_REQUIRED',
          message: 'The transaction could not complete; retry the request',
        });
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async storeIdempotency(
    client: QueryableClient,
    idempotencyScope: string,
    requestHash: string,
    key: string,
    response: RevertImportResponse,
  ): Promise<void> {
    await client.query(
      `insert into idempotency_records (scope, key, request_hash, status_code, response, expires_at)
       values ($1, $2, $3, 200, $4::jsonb, now() + interval '24 hours')`,
      [idempotencyScope, key, requestHash, JSON.stringify(response)],
    );
  }

  private async insertItemRemovalAudits(
    client: QueryableClient,
    input: {
      actorId: string;
      organizationId: string;
      batchId: string;
      removedIds: string[];
      removedKeys: string[];
      correlationId: string;
    },
  ): Promise<void> {
    await client.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
       select 'USER', $2, $3, 'AUTHORIZATION_ITEM_REMOVED_BY_IMPORT_ROLLBACK', 'authorization_item', item_id,
              jsonb_build_object('batchId', $4::text, 'authorizationKey', item_key), $5, $6, 'SUCCESS'
       from unnest($1::uuid[], $7::text[]) as t(item_id, item_key)`,
      [
        input.removedIds,
        input.actorId,
        input.organizationId,
        input.batchId,
        input.correlationId,
        input.correlationId,
        input.removedKeys,
      ],
    );
  }

  private async insertAudit(
    client: QueryableClient,
    input: {
      actorId: string;
      organizationId: string;
      action: string;
      resourceType: string;
      resourceId: string;
      after: unknown;
      correlationId: string;
    },
  ): Promise<void> {
    await client.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
         values ('USER', $1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'SUCCESS')`,
      [
        input.actorId,
        input.organizationId,
        input.action,
        input.resourceType,
        input.resourceId,
        JSON.stringify(input.after),
        input.correlationId,
        input.correlationId,
      ],
    );
  }
}
