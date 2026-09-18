import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertNovelty, resolveNovelties } from '../../packages/database/src/novelties.js';

const database = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://authorization:authorization@localhost:15432/authorization_test_integration',
});

function asQueryable(client: Client) {
  return {
    query: async (
      text: string,
      values?: unknown[],
    ): Promise<{ rows: unknown[]; rowCount: number | null }> => {
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount ?? null };
    },
  };
}

describe('W1 tariff foundation', () => {
  beforeAll(async () => database.connect());
  afterAll(async () => database.end());

  it('has deterministic logical keys and no active duplicates', async () => {
    const nullKeys = await database.query<{ count: string }>(
      'select count(*)::text as count from novelties where logical_key is null',
    );
    const duplicateKeys = await database.query<{ count: string }>(
      `select count(*)::text as count from (
         select logical_key from novelties where active group by logical_key having count(*) > 1
       ) duplicates`,
    );

    expect(nullKeys.rows[0]?.count).toBe('0');
    expect(duplicateKeys.rows[0]?.count).toBe('0');
  });

  it('stores canonical tariff provenance and protects it from mutation', async () => {
    await database.query('begin');
    const organization = await database.query<{ id: string }>(
      `select id from organizations where code = 'MTD' limit 1`,
    );
    const user = await database.query<{ id: string }>('select id from users limit 1');
    const organizationId = organization.rows[0]?.id;
    const userId = user.rows[0]?.id;
    if (!organizationId || !userId) throw new Error('W1 fixtures require seeded organization/user');

    const batchId = randomUUID();
    const authorizationItemId = randomUUID();
    await database.query(
      `insert into import_batches
         (id, organization_id, created_by, original_filename, mime_type, size_bytes,
          sha256, processor_version, status)
       values ($1, $2, $3, 'w1.xlsx', 'application/octet-stream', 1, $4, 1, 'UPLOADED')`,
      [batchId, organizationId, userId, randomUUID().replaceAll('-', '').padEnd(64, '0')],
    );
    await database.query(
      `insert into authorization_items
         (id, numero_autorizacion, codigo_medicamento, authorization_key, source_data,
          source_status_normalized, enablement_status, coverage_type, direction_status,
          coverage_rule_version, created_from_batch_id)
       values ($1, 'W1-AUTH', 'W1-PRODUCT', 'W1-AUTH:W1-PRODUCT', '{}'::jsonb,
          '5', 'ENABLED', 'PBS', 'NOT_APPLICABLE', 'W1', $2)`,
      [authorizationItemId, batchId],
    );
    const product = await database.query<{ id: string }>(
      `insert into tariff_annex_products
         (codigo_producto, organization_id, created_by, tarifa_unidad, tipo_inclusion)
       values ('W1-PRODUCT', $1, $2, '10,25', 'PBS')
       returning id`,
      [organizationId, userId],
    );
    const productId = product.rows[0]?.id;
    if (!productId) throw new Error('W1 product fixture was not created');
    const revision = await database.query<{ id: string; canonical: string }>(
      `insert into tariff_product_revisions
         (product_id, codigo_producto, revision, tarifa_unidad_raw,
          tarifa_unidad_canonical, tipo_inclusion, commercial_snapshot,
          valid_from, changed_by, provenance)
       values ($1, 'W1-PRODUCT', 1, '10,25', 10.25, 'PBS', '{}'::jsonb,
          now(), $2, 'W1_TEST')
       returning id, tarifa_unidad_canonical::text as canonical`,
      [productId, userId],
    );
    const revisionId = revision.rows[0]?.id;
    expect(revision.rows[0]?.canonical).toBe('10.2500');
    if (!revisionId) throw new Error('W1 revision fixture was not created');
    await database.query(
      `insert into authorization_tariff_snapshots
         (authorization_item_id, product_id, product_revision_id, codigo_producto,
          status, tarifa_unidad_raw, tarifa_unidad_canonical, tipo_inclusion, provenance)
       values ($1, $2, $3, 'W1-PRODUCT', 'RESOLVED', '10,25', 10.25, 'PBS', 'W1_TEST')`,
      [authorizationItemId, productId, revisionId],
    );

    await database.query('savepoint revision_mutation');
    await expect(
      database.query(`update tariff_product_revisions set provenance = 'MUTATED' where id = $1`, [
        revisionId,
      ]),
    ).rejects.toThrow('append-only');
    await database.query('rollback to savepoint revision_mutation');

    await database.query('savepoint snapshot_mutation');
    await expect(
      database.query(
        `update authorization_tariff_snapshots set provenance = 'MUTATED'
         where authorization_item_id = $1`,
        [authorizationItemId],
      ),
    ).rejects.toThrow('append-only');
    await database.query('rollback to savepoint snapshot_mutation');
    await database.query('rollback');
  });

  it('supersedes repeated causals keeping history and a single active novelty', async () => {
    await database.query('begin');
    const queryable = asQueryable(database);
    const correlationId = randomUUID();
    const logicalKey = `TARIFF|${randomUUID()}|W1-LIFECYCLE|ANX_001|TARIFF|-`;
    const expectedStage = await database.query<{ stage: string }>(
      `select stage::varchar as stage from novelty_codes where code = 'ANX_001'`,
    );

    await insertNovelty(queryable, {
      tariffAnnexImportId: null,
      originalRow: {},
      code: 'ANX_001',
      receivedValue: 'W1-LIFECYCLE',
      description: 'W1 lifecycle first attempt',
      correlationId,
      logicalKey,
    });
    await insertNovelty(queryable, {
      tariffAnnexImportId: null,
      originalRow: {},
      code: 'ANX_001',
      receivedValue: 'W1-LIFECYCLE',
      description: 'W1 lifecycle second attempt',
      correlationId,
      logicalKey,
    });

    const occurrences = await database.query<{
      active: boolean;
      attempt_number: number;
      description: string;
      stage: string;
    }>(
      `select active, attempt_number, description, stage from novelties
       where logical_key = $1 order by attempt_number`,
      [logicalKey],
    );

    expect(occurrences.rows).toHaveLength(2);
    expect(occurrences.rows[0]).toMatchObject({
      active: false,
      attempt_number: 1,
      description: 'W1 lifecycle first attempt',
    });
    expect(occurrences.rows[1]).toMatchObject({
      active: true,
      attempt_number: 2,
      description: 'W1 lifecycle second attempt',
    });
    expect(occurrences.rows[1]?.stage).toBe(expectedStage.rows[0]?.stage);

    const supersededAudit = await database.query<{ count: string }>(
      `select count(*)::text as count from audit_events
       where action = 'NOVELTY_SUPERSEDED' and correlation_id = $1`,
      [correlationId],
    );
    expect(Number(supersededAudit.rows[0]?.count ?? '0')).toBeGreaterThanOrEqual(1);

    await database.query('rollback');
  });

  it('enforces one active novelty per logical key at the database level', async () => {
    await database.query('begin');
    const logicalKey = `TARIFF|${randomUUID()}|W1-UNIQUE|ANX_001|TARIFF|-`;
    await database.query(
      `insert into novelties
         (original_row, code, stage, logical_key, description)
       values ('{}'::jsonb, 'ANX_001', 'TARIFF', $1, 'W1 unique first')`,
      [logicalKey],
    );
    await expect(
      database.query(
        `insert into novelties
           (original_row, code, stage, logical_key, description)
         values ('{}'::jsonb, 'ANX_001', 'TARIFF', $1, 'W1 unique second')`,
        [logicalKey],
      ),
    ).rejects.toThrow();
    await database.query('rollback');
  });

  it('escapes LIKE wildcards in logical key prefixes', async () => {
    await database.query('begin');
    const organizationId = (
      await database.query<{ id: string }>(
        `select id from organizations where code = 'MTD' limit 1`,
      )
    ).rows[0]?.id;
    if (!organizationId) throw new Error('W1 fixtures require seeded organization');

    const wildcardProduct = 'W1%PROD';
    const safeProduct = 'W1XPROD';
    const wildcardKey = `TARIFF|${organizationId}|${wildcardProduct}|ANX_001|TARIFF|-`;
    const safeKey = `TARIFF|${organizationId}|${safeProduct}|ANX_001|TARIFF|-`;
    for (const key of [wildcardKey, safeKey]) {
      await database.query(
        `insert into novelties
           (original_row, code, stage, logical_key, description)
         values ('{}'::jsonb, 'ANX_001', 'TARIFF', $1, 'W1 prefix escape')`,
        [key],
      );
    }

    const resolved = await resolveNovelties(asQueryable(database), {
      logicalKeyPrefix: `TARIFF|${organizationId}|${wildcardProduct}|`,
      reason: 'W1_PREFIX_ESCAPE_TEST',
      actorType: 'SYSTEM',
      correlationId: randomUUID(),
    });

    expect(resolved).toBe(1);
    const stillActive = await database.query<{ logical_key: string }>(
      `select logical_key from novelties where logical_key = $1 and active = true`,
      [safeKey],
    );
    expect(stillActive.rows).toHaveLength(1);

    await database.query('rollback');
  });
});
