export type Queryable = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
};

export type NoveltyInsert = Readonly<{
  authorizationItemId?: string | null;
  importBatchId?: string | null;
  bulkUpdateBatchId?: string | null;
  tariffAnnexImportId?: string | null;
  sourceRowNumber?: number | null;
  originalRow: Record<string, unknown>;
  code: string;
  stage?: string | null;
  field?: string | null;
  receivedValue?: string | null;
  description: string;
  actorId?: string | null;
  logicalKey?: string | null;
  correlationId?: string | null;
}>;

export function itemNoveltyLogicalKey(input: {
  authorizationItemId: string;
  code: string;
  stage: string;
  field?: string | null;
}): string {
  return `ITEM|${input.authorizationItemId}|${input.code}|${input.stage}|${input.field ?? '-'}`;
}

export function tariffNoveltyLogicalKey(input: {
  organizationId: string;
  normalizedProductCode: string;
  code: string;
  stage: string;
  field?: string | null;
}): string {
  return `TARIFF|${input.organizationId}|${input.normalizedProductCode}|${input.code}|${input.stage}|${input.field ?? '-'}`;
}

export function tariffNoveltyLogicalKeyPrefix(input: {
  organizationId: string;
  normalizedProductCode: string;
}): string {
  return `TARIFF|${input.organizationId}|${input.normalizedProductCode}|`;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function technicalLogicalKey(input: NoveltyInsert): string {
  const batch = input.tariffAnnexImportId
    ? `TECH|TARIFF|${input.tariffAnnexImportId}`
    : input.importBatchId
      ? `TECH|IMP|${input.importBatchId}`
      : input.bulkUpdateBatchId
        ? `TECH|BULK|${input.bulkUpdateBatchId}`
        : 'TECH|UNKNOWN';
  return `${batch}|${input.sourceRowNumber ?? 0}`;
}

function logicalKeyFor(input: NoveltyInsert, stage: string): string {
  if (input.logicalKey) return input.logicalKey;
  if (input.authorizationItemId) {
    return itemNoveltyLogicalKey({
      authorizationItemId: input.authorizationItemId,
      code: input.code,
      stage,
      field: input.field ?? null,
    });
  }
  return technicalLogicalKey(input);
}

async function stageForCode(
  client: Queryable,
  code: string,
  inputStage: string | null | undefined,
): Promise<string> {
  if (inputStage) return inputStage;
  const result = await client.query(
    'select c.stage::varchar as stage from novelty_codes c where c.code = $1::varchar',
    [code],
  );
  return (result.rows[0] as { stage?: string } | undefined)?.stage ?? '';
}

export async function insertNovelty(client: Queryable, input: NoveltyInsert): Promise<void> {
  const stage = await stageForCode(client, input.code, input.stage);
  const logicalKey = logicalKeyFor(input, stage);
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [logicalKey]);
  const superseded = await client.query(
    `update novelties set active = false
      where logical_key = $1 and active = true
      returning id`,
    [logicalKey],
  );
  await client.query(
    `insert into novelties
       (authorization_item_id, import_batch_id, bulk_update_batch_id, tariff_annex_import_id,
        source_row_number, original_row, code, stage, field, received_value, description,
        attempt_number, logical_key, created_by)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11,
       coalesce((select max(previous.attempt_number) + 1 from novelties previous
         where previous.logical_key = $12), 1), $12, $13)`,
    [
      input.authorizationItemId ?? null,
      input.importBatchId ?? null,
      input.bulkUpdateBatchId ?? null,
      input.tariffAnnexImportId ?? null,
      input.sourceRowNumber ?? null,
      JSON.stringify(input.originalRow),
      input.code,
      stage,
      input.field ?? null,
      input.receivedValue ?? null,
      input.description,
      logicalKey,
      input.actorId ?? null,
    ],
  );
  if ((superseded.rowCount ?? 0) > 0 && input.correlationId) {
    await client.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id,
          before, after, correlation_id, request_id, result)
       values ($1, $2, null, 'NOVELTY_SUPERSEDED', 'novelties', $3, $4::jsonb,
          $5::jsonb, $6, null, 'SUCCESS')`,
      [
        input.actorId ? 'USER' : 'SYSTEM',
        input.actorId ?? null,
        (superseded.rows as Array<{ id: string }>)[0]?.id ?? 'multiple',
        JSON.stringify({ logicalKey, superseded: superseded.rowCount }),
        JSON.stringify({ logicalKey, code: input.code, stage }),
        input.correlationId,
      ],
    );
  }
}

export type NoveltyResolutionInput = Readonly<{
  authorizationItemId?: string | null;
  authorizationKey?: string | null;
  normalizedNumeroAutorizacion?: string | null;
  normalizedCodigoMedicamento?: string | null;
  codes?: readonly string[] | null;
  logicalKeys?: readonly string[] | null;
  logicalKeyPrefix?: string | null;
  reason: string;
  actorType: 'USER' | 'SYSTEM';
  actorId?: string | null;
  organizationId?: string | null;
  correlationId: string;
}>;

export async function resolveNovelties(
  client: Queryable,
  input: NoveltyResolutionInput,
): Promise<number> {
  const conditions = ['n.active = true'];
  const values: unknown[] = [];
  let identityScope = false;
  if (input.logicalKeys?.length) {
    values.push([...input.logicalKeys]);
    conditions.push(`n.logical_key = any($${values.length}::text[])`);
    identityScope = true;
  } else if (input.logicalKeyPrefix) {
    values.push(escapeLikePattern(input.logicalKeyPrefix));
    conditions.push(`n.logical_key like $${values.length} || '%' escape '\\'`);
    identityScope = true;
  }
  if (!identityScope) {
    if (input.authorizationItemId) {
      values.push(input.authorizationItemId);
      conditions.push(`n.authorization_item_id = $${values.length}`);
    } else if (input.authorizationKey) {
      values.push(input.authorizationKey);
      conditions.push(`n.original_row->>'CLAVE_AUTORIZACION' = $${values.length}`);
    } else if (input.normalizedNumeroAutorizacion && input.normalizedCodigoMedicamento) {
      values.push(input.normalizedNumeroAutorizacion);
      conditions.push(
        `lower(regexp_replace(btrim(coalesce(n.original_row->>'NUMERO_AUTORIZACION', '')), '\\s+', ' ', 'g')) = lower($${values.length})`,
      );
      values.push(input.normalizedCodigoMedicamento);
      conditions.push(
        `lower(regexp_replace(btrim(coalesce(n.original_row->>'CODIGO_COMERCIAL', n.original_row->>'COD_COMERCIAL', '')), '\\s+', ' ', 'g')) = lower($${values.length})`,
      );
    } else {
      return 0;
    }
  }
  if (input.codes?.length) {
    values.push([...input.codes]);
    conditions.push(`n.code = any($${values.length}::text[])`);
  }
  const resolved = await client.query(
    `update novelties set active = false
      where id in (select n.id from novelties n where ${conditions.join(' and ')})
      returning id, code, stage, description`,
    values,
  );
  if (!resolved.rowCount) return 0;
  await client.query(
    `insert into audit_events
       (actor_type, actor_id, organization_id, action, resource_type, resource_id,
        before, after, correlation_id, request_id, result)
     values ($1, $2, $3, 'NOVELTY_RESOLVED', 'novelties', 'multiple', $4::jsonb,
        $5::jsonb, $6, $7, 'SUCCESS')`,
    [
      input.actorType,
      input.actorId ?? null,
      input.organizationId ?? null,
      JSON.stringify({ resolved: resolved.rowCount }),
      JSON.stringify({ reason: input.reason, novelties: resolved.rows }),
      input.correlationId,
      input.correlationId,
    ],
  );
  return resolved.rowCount;
}
