import { apiRequest } from './api-client';

export type FinancialAuditDashboardResponse = {
  generatedAt: string;

  authorizationTotal: number;

  moderatorFee: {
    collectedCount: number;
    notCollectedCount: number;
    notRecordedCount: number;
    collectedAmountCop: string;
  };

  billingAudit: {
    notStartedCount: number;
    pendingCount: number;
    compliesCount: number;
    doesNotComplyCount: number;
    inconsistentCount: number;
  };

  fulfillment: {
    withFulfillmentCount: number;
  };
};

export function getFinancialAuditDashboard(
  organizationId: string,
  signal?: AbortSignal,
): Promise<FinancialAuditDashboardResponse> {
  return apiRequest<FinancialAuditDashboardResponse>(
    '/analytics/dashboard/financial-audit',
    {
      organizationId,
      ...(signal ? { signal } : {}),
    },
  );
}
