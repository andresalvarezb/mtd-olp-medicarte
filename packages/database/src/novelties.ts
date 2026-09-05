export type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
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
}>;

export async function insertNovelty(client: Queryable, input: NoveltyInsert): Promise<void> {
  await client.query(
    `insert into novelties
       (authorization_item_id, import_batch_id, bulk_update_batch_id, tariff_annex_import_id,
         source_row_number, original_row, code, stage, field, received_value, description, attempt_number, created_by)
      select $1, $2, $3, $4, $5, $6::jsonb, $7::varchar,
             coalesce($8::varchar, (select c.stage::varchar from novelty_codes c where c.code = $7::varchar)),
             $9::varchar, $10::varchar, $11::varchar,
             coalesce((select max(previous.attempt_number) + 1 from novelties previous
               where previous.code = $7::varchar and
                 (($1::uuid is not null and previous.authorization_item_id = $1::uuid) or
                  ($1::uuid is null and previous.import_batch_id = $2::uuid and previous.source_row_number = $5::int))), 1),
             $12::uuid`,
    [
      input.authorizationItemId ?? null,
      input.importBatchId ?? null,
      input.bulkUpdateBatchId ?? null,
      input.tariffAnnexImportId ?? null,
      input.sourceRowNumber ?? null,
      JSON.stringify(input.originalRow),
      input.code,
      input.stage ?? null,
      input.field ?? null,
      input.receivedValue ?? null,
      input.description,
      input.actorId ?? null,
    ],
  );
}

export async function insertNoveltyForItemIfAbsent(
  client: Queryable,
  input: NoveltyInsert & Readonly<{ authorizationItemId: string }>,
): Promise<void> {
  await client.query(
    `insert into novelties
       (authorization_item_id, import_batch_id, bulk_update_batch_id, tariff_annex_import_id,
         source_row_number, original_row, code, stage, field, received_value, description, attempt_number, created_by)
      select $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::int, $6::jsonb, $7::varchar,
             coalesce($8::varchar, (select c.stage::varchar from novelty_codes c where c.code = $7::varchar)),
             $9::varchar, $10::varchar, $11::varchar,
             coalesce((select max(previous.attempt_number) + 1 from novelties previous
               where previous.code = $7::varchar and previous.authorization_item_id = $1::uuid), 1),
             $12::uuid
     where not exists (
       select 1 from novelties nv
        where nv.code = $7::varchar and nv.active = true and nv.authorization_item_id = $1::uuid
     )`,
    [
      input.authorizationItemId,
      input.importBatchId ?? null,
      input.bulkUpdateBatchId ?? null,
      input.tariffAnnexImportId ?? null,
      input.sourceRowNumber ?? null,
      JSON.stringify(input.originalRow),
      input.code,
      input.stage ?? null,
      input.field ?? null,
      input.receivedValue ?? null,
      input.description,
      input.actorId ?? null,
    ],
  );
}

export type ItemNoveltySyncInput = Readonly<{
  itemId: string;
  importBatchId?: string | null;
  tariffAnnexImportId?: string | null;
  bulkUpdateBatchId?: string | null;
  sourceRowNumber?: number | null;
  originalRow: Record<string, unknown>;
  activeCausales: readonly Readonly<{ code: string; description: string }>[];
  resolveCodes: readonly string[];
  reason: string;
  actorType: 'USER' | 'SYSTEM';
  actorId?: string | null;
  organizationId?: string | null;
  correlationId: string;
}>;

/** ADR-027 §8/§10: la bandeja por ítem refleja exactamente las causales activas. */
export async function syncItemNovelties(
  client: Queryable,
  input: ItemNoveltySyncInput,
): Promise<number> {
  const resolved = await resolveNovelties(client, {
    authorizationItemId: input.itemId,
    codes: input.resolveCodes,
    reason: input.reason,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    organizationId: input.organizationId ?? null,
    correlationId: input.correlationId,
  });
  for (const causal of input.activeCausales) {
    await insertNoveltyForItemIfAbsent(client, {
      authorizationItemId: input.itemId,
      importBatchId: input.importBatchId ?? null,
      tariffAnnexImportId: input.tariffAnnexImportId ?? null,
      bulkUpdateBatchId: input.bulkUpdateBatchId ?? null,
      sourceRowNumber: input.sourceRowNumber ?? null,
      originalRow: input.originalRow,
      code: causal.code,
      stage: null,
      description: causal.description,
      actorId: input.actorId ?? null,
    });
  }
  return resolved;
}

export type NoveltyResolutionInput = Readonly<{
  authorizationItemId?: string | null;
  authorizationKey?: string | null;
  normalizedNumeroAutorizacion?: string | null;
  normalizedCodigoMedicamento?: string | null;
  codes?: readonly string[] | null;
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
  if (input.authorizationItemId) {
    values.push(input.authorizationItemId);
    const itemParameter = `$${values.length}`;
    if (input.authorizationKey) {
      values.push(input.authorizationKey);
      conditions.push(`(n.authorization_item_id = ${itemParameter} or n.original_row->>'CLAVE_AUTORIZACION' = $${values.length})`);
    } else {
      conditions.push(`n.authorization_item_id = ${itemParameter}`);
    }
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
  if (input.codes && input.codes.length > 0) {
    values.push([...input.codes]);
    conditions.push(`n.code = any($${values.length}::text[])`);
  }
  const resolved = await client.query(
    `update novelties set active = false
      where id in (
        select n.id from novelties n where ${conditions.join(' and ')}
      )
      returning id, code, authorization_item_id as item_id,
                import_batch_id as import_batch_id, bulk_update_batch_id as bulk_update_batch_id,
                stage, description`,
    values,
  );
  if (resolved.rowCount === null || resolved.rowCount === 0) return 0;
  const items = resolved.rows as Array<{
    id: string;
    code: string;
    item_id: string | null;
    import_batch_id: string | null;
    bulk_update_batch_id: string | null;
    stage: string;
    description: string;
  }>;
  await client.query(
    `insert into audit_events
       (actor_type, actor_id, organization_id, action, resource_type, resource_id, before, after, correlation_id, request_id, result)
     values ($1, $2, $3, 'NOVELTY_RESOLVED', 'novelties', $4, $5::jsonb, $6::jsonb, $7, $8, 'SUCCESS')`,
    [
      input.actorType,
      input.actorId ?? null,
      input.organizationId ?? null,
      items[0]?.item_id ?? items[0]?.import_batch_id ?? items[0]?.bulk_update_batch_id ?? 'multiple',
      JSON.stringify({ resolved: items.length }),
      JSON.stringify({
        reason: input.reason,
        novelties: items.map((item) => ({
          id: item.id,
          code: item.code,
          stage: item.stage,
          description: item.description,
        })),
      }),
      input.correlationId,
      input.correlationId,
    ],
  );
  return resolved.rowCount ?? 0;
}
