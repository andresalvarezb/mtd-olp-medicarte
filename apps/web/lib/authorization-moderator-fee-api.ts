import type {
  ModeratorFeeResponse,
  RegisterModeratorFeeRequest,
} from '@authorization/contracts';

import { apiRequest } from './api-client';

export type {
  ModeratorFeeResponse,
  RegisterModeratorFeeRequest,
} from '@authorization/contracts';

export function getAuthorizationModeratorFee(
  organizationId: string,
  authorizationItemId: string,
): Promise<ModeratorFeeResponse> {
  return apiRequest<ModeratorFeeResponse>(
    `/medicarte/authorizations/${encodeURIComponent(authorizationItemId)}/moderator-fee`,
    { organizationId },
  );
}

export function registerAuthorizationModeratorFee(
  organizationId: string,
  authorizationItemId: string,
  body: RegisterModeratorFeeRequest,
): Promise<ModeratorFeeResponse> {
  return apiRequest<ModeratorFeeResponse>(
    `/medicarte/authorizations/${encodeURIComponent(authorizationItemId)}/moderator-fee`,
    {
      method: 'POST',
      organizationId,
      idempotencyKey: body.idempotencyKey,
      body: JSON.stringify(body),
    },
  );
}

export function getAuthorizationModeratorFeeInvoiceUrl(
  organizationId: string,
  authorizationItemId: string,
): Promise<{ invoiceUrl: string | null }> {
  return apiRequest<{ invoiceUrl: string | null }>(
    `/medicarte/authorizations/${encodeURIComponent(authorizationItemId)}/moderator-fee/invoice-url`,
    { organizationId },
  );
}
