import { sql, type SQL } from 'drizzle-orm';
import type { RealtimeTopic } from '@authorization/contracts';

export type RealtimeOrganizationCode = 'MTD' | 'OLP' | 'MEDICARTE' | 'COMPENSAR';

export const REALTIME_AUDIENCE = {
  AUTHORIZATION: ['MTD', 'MEDICARTE'],
  PROCUREMENT: ['MTD', 'OLP', 'MEDICARTE'],
  INVENTORY: ['MTD', 'MEDICARTE'],
  TARIFF: ['MTD', 'MEDICARTE'],
} as const satisfies Record<string, readonly RealtimeOrganizationCode[]>;

export type RealtimeResourceRef = Readonly<{
  type: string;
  id: string;
  version?: number;
}>;

export function realtimeInvalidationSql(input: {
  organizationCodes: readonly RealtimeOrganizationCode[];
  topics: readonly RealtimeTopic[];
  correlationId: string;
  resource?: RealtimeResourceRef | null;
}): SQL {
  const organizationCodes = [...new Set(input.organizationCodes)];
  const topics = [...new Set(input.topics)];

  if (organizationCodes.length === 0) throw new Error('REALTIME_ORGANIZATION_REQUIRED');
  if (topics.length === 0) throw new Error('REALTIME_TOPIC_REQUIRED');

  const payload = JSON.stringify({
    topics,
    resource: input.resource ?? null,
  });

  return sql`
    insert into outbox_events (
      event_type,
      version,
      payload,
      correlation_id,
      organization_id,
      idempotency_key
    )
    select
      'realtime.invalidate',
      1,
      ${payload}::jsonb,
      ${input.correlationId}::uuid,
      o.id,
      'realtime:' || gen_random_uuid()::text
    from organizations o
    where o.active = true
      and o.code in (${sql.join(
        organizationCodes.map((code) => sql`${code}`),
        sql`, `,
      )})
  `;
}
