import type { PoolClient } from 'pg';
import {
  buildPatientBackfillInventory,
  classifyPatientBackfillRow,
  type PatientBackfillInventoryRow,
  type PatientBackfillReport,
} from '@authorization/domain';
import type { PatientIdentityNormalizationPolicy } from '@authorization/domain';
import type { createDatabase } from '@authorization/database';

type Database = ReturnType<typeof createDatabase>;
type IdentityRow = Readonly<{
  authorization_item_id: string;
  source_data: unknown;
  patient_id: string | null;
  exact_candidate_patient_count: number;
  linked_type: string | null;
  linked_value: string | null;
  organization_codes: string[];
}>;

export type SyntheticBackfillGuard = Readonly<{
  enabled: boolean;
  nodeEnv: string | undefined;
  databaseUrl: string;
  policyVersion: string;
}>;

export function assertSyntheticPatientBackfillAllowed(guard: SyntheticBackfillGuard): void {
  if (
    !guard.enabled ||
    guard.nodeEnv !== 'test' ||
    !guard.policyVersion.startsWith('SYNTHETIC_EXACT_TEST_')
  ) {
    throw new Error('PATIENT_BACKFILL_SYNTHETIC_MODE_REQUIRED');
  }
  let target: URL;
  try {
    target = new URL(guard.databaseUrl);
  } catch {
    throw new Error('PATIENT_BACKFILL_TEST_DATABASE_REQUIRED');
  }
  const databaseName = target.pathname.replace(/^\//, '');
  if (
    !['localhost', '127.0.0.1', '::1'].includes(target.hostname) ||
    target.port !== '25432' ||
    databaseName !== 'authorization_test_integration'
  )
    throw new Error('PATIENT_BACKFILL_TEST_DATABASE_REQUIRED');
}

function mapIdentityRow(row: IdentityRow): PatientBackfillInventoryRow {
  return {
    authorizationItemId: row.authorization_item_id,
    organizationCodes: row.organization_codes,
    sourceData: row.source_data,
    patientId: row.patient_id,
    exactCandidatePatientCount: Number(row.exact_candidate_patient_count ?? 0),
    linkedPatient:
      row.linked_type !== null && row.linked_value !== null
        ? { identificationTypeRaw: row.linked_type, identificationValueRaw: row.linked_value }
        : null,
  };
}

const MEDICARTE_SCOPE_SQL = `
  from authorization_items ai
  join authorization_item_organizations aio on aio.authorization_item_id = ai.id
  join organizations o on o.id = aio.organization_id and o.code = 'MEDICARTE'
  left join patients p on p.id = ai.patient_id
  left join lateral (
    select count(*)::integer exact_candidate_patient_count
      from patients candidate
     where candidate.identification_type_raw = ai.source_data->>'TIPO_IDENTIFICACION'
       and candidate.identification_value_raw = coalesce(
         nullif(ai.source_data->>'IDENTIFICACION_PACIENTE', ''),
         nullif(ai.source_data->>'NUM_DOCUMENTO', '')
       )
  ) exact_candidates on true
`;

/** Read-only inventory. It returns aggregate counts only and never creates outbox events. */
export async function inspectPatientBackfillInventory(
  database: Database,
  policy?: PatientIdentityNormalizationPolicy,
): Promise<PatientBackfillReport> {
  const result = await database.pool.query<IdentityRow>(
    `select ai.id authorization_item_id, ai.source_data, ai.patient_id,
            p.identification_type_raw linked_type,
            p.identification_value_raw linked_value,
            exact_candidates.exact_candidate_patient_count,
            array['MEDICARTE']::text[] organization_codes
       ${MEDICARTE_SCOPE_SQL}
      `,
  );
  return buildPatientBackfillInventory(result.rows.map(mapIdentityRow), policy);
}

export async function createSyntheticPatientBackfillBatch(
  database: Database,
  guard: SyntheticBackfillGuard,
  policy: PatientIdentityNormalizationPolicy,
  batchSize = 100,
): Promise<string> {
  assertSyntheticPatientBackfillAllowed(guard);
  if (guard.policyVersion !== policy.version) {
    throw new Error('PATIENT_BACKFILL_BATCH_POLICY_MISMATCH');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error('PATIENT_BACKFILL_BATCH_SIZE_INVALID');
  }
  const result = await database.pool.query<{ id: string }>(
    `insert into patient_backfill_batches
       (organization_id, policy_version, status, batch_size)
     select id, $1, 'PENDING', $2 from organizations where code = 'MEDICARTE' and active = true
     returning id`,
    [policy.version, batchSize],
  );
  if (!result.rows[0]) throw new Error('PATIENT_BACKFILL_MEDICARTE_ORGANIZATION_MISSING');
  return result.rows[0].id;
}

function requireExactTestPolicy(policy: PatientIdentityNormalizationPolicy) {
  if (!policy.version.startsWith('SYNTHETIC_EXACT_TEST_')) {
    throw new Error('PATIENT_BACKFILL_EXACT_SYNTHETIC_POLICY_REQUIRED');
  }
}

type BatchRow = Readonly<{
  id: string;
  organization_id: string;
  policy_version: string;
  status: string;
  batch_size: number;
  summary: Record<string, number>;
}>;

function bump(summary: Record<string, number>, key: string) {
  summary[key] = (summary[key] ?? 0) + 1;
}

function insertAuditEvent(
  client: PoolClient,
  organizationId: string,
  batchId: string,
  authorizationItemId: string,
  action: string,
  before: unknown,
  after: unknown,
) {
  return client.query(
    `insert into audit_events
       (actor_type, organization_id, action, resource_type, resource_id,
        before, after, correlation_id, request_id, result)
     values ('SYSTEM', $1, $2, 'authorization_item', $3, $4::jsonb, $5::jsonb,
             $6, $6, 'SUCCESS')`,
    [
      organizationId,
      action,
      authorizationItemId,
      JSON.stringify(before),
      JSON.stringify(after),
      batchId,
    ],
  );
}

/**
 * Executes one small, resumable transaction page. The only enabled policy is
 * exact synthetic identity; source_data and operational fields are read-only.
 */
export async function processSyntheticPatientBackfillBatch(
  database: Database,
  guard: SyntheticBackfillGuard,
  batchId: string,
  policy: PatientIdentityNormalizationPolicy,
): Promise<
  Readonly<{ processed: number; remaining: boolean; summary: Readonly<Record<string, number>> }>
> {
  assertSyntheticPatientBackfillAllowed(guard);
  requireExactTestPolicy(policy);
  if (guard.policyVersion !== policy.version) {
    throw new Error('PATIENT_BACKFILL_BATCH_POLICY_MISMATCH');
  }
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    const batchResult = await client.query<BatchRow>(
      `select id, organization_id, policy_version, status, batch_size, summary
         from patient_backfill_batches
        where id = $1 and organization_id = (select id from organizations where code = 'MEDICARTE')
        for update`,
      [batchId],
    );
    const batch = batchResult.rows[0];
    if (!batch || batch.policy_version !== policy.version) {
      await client.query('rollback');
      throw new Error('PATIENT_BACKFILL_BATCH_POLICY_MISMATCH');
    }
    if (batch.status === 'COMPLETED' || batch.status === 'REVERTED') {
      await client.query('commit');
      return { processed: 0, remaining: false, summary: batch.summary ?? {} };
    }
    const rows = await client.query<IdentityRow>(
      `select ai.id authorization_item_id, ai.source_data, ai.patient_id,
              p.identification_type_raw linked_type,
              p.identification_value_raw linked_value,
              exact_candidates.exact_candidate_patient_count,
              array['MEDICARTE']::text[] organization_codes
         ${MEDICARTE_SCOPE_SQL}
        where not exists (
          select 1 from patient_backfill_items bi
           where bi.batch_id = $1 and bi.authorization_item_id = ai.id
        )
        order by ai.id
        limit $2
        for update of ai`,
      [batchId, batch.batch_size],
    );
    const summary = { ...(batch.summary ?? {}) };
    for (const source of rows.rows) {
      const inventoryRow = mapIdentityRow(source);
      const decision = classifyPatientBackfillRow(inventoryRow, policy);
      let status:
        | 'ELIGIBLE'
        | 'LINKED'
        | 'ALREADY_LINKED'
        | 'NEEDS_RECONCILIATION'
        | 'CONFLICT'
        | 'OUT_OF_SCOPE' = decision.status;
      let reasonCode: string = decision.reasonCode;
      let appliedPatientId: string | null = null;
      let createdPatient = false;
      const previousPatientId = source.patient_id;

      if (status === 'ALREADY_LINKED') {
        appliedPatientId = source.patient_id;
      } else if (status === 'ELIGIBLE') {
        const sourceData =
          typeof source.source_data === 'object' && source.source_data !== null
            ? (source.source_data as Record<string, unknown>)
            : {};
        const identity = classifyExactIdentity(sourceData, policy);
        if (!identity) {
          status = 'NEEDS_RECONCILIATION';
          reasonCode = 'IDENTITY_REQUIRES_REVIEW';
        } else {
          await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
            JSON.stringify([identity.documentType, identity.documentValue]),
          ]);
          const matches = await client.query<{ id: string }>(
            `select id from patients
              where identification_type_raw = $1 and identification_value_raw = $2
              order by id for update`,
            [identity.documentType, identity.documentValue],
          );
          if (matches.rows.length > 1) {
            status = 'CONFLICT';
            reasonCode = 'MULTIPLE_LOCAL_PATIENT_MATCHES';
          } else {
            appliedPatientId =
              matches.rows[0]?.id ??
              (
                await client.query<{ id: string }>(
                  `insert into patients (identification_type_raw, identification_value_raw)
               values ($1, $2) returning id`,
                  [identity.documentType, identity.documentValue],
                )
              ).rows[0]?.id ??
              null;
            createdPatient = matches.rows.length === 0;
            if (!appliedPatientId) throw new Error('PATIENT_BACKFILL_PATIENT_CREATE_FAILED');
            const linked = await client.query(
              `update authorization_items set patient_id = $2
                where id = $1 and patient_id is null returning id`,
              [source.authorization_item_id, appliedPatientId],
            );
            if (!linked.rowCount) {
              status = 'CONFLICT';
              reasonCode = 'AUTHORIZATION_LINK_CHANGED';
              appliedPatientId = null;
            } else {
              status = 'LINKED';
              reasonCode = createdPatient
                ? 'PATIENT_CREATED_AND_LINKED'
                : 'PATIENT_REUSED_AND_LINKED';
              await insertAuditEvent(
                client,
                batch.organization_id,
                batchId,
                source.authorization_item_id,
                'patient.backfill.link',
                { patientId: null },
                { patientId: appliedPatientId },
              );
            }
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
          batchId,
          source.authorization_item_id,
          status,
          reasonCode,
          previousPatientId,
          appliedPatientId,
          createdPatient,
        ],
      );
      bump(summary, `${status.toLowerCase()}_${reasonCode.toLowerCase()}`);
    }
    const remaining = rows.rows.length === batch.batch_size;
    await client.query(
      `update patient_backfill_batches
          set status = $2, summary = $3::jsonb,
              started_at = coalesce(started_at, now()),
              completed_at = case when $2 = 'COMPLETED' then now() else null end,
              last_error_code = null
        where id = $1`,
      [batchId, remaining ? 'RUNNING' : 'COMPLETED', JSON.stringify(summary)],
    );
    await client.query('commit');
    return { processed: rows.rows.length, remaining, summary };
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      /* transaction already closed */
    }
    const safeErrorCode =
      error instanceof Error && /^PATIENT_BACKFILL_[A-Z_]+$/.test(error.message)
        ? error.message
        : 'PATIENT_BACKFILL_BATCH_FAILED';
    await database.pool.query(
      `update patient_backfill_batches
          set status = case when status = 'PENDING' then 'FAILED' else 'PARTIAL' end,
              last_error_code = $2
        where id = $1 and status not in ('COMPLETED', 'REVERTED')`,
      [batchId, safeErrorCode],
    );
    throw new Error(safeErrorCode);
  } finally {
    client.release();
  }
}

function classifyExactIdentity(
  source: Record<string, unknown>,
  policy: PatientIdentityNormalizationPolicy,
): Readonly<{ documentType: string; documentValue: string }> | null {
  const type = source.TIPO_IDENTIFICACION;
  const canonical = source.IDENTIFICACION_PACIENTE;
  const legacy = source.NUM_DOCUMENTO;
  if (typeof type !== 'string' || !type.trim()) return null;
  if (
    typeof canonical === 'string' &&
    canonical.trim() &&
    typeof legacy === 'string' &&
    legacy.trim() &&
    canonical !== legacy
  )
    return null;
  const value =
    typeof canonical === 'string' && canonical.trim()
      ? canonical
      : typeof legacy === 'string' && legacy.trim()
        ? legacy
        : null;
  if (!value) return null;
  // The executable path deliberately supports only an exact synthetic policy.
  if (
    policy.normalizeDocumentType(type) !== type ||
    policy.normalizeDocumentValue(value, type) !== value
  )
    return null;
  return { documentType: type, documentValue: value };
}

export async function revertSyntheticPatientBackfillBatch(
  database: Database,
  guard: SyntheticBackfillGuard,
  batchId: string,
): Promise<Readonly<{ reverted: number; conflicts: number }>> {
  assertSyntheticPatientBackfillAllowed(guard);
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    const batch = await client.query<{ organization_id: string; status: string }>(
      `select organization_id, status from patient_backfill_batches
        where id = $1 and organization_id = (select id from organizations where code = 'MEDICARTE')
        for update`,
      [batchId],
    );
    if (!batch.rows[0]) throw new Error('PATIENT_BACKFILL_BATCH_NOT_FOUND');
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
      const update = await client.query(
        `update authorization_items set patient_id = $3
          where id = $1 and patient_id = $2 returning id`,
        [item.authorization_item_id, item.applied_patient_id, item.previous_patient_id],
      );
      if (update.rowCount) {
        await client.query(
          `update patient_backfill_items set status = 'REVERTED', reason_code = 'LINK_REVERSED', processed_at = now()
            where id = $1`,
          [item.id],
        );
        await insertAuditEvent(
          client,
          batch.rows[0].organization_id,
          batchId,
          item.authorization_item_id,
          'patient.backfill.revert',
          { patientId: item.applied_patient_id },
          { patientId: item.previous_patient_id },
        );
        reverted += 1;
      } else {
        await client.query(
          `update patient_backfill_items set status = 'REVERT_CONFLICT', reason_code = 'LINK_CHANGED_AFTER_BACKFILL', processed_at = now()
            where id = $1`,
          [item.id],
        );
        conflicts += 1;
      }
    }
    await client.query(
      `update patient_backfill_batches set status = 'REVERTED', reverted_at = now(),
          last_error_code = case when $2 > 0 then 'PATIENT_BACKFILL_REVERT_CONFLICT' else null end
        where id = $1`,
      [batchId, conflicts],
    );
    await client.query('commit');
    return { reverted, conflicts };
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      /* transaction already closed */
    }
    const safeCode =
      error instanceof Error && /^PATIENT_BACKFILL_[A-Z_]+$/.test(error.message)
        ? error.message
        : 'PATIENT_BACKFILL_REVERT_FAILED';
    throw new Error(safeCode);
  } finally {
    client.release();
  }
}
