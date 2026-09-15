/**
 * ESP-014: analytics XLSX mapping. Does not recalculate KPIs.
 * Values come from the ESP-013 operational read model as-is.
 */

import type { MoneyMetric } from './operational-analytics';

export const ANALYTICS_EXPORT_UNAVAILABLE_LABEL = 'No disponible' as const;

export function exportMoneyCell(metric: MoneyMetric): string {
  if (metric.availability !== 'EXACT' || metric.value == null) {
    return ANALYTICS_EXPORT_UNAVAILABLE_LABEL;
  }
  return metric.value;
}

export type AnalyticsExportSheet = Readonly<{
  name: string;
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null>>;
}>;

export function moneyExportRow(
  metricName: string,
  metric: MoneyMetric,
): ReadonlyArray<string | number | boolean | null> {
  return [
    metricName,
    metric.availability,
    metric.availability === 'EXACT' ? metric.value : ANALYTICS_EXPORT_UNAVAILABLE_LABEL,
    metric.basis,
    metric.reason,
  ];
}
