import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ORGANIZATION_IDS,
  adminLogin,
  apiUrl,
  ensureOperatorTokens,
} from './helpers/auth';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization_test_integration';

const database = new Client({ connectionString: databaseUrl });
let adminToken = '';
let olpToken = '';

type SseEvent = Readonly<{ event: string; data: string }>;

async function nextEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  wanted: string,
  timeoutMs = 8_000,
): Promise<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = '';

  return new Promise<SseEvent>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`SSE timeout waiting for ${wanted}`)), timeoutMs);

    const pump = async (): Promise<void> => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) throw new Error('SSE stream closed');
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            let event = 'message';
            const data: string[] = [];
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
            }
            if (event === wanted) {
              clearTimeout(timeout);
              resolve({ event, data: data.join('\n') });
              return;
            }
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    };

    void pump();
  });
}

function openStream(token: string, organizationId: string, signal: AbortSignal): Promise<Response> {
  return fetch(`${apiUrl}/api/v1/realtime/stream`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': organizationId,
      accept: 'text/event-stream',
    },
    signal,
  });
}

async function waitUntilProcessed(ids: readonly string[], timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await database.query<{ id: string; status: string }>(
      `select id,status from outbox_events where id = any($1::uuid[])`,
      [[...ids]],
    );

    if (result.rows.length === ids.length && result.rows.every((row) => row.status === 'PROCESSED')) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('Realtime outbox rows did not reach PROCESSED');
}

beforeAll(async () => {
  await database.connect();
  adminToken = await adminLogin();
  ({ olpToken } = await ensureOperatorTokens());
});

afterAll(async () => {
  await database.end();
});

describe.sequential('REALTIME-1 transport gate', () => {
  it('authenticates streams, isolates organizations and dispatches outbox invalidations', async () => {
    const mtdAbortA = new AbortController();
    const mtdAbortB = new AbortController();
    const olpAbort = new AbortController();

    try {
      const [mtdResponseA, mtdResponseB, olpResponse] = await Promise.all([
        openStream(adminToken, ORGANIZATION_IDS.MTD, mtdAbortA.signal),
        openStream(adminToken, ORGANIZATION_IDS.MTD, mtdAbortB.signal),
        openStream(olpToken, ORGANIZATION_IDS.OLP, olpAbort.signal),
      ]);

      expect(mtdResponseA.status).toBe(200);
      expect(mtdResponseB.status).toBe(200);
      expect(olpResponse.status).toBe(200);
      expect(mtdResponseA.headers.get('content-type')).toContain('text/event-stream');

      const mtdReaderA = mtdResponseA.body!.getReader();
      const mtdReaderB = mtdResponseB.body!.getReader();
      const olpReader = olpResponse.body!.getReader();

      await Promise.all([
        nextEvent(mtdReaderA, 'ready'),
        nextEvent(mtdReaderB, 'ready'),
        nextEvent(olpReader, 'ready'),
      ]);

      const mtdEventId = randomUUID();
      const olpEventId = randomUUID();
      const correlationId = randomUUID();

      await database.query(
        `insert into outbox_events
          (id,event_type,version,payload,correlation_id,organization_id,idempotency_key)
         values
          ($1,'realtime.invalidate',1,$2::jsonb,$3,$4,$5),
          ($6,'realtime.invalidate',1,$7::jsonb,$3,$8,$9)`,
        [
          mtdEventId,
          JSON.stringify({ topics: ['DASHBOARD'], resource: null }),
          correlationId,
          ORGANIZATION_IDS.MTD,
          `rt-gate:${mtdEventId}`,
          olpEventId,
          JSON.stringify({ topics: ['PURCHASE_ORDERS'], resource: null }),
          ORGANIZATION_IDS.OLP,
          `rt-gate:${olpEventId}`,
        ],
      );

      const [mtdEventA, mtdEventB, olpEvent] = await Promise.all([
        nextEvent(mtdReaderA, 'invalidate'),
        nextEvent(mtdReaderB, 'invalidate'),
        nextEvent(olpReader, 'invalidate'),
      ]);

      for (const mtdEvent of [mtdEventA, mtdEventB]) {
        expect(JSON.parse(mtdEvent.data)).toMatchObject({
          eventId: mtdEventId,
          organizationId: ORGANIZATION_IDS.MTD,
          topics: ['DASHBOARD'],
        });
      }
      expect(JSON.parse(olpEvent.data)).toMatchObject({
        eventId: olpEventId,
        organizationId: ORGANIZATION_IDS.OLP,
        topics: ['PURCHASE_ORDERS'],
      });

      await waitUntilProcessed([mtdEventId, olpEventId]);
      await database.query(
        `delete from outbox_events where id = any($1::uuid[])`,
        [[mtdEventId, olpEventId]],
      );
    } finally {
      mtdAbortA.abort();
      mtdAbortB.abort();
      olpAbort.abort();
    }
  });

  it('does not allow an OLP session to open the MTD organization stream', async () => {
    const abort = new AbortController();

    try {
      const response = await openStream(olpToken, ORGANIZATION_IDS.MTD, abort.signal);
      expect(response.status).toBe(403);
    } finally {
      abort.abort();
    }
  });
});
