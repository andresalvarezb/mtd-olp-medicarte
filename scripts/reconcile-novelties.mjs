#!/usr/bin/env node
/**
 * TASK-NOV-001 — Saneamiento del ciclo de vida de novelties.
 *
 * Supersede transaccional de ocurrencias activas duplicadas por logical_key:
 * por identidad lógica se conserva la ocurrencia más reciente (active=true) y
 * las anteriores se marcan active=false. Sin DELETE: el histórico permanece.
 *
 * Uso:
 *   node scripts/reconcile-novelties.mjs                 # dry-run (reporte)
 *   node scripts/reconcile-novelties.mjs --apply         # aplica en una transacción
 *   DATABASE_URL=... node scripts/reconcile-novelties.mjs [--apply]
 *
 * Deja evento de auditoría 'NOVELTIES_RECONCILED' (append-only) al aplicar.
 */
import { Client } from 'pg';

const apply = process.argv.includes('--apply');
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';

const database = new Client({ connectionString: databaseUrl });
await database.connect();

const metrics = await database.query(`
  select
    (select count(*) from novelties where active = true)::int as active_before,
    (select count(distinct logical_key) from novelties where active = true)::int as logical_active_before,
    (select coalesce(sum(active_rows - 1), 0) from (
       select count(*)::int as active_rows from novelties where active = true group by logical_key
       having count(*) > 1) g)::int as rows_to_supersede
`);
const activeByCode = await database.query(`
  select code, count(*)::int as active from novelties where active = true group by code order by code
`);
const duplicateGroups = await database.query(`
  select logical_key, code, stage, coalesce(field, '-') as field,
         count(*)::int as active_rows, count(*)::int - 1 as to_supersede,
         max(processed_at) as newest
    from novelties
   where active = true
   group by logical_key, code, stage, coalesce(field, '-')
  having count(*) > 1
   order by code, logical_key
`);

const lockRows = duplicateGroups.rows.filter((row) => row.code === 'LOCK_001');
const lockActive = Number(activeByCode.rows.find((row) => row.code === 'LOCK_001')?.active ?? 0);
const report = {
  mode: apply ? 'APPLY' : 'DRY_RUN',
  activeBefore: metrics.rows[0].active_before,
  logicalActiveBefore: metrics.rows[0].logical_active_before,
  rowsToSupersede: metrics.rows[0].rows_to_supersede,
  lock001: {
    active: lockActive,
    logicalGroups: lockRows.reduce((sum, row) => sum + 1, 0) || 0,
    distinctKeys: new Set(lockRows.map((row) => row.logical_key)).size,
    toSupersede: lockRows.reduce((sum, row) => sum + Number(row.to_supersede), 0),
    expectedActiveAfterRepair:
      lockActive - lockRows.reduce((sum, row) => sum + Number(row.to_supersede), 0),
  },
  activeByCode: Object.fromEntries(activeByCode.rows.map((row) => [row.code, row.active])),
  duplicateGroups: duplicateGroups.rows.map((row) => ({
    code: row.code,
    stage: row.stage,
    field: row.field,
    activeRows: row.active_rows,
    toSupersede: row.to_supersede,
    newest: row.newest,
    logicalKey: row.logical_key,
  })),
};

console.log(JSON.stringify(report, null, 2));

if (!apply) {
  console.log('DRY_RUN: no se modificó ninguna fila. Use --apply para sanear.');
  await database.end();
  process.exit(0);
}

if (duplicateGroups.rows.length === 0) {
  console.log('APPLY: cero duplicados activos; nada que sanear.');
  await database.end();
  process.exit(0);
}

const client = database;
try {
  await client.query('begin');
  await client.query("select pg_advisory_xact_lock(hashtextextended('novelties-reconcile', 0))");
  let superseded = 0;
  const affected = [];
  for (const group of duplicateGroups.rows) {
    const result = await client.query(
      `with ranked as (
         select id, row_number() over (order by processed_at desc, id desc) as rn
           from novelties
          where logical_key = $1 and active = true
       )
       update novelties n set active = false
        from ranked r
        where n.id = r.id and r.rn > 1
        returning n.id`,
      [group.logical_key],
    );
    superseded += result.rowCount ?? 0;
    affected.push({
      code: group.code,
      stage: group.stage,
      field: group.field,
      logicalKey: group.logical_key,
      superseded: result.rowCount ?? 0,
    });
  }
  await client.query(
    `insert into audit_events
       (actor_type, actor_id, organization_id, action, resource_type, resource_id, before, after, correlation_id, request_id, result)
     values ('SYSTEM', null, null, 'NOVELTIES_RECONCILED', 'novelties', 'reconcile', $1::jsonb, $2::jsonb, gen_random_uuid(), null, 'SUCCESS')`,
    [
      JSON.stringify({
        activeBefore: report.activeBefore,
        logicalActiveBefore: report.logicalActiveBefore,
      }),
      JSON.stringify({ superseded, groups: affected.length, detail: affected }),
    ],
  );
  await client.query('commit');
  console.log(JSON.stringify({ mode: 'APPLIED', superseded, groups: affected.length }, null, 2));
} catch (error) {
  await client.query('rollback');
  console.error('RECONCILE_FAILED (rollback):', error);
  process.exitCode = 1;
} finally {
  await database.end();
}
