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
  /** Identidad lógica explícita; el llamador la calcula cuando conoce la
   *  identidad de negocio (p. ej. producto del Anexo Tarifario). */
  logicalKey?: string | null;
  /** Correlación para auditar la supersedencia del intento anterior. */
  correlationId?: string | null;
}>;

/**
 * Identidad lógica de una novedad (TASK-NOV-001):
 * - con ítem: item + code + stage + field (la misma causal en otra etapa o
 *   campo es una causal distinta);
 * - Anexo por producto: organización + producto normalizado + code + stage +
 *   field, reutilizando la normalización canónica del código de producto;
 * - sin identidad de negocio: identidad técnica por lote y fila, que no
 *   fusiona errores de filas distintas.
 */
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

function technicalLogicalKey(input: NoveltyInsert): string {
  const batch =
    input.tariffAnnexImportId !== undefined && input.tariffAnnexImportId !== null
      ? `TECH|TARIFF|${input.tariffAnnexImportId}`
      : input.importBatchId !== undefined && input.importBatchId !== null
        ? `TECH|IMP|${input.importBatchId}`
        : input.bulkUpdateBatchId !== undefined && input.bulkUpdateBatchId !== null
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
    `select c.stage::varchar as stage from novelty_codes c where c.code = $1::varchar`,
    [code],
  );
  return (result.rows[0] as { stage?: string } | undefined)?.stage ?? '';
}

/**
 * TASK-NOV-001: al repetirse la misma causal lógica, la ocurrencia activa
 * anterior se supersede (active=false) y el nuevo intento se inserta con
 * attempt_number incremental. El histórico completo se conserva; solo la
 * última ocurrencia permanece activa. El bloqueo advisory transaccional por
 * logical_key serializa escrituras concurrentes de la misma causal.
 */
export async function insertNovelty(client: Queryable, input: NoveltyInsert): Promise<void> {
  const stage = await stageForCode(client, input.code, input.stage);
  const logicalKey = logicalKeyFor(input, stage);
  await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [logicalKey]);
  const superseded = await client.query(
    `update novelties set active = false
      where logical_key = $1 and active = true
      returning id, code, attempt_number`,
    [logicalKey],
  );
  await client.query(
    `insert into novelties
       (authorization_item_id, import_batch_id, bulk_update_batch_id, tariff_annex_import_id,
         source_row_number, original_row, code, stage, field, received_value, description, attempt_number, logical_key, created_by)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::varchar, $8::varchar, $9::varchar, $10::varchar, $11::varchar,
             coalesce((select max(previous.attempt_number) + 1 from novelties previous
               where previous.logical_key = $12), 1),
             $12, $13::uuid)`,
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
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, before, after, correlation_id, request_id, result)
       values ($1, $2, null, 'NOVELTY_SUPERSEDED', 'novelties', $3, $4::jsonb, $5::jsonb, $6::uuid, null, 'SUCCESS')`,
      [
        input.actorId ? 'USER' : 'SYSTEM',
        input.actorId ?? null,
        (superseded.rows as Array<{ id: string }>)[0]!.id,
        JSON.stringify({ logicalKey, superseded: superseded.rowCount }),
        JSON.stringify({ logicalKey, code: input.code, stage }),
        input.correlationId,
      ],
    );
  }
}

export async function insertNoveltyForItemIfAbsent(
  client: Queryable,
  input: NoveltyInsert & Readonly<{ authorizationItemId: string }>,
): Promise<void> {
  const stage = await stageForCode(client, input.code, input.stage);
  const logicalKey = logicalKeyFor(input, stage);
  await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [logicalKey]);
  await client.query(
    `insert into novelties
       (authorization_item_id, import_batch_id, bulk_update_batch_id, tariff_annex_import_id,
         source_row_number, original_row, code, stage, field, received_value, description, attempt_number, logical_key, created_by)
      select $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::int, $6::jsonb, $7::varchar, $8::varchar,
             $9::varchar, $10::varchar, $11::varchar,
             coalesce((select max(previous.attempt_number) + 1 from novelties previous
               where previous.logical_key = $12), 1),
             $12, $13::uuid
     where not exists (
       select 1 from novelties nv
        where nv.logical_key = $12 and nv.active = true
     )`,
    [
      input.authorizationItemId,
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
  /** Resolución exacta por identidad lógica (TASK-NOV-001). */
  logicalKeys?: readonly string[] | null;
  /** Resolución por prefijo de identidad lógica: todas las causales de la
   *  misma identidad de negocio (p. ej. un producto del Anexo). */
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
  if (input.logicalKeys && input.logicalKeys.length > 0) {
    values.push([...input.logicalKeys]);
    conditions.push(`n.logical_key = any($${values.length}::text[])`);
    identityScope = true;
  } else if (input.logicalKeyPrefix) {
    values.push(input.logicalKeyPrefix);
    conditions.push(`n.logical_key like $${values.length} || '%'`);
    identityScope = true;
  }
  if (!identityScope) {
    if (input.authorizationItemId) {
      values.push(input.authorizationItemId);
      const itemParameter = `$${values.length}`;
      if (input.authorizationKey) {
        values.push(input.authorizationKey);
        conditions.push(
          `(n.authorization_item_id = ${itemParameter} or n.original_row->>'CLAVE_AUTORIZACION' = $${values.length})`,
        );
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
                tariff_annex_import_id as tariff_annex_import_id,
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
    tariff_annex_import_id: string | null;
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
      items[0]?.item_id ??
        items[0]?.import_batch_id ??
        items[0]?.bulk_update_batch_id ??
        items[0]?.tariff_annex_import_id ??
        'multiple',
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
