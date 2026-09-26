import type {
  FulfillmentAuditListQuery,
  FulfillmentAuditResponse,
  RejectFulfillmentAuditRequest,
} from '@authorization/contracts';

import {
  apiRequest,
} from './api-client';

export function listAuthorizationFulfillmentAudits(
  organizationId: string,
  query: Partial<FulfillmentAuditListQuery> = {},
) {
  const params =
    new URLSearchParams();

  for (
    const [
      key,
      value,
    ] of
    Object.entries(
      query,
    )
  ) {
    if (
      value !==
      undefined
    ) {
      params.set(
        key,
        String(
          value,
        ),
      );
    }
  }

  return apiRequest<{
    items:
      FulfillmentAuditResponse[];
  }>(
    `/fulfillment-audits?${params}`,
    {
      organizationId,
    },
  );
}

export function startAuthorizationFulfillmentAudit(
  organizationId: string,
  fulfillmentId: string,
) {
  return apiRequest<FulfillmentAuditResponse>(
    `/fulfillments/${fulfillmentId}/audit/start`,
    {
      method:
        'POST',

      organizationId,

      body:
        JSON.stringify(
          {},
        ),
    },
  );
}

export function approveAuthorizationFulfillmentAudit(
  organizationId: string,
  auditId: string,
) {
  return apiRequest<FulfillmentAuditResponse>(
    `/fulfillment-audits/${auditId}/approve`,
    {
      method:
        'POST',

      organizationId,

      body:
        JSON.stringify(
          {},
        ),
    },
  );
}

export function rejectAuthorizationFulfillmentAudit(
  organizationId: string,
  auditId: string,
  body: RejectFulfillmentAuditRequest,
) {
  return apiRequest<FulfillmentAuditResponse>(
    `/fulfillment-audits/${auditId}/reject`,
    {
      method:
        'POST',

      organizationId,

      body:
        JSON.stringify(
          body,
        ),
    },
  );
}
