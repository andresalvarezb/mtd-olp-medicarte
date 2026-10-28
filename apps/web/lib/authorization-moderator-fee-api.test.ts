import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from './api-client';

import {
  getAuthorizationModeratorFee,
  getAuthorizationModeratorFeeInvoiceUrl,
  registerAuthorizationModeratorFee,
} from './authorization-moderator-fee-api';

vi.mock('./api-client', () => ({
  apiRequest: vi.fn(),
}));

const organizationId =
  '10000000-0000-4000-8000-000000000001';

const authorizationId =
  '30000000-0000-4000-8000-000000000001';

const key =
  '60000000-0000-4000-8000-000000000001';

describe('Cliente de recaudo cuota moderadora', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRequest).mockResolvedValue({} as never);
  });

  it('consulta la autorización en la organización activa', async () => {
    await getAuthorizationModeratorFee(
      organizationId,
      authorizationId,
    );

    expect(apiRequest).toHaveBeenCalledWith(
      `/medicarte/authorizations/${authorizationId}/moderator-fee`,
      { organizationId },
    );
  });

  it('envía un recaudo con idempotencia y versión', async () => {
    const payload = {
      idempotencyKey: key,
      expectedVersion: 0,
      status: 'COLLECTED' as const,
      amountCop: '12500.00',
      collectedAt: '2026-10-17T10:00:00-05:00',
    };

    await registerAuthorizationModeratorFee(
      organizationId,
      authorizationId,
      payload,
    );

    expect(apiRequest).toHaveBeenCalledWith(
      `/medicarte/authorizations/${authorizationId}/moderator-fee`,
      {
        method: 'POST',
        organizationId,
        idempotencyKey: key,
        body: JSON.stringify(payload),
      },
    );
  });

  it('registra NO RECAUDADA sin inventar importe ni fecha', async () => {
    const payload = {
      idempotencyKey: key,
      expectedVersion: 1,
      status: 'NOT_COLLECTED' as const,
    };

    await registerAuthorizationModeratorFee(
      organizationId,
      authorizationId,
      payload,
    );

    const options = vi.mocked(apiRequest).mock.calls[0]?.[1];

    expect(typeof options?.body).toBe('string');

    if (typeof options?.body !== 'string') {
      throw new Error('EXPECTED_JSON_BODY');
    }

    expect(JSON.parse(options.body)).toEqual(payload);
    expect(options?.organizationId).toBe(organizationId);
  });

  it('consulta la URL de factura en la organización activa', async () => {
    await getAuthorizationModeratorFeeInvoiceUrl(
      organizationId,
      authorizationId,
    );

    expect(apiRequest).toHaveBeenCalledWith(
      `/medicarte/authorizations/${authorizationId}/moderator-fee/invoice-url`,
      { organizationId },
    );
  });
});
