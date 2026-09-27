import { describe, expect, it } from 'vitest';
import {
  realtimeInvalidationMessageSchema,
  realtimeOutboxPayloadSchema,
} from './index';

describe('REALTIME-01 contracts', () => {
  it('accepts a minimal invalidation payload', () => {
    expect(
      realtimeOutboxPayloadSchema.parse({
        topics: ['AUTHORIZATIONS', 'DASHBOARD'],
        resource: { type: 'authorization_item', id: 'resource-1', version: 2 },
      }),
    ).toMatchObject({
      topics: ['AUTHORIZATIONS', 'DASHBOARD'],
    });
  });

  it('rejects unknown topics', () => {
    expect(
      realtimeOutboxPayloadSchema.safeParse({
        topics: ['UNKNOWN'],
      }).success,
    ).toBe(false);
  });

  it('requires organization and correlation metadata on published messages', () => {
    const result = realtimeInvalidationMessageSchema.safeParse({
      eventId: '00000000-0000-4000-8000-000000000001',
      type: 'realtime.invalidate',
      version: 1,
      organizationId: '00000000-0000-4000-8000-000000000002',
      topics: ['PURCHASE_ORDERS'],
      resource: null,
      correlationId: '00000000-0000-4000-8000-000000000003',
      occurredAt: '2026-09-26T18:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });

  it('accepts RECONCILIATION realtime topic', () => {
    expect(
      realtimeOutboxPayloadSchema.safeParse({
        topics: ['RECONCILIATION'],
      }).success,
    ).toBe(true);
  });

});
