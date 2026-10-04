import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mipresManualDecisionResponseSchema } from '../../packages/contracts/src/index.js';

import { ORGANIZATION_IDS, adminLogin, ensureUser } from './helpers/auth';

const apiUrl = process.env.API_URL ?? 'http://localhost:3003';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:25432/authorization_test_integration';

const database = new Client({
  connectionString: databaseUrl,
});

let adminToken: string;

let operatorToken: string;

let readOnlyToken: string;

let adminUserId: string;

let batchId: string;

async function requestDecision(
  itemId: string,

  input: Readonly<{
    token: string;

    key: string;

    body: unknown;

    organizationId?: string;
  }>,
) {
  return fetch(`${apiUrl}/api/v1/mipres/${itemId}/decision`, {
    method: 'POST',

    headers: {
      authorization: `Bearer ${input.token}`,

      'content-type': 'application/json',

      'x-organization-id': input.organizationId ?? ORGANIZATION_IDS.MTD,

      'idempotency-key': input.key,
    },

    body: JSON.stringify(input.body),
  });
}

async function createItem(
  input: Readonly<{
    coverageType?: 'NO_PBS' | 'PBS';

    directionStatus?: 'NOT_APPLICABLE' | 'PENDING' | 'CONFIRMED' | 'QUERY_ERROR';
  }> = {},
): Promise<string> {
  const id = randomUUID();

  const authorization = `W3-${randomUUID()}`;

  const product = `W3-${randomUUID()}`.toUpperCase();

  const prescription = `RX-${randomUUID()}`;

  await database.query(
    `insert into
       authorization_items
       (
         id,
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
         coverage_rule_version,
         tariff_membership_status,
         created_from_batch_id
       )

     values
       (
         $1,
         $2,
         $3,
         $4,
         $5::jsonb,
         '5',
         $6,
         $6,
         'ENABLED',
         $7,
         $8,
         'W3-TEST',
         'LISTED',
         $9
       )`,
    [
      id,
      authorization,
      product,
      `${authorization}|${product}`,
      JSON.stringify({
        CANTIDAD: '5',

        FECHA_ASIGNACION: '20260930',

        FECHA_FINAL_VIGENCIA: '20261231',

        IDENTIFICACION_PACIENTE: '1099999999',

        NOMBRE_PACIENTE: 'PACIENTE WAVE 3',
      }),
      prescription,
      input.coverageType ?? 'NO_PBS',
      input.directionStatus ?? 'CONFIRMED',
      batchId,
    ],
  );

  return id;
}

beforeAll(async () => {
  await database.connect();

  adminToken = await adminLogin();

  operatorToken = await ensureUser({
    adminToken,

    username: 'wave3-mtd-operator',

    displayName: 'Wave 3 MTD Operator',

    password: 'Wave3Operator!2026',

    organizationId: ORGANIZATION_IDS.MTD,

    roleCode: 'MTD_OPERATOR',
  });

  readOnlyToken = await ensureUser({
    adminToken,

    username: 'wave3-read-only',

    displayName: 'Wave 3 Read Only',

    password: 'Wave3ReadOnly!2026',

    organizationId: ORGANIZATION_IDS.MTD,

    roleCode: 'READ_ONLY',
  });

  const admin = await database.query<{
    id: string;
  }>(
    `select
           id

         from
           users

         where
           username =
             'foundation-admin'`,
  );

  adminUserId = admin.rows[0]?.id ?? '';

  if (!adminUserId) {
    throw new Error('foundation-admin not found');
  }

  batchId = randomUUID();

  await database.query(
    `insert into
         import_batches
         (
           id,
           organization_id,
           created_by,
           original_filename,
           mime_type,
           size_bytes,
           sha256,
           processor_version,
           status
         )

       values
         (
           $1,
           $2,
           $3,
           'wave3-mipres.xlsx',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           1,
           $4,
           1,
           'COMPLETED'
         )`,
    [batchId, ORGANIZATION_IDS.MTD, adminUserId, 'b'.repeat(64)],
  );
});

afterAll(async () => {
  await database.end();
});

describe('MIPRES manual decision WAVE 3', () => {
  it('persists enable, disable and reset without modifying external evidence', async () => {
    const itemId = await createItem({
      directionStatus: 'CONFIRMED',
    });

    const enableKey = randomUUID();

    const enableResponse = await requestDecision(itemId, {
      token: adminToken,

      key: enableKey,

      body: {
        action: 'ENABLE',

        expectedVersion: 0,

        conceptCode: 'EPS_ADMINISTRATIVE_VALIDATION',
      },
    });

    expect(enableResponse.status).toBe(200);

    const enable = mipresManualDecisionResponseSchema.parse(await enableResponse.json());

    expect(enable).toMatchObject({
      itemId,

      decision: 'MANUALLY_ENABLED',

      version: 1,

      conceptCode: 'EPS_ADMINISTRATIVE_VALIDATION',
    });

    /*
     * Replay exacto: misma respuesta,
     * sin nueva transición.
     */
    const replayResponse = await requestDecision(itemId, {
      token: adminToken,

      key: enableKey,

      body: {
        action: 'ENABLE',

        expectedVersion: 0,

        conceptCode: 'EPS_ADMINISTRATIVE_VALIDATION',
      },
    });

    expect(replayResponse.status).toBe(200);

    const replay = mipresManualDecisionResponseSchema.parse(await replayResponse.json());

    expect(replay).toEqual(enable);

    const afterReplay = await database.query<{
      count: string;
    }>(
      `select
               count(*)::text
                 as count

             from
               authorization_mipres_decision_history

             where
               authorization_item_id =
                 $1`,
      [itemId],
    );

    expect(Number(afterReplay.rows[0]?.count ?? 0)).toBe(1);

    /*
     * La misma clave con otro payload
     * debe ser rechazada.
     */
    const idemConflict = await requestDecision(itemId, {
      token: adminToken,

      key: enableKey,

      body: {
        action: 'DISABLE',

        expectedVersion: 1,

        conceptCode: 'DIRECTION_DOES_NOT_MATCH',
      },
    });

    expect(idemConflict.status).toBe(409);

    expect(await idemConflict.json()).toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });

    /*
     * Optimistic concurrency.
     */
    const stale = await requestDecision(itemId, {
      token: adminToken,

      key: randomUUID(),

      body: {
        action: 'DISABLE',

        expectedVersion: 0,

        conceptCode: 'DIRECTION_DOES_NOT_MATCH',
      },
    });

    expect(stale.status).toBe(409);

    expect(await stale.json()).toMatchObject({
      code: 'MIPRES_DECISION_VERSION_CONFLICT',
    });

    const disableResponse = await requestDecision(itemId, {
      token: adminToken,

      key: randomUUID(),

      body: {
        action: 'DISABLE',

        expectedVersion: 1,

        conceptCode: 'DIRECTION_DOES_NOT_MATCH',
      },
    });

    expect(disableResponse.status).toBe(200);

    const disable = mipresManualDecisionResponseSchema.parse(await disableResponse.json());

    expect(disable).toMatchObject({
      decision: 'MANUALLY_DISABLED',

      version: 2,

      conceptCode: 'DIRECTION_DOES_NOT_MATCH',
    });

    const resetResponse = await requestDecision(itemId, {
      token: adminToken,

      key: randomUUID(),

      body: {
        action: 'RESET',

        expectedVersion: 2,

        observation: 'Se restablece para una nueva revisión operacional.',
      },
    });

    expect(resetResponse.status).toBe(200);

    const reset = mipresManualDecisionResponseSchema.parse(await resetResponse.json());

    expect(reset).toMatchObject({
      decision: 'PENDING_MANUAL_ENABLEMENT',

      version: 3,

      conceptCode: null,
    });

    const item = await database.query<{
      direction_status: string;

      enablement_status: string;

      mipres_manual_decision: string;

      mipres_manual_version: number;
    }>(
      `select
               direction_status,
               enablement_status,
               mipres_manual_decision,
               mipres_manual_version

             from
               authorization_items

             where
               id =
                 $1`,
      [itemId],
    );

    expect(item.rows[0]).toMatchObject({
      direction_status: 'CONFIRMED',

      enablement_status: 'ENABLED',

      mipres_manual_decision: 'PENDING_MANUAL_ENABLEMENT',

      mipres_manual_version: 3,
    });

    /*
     * La decisión humana no genera ni
     * altera evidencia MIPRES.
     */
    const evidence = await database.query<{
      count: string;
    }>(
      `select
               count(*)::text
                 as count

             from
               mipres_checks

             where
               authorization_item_id =
                 $1`,
      [itemId],
    );

    expect(Number(evidence.rows[0]?.count ?? 0)).toBe(0);

    const history = await database.query<{
      decision: string;

      decision_version: number;
    }>(
      `select
               decision,
               decision_version

             from
               authorization_mipres_decision_history

             where
               authorization_item_id =
                 $1

             order by
               decision_version`,
      [itemId],
    );

    expect(history.rows).toEqual([
      {
        decision: 'MANUALLY_ENABLED',

        decision_version: 1,
      },
      {
        decision: 'MANUALLY_DISABLED',

        decision_version: 2,
      },
      {
        decision: 'PENDING_MANUAL_ENABLEMENT',

        decision_version: 3,
      },
    ]);

    const audits = await database.query<{
      action: string;
    }>(
      `select
               action

             from
               audit_events

             where
               resource_type =
                 'authorization_mipres_decision'

               and

               resource_id =
                 $1

             order by
               occurred_at`,
      [itemId],
    );

    expect(audits.rows.map((row) => row.action)).toEqual([
      'MIPRES_MANUAL_ENABLED',
      'MIPRES_MANUAL_DISABLED',
      'MIPRES_MANUAL_RESET_TO_PENDING',
    ]);

    const outbox = await database.query<{
      count: string;
    }>(
      `select
               count(*)::text
                 as count

             from
               outbox_events

             where
               event_type =
                 'realtime.invalidate'

               and

               payload
                 -> 'resource'
                 ->> 'id'
                 =
                 $1`,
      [itemId],
    );

    expect(Number(outbox.rows[0]?.count ?? 0)).toBe(3);
  });

  it('enforces concept action and required observation', async () => {
    const noteRequiredItem = await createItem();

    const missingNote = await requestDecision(noteRequiredItem, {
      token: adminToken,

      key: randomUUID(),

      body: {
        action: 'ENABLE',

        expectedVersion: 0,

        conceptCode: 'MIPRES_CONTINGENCY',
      },
    });

    expect(missingNote.status).toBe(400);

    expect(await missingNote.json()).toMatchObject({
      code: 'MIPRES_DECISION_NOTE_REQUIRED',
    });

    const mismatchItem = await createItem();

    const mismatch = await requestDecision(mismatchItem, {
      token: adminToken,

      key: randomUUID(),

      body: {
        action: 'ENABLE',

        expectedVersion: 0,

        conceptCode: 'DIRECTION_DOES_NOT_MATCH',
      },
    });

    expect(mismatch.status).toBe(400);

    expect(await mismatch.json()).toMatchObject({
      code: 'MIPRES_DECISION_CONCEPT_INVALID',
    });

    const resetConceptItem = await createItem();

    const enabled = await requestDecision(resetConceptItem, {
      token: adminToken,

      key: randomUUID(),

      body: {
        action: 'ENABLE',

        expectedVersion: 0,

        conceptCode: 'EPS_ADMINISTRATIVE_VALIDATION',
      },
    });

    expect(enabled.status).toBe(200);

    const invalidReset = await requestDecision(resetConceptItem, {
      token: adminToken,

      key: randomUUID(),

      body: {
        action: 'RESET',

        expectedVersion: 1,

        conceptCode: 'EPS_ADMINISTRATIVE_VALIDATION',
      },
    });

    expect(invalidReset.status).toBe(400);

    expect(await invalidReset.json()).toMatchObject({
      code: 'MIPRES_RESET_CONCEPT_NOT_ALLOWED',
    });
  });

  it('allows MTD_OPERATOR and denies READ_ONLY', async () => {
    const operatorItem = await createItem();

    const operatorResponse = await requestDecision(operatorItem, {
      token: operatorToken,

      key: randomUUID(),

      body: {
        action: 'ENABLE',

        expectedVersion: 0,

        conceptCode: 'EPS_ADMINISTRATIVE_VALIDATION',
      },
    });

    expect(operatorResponse.status).toBe(200);

    expect(mipresManualDecisionResponseSchema.parse(await operatorResponse.json())).toMatchObject({
      decision: 'MANUALLY_ENABLED',

      version: 1,
    });

    const readOnlyItem = await createItem();

    const denied = await requestDecision(readOnlyItem, {
      token: readOnlyToken,

      key: randomUUID(),

      body: {
        action: 'ENABLE',

        expectedVersion: 0,

        conceptCode: 'EPS_ADMINISTRATIVE_VALIDATION',
      },
    });

    expect(denied.status).toBe(403);

    expect(await denied.json()).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('serializes concurrent decisions with optimistic versioning', async () => {
    const itemId = await createItem();

    const requests = await Promise.all([
      requestDecision(itemId, {
        token: adminToken,

        key: randomUUID(),

        body: {
          action: 'ENABLE',

          expectedVersion: 0,

          conceptCode: 'EPS_ADMINISTRATIVE_VALIDATION',
        },
      }),

      requestDecision(itemId, {
        token: adminToken,

        key: randomUUID(),

        body: {
          action: 'ENABLE',

          expectedVersion: 0,

          conceptCode: 'EPS_ADMINISTRATIVE_VALIDATION',
        },
      }),
    ]);

    const statuses = requests
      .map((response) => response.status)
      .sort((left, right) => left - right);

    expect(statuses).toEqual([200, 409]);

    const failed = requests.find((response) => response.status === 409);

    if (!failed) {
      throw new Error('Expected one concurrent request to fail');
    }

    expect(await failed.json()).toMatchObject({
      code: 'MIPRES_DECISION_VERSION_CONFLICT',
    });

    const state = await database.query<{
      mipres_manual_version: number;

      history_count: number;
    }>(
      `select
               i.mipres_manual_version,

               (
                 select
                   count(*)::int

                 from
                   authorization_mipres_decision_history h

                 where
                   h.authorization_item_id =
                     i.id
               )
                 as history_count

             from
               authorization_items i

             where
               i.id =
                 $1`,
      [itemId],
    );

    expect(state.rows[0]).toMatchObject({
      mipres_manual_version: 1,

      history_count: 1,
    });
  });

  it('rejects decision control for non NO_PBS authorization', async () => {
    const itemId = await createItem({
      coverageType: 'PBS',

      directionStatus: 'NOT_APPLICABLE',
    });

    const response = await requestDecision(itemId, {
      token: adminToken,

      key: randomUUID(),

      body: {
        action: 'ENABLE',

        expectedVersion: 0,

        conceptCode: 'EPS_ADMINISTRATIVE_VALIDATION',
      },
    });

    expect(response.status).toBe(409);

    expect(await response.json()).toMatchObject({
      code: 'MIPRES_DECISION_NOT_APPLICABLE',
    });
  });
});
