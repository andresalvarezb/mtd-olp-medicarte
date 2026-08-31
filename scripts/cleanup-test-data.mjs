import pg from 'pg';

const { Client } = pg;

const DEFAULT_DATABASE_URL =
  'postgresql://authorization:authorization@localhost:15432/authorization';

// These prefixes are reserved by the integration gates for ephemeral data.
const authorizationPatterns = [
  'AUTH-F2-%',
  'AUTH-PRES-%',
  'AUTH-CONCURRENT-%',
  'AUTH-UPDATE-%',
  'AUTH-REPLAY-SCOPE-%',
  'AUTH-SOURCE-SCOPE-%',
  'AUTH-IDEM-%',
  'AUTH-BLOCKED-%',
  'AUTH-F3-%',
  'AUTH-F4-%',
  'AUTH-F5-%',
  '%AUTH-F5-%',
  'AUTH-F6-%',
  'AUTH-T9-%',
  'AUTH-MISSING',
];

const tariffProductPatterns = [
  'MED-UPDATE%',
  'MED-REPLAY-%',
  'MED-F3-%',
  'MED-F4-%',
  'ANX-A-%',
  'ANX-BULK-%',
  'TARIF-%',
];

const testRecipientPatterns = ['operaciones-%@example.test', 'olp-recuperable@example.test'];

function parseArguments() {
  const argumentsSet = new Set(process.argv.slice(2));
  if (argumentsSet.has('--help')) {
    console.log(
      'Usage: node scripts/cleanup-test-data.mjs --yes\n' +
        '       node scripts/cleanup-test-data.mjs --dry-run',
    );
    return null;
  }

  const dryRun = argumentsSet.has('--dry-run');
  if (!dryRun && !argumentsSet.has('--yes')) {
    throw new Error('Use --yes to clean test data or --dry-run to inspect candidates.');
  }
  return { dryRun };
}

function validateDatabaseUrl(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is invalid.');
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', 'postgres']);
  if (
    databaseName !== 'authorization' ||
    (!localHosts.has(parsed.hostname.toLowerCase()) && process.env.ALLOW_NONLOCAL_TEST_DB !== '1')
  ) {
    throw new Error(
      'Refusing cleanup: only the local authorization database is allowed. Set ALLOW_NONLOCAL_TEST_DB=1 explicitly for another test database.',
    );
  }
}

async function main() {
  const options = parseArguments();
  if (!options) return;

  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  validateDatabaseUrl(databaseUrl);

  const rawSince = process.env.TEST_RUN_STARTED_AT;
  const since = rawSince ? new Date(rawSince) : null;
  if (since && Number.isNaN(since.getTime())) {
    throw new Error('TEST_RUN_STARTED_AT is not a valid ISO date.');
  }
  const sinceValue = since?.toISOString() ?? null;
  const client = new Client({ connectionString: databaseUrl });
  const deleted = new Map();

  await client.connect();
  try {
    await client.query('begin');

    await client.query(
      `create temp table cleanup_test_items on commit drop as
       select i.id, i.created_from_batch_id
       from authorization_items i
       where i.numero_autorizacion like any($1::text[])
         and not exists (
           select 1
           from authorization_items sibling
           where sibling.created_from_batch_id = i.created_from_batch_id
             and sibling.id <> i.id
             and not (sibling.numero_autorizacion like any($1::text[]))
         )`,
      [authorizationPatterns],
    );
    await client.query(
      `create temp table cleanup_test_import_batches on commit drop as
       select distinct b.id
       from import_batches b
       where (
           b.id in (select created_from_batch_id from cleanup_test_items)
           or exists (
             select 1
             from import_rows r
             where r.import_batch_id = b.id
               and r.raw_data->>'NUMERO_AUTORIZACION' like any($1::text[])
           )
           or (
             $2::timestamptz is not null
             and b.created_at >= $2::timestamptz
             and b.original_filename in ('phase5.csv', 'phase6.csv')
           )
         )
         and not exists (
           select 1
           from authorization_items sibling
           where sibling.created_from_batch_id = b.id
             and sibling.id not in (select id from cleanup_test_items)
         )`,
      [authorizationPatterns, sinceValue],
    );
    await client.query(
      `create temp table cleanup_test_bulk_batches on commit drop as
       select distinct b.id
       from bulk_update_batches b
       where (
           exists (
             select 1
             from bulk_update_rows r
             where r.batch_id = b.id
               and r.authorization_item_id in (select id from cleanup_test_items)
           )
           or (
             $1::timestamptz is not null
             and b.created_at >= $1::timestamptz
             and b.original_filename in ('phase5.csv', 'locations.csv')
           )
         )
         and not exists (
           select 1
           from bulk_update_rows r
           where r.batch_id = b.id
             and r.authorization_item_id is not null
             and r.authorization_item_id not in (select id from cleanup_test_items)
         )`,
      [sinceValue],
    );
    await client.query(
      `create temp table cleanup_test_tariff_products on commit drop as
       select id
       from tariff_annex_products
       where codigo_producto like any($1::text[])`,
      [tariffProductPatterns],
    );
    await client.query(
      `create temp table cleanup_test_tariff_imports on commit drop as
       select distinct i.id
       from tariff_annex_imports i
       where exists (
           select 1
           from tariff_annex_import_rows r
           where r.import_id = i.id
             and r.product_id in (select id from cleanup_test_tariff_products)
         )
         or (
           $1::timestamptz is not null
           and i.created_at >= $1::timestamptz
           and i.original_filename in ('anexo.csv', 'vacio.csv')
         )`,
      [sinceValue],
    );
    await client.query(
      `create temp table cleanup_test_users on commit drop as
       select id
       from users
       where email like 'f1-%@example.test'
          or email like 'f7-%@example.test'`,
    );
    await client.query(
      `create temp table cleanup_test_recipients on commit drop as
       select id
       from notification_recipients
       where email like any($1::text[])`,
      [testRecipientPatterns],
    );
    await client.query(
      `create temp table cleanup_test_reviews on commit drop as
       select id
       from audit_reviews
       where authorization_item_id in (select id from cleanup_test_items)`,
    );
    await client.query(
      `create temp table cleanup_test_outbox on commit drop as
       select id, idempotency_key
       from outbox_events o
       where o.payload->>'itemId' in (select id::text from cleanup_test_items)
          or o.payload->>'batchId' in (
            select id::text from cleanup_test_import_batches
            union
            select id::text from cleanup_test_bulk_batches
            union
            select id::text from cleanup_test_tariff_imports
          )
          or o.payload->>'tariffProductId' in (
            select id::text from cleanup_test_tariff_products
          )
          or o.idempotency_key like 'poison-%'
          or o.idempotency_key like 'reconcile-%'
          or (
            o.event_type = 'foundation.event'
            and o.payload->>'message' in ('first payload', 'Gate F1 end-to-end', 'Reconciled delivery')
          )`,
    );

    const candidates = await client.query(`
      select
        (select count(*) from cleanup_test_items) as items,
        (select count(*) from cleanup_test_import_batches) as import_batches,
        (select count(*) from cleanup_test_bulk_batches) as bulk_batches,
        (select count(*) from cleanup_test_tariff_products) as tariff_products,
        (select count(*) from cleanup_test_tariff_imports) as tariff_imports,
        (select count(*) from cleanup_test_outbox) as outbox_events,
        (select count(*) from cleanup_test_users) as users,
        (select count(*) from cleanup_test_recipients) as recipients`);
    const candidateRow = candidates.rows[0];
    console.log(
      `Test cleanup candidates: ${candidateRow.items} items, ${candidateRow.import_batches} import batches, ${candidateRow.bulk_batches} bulk batches, ${candidateRow.tariff_products} tariff products, ${candidateRow.tariff_imports} tariff imports, ${candidateRow.outbox_events} outbox events, ${candidateRow.users} users, ${candidateRow.recipients} recipients.`,
    );

    if (options.dryRun) {
      await client.query('rollback');
      return;
    }

    async function deleteRows(label, statement, values = []) {
      const result = await client.query(statement, values);
      const count = result.rowCount ?? 0;
      if (count > 0) deleted.set(label, count);
    }

    await deleteRows(
      'audit findings',
      `delete from audit_findings
       where audit_review_id in (select id from cleanup_test_reviews)`,
    );
    await deleteRows(
      'audit reviews',
      `delete from audit_reviews
       where id in (select id from cleanup_test_reviews)`,
    );
    await deleteRows(
      'MIPRES directions',
      `delete from mipres_directions
       where authorization_item_id in (select id from cleanup_test_items)
          or mipres_check_id in (
            select id from mipres_checks where authorization_item_id in (select id from cleanup_test_items)
          )`,
    );
    await deleteRows(
      'MIPRES checks',
      `delete from mipres_checks
       where authorization_item_id in (select id from cleanup_test_items)`,
    );
    await deleteRows(
      'notifications',
      `delete from notifications
       where item_id in (select id from cleanup_test_items)`,
    );
    await deleteRows(
      'operational field changes',
      `delete from operational_field_changes
       where authorization_item_id in (select id from cleanup_test_items)`,
    );
    await deleteRows(
      'bulk update rows',
      `delete from bulk_update_rows
       where batch_id in (select id from cleanup_test_bulk_batches)
          or authorization_item_id in (select id from cleanup_test_items)`,
    );
    await deleteRows(
      'import rows',
      `delete from import_rows
       where import_batch_id in (select id from cleanup_test_import_batches)
          or authorization_item_id in (select id from cleanup_test_items)`,
    );
    await deleteRows(
      'coverage evaluations',
      `delete from coverage_evaluations
       where authorization_item_id in (select id from cleanup_test_items)`,
    );
    await deleteRows(
      'authorization item organizations',
      `delete from authorization_item_organizations
       where authorization_item_id in (select id from cleanup_test_items)`,
    );
    await deleteRows(
      'authorization items',
      `delete from authorization_items
       where id in (select id from cleanup_test_items)`,
    );
    await deleteRows(
      'bulk update source files',
      `delete from bulk_update_source_files
       where batch_id in (select id from cleanup_test_bulk_batches)`,
    );
    await deleteRows(
      'bulk update batches',
      `delete from bulk_update_batches
       where id in (select id from cleanup_test_bulk_batches)`,
    );
    await deleteRows(
      'import source files',
      `delete from import_source_files
       where import_batch_id in (select id from cleanup_test_import_batches)`,
    );
    await deleteRows(
      'import batches',
      `delete from import_batches
       where id in (select id from cleanup_test_import_batches)`,
    );
    await deleteRows(
      'tariff import rows',
      `delete from tariff_annex_import_rows
       where import_id in (select id from cleanup_test_tariff_imports)`,
    );
    await deleteRows(
      'tariff import source files',
      `delete from tariff_annex_import_source_files
       where import_id in (select id from cleanup_test_tariff_imports)`,
    );
    await deleteRows(
      'tariff imports',
      `delete from tariff_annex_imports
       where id in (select id from cleanup_test_tariff_imports)`,
    );
    await deleteRows(
      'tariff products',
      `delete from tariff_annex_products
       where id in (select id from cleanup_test_tariff_products)`,
    );
    await deleteRows(
      'job results',
      `delete from job_results
       where idempotency_key in (select idempotency_key from cleanup_test_outbox)`,
    );
    await deleteRows(
      'idempotency records',
      `delete from idempotency_records r
       where r.response->>'id' in (
           select id::text from cleanup_test_import_batches
           union
           select id::text from cleanup_test_bulk_batches
           union
           select id::text from cleanup_test_tariff_imports
         )
          or r.response->>'batchId' in (
            select id::text from cleanup_test_import_batches
            union
            select id::text from cleanup_test_bulk_batches
            union
            select id::text from cleanup_test_tariff_imports
          )
          or r.response->>'eventId' in (select id::text from cleanup_test_outbox)
          or r.response->'product'->>'id' in (select id::text from cleanup_test_tariff_products)
          or exists (
            select 1 from cleanup_test_items i
            where r.scope like '%' || i.id::text || '%'
          )
          or exists (
            select 1 from cleanup_test_reviews ar
            where r.scope like '%' || ar.id::text || '%'
          )
          or (
            $1::timestamptz is not null
            and r.created_at >= $1::timestamptz
            and (
              r.scope like 'foundation.event.v1:%'
              or r.scope like 'imports.%'
              or r.scope like 'bulk-updates.%'
              or r.scope like 'tariff-annex.%'
              or r.scope like 'audit-reviews.%'
              or r.scope like 'authorization-items.update:%'
              or r.scope like 'notifications.%'
            )
          )`,
      [sinceValue],
    );
    await deleteRows(
      'outbox events',
      `delete from outbox_events
       where id in (select id from cleanup_test_outbox)`,
    );

    await client.query('drop trigger if exists test_reject_update_audit on audit_events');
    await client.query('drop function if exists test_reject_update_audit()');
    await client.query('alter table audit_events disable trigger user');
    try {
      await deleteRows(
        'audit events',
        `delete from audit_events a
         where a.resource_id in (
             select id::text from cleanup_test_items
             union
             select id::text from cleanup_test_import_batches
             union
             select id::text from cleanup_test_bulk_batches
             union
             select id::text from cleanup_test_tariff_products
             union
             select id::text from cleanup_test_tariff_imports
             union
             select id::text from cleanup_test_outbox
             union
             select id::text from cleanup_test_reviews
             union
             select id::text from cleanup_test_users
             union
             select id::text from cleanup_test_recipients
           )
            or (
              $1::timestamptz is not null
              and a.occurred_at >= $1::timestamptz
              and a.action in (
                'OPERATIONAL_EXPORT_CREATED',
                'CONSOLIDATED_EXPORT_CREATED',
                'EPS_NOVEDADES_EXPORT_CREATED',
                'DEAD_LETTER_JOBS_READ'
              )
            )`,
        [sinceValue],
      );
    } finally {
      await client.query('alter table audit_events enable trigger user');
    }

    await deleteRows(
      'notification recipients',
      `delete from notification_recipients
       where id in (select id from cleanup_test_recipients)`,
    );
    await deleteRows(
      'pending user requests',
      `delete from pending_user_requests
       where email like 'f1-%@example.test'
          or email like 'f7-%@example.test'`,
    );
    await deleteRows(
      'user organization roles',
      `delete from user_organization_roles
       where user_id in (select id from cleanup_test_users)`,
    );
    await deleteRows(
      'test users',
      `delete from users
       where id in (select id from cleanup_test_users)`,
    );

    await client.query('commit');
    if (deleted.size === 0) {
      console.log('No test records were removed.');
    } else {
      console.log(
        `Removed test records: ${[...deleted.entries()]
          .map(([label, count]) => `${label}=${count}`)
          .join(', ')}.`,
      );
    }
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
