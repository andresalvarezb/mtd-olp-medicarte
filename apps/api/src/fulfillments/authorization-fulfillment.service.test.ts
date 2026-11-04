import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthorizationFulfillmentError } from '@authorization/domain';
import type { Scope } from '../common/request-scope';
import { AuthorizationFulfillmentService } from './authorization-fulfillment.service';
import type { AuthorizationFulfillmentRepository } from './authorization-fulfillment.repository';

describe('AuthorizationFulfillmentService expiration handling', () => {
  it('returns a 400 domain error for retroactive fulfillment after expiry', async () => {
    const fulfillMock = vi
      .fn()
      .mockRejectedValue(
        new AuthorizationFulfillmentError(
          'AUTHORIZATION_FULFILLMENT_EXPIRED',
          'Amplíe la vigencia antes de entregar o aplicar.',
        ),
      );
    const repository = {
      fulfill: fulfillMock,
    } as unknown as AuthorizationFulfillmentRepository;
    const service = new AuthorizationFulfillmentService(repository);
    const scope: Scope = {
      organizationId: '10000000-0000-4000-8000-000000000004',
      organizationCode: 'MEDICARTE',
      userId: '20000000-0000-4000-8000-000000000001',
      correlationId: '30000000-0000-4000-8000-000000000001',
      readSensitive: false,
      isFoundationAdmin: false,
      canCrossOrganizationOperationalExport: false,
      pointAccessKind: 'explicit',
    };

    const result = service.fulfill(
      '40000000-0000-4000-8000-000000000001',
      {
        purchaseOrderCode: 'PO-EXPIRED-TEST',
        fulfillmentType: 'APPLICATION',
        effectiveDate: '2026-10-30',
        quantity: 1,
      },
      scope,
    );
    const error = await result.catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getStatus()).toBe(400);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'AUTHORIZATION_FULFILLMENT_EXPIRED',
    });
    expect(fulfillMock).toHaveBeenCalledOnce();
  });
});
