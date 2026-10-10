import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import type { Scope } from '../common/request-scope';
import { DATABASE } from '../tokens';
import { resolveAuthorizationOperationalStatus } from '../clinical/authorization-query-status';
import { resolveAuthorizationInitialValidationStatus, resolveAuthorizationValidityStatus } from '../clinical/authorization-query-state';
import { authorizationQueryValidityWindow } from '../clinical/authorization-query-validity';
import {
  BILLING_AUDIT_BULK_MAX_BYTES,
  createBillingAuditBulkResult,
  createBillingAuditBulkTemplate,
  parseBillingAuditBulkWorkbook,
} from './authorization-billing-audit-bulk.xlsx';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
type Decision = 'COMPLIES' | 'DOES_NOT_COMPLY';
type BulkRow = {
  id: string; row_number: number; authorization_key: string; result: Decision;
  observation: string | null; validation_status: string; execution_status: string;
  error_code: string | null; error_message: string | null;
  operational_status_at_decision: string | null;
};
type AuthRow = {
  id: string; authorization_key: string;
  quantity: string | null; assignment_date: string | null; validity_end_date: string | null;
  enablement_status: string; tariff_membership_status: string; coverage_type: string;
  direction_status: string; mipres_manual_decision: string;
  minimum_quantity: number | null;
  fulfillment_quantity: number | string;
  application_quantity: number | string;
  consumed_quantity: number | string;
  remaining_assigned_quantity: number | string;
};
type ResultRow = {
  rowNumber: number; authorizationKey: string; result: Decision | null; observation: string | null;
  executionStatus: string; errorCode: string | null; errorMessage: string | null;
  operationalStatus: string | null;
};


export function isBillingAuditBulkEligibleStatus(
  status: ReturnType<typeof resolveBillingAuditBulkOperationalStatus>,
): boolean {
  return status === 'CLOSED';
}

export function resolveBillingAuditBulkOperationalStatus(authorization: AuthRow, today = authorizationQueryValidityWindow().today) {
  const initial = resolveAuthorizationInitialValidationStatus({
      enablementStatus: authorization.enablement_status,
      tariffMembershipStatus: authorization.tariff_membership_status,
      coverageType: authorization.coverage_type,
      directionStatus: authorization.direction_status,
      mipresManualDecision: authorization.mipres_manual_decision,
      quantity: authorization.quantity,
      minimumQuantity: authorization.minimum_quantity,
    });
  const validity = resolveAuthorizationValidityStatus({
      assignmentDate: authorization.assignment_date,
      validityEndDate: authorization.validity_end_date,
      today,
    });
    const operationalEligible = initial === 'PASSED' && (validity === 'IN_WINDOW' || validity === 'EXPIRED');
    const authorizedQuantity = Math.max(Number(authorization.quantity ?? 0), 0);
    const fulfilledQuantity = Math.max(Number(authorization.fulfillment_quantity),
      Number(authorization.application_quantity), Number(authorization.consumed_quantity), 0);
    const operationalStatus = resolveAuthorizationOperationalStatus({
      authorizedQuantity, fulfilledQuantity,
      operationalEligible, remainingAssignedQuantity: Number(authorization.remaining_assigned_quantity),
    });
  return operationalStatus;
}

function billingAuditBulkAuthorizationSnapshotSql(
  predicate: SQL,
  forUpdate = false,
): SQL {
  return sql`
      select i.id, i.authorization_key, i.source_data->>'CANTIDAD' as quantity,
        i.source_data->>'FECHA_ASIGNACION' as assignment_date,
        i.source_data->>'FECHA_FINAL_VIGENCIA' as validity_end_date,
        i.enablement_status, i.tariff_membership_status, i.coverage_type, i.direction_status,
        i.mipres_manual_decision,
        (select tap.minimum_quantity from tariff_annex_products tap
          where tap.codigo_producto = i.codigo_medicamento and tap.active = true
          order by tap.updated_at desc, tap.id desc limit 1) as minimum_quantity,
        coalesce((select sum(af.quantity)::int from authorization_fulfillments af
          where af.authorization_item_id = i.id), 0)::int as fulfillment_quantity,
        coalesce((select sum(pal.quantity)::int from patient_applications pa
          join patient_application_lines pal on pal.patient_application_id = pa.id
          where pa.authorization_item_id = i.id and pa.status = 'CONFIRMED'), 0)::int as application_quantity,
        coalesce((select sum(iaa.consumed_quantity)::int from inventory_authorization_allocations iaa
          where iaa.authorization_item_id = i.id), 0)::int as consumed_quantity,
        coalesce((select sum(greatest(iaa.allocated_quantity - iaa.consumed_quantity - iaa.released_quantity, 0))::int
          from inventory_authorization_allocations iaa where iaa.authorization_item_id = i.id
          and iaa.status in ('ALLOCATED', 'PARTIALLY_CONSUMED')), 0)::int as remaining_assigned_quantity
      from authorization_items i where ${predicate} ${forUpdate ? sql`for update of i` : sql``}
    `;
}

@Injectable()
export class AuthorizationBillingAuditBulkService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private assertMtd(scope: Scope): void {
    if (scope.organizationCode !== 'MTD') {
      throw new ForbiddenException({ code: 'BILLING_AUDIT_BULK_MTD_ONLY', message: 'Solo MTD puede usar la carga masiva de auditoría.' });
    }
  }

  template(scope: Scope): Buffer {
    this.assertMtd(scope);
    return createBillingAuditBulkTemplate();
  }

  async upload(file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined, scope: Scope) {
    this.assertMtd(scope);
    if (!file || !/\.xlsx$/i.test(file.originalname) || file.size <= 0 || file.size > BILLING_AUDIT_BULK_MAX_BYTES ||
        !['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', ''].includes(file.mimetype)) {
      throw new BadRequestException({ code: 'INVALID_BILLING_AUDIT_FILE', message: 'Se requiere XLSX de hasta 20 MiB.' });
    }
    const rows = parseBillingAuditBulkWorkbook(file.buffer);
    const keys = [...new Set(rows.filter((r) => !r.errorCode).map((r) => r.authorizationKey))];
    if (keys.length) {
      const existing = await this.database.db.execute<{ authorization_key: string; review_status: string | null }>(sql`
        select i.authorization_key, aba.status as review_status
        from authorization_items i
        left join authorization_billing_audits aba on aba.authorization_item_id = i.id
        where i.authorization_key in (${sql.join(keys.map((key) => sql`${key}`), sql`, `)})
      `);
      const byKey = new Map(existing.rows.map((r) => [r.authorization_key, r.review_status]));
      const previewSnapshots = await this.database.db.execute<AuthRow>(
        billingAuditBulkAuthorizationSnapshotSql(
          sql`i.authorization_key in (${sql.join(keys.map((key) => sql`${key}`), sql`, `)})`,
        ),
      );
      const operationalByKey = new Map(
        previewSnapshots.rows.map((auth) => [
          auth.authorization_key,
          resolveBillingAuditBulkOperationalStatus(auth),
        ]),
      );
      for (const row of rows) {
        if (row.errorCode) continue;
        if (!byKey.has(row.authorizationKey)) {
          row.errorCode = 'AUTO_NOT_FOUND'; row.errorMessage = 'La clave AUTO no existe.';
        } else if (byKey.get(row.authorizationKey) === 'REVIEWED') {
          row.errorCode = 'AUDIT_ALREADY_REVIEWED'; row.errorMessage = 'La AUTO ya tiene auditoría definitiva.';
        } else {
          const operationalStatus = operationalByKey.get(row.authorizationKey);

          if (
            !operationalStatus ||
            !isBillingAuditBulkEligibleStatus(operationalStatus)
          ) {
            row.errorCode = 'AUTO_NOT_ELIGIBLE';
            row.errorMessage =
              'La AUTO debe estar cerrada. PARTIALLY_ASSIGNED no representa un cierre con aplicación pendiente.';
          }
        }
      }
    }
    const jobId = randomUUID();
    const valid = rows.filter((r) => !r.errorCode).length;
    const digest = createHash('sha256').update(file.buffer).digest('hex');
    await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into authorization_billing_audit_bulk_jobs
          (id, organization_id, created_by, correlation_id, template_version, filename, file_hash, status, total_rows, valid_rows)
        values (${jobId}, ${scope.organizationId}, ${scope.userId}, ${scope.correlationId}, 'BILLING_AUDIT_V1', ${file.originalname.slice(0, 255)}, ${digest}, ${valid ? 'READY' : 'INVALID'}, ${rows.length}, ${valid})
      `);
      for (let start = 0; start < rows.length; start += 100) {
        const batch = rows.slice(start, start + 100);
        const values = batch.map((r) => sql`(
          ${jobId}, ${r.rowNumber}, ${r.authorizationKey}, ${r.result}, ${r.observation},
          ${r.errorCode ? 'INVALID' : 'VALID'}, ${r.errorCode ? 'SKIPPED' : 'PENDING'}, ${r.errorCode}, ${r.errorMessage}
        )`);
        await tx.execute(sql`
          insert into authorization_billing_audit_bulk_rows
            (job_id, row_number, authorization_key, result, observation, validation_status, execution_status, error_code, error_message)
          values ${sql.join(values, sql`, `)}
        `);
      }
    });
    return this.getJob(jobId, scope);
  }

  async getJob(jobId: string, scope: Scope, limit = 100, offset = 0) {
    this.assertMtd(scope);
    const job = (await this.database.db.execute<{
      id: string; status: string; total_rows: number; valid_rows: number;
      created_at: Date | string; confirmed_at: Date | string | null; completed_at: Date | string | null;
    }>(sql`
      select id, status, total_rows, valid_rows, created_at, confirmed_at, completed_at
      from authorization_billing_audit_bulk_jobs
      where id = ${jobId} and organization_id = ${scope.organizationId}
    `)).rows[0];
    if (!job) throw new NotFoundException({ code: 'BILLING_AUDIT_BULK_JOB_NOT_FOUND', message: 'No se encontró el lote.' });
    const counts = (await this.database.db.execute<{
      succeeded: number; failed: number; pending: number; skipped: number;
    }>(sql`
      select
        count(*) filter (where execution_status = 'SUCCEEDED')::int as succeeded,
        count(*) filter (where execution_status = 'FAILED')::int as failed,
        count(*) filter (where execution_status = 'PENDING')::int as pending,
        count(*) filter (where execution_status = 'SKIPPED')::int as skipped
      from authorization_billing_audit_bulk_rows where job_id = ${jobId}
    `)).rows[0];
    const rows = await this.readRows(jobId, Math.min(Math.max(limit, 1), 500), Math.max(offset, 0));
    return { ...job, counts, rows, limit: Math.min(Math.max(limit, 1), 500), offset: Math.max(offset, 0) };
  }

  private async readRows(jobId: string, limit: number, offset = 0): Promise<ResultRow[]> {
    const rows = await this.database.db.execute<{
      row_number: number; authorization_key: string; result: Decision | null; observation: string | null;
      execution_status: string; error_code: string | null; error_message: string | null;
      operational_status_at_decision: string | null;
    }>(sql`
      select row_number, authorization_key, result, observation, execution_status, error_code, error_message,
        operational_status_at_decision
      from authorization_billing_audit_bulk_rows
      where job_id = ${jobId} order by row_number asc limit ${limit} offset ${offset}
    `);
    return rows.rows.map((r) => ({
      rowNumber: r.row_number, authorizationKey: r.authorization_key, result: r.result,
      observation: r.observation, executionStatus: r.execution_status, errorCode: r.error_code,
      errorMessage: r.error_message, operationalStatus: r.operational_status_at_decision,
    }));
  }

  async resultWorkbook(jobId: string, scope: Scope): Promise<Buffer> {
    const job = await this.getJob(jobId, scope, 1, 0);
    return createBillingAuditBulkResult(await this.readRows(job.id, 5000));
  }

  async confirm(jobId: string, scope: Scope) {
    this.assertMtd(scope);
    const current = await this.getJob(jobId, scope, 1, 0);
    if (['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED'].includes(current.status)) return current;
    if (current.status === 'INVALID') {
      throw new ConflictException({ code: 'BILLING_AUDIT_BULK_INVALID_JOB', message: 'No existen filas válidas para confirmar.' });
    }
    await this.database.db.execute(sql`
      update authorization_billing_audit_bulk_jobs set status = 'PROCESSING', confirmed_at = coalesce(confirmed_at, now())
      where id = ${jobId} and organization_id = ${scope.organizationId} and status in ('READY', 'PROCESSING')
    `);

    for (;;) {
      const handled = await this.database.db.transaction(async (tx) => {
        const row = (await tx.execute<BulkRow>(sql`
          select id, row_number, authorization_key, result, observation, validation_status, execution_status,
            error_code, error_message, operational_status_at_decision
          from authorization_billing_audit_bulk_rows
          where job_id = ${jobId} and validation_status = 'VALID' and execution_status = 'PENDING'
          order by row_number asc limit 1 for update skip locked
        `)).rows[0];
        if (!row) return false;
        const decision = await this.applyDecision(tx, row, scope, jobId);
        await tx.execute(sql`
          update authorization_billing_audit_bulk_rows
          set execution_status = ${decision.ok ? 'SUCCEEDED' : 'FAILED'}, error_code = ${decision.code},
            error_message = ${decision.message}, billing_audit_id = ${decision.auditId},
            operational_status_at_decision = ${decision.operationalStatus}, executed_at = now()
          where id = ${row.id}
        `);
        return true;
      });
      if (!handled) break;
    }

    await this.database.db.execute(sql`
      update authorization_billing_audit_bulk_jobs j
      set status = case
          when exists (select 1 from authorization_billing_audit_bulk_rows r where r.job_id = j.id and r.execution_status = 'PENDING') then 'PROCESSING'
          when exists (select 1 from authorization_billing_audit_bulk_rows r where r.job_id = j.id and r.execution_status = 'SUCCEEDED')
            and exists (select 1 from authorization_billing_audit_bulk_rows r where r.job_id = j.id and r.execution_status in ('FAILED', 'SKIPPED')) then 'PARTIALLY_COMPLETED'
          when exists (select 1 from authorization_billing_audit_bulk_rows r where r.job_id = j.id and r.execution_status = 'SUCCEEDED') then 'COMPLETED'
          else 'FAILED'
        end,
        completed_at = case
          when not exists (select 1 from authorization_billing_audit_bulk_rows r where r.job_id = j.id and r.execution_status = 'PENDING') then now()
          else null end
      where j.id = ${jobId} and j.organization_id = ${scope.organizationId} and j.status = 'PROCESSING'
    `);
    return this.getJob(jobId, scope);
  }

  private async applyDecision(tx: Tx, row: BulkRow, scope: Scope, jobId: string): Promise<{
    ok: boolean; code: string | null; message: string | null; auditId: string | null; operationalStatus: string | null;
  }> {
    const fail = (code: string, message: string, operationalStatus: string | null = null) => ({
      ok: false, code, message, auditId: null, operationalStatus,
    });
    const authorization = (await tx.execute<AuthRow>(billingAuditBulkAuthorizationSnapshotSql(sql`i.authorization_key = ${row.authorization_key}`, true))).rows[0];
    if (!authorization) return fail('AUTO_NOT_FOUND', 'La clave AUTO no existe.');

    const operationalStatus = resolveBillingAuditBulkOperationalStatus(authorization);

if (!isBillingAuditBulkEligibleStatus(operationalStatus)) {
      return fail(
        'AUTO_NOT_ELIGIBLE',
        'La AUTO debe estar cerrada. PARTIALLY_ASSIGNED no es un cierre con aplicación pendiente.',
        operationalStatus,
      );
    }
    const existing = (await tx.execute<{ id: string; status: string; result: Decision | null; observation: string | null }>(sql`
      select id, status, result, observation from authorization_billing_audits
      where authorization_item_id = ${authorization.id} for update
    `)).rows[0];
    if (existing?.status === 'REVIEWED') return fail('AUDIT_ALREADY_REVIEWED', 'La auditoría es definitiva y no puede modificarse.', operationalStatus);
    if (row.result === 'DOES_NOT_COMPLY' && !row.observation?.trim()) {
      return fail('OBSERVATION_REQUIRED', 'NO CUMPLE requiere observación.', operationalStatus);
    }
    const count = (await tx.execute<{ count: number }>(sql`
      select count(*)::int as count from authorization_drive_supports
      where authorization_item_id = ${authorization.id} and is_present = true
    `)).rows[0]?.count ?? 0;
    if (Number(count) === 0 && !row.observation?.trim()) {
      return fail('OBSERVATION_REQUIRED_WITHOUT_EVIDENCE', 'Sin soportes, la observación es obligatoria.', operationalStatus);
    }
    let auditId = existing?.id;
    if (!auditId) {
      auditId = (await tx.execute<{ id: string }>(sql`
        insert into authorization_billing_audits
          (authorization_item_id, status, result, observation, created_by, correlation_id)
        values (${authorization.id}, 'PENDING', null, null, ${scope.userId}, ${scope.correlationId}) returning id
      `)).rows[0]?.id;
    }
    if (!auditId) throw new Error('BILLING_AUDIT_INSERT_FAILED');
    const updated = (await tx.execute<{ id: string }>(sql`
      update authorization_billing_audits set status = 'REVIEWED', result = ${row.result},
        observation = ${row.observation}, audited_by = ${scope.userId}, audited_at = now(), updated_at = now()
      where id = ${auditId} and status = 'PENDING' returning id
    `)).rows[0];
    if (!updated) return fail('AUDIT_ALREADY_REVIEWED', 'La auditoría fue cerrada por otra operación.', operationalStatus);
    await tx.execute(sql`
      insert into audit_events
        (actor_type, actor_id, organization_id, action, resource_type, resource_id, before, after,
          correlation_id, request_id, result)
      values ('USER', ${scope.userId}, ${scope.organizationId}, 'AUTHORIZATION_BILLING_AUDIT_REVIEWED',
        'authorization_billing_audit', ${auditId},
        ${existing ? JSON.stringify({ status: existing.status, result: existing.result, observation: existing.observation }) : null}::jsonb,
        ${JSON.stringify({ authorizationItemId: authorization.id, status: 'REVIEWED', result: row.result,
          observation: row.observation, operationalStatusAtDecision: operationalStatus, source: 'BULK_XLSX',
          importJobId: jobId, importRowNumber: row.row_number })}::jsonb,
        ${scope.correlationId}, ${scope.correlationId}, 'SUCCESS')
    `);
    return { ok: true, code: null, message: null, auditId, operationalStatus };
  }
}
