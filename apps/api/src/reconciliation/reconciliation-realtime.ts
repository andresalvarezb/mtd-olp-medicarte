import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

type ReconciliationRealtimeResource = Readonly<{
  type: string;
  id: string;
  version?: number;
}>;

export async function appendReconciliationRealtime(
  client: Pool | PoolClient,
  input: {
    organizationId: string;
    correlationId?: string | null;
    resource?: ReconciliationRealtimeResource | null;
  },
): Promise<void> {
  const correlationId = input.correlationId ?? randomUUID();
  const idempotencyKey =
    `realtime:reconciliation:${randomUUID()}`.slice(0, 200);

  await client.query(
    `insert into outbox_events (
       event_type,
       version,
       payload,
       correlation_id,
       organization_id,
       idempotency_key
     )
     values (
       'realtime.invalidate',
       1,
       $1::jsonb,
       $2::uuid,
       $3::uuid,
       $4
     )
     on conflict (idempotency_key) do nothing`,
    [
      JSON.stringify({
        topics: ['RECONCILIATION'],
        resource: input.resource ?? null,
      }),
      correlationId,
      input.organizationId,
      idempotencyKey,
    ],
  );
}
