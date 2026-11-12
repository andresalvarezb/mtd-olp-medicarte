import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { createDatabase } from '@authorization/database';
import {
  COMPENSAR_AUTO_PATIENT_IDENTITY_POLICY,
  buildPatientBackfillInventory,
  classifyPatientBackfillRow,
  compensarIdentitySourceForAssessment,
} from '@authorization/domain';

type Database = ReturnType<typeof createDatabase>;
type Row = Readonly<{
  authorization_item_id: string;
  source_data: unknown;
  patient_id: string | null;
  linked_type: string | null;
  linked_value: string | null;
  linked_source_code: string | null;
  exact_candidate_patient_count: number;
}>;
type Batch = Readonly<{
  id: string;
  organization_id: string;
  policy_version: string;
  status: string;
  batch_size: number;
  summary: Record<string, number>;
}>;

const POLICY_VERSION = COMPENSAR_AUTO_PATIENT_IDENTITY_POLICY.version;
const SCOPE_SQL = `
  from authorization_items ai
  join authorization_item_organizations aio on aio.authorization_item_id = ai.id
  join organizations operational_org on operational_org.id = aio.organization_id
    and operational_org.code = 'MEDICARTE'
  left join patients linked on linked.id = ai.patient_id
  left join organizations linked_source on linked_source.id = linked.source_organization_id
  left join lateral (
    select count(*)::integer as candidate_count
      from patients candidate
      join organizations candidate_source on candidate_source.id = candidate.source_organization_id
        and candidate_source.code = 'COMPENSAR'
     where candidate.identification_type_raw = ai.source_data->>'TIPO_IDENTIFICACION'
       and candidate.identification_value_raw = coalesce(
         nullif(ai.source_data->>'IDENTIFICACION_PACIENTE', ''),
         nullif(ai.source_data->>'NUM_DOCUMENTO', '')
       )
  ) exact_candidates on true`;

const ROW_SQL = `select ai.id as authorization_item_id, ai.source_data, ai.patient_id,
    linked.identification_type_raw as linked_type,
    linked.identification_value_raw as linked_value,
    linked_source.code as linked_source_code,
    exact_candidates.candidate_count as exact_candidate_patient_count
  ${SCOPE_SQL}`;

function inventoryRow(row: Row) {
  const source = row.source_data;
  return {
    authorizationItemId: row.authorization_item_id,
    organizationCodes: ['MEDICARTE'],
    sourceData:
      source && typeof source === 'object' && !Array.isArray(source)
        ? compensarIdentitySourceForAssessment(source as Record<string, unknown>)
        : source,
    patientId: row.patient_id,
    exactCandidatePatientCount: Number(row.exact_candidate_patient_count),
    linkedPatient:
      row.linked_source_code === 'COMPENSAR' &&
      row.linked_type !== null &&
      row.linked_value !== null
        ? { identificationTypeRaw: row.linked_type, identificationValueRaw: row.linked_value }
        : null,
  };
}

/** Aggregate-only, read-only inventory. No identity values leave this process. */
export async function inspectCompensarPatientBackfill(database: Database) {
  const result = await database.pool.query<Row>(ROW_SQL);
  return buildPatientBackfillInventory(
    result.rows.map(inventoryRow),
    COMPENSAR_AUTO_PATIENT_IDENTITY_POLICY,
  );
}

export async function createCompensarPatientBackfillBatch(
  database: Database,
  batchSize = 100,
): Promise<string> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error('PATIENT_BACKFILL_BATCH_SIZE_INVALID');
  }
  const result = await database.pool.query<{ id: string }>(
    `insert into patient_backfill_batches (organization_id, policy_version, status, batch_size)
     select id, $1, 'PENDING', $2 from organizations where code = 'MTD' and active = true
     returning id`,
    [POLICY_VERSION, batchSize],
  );
  if (!result.rows[0]) throw new Error('PATIENT_BACKFILL_MTD_ORGANIZATION_MISSING');
  return result.rows[0].id;
}

async function auditLink(
  client: PoolClient,
  batch: Batch,
  authorizationItemId: string,
  patientId: string,
) {
  await client.query(
    `insert into audit_events
       (actor_type, organization_id, action, resource_type, resource_id,
        before, after, correlation_id, request_id, result)
     values ('SYSTEM', $1, 'patient.backfill.link', 'authorization_item', $2,
             $3::jsonb, $4::jsonb, $5, $5, 'SUCCESS')`,
    [
      batch.organization_id,
      authorizationItemId,
      JSON.stringify({ patientId: null }),
      JSON.stringify({ patientId }),
      batch.id,
    ],
  );
}

/** One bounded, resumable transaction page. No MTDOM request occurs here. */
export async function processCompensarPatientBackfillBatch(database: Database, batchId: string) {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    const selected = await client.query<Batch>(
      `select id, organization_id, policy_version, status, batch_size, summary
         from patient_backfill_batches
        where id = $1 and organization_id = (select id from organizations where code = 'MTD')
        for update`,
      [batchId],
    );
    const batch = selected.rows[0];
    if (!batch || batch.policy_version !== POLICY_VERSION) {
      throw new Error('PATIENT_BACKFILL_BATCH_POLICY_MISMATCH');
    }
    if (batch.status === 'COMPLETED' || batch.status === 'REVERTED') {
      await client.query('commit');
      return { processed: 0, remaining: false, summary: batch.summary ?? {} };
    }
    const rows = await client.query<Row>(
      `${ROW_SQL}
       where not exists (
         select 1 from patient_backfill_items bi
          where bi.batch_id = $1 and bi.authorization_item_id = ai.id
       )
       order by ai.id limit $2 for update of ai`,
      [batchId, batch.batch_size],
    );
    const summary = { ...(batch.summary ?? {}) };
    for (const row of rows.rows) {
      const evidence = inventoryRow(row);
      const decision = classifyPatientBackfillRow(evidence, COMPENSAR_AUTO_PATIENT_IDENTITY_POLICY);
      let status: 'LINKED' | 'ALREADY_LINKED' | 'NEEDS_RECONCILIATION' | 'CONFLICT';
      let reasonCode = decision.reasonCode as string;
      let patientId: string | null = null;
      let createdPatient = false;
      if (row.patient_id) {
        status =
          decision.status === 'ALREADY_LINKED' && row.linked_source_code === 'COMPENSAR'
            ? 'ALREADY_LINKED'
            : 'NEEDS_RECONCILIATION';
        reasonCode =
          status === 'ALREADY_LINKED'
            ? 'ALREADY_LINKED_MATCH'
            : row.linked_source_code !== 'COMPENSAR'
              ? 'LINKED_SOURCE_MISMATCH'
              : decision.reasonCode;
        if (status === 'ALREADY_LINKED') patientId = row.patient_id;
      } else if (decision.status !== 'ELIGIBLE') {
        status = 'NEEDS_RECONCILIATION';
      } else {
        const source = evidence.sourceData as Record<string, unknown>;
        const type = source.TIPO_IDENTIFICACION as string;
        const value = (source.IDENTIFICACION_PACIENTE || source.NUM_DOCUMENTO) as string;
        const lockKey = createHash('sha256')
          .update(JSON.stringify([type, value]))
          .digest()
          .readBigInt64BE(0)
          .toString();
        await client.query(`select pg_advisory_xact_lock($1::bigint)`, [lockKey]);
        const matches = await client.query<{ id: string }>(
          `select id from patients
            where source_organization_id = (select id from organizations where code = 'COMPENSAR')
              and identification_type_raw = $1 and identification_value_raw = $2
            order by id limit 2 for update`,
          [type, value],
        );
        if (matches.rows.length > 1) {
          status = 'CONFLICT';
          reasonCode = 'MULTIPLE_LOCAL_PATIENT_MATCHES';
        } else {
          patientId = matches.rows[0]?.id ?? null;
          if (!patientId) {
            const created = await client.query<{ id: string }>(
              `insert into patients
                 (source_organization_id, identification_type_raw, identification_value_raw)
               select id, $1, $2 from organizations where code = 'COMPENSAR' and active = true
               returning id`,
              [type, value],
            );
            patientId = created.rows[0]?.id ?? null;
            createdPatient = true;
          }
          if (!patientId) throw new Error('PATIENT_BACKFILL_COMPENSAR_ORGANIZATION_MISSING');
          const linked = await client.query(
            `update authorization_items set patient_id = $2
              where id = $1 and patient_id is null returning id`,
            [row.authorization_item_id, patientId],
          );
          if (!linked.rowCount) {
            status = 'CONFLICT';
            reasonCode = 'AUTHORIZATION_LINK_CHANGED';
            patientId = null;
          } else {
            status = 'LINKED';
            reasonCode = createdPatient
              ? 'PATIENT_CREATED_AND_LINKED'
              : 'PATIENT_REUSED_AND_LINKED';
            await auditLink(client, batch, row.authorization_item_id, patientId);
          }
        }
      }
      await client.query(
        `insert into patient_backfill_items
           (batch_id, authorization_item_id, status, reason_code,
            previous_patient_id, applied_patient_id, created_patient)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (batch_id, authorization_item_id) do nothing`,
        [
          batch.id,
          row.authorization_item_id,
          status,
          reasonCode,
          row.patient_id,
          patientId,
          createdPatient,
        ],
      );
      const key = `${status.toLowerCase()}_${reasonCode.toLowerCase()}`;
      summary[key] = (summary[key] ?? 0) + 1;
    }
    const remaining = rows.rows.length === batch.batch_size;
    await client.query(
      `update patient_backfill_batches
          set status = $2, summary = $3::jsonb,
              started_at = coalesce(started_at, now()),
              completed_at = case when $2 = 'COMPLETED' then now() else null end,
              last_error_code = null
        where id = $1`,
      [batch.id, remaining ? 'RUNNING' : 'COMPLETED', JSON.stringify(summary)],
    );
    await client.query('commit');
    return { processed: rows.rows.length, remaining, summary };
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      /* transaction already closed */
    }
    const code =
      error instanceof Error && /^PATIENT_BACKFILL_[A-Z_]+$/.test(error.message)
        ? error.message
        : 'PATIENT_BACKFILL_BATCH_FAILED';
    await database.pool.query(
      `update patient_backfill_batches
          set status = case when status = 'PENDING' then 'FAILED' else 'PARTIAL' end,
              last_error_code = $2
        where id = $1 and policy_version = $3 and status not in ('COMPLETED', 'REVERTED')`,
      [batchId, code, POLICY_VERSION],
    );
    throw new Error(code);
  } finally {
    client.release();
  }
}

/** Queue only completed-batch, still-linked patients after the worker is enabled. */
export async function enqueueCompensarPatientBackfillBatch(
  database: Database,
  batchId: string,
  limit = 100,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new Error('PATIENT_BACKFILL_BATCH_SIZE_INVALID');
  const selected = await database.pool.query<Batch>(
    `select id, organization_id, policy_version, status, batch_size, summary
       from patient_backfill_batches
      where id = $1 and organization_id = (select id from organizations where code = 'MTD')`,
    [batchId],
  );
  const batch = selected.rows[0];
  if (!batch || batch.policy_version !== POLICY_VERSION || batch.status !== 'COMPLETED')
    throw new Error('PATIENT_BACKFILL_BATCH_NOT_READY_FOR_LOOKUP');
  const inserted = await database.pool.query<{ id: string }>(
    `with candidates as (
       select distinct p.id
         from patient_backfill_items bi
         join authorization_items ai on ai.id = bi.authorization_item_id
         join patients p on p.id = ai.patient_id and p.id = bi.applied_patient_id
         join organizations source_org on source_org.id = p.source_organization_id
           and source_org.code = 'COMPENSAR'
        where bi.batch_id = $1 and bi.status in ('LINKED', 'ALREADY_LINKED')
           and p.identification_type_raw = '1'
          and ai.source_data->>'TIPO_IDENTIFICACION' = p.identification_type_raw
          and coalesce(nullif(ai.source_data->>'IDENTIFICACION_PACIENTE', ''),
                       nullif(ai.source_data->>'NUM_DOCUMENTO', '')) = p.identification_value_raw
          and (nullif(ai.source_data->>'IDENTIFICACION_PACIENTE', '') is null
               or nullif(ai.source_data->>'NUM_DOCUMENTO', '') is null
               or ai.source_data->>'IDENTIFICACION_PACIENTE' = ai.source_data->>'NUM_DOCUMENTO')
          and exists (
            select 1 from authorization_item_organizations aio
            join organizations operational_org on operational_org.id = aio.organization_id
              and operational_org.code = 'MEDICARTE'
            where aio.authorization_item_id = ai.id
          )
          and not exists (
            select 1 from outbox_events e
             where e.idempotency_key = 'patient.lookup.v1:' || p.id::text
          )
        order by p.id limit $2
     )
     insert into outbox_events
       (event_type, version, payload, correlation_id, organization_id, idempotency_key)
     select 'patient.lookup', 1, jsonb_build_object('patientId', c.id),
            $1::uuid, $3::uuid, 'patient.lookup.v1:' || c.id::text
       from candidates c
     on conflict (idempotency_key) do nothing
     returning id`,
    [batchId, limit, batch.organization_id],
  );
  return inserted.rowCount ?? inserted.rows.length;
}

/** Reverses only this batch's unchanged links. Patient rows are intentionally retained. */
export async function revertCompensarPatientBackfillBatch(database: Database, batchId: string) {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    const result = await client.query<Batch>(
      `select id, organization_id, policy_version, status, batch_size, summary
         from patient_backfill_batches
        where id = $1 and organization_id = (select id from organizations where code = 'MTD')
        for update`,
      [batchId],
    );
    const batch = result.rows[0];
    if (!batch || batch.policy_version !== POLICY_VERSION)
      throw new Error('PATIENT_BACKFILL_BATCH_POLICY_MISMATCH');
    const items = await client.query<{
      id: string;
      authorization_item_id: string;
      previous_patient_id: string | null;
      applied_patient_id: string | null;
    }>(
      `select id, authorization_item_id, previous_patient_id, applied_patient_id
         from patient_backfill_items where batch_id = $1 and status = 'LINKED'
        order by processed_at desc for update`,
      [batchId],
    );
    let reverted = 0;
    let conflicts = 0;
    for (const item of items.rows) {
      const updated = await client.query(
        `update authorization_items set patient_id = $3
          where id = $1 and patient_id = $2 returning id`,
        [item.authorization_item_id, item.applied_patient_id, item.previous_patient_id],
      );
      const status = updated.rowCount ? 'REVERTED' : 'REVERT_CONFLICT';
      await client.query(
        `update patient_backfill_items set status = $2, reason_code = $3, processed_at = now()
          where id = $1`,
        [item.id, status, updated.rowCount ? 'LINK_REVERSED' : 'LINK_CHANGED_AFTER_BACKFILL'],
      );
      if (updated.rowCount) {
        reverted += 1;
        await client.query(
          `insert into audit_events
             (actor_type, organization_id, action, resource_type, resource_id,
              before, after, correlation_id, request_id, result)
           values ('SYSTEM', $1, 'patient.backfill.revert', 'authorization_item', $2,
                   $3::jsonb, $4::jsonb, $5, $5, 'SUCCESS')`,
          [
            batch.organization_id,
            item.authorization_item_id,
            JSON.stringify({ patientId: item.applied_patient_id }),
            JSON.stringify({ patientId: item.previous_patient_id }),
            batch.id,
          ],
        );
      } else conflicts += 1;
    }
    await client.query(
      `update patient_backfill_batches set status = 'REVERTED', reverted_at = now(),
          last_error_code = case when $2 > 0 then 'PATIENT_BACKFILL_REVERT_CONFLICT' else null end
        where id = $1`,
      [batch.id, conflicts],
    );
    await client.query('commit');
    return { reverted, conflicts };
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      /* transaction already closed */
    }
    const code =
      error instanceof Error && /^PATIENT_BACKFILL_[A-Z_]+$/.test(error.message)
        ? error.message
        : 'PATIENT_BACKFILL_REVERT_FAILED';
    throw new Error(code);
  } finally {
    client.release();
  }
}
