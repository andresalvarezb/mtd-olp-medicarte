import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Client } from 'pg';

import { adminLogin, ORGANIZATION_IDS } from './helpers/auth';

const apiUrl = process.env.API_URL ?? 'http://localhost:3003';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:25432/authorization_test_integration';

const database = new Client({
  connectionString: databaseUrl,
});

const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();

let token = '';
let adminId = '';
let batchId = '';

const createdItems: string[] = [];

type ManualDecision = 'PENDING_MANUAL_ENABLEMENT' | 'MANUALLY_ENABLED' | 'MANUALLY_DISABLED';

type ItemState = Readonly<{
  direction_status: string;
  mipres_manual_decision: string;
  mipres_manual_version: number;
  mipres_manual_concept_code: string | null;
  mipres_manual_note: string | null;
  mipres_manual_updated_at: Date | null;
  mipres_manual_updated_by: string | null;
  operation_status: string | null;
  version: number;
}>;

function sha256Like(): string {
  return (randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')).slice(0, 64);
}

async function createItem(
  input: Readonly<{
    label: string;
    prescriptionSuffix: '0' | '1' | '5';
    decision: ManualDecision;
    conceptCode: string | null;
    note?: string | null;
  }>,
): Promise<string> {
  const prescription = `20261002000000000${input.prescriptionSuffix}`;

  const authorization = `W5-${input.label}-${suffix}`;

  const product = `W5-PROD-${input.label}-${suffix}`;

  const manualVersion = input.decision === 'PENDING_MANUAL_ENABLEMENT' ? 0 : 1;

  const result = await database.query<{ id: string }>(
    `
        insert into authorization_items (
          numero_autorizacion,
          codigo_medicamento,
          authorization_key,
          source_data,
          source_status_normalized,
          source_prescripcion_normalized,
          no_prescripcion,
          enablement_status,
          coverage_type,
          direction_status,
          operation_status,
          coverage_rule_version,
          tariff_membership_status,
          tariff_membership_evaluated_at,
          created_from_batch_id,
          mipres_manual_decision,
          mipres_manual_version,
          mipres_manual_concept_code,
          mipres_manual_note,
          mipres_manual_updated_at,
          mipres_manual_updated_by
        )
        values (
          $1,
          $2,
          $3,
          $4::jsonb,
          '5',
          $5,
          $5,
          'ENABLED',
          'NO_PBS',
          'PENDING',
          null,
          'W5',
          'LISTED',
          now(),
          $6,
          $7::varchar(30),
          $8::integer,
          $9::text,
          $10::text,
          case
            when $7::varchar(30) = 'PENDING_MANUAL_ENABLEMENT'
              then null
            else now()
          end,
          case
            when $7::varchar(30) = 'PENDING_MANUAL_ENABLEMENT'
              then null
            else $11::uuid
          end
        )
        returning id
      `,
    [
      authorization,
      product,
      `${authorization}:${product}`,
      JSON.stringify({
        NUMERO_AUTORIZACION: authorization,

        CODIGO_COMERCIAL: product,

        CANTIDAD: '1',

        FECHA_ASIGNACION: '2026-10-02',

        FECHA_FINAL_VIGENCIA: '2099-12-31',

        IDENTIFICACION_PACIENTE: `DOC-${authorization}`,

        NOMBRE_PACIENTE: `Paciente ${authorization}`,
      }),
      prescription,
      batchId,
      input.decision,
      manualVersion,
      input.conceptCode,
      input.note ?? null,
      adminId,
    ],
  );

  const id = result.rows[0]!.id;

  createdItems.push(id);

  await database.query(
    `
      insert into authorization_item_organizations (
        authorization_item_id,
        organization_id
      )
      values ($1, $2)
    `,
    [id, ORGANIZATION_IDS.MTD],
  );

  if (input.decision !== 'PENDING_MANUAL_ENABLEMENT') {
    await database.query(
      `
        insert into authorization_mipres_decision_history (
          authorization_item_id,
          previous_decision,
          decision,
          decision_version,
          concept_code,
          note,
          actor_id,
          organization_id,
          correlation_id
        )
        values (
          $1,
          'PENDING_MANUAL_ENABLEMENT',
          $2,
          1,
          $3,
          $4,
          $5,
          $6,
          $7
        )
      `,
      [
        id,
        input.decision,
        input.conceptCode,
        input.note ?? null,
        adminId,
        ORGANIZATION_IDS.MTD,
        randomUUID(),
      ],
    );
  }

  return id;
}

async function readState(itemId: string): Promise<ItemState> {
  const result = await database.query<ItemState>(
    `
        select
          direction_status,
          mipres_manual_decision,
          mipres_manual_version,
          mipres_manual_concept_code,
          mipres_manual_note,
          mipres_manual_updated_at,
          mipres_manual_updated_by,
          operation_status,
          version
        from authorization_items
        where id = $1
      `,
    [itemId],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error('W5_ITEM_NOT_FOUND');
  }

  return row;
}

function manualSnapshot(row: ItemState) {
  return {
    decision: row.mipres_manual_decision,

    version: Number(row.mipres_manual_version),

    concept: row.mipres_manual_concept_code,

    note: row.mipres_manual_note,

    updatedAt: row.mipres_manual_updated_at,

    updatedBy: row.mipres_manual_updated_by,
  };
}

async function readHistory(itemId: string) {
  const result = await database.query<{
    history: unknown;
  }>(
    `
        select
          coalesce(
            jsonb_agg(
              to_jsonb(h)
              order by
                h.decision_version,
                h.created_at
            ),
            '[]'::jsonb
          ) as history
        from authorization_mipres_decision_history h
        where
          h.authorization_item_id = $1
      `,
    [itemId],
  );

  return result.rows[0]?.history ?? [];
}

async function rawRecheck(itemId: string, idempotencyKey = randomUUID()) {
  const response = await fetch(`${apiUrl}/api/v1/mipres/${itemId}/recheck`, {
    method: 'POST',

    headers: {
      authorization: `Bearer ${token}`,

      'x-organization-id': ORGANIZATION_IDS.MTD,

      'idempotency-key': idempotencyKey,
    },
  });

  const body: unknown = await response.json();

  return {
    response,
    body,
  };
}

async function successfulRecheck(itemId: string, idempotencyKey = randomUUID()) {
  const result = await rawRecheck(itemId, idempotencyKey);

  expect(result.response.status, JSON.stringify(result.body)).toBe(200);

  return result.body as Record<string, unknown>;
}

async function manualCheckCount(itemId: string): Promise<number> {
  const result = await database.query<{
    count: string;
  }>(
    `
        select
          count(*)::text as count
        from mipres_checks
        where
          authorization_item_id = $1
          and query_type = 'MANUAL'
      `,
    [itemId],
  );

  return Number.parseInt(result.rows[0]?.count ?? '0', 10);
}

async function assertIsolation(
  input: Readonly<{
    itemId: string;
    expectedDirection: 'CONFIRMED' | 'PENDING' | 'QUERY_ERROR';
    expectedDecision: ManualDecision;
  }>,
): Promise<void> {
  const before = await readState(input.itemId);

  const beforeManual = manualSnapshot(before);

  const beforeHistory = await readHistory(input.itemId);

  const body = await successfulRecheck(input.itemId);

  expect(body).toMatchObject({
    itemId: input.itemId,

    previousDirectionStatus: 'PENDING',

    directionStatus: input.expectedDirection,

    queryType: 'MANUAL',

    manualDecision: input.expectedDecision,

    manualVersion: Number(before.mipres_manual_version),
  });

  const after = await readState(input.itemId);

  expect(after.direction_status).toBe(input.expectedDirection);

  expect(manualSnapshot(after)).toEqual(beforeManual);

  expect(await readHistory(input.itemId)).toEqual(beforeHistory);

  expect(after.operation_status).toBe(before.operation_status);

  expect(Number(after.version)).toBe(Number(before.version));

  expect(await manualCheckCount(input.itemId)).toBe(1);
}

beforeAll(async () => {
  await database.connect();

  token = await adminLogin();

  const admin = await database.query<{
    id: string;
  }>(
    `
          select id
          from users
          where username =
            'foundation-admin'
        `,
  );

  adminId = admin.rows[0]?.id ?? '';

  if (!adminId) {
    throw new Error('FOUNDATION_ADMIN_NOT_FOUND');
  }

  const batch = await database.query<{
    id: string;
  }>(
    `
          insert into import_batches (
            organization_id,
            created_by,
            original_filename,
            mime_type,
            size_bytes,
            sha256,
            processor_version,
            status,
            total_rows,
            confirmed_rows,
            completed_at,
            confirmed_at
          )
          values (
            $1,
            $2,
            $3,
            'application/json',
            1,
            $4,
            1,
            'COMPLETED',
            20,
            20,
            now(),
            now()
          )
          returning id
        `,
    [ORGANIZATION_IDS.MTD, adminId, `w5-${suffix}.json`, sha256Like()],
  );

  batchId = batch.rows[0]!.id;
}, 30_000);

afterAll(async () => {
  if (createdItems.length > 0) {
    await database.query(
      `
          delete from mipres_directions
          where
            authorization_item_id =
            any($1::uuid[])
        `,
      [createdItems],
    );

    await database.query(
      `
          delete from mipres_checks
          where
            authorization_item_id =
            any($1::uuid[])
        `,
      [createdItems],
    );

    await database.query(
      `
          delete from
            authorization_mipres_decision_history
          where
            authorization_item_id =
            any($1::uuid[])
        `,
      [createdItems],
    );

    await database.query(
      `
          delete from
            authorization_item_organizations
          where
            authorization_item_id =
            any($1::uuid[])
        `,
      [createdItems],
    );

    await database.query(
      `
          delete from authorization_items
          where
            id = any($1::uuid[])
        `,
      [createdItems],
    );
  }

  if (batchId) {
    await database.query(
      `
          delete from import_batches
          where id = $1
        `,
      [batchId],
    );
  }

  await database.end();
});

describe('W5 MIPRES recheck isolation', () => {
  it('CONFIRMED does not auto-enable pending manual decision', async () => {
    const itemId = await createItem({
      label: 'PENDING',
      prescriptionSuffix: '0',
      decision: 'PENDING_MANUAL_ENABLEMENT',
      conceptCode: null,
    });

    await assertIsolation({
      itemId,
      expectedDirection: 'CONFIRMED',
      expectedDecision: 'PENDING_MANUAL_ENABLEMENT',
    });
  });

  it('PENDING evidence preserves MANUALLY_ENABLED', async () => {
    const itemId = await createItem({
      label: 'ENABLED-PENDING',
      prescriptionSuffix: '1',
      decision: 'MANUALLY_ENABLED',
      conceptCode: 'MIPRES_SUPPORT_VALIDATED',
    });

    await assertIsolation({
      itemId,
      expectedDirection: 'PENDING',
      expectedDecision: 'MANUALLY_ENABLED',
    });
  });

  it('CONFIRMED evidence preserves MANUALLY_DISABLED', async () => {
    const itemId = await createItem({
      label: 'DISABLED-CONFIRMED',
      prescriptionSuffix: '0',
      decision: 'MANUALLY_DISABLED',
      conceptCode: 'DIRECTION_DOES_NOT_MATCH',
    });

    await assertIsolation({
      itemId,
      expectedDirection: 'CONFIRMED',
      expectedDecision: 'MANUALLY_DISABLED',
    });
  });

  it('QUERY_ERROR preserves MANUALLY_ENABLED', async () => {
    const itemId = await createItem({
      label: 'ENABLED-ERROR',
      prescriptionSuffix: '5',
      decision: 'MANUALLY_ENABLED',
      conceptCode: 'MIPRES_SUPPORT_VALIDATED',
    });

    await assertIsolation({
      itemId,
      expectedDirection: 'QUERY_ERROR',
      expectedDecision: 'MANUALLY_ENABLED',
    });
  });

  it('same idempotency key does not duplicate evidence', async () => {
    const itemId = await createItem({
      label: 'IDEMPOTENT',
      prescriptionSuffix: '0',
      decision: 'PENDING_MANUAL_ENABLEMENT',
      conceptCode: null,
    });

    const key = randomUUID();

    const first = await successfulRecheck(itemId, key);

    const second = await successfulRecheck(itemId, key);

    expect(second).toEqual(first);

    expect(await manualCheckCount(itemId)).toBe(1);
  });

  it('enforces manual daily limit with HTTP 429', async () => {
    const itemId = await createItem({
      label: 'RATE-LIMIT',
      prescriptionSuffix: '0',
      decision: 'PENDING_MANUAL_ENABLEMENT',
      conceptCode: null,
    });

    for (let index = 0; index < 3; index += 1) {
      const result = await rawRecheck(itemId);

      expect(result.response.status, JSON.stringify(result.body)).toBe(200);
    }

    const blocked = await rawRecheck(itemId);

    expect(blocked.response.status, JSON.stringify(blocked.body)).toBe(429);

    expect(blocked.body).toMatchObject({
      code: 'MIPRES_RECHECK_RATE_LIMITED',
    });

    expect(await manualCheckCount(itemId)).toBe(3);
  });
});
