import type {
  AnalyticsDrilldownKind,
  AnalyticsDrilldownQuery,
  AnalyticsQuery,
  OperationalAnalyticsResponse,
} from '@authorization/contracts';
import { apiRequest } from './api-client';

export type { AnalyticsQuery, OperationalAnalyticsResponse };

function params(query: object) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
}

export function getOperationalAnalytics(organizationId: string, query: AnalyticsQuery = {}) {
  const qs = params(query);
  return apiRequest<OperationalAnalyticsResponse>(`/analytics/operational${qs ? `?${qs}` : ''}`, {
    organizationId,
  });
}

export function getAnalyticsNovelties(organizationId: string, query: AnalyticsQuery = {}) {
  const qs = params(query);
  return apiRequest<{ outcomes: OperationalAnalyticsResponse['outcomes'] }>(
    `/analytics/novelties${qs ? `?${qs}` : ''}`,
    { organizationId },
  );
}

export function getAnalyticsInventory(organizationId: string, query: AnalyticsQuery = {}) {
  const qs = params(query);
  return apiRequest<{
    summary: OperationalAnalyticsResponse['inventory'];
    lots: Array<{
      inventoryLotId: string;
      commercialCode: string;
      dispensingPointName: string;
      lotNumber: string;
      expirationDate: string;
      physicalBalance: number;
      usableBalance: number;
      expired: boolean;
      upcomingExpiration: boolean;
    }>;
  }>(`/analytics/inventory${qs ? `?${qs}` : ''}`, { organizationId });
}

export function getAnalyticsEconomics(organizationId: string, query: AnalyticsQuery = {}) {
  const qs = params(query);
  return apiRequest<{ economics: NonNullable<OperationalAnalyticsResponse['economics']> }>(
    `/analytics/economics${qs ? `?${qs}` : ''}`,
    { organizationId },
  );
}

export function getAnalyticsDrilldown(organizationId: string, query: AnalyticsDrilldownQuery) {
  return apiRequest<{
    kind: AnalyticsDrilldownKind;
    items: Array<{
      id: string;
      kind: AnalyticsDrilldownKind;
      commercialCode: string | null;
      dispensingPointId: string | null;
      quantity: number | null;
      status: string | null;
      reference: string | null;
    }>;
  }>(`/analytics/drilldown?${params(query)}`, { organizationId });
}
