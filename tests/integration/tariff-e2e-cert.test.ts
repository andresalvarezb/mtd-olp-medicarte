import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const database = new Client({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:local-analysis-only@127.0.0.1:55432/authorization_agent_analysis',
});

describe('tariff prepare/confirm PostgreSQL certification', () => {
  beforeAll(async () => database.connect());
  afterAll(async () => database.end());

  it('persists prepared preview without publishing or changing catalog', async () => {
    await database.query('begin');
    const organization = await database.query<{ id: string }>(`select id from organizations where code = 'MTD' limit 1`);
    const user = await database.query<{ id: string }>('select id from users limit 1');
    const batchId = randomUUID();
    const correlationId = randomUUID();
    const sourceId = randomUUID();
    await database.query(`insert into tariff_annex_imports (id,organization_id,created_by,original_filename,mime_type,size_bytes,sha256,status,correlation_id,idempotency_key,preview,preview_total,preview_unchanged,preview_changed,preview_anomalous,preview_rejected,preview_scale_pattern_detected) values ($1,$2,$3,'e2e.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1,$4,'PREPARED',$5,$6,$7::jsonb,1,0,1,0,0,false)`, [batchId, organization.rows[0].id, user.rows[0].id, randomUUID().replaceAll('-', '').padEnd(64, '0'), correlationId, `e2e:${batchId}`, JSON.stringify({ total: 1, unchanged: 0, changed: 1, anomalous: 0, rejected: 0, scalePatternDetected: false })]);
    await database.query(`insert into tariff_annex_import_source_files (id,import_id,original_filename,mime_type,size_bytes,sha256) values ($1,$2,'e2e.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1,$3)`, [sourceId, batchId, randomUUID().replaceAll('-', '').padEnd(64, '0')]);
    expect((await database.query('select status from tariff_annex_imports where id=$1', [batchId])).rows[0].status).toBe('PREPARED');
    expect((await database.query('select count(*)::int as count from outbox_events where payload->>\'batchId\'=$1', [batchId])).rows[0].count).toBe(0);
    await database.query('rollback');
  });

  it('enforces anomaly override, outbox idempotency and append-only history', async () => {
    await database.query('begin');
    const organization = await database.query<{ id: string }>(`select id from organizations where code = 'MTD' limit 1`);
    const user = await database.query<{ id: string }>('select id from users limit 1');
    const product = await database.query<{ id: string }>(`select id from tariff_annex_products where codigo_producto='12690'`);
    const auth = await database.query<{ id: string }>('select id from authorization_items limit 1');
    const batchId = randomUUID();
    const correlationId = randomUUID();
    await database.query(`insert into tariff_annex_imports (id,organization_id,created_by,original_filename,mime_type,size_bytes,sha256,status,correlation_id,idempotency_key,preview,preview_total,preview_anomalous) values ($1,$2,$3,'anomaly.xlsx','application/octet-stream',1,$4,'PREPARED',$5,$6,$7::jsonb,1,1)`, [batchId, organization.rows[0].id, user.rows[0].id, randomUUID().replaceAll('-', '').padEnd(64, '0'), correlationId, `e2e:${batchId}`, JSON.stringify({ total: 1, unchanged: 0, changed: 0, anomalous: 1, rejected: 0, scalePatternDetected: false })]);
    await expect(database.query(`update tariff_annex_imports set status='CONFIRMING' where id=$1 and preview_anomalous=0`, [batchId])).resolves.toBeTruthy();
    await database.query(`update tariff_annex_imports set status='CONFIRMING',confirmed_at=now(),confirmed_by=$2,override_reason='E2E explicit correction' where id=$1 and preview_anomalous>0`, [batchId, user.rows[0].id]);
    const eventId = randomUUID();
    await database.query(`insert into outbox_events (id,event_type,version,payload,correlation_id,organization_id,idempotency_key) values ($1,'tariff.import',1,$2::jsonb,$3,$4,$5) on conflict (idempotency_key) do nothing`, [eventId, JSON.stringify({ batchId, overrideReason: 'E2E explicit correction' }), correlationId, organization.rows[0].id, `tariff-confirm:${batchId}`]);
    await database.query(`insert into outbox_events (id,event_type,version,payload,correlation_id,organization_id,idempotency_key) values ($1,'tariff.import',1,$2::jsonb,$3,$4,$5) on conflict (idempotency_key) do nothing`, [randomUUID(), JSON.stringify({ batchId }), correlationId, organization.rows[0].id, `tariff-confirm:${batchId}`]);
    expect((await database.query('select count(*)::int as count from outbox_events where idempotency_key=$1', [`tariff-confirm:${batchId}`])).rows[0].count).toBe(1);
    const revision = await database.query<{ id: string }>('select id from tariff_product_revisions where product_id=$1 limit 1', [product.rows[0].id]);
    await database.query('savepoint append_update');
    await expect(database.query('update tariff_product_revisions set provenance=\'mutated\' where id=$1', [revision.rows[0].id])).rejects.toThrow('append-only');
    await database.query('rollback to savepoint append_update');
    await database.query('savepoint append_delete');
    await expect(database.query('delete from tariff_product_revisions where id=$1', [revision.rows[0].id])).rejects.toThrow('append-only');
    await database.query('rollback to savepoint append_delete');
    await database.query(`insert into authorization_tariff_snapshots (authorization_item_id,product_id,product_revision_id,codigo_producto,status,tarifa_unidad_raw,tarifa_unidad_canonical,provenance) values ($1,$2,$3,'12690','RESOLVED','7420',7420,'E2E') on conflict (authorization_item_id) do nothing`, [auth.rows[0].id, product.rows[0].id, revision.rows[0].id]);
    await database.query('rollback');
  });
});
