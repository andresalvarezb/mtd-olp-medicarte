/**
 * ESP-013: pure operational and economic formulas.
 * Analytics is a derived read model; these functions do not persist facts.
 * The live annex (`active = true`) is not a period-effective historical tariff.
 */

export const ANALYTICS_DEFINITIONS_VERSION = 'ESP-013' as const;

export const CURRENT_ON_HAND_LABEL = 'currentOnHandQuantity' as const;
export const PERIOD_FLOW_LABEL = 'receivedMinusAppliedFlow' as const;
export const PERIOD_FLOW_DISCLAIMER =
  'balance de flujo del período, no inventario atribuible al período';

export const APPLIED_SUPPLIER_COST_UNAVAILABLE_REASON = 'AMBIGUOUS_LOT_PROVENANCE' as const;
export const HISTORICAL_TARIFF_UNAVAILABLE = 'HISTORICAL_TARIFF_UNAVAILABLE' as const;
export const INCOMPLETE_TARIFF_LOOKUP = 'INCOMPLETE_TARIFF_LOOKUP' as const;
export const INCOMPLETE_SUPPLIER_COST = 'INCOMPLETE_SUPPLIER_COST' as const;
export const PURCHASE_ORDER_SNAPSHOT_BASIS = 'PURCHASE_ORDER_SNAPSHOT' as const;
export const PERIOD_EFFECTIVE_TARIFF_BASIS = 'PERIOD_EFFECTIVE_TARIFF' as const;

export type RatioMetric = Readonly<{
  numerator: number;
  denominator: number;
  rate: string | null;
}>;

export type MoneyAvailability = 'EXACT' | 'UNAVAILABLE';
export type MoneyLineageBasis = 'PURCHASE_ORDER_SNAPSHOT' | 'PERIOD_EFFECTIVE_TARIFF';

export type MoneyMetric = Readonly<{
  availability: MoneyAvailability;
  value: string | null;
  reason: string | null;
  basis: MoneyLineageBasis | null;
}>;

const MONEY_PATTERN = /^-?\d+\.\d{2}$/;

export function shortageQuantity(requestedOrExpected: number, covered: number): number {
  return Math.max(requestedOrExpected - covered, 0);
}

export function projectedQuantity(regularProjectedQuantity: number, lateProjectedQuantity: number) {
  return regularProjectedQuantity + lateProjectedQuantity;
}

export function ratioMetric(numerator: number, denominator: number): RatioMetric {
  if (denominator === 0) return { numerator, denominator, rate: null };
  const scaled = Math.trunc((numerator * 10000) / denominator);
  const sign = scaled < 0 ? '-' : '';
  const absolute = Math.abs(scaled);
  const whole = Math.trunc(absolute / 10000);
  const fraction = String(absolute % 10000).padStart(4, '0');
  return { numerator, denominator, rate: `${sign}${whole}.${fraction}` };
}

export function receivedMinusAppliedFlow(
  acceptedIntoInventoryQuantity: number,
  appliedQuantity: number,
) {
  return {
    value: acceptedIntoInventoryQuantity - appliedQuantity,
    label: PERIOD_FLOW_LABEL,
    disclaimer: PERIOD_FLOW_DISCLAIMER,
  };
}

export function parseMoneyCents(amount: string): bigint {
  if (!MONEY_PATTERN.test(amount)) throw new Error('INVALID_MONEY_DECIMAL');
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = '00'] = amount.replace('-', '').split('.');
  return BigInt(negative ? `-${whole}${fraction}` : `${whole}${fraction}`);
}

export function formatMoneyCents(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

export function multiplyQuantityByUnitAmount(quantity: number, unitAmount: string): string {
  if (!Number.isInteger(quantity)) throw new Error('INVALID_QUANTITY');
  return formatMoneyCents(BigInt(quantity) * parseMoneyCents(unitAmount));
}

export function addMoney(left: string, right: string): string {
  return formatMoneyCents(parseMoneyCents(left) + parseMoneyCents(right));
}

export function subtractMoney(left: string, right: string): string {
  return formatMoneyCents(parseMoneyCents(left) - parseMoneyCents(right));
}

export function exactMoney(
  value: string | null | undefined,
  basis: MoneyLineageBasis | null = null,
): MoneyMetric {
  if (value == null) return unavailableMoney('MISSING_LINEAGE');
  if (!MONEY_PATTERN.test(value)) throw new Error('INVALID_MONEY_DECIMAL');
  return { availability: 'EXACT', value, reason: null, basis };
}

export function unavailableMoney(
  reason: string,
  basis: MoneyLineageBasis | null = null,
): MoneyMetric {
  return { availability: 'UNAVAILABLE', value: null, reason, basis };
}

export function appliedSupplierCostMetric(): MoneyMetric {
  return unavailableMoney(APPLIED_SUPPLIER_COST_UNAVAILABLE_REASON);
}

export function aggregateExactMoney(
  values: readonly (string | null | undefined)[],
  basis: MoneyLineageBasis | null = null,
): MoneyMetric {
  if (values.length === 0) return unavailableMoney('NO_ROWS');
  if (values.some((value) => value == null)) return unavailableMoney('INCOMPLETE_LINEAGE');
  return exactMoney(
    values.reduce((sum, value) => addMoney(sum ?? '0.00', value as string), '0.00'),
    basis,
  );
}

export function projectedTariffReferenceMetric(
  periodEffectiveTariffValue: string | null | undefined,
  projectedQty: number,
): MoneyMetric {
  if (projectedQty <= 0) return unavailableMoney('NO_QUANTITY');
  if (periodEffectiveTariffValue == null) {
    return unavailableMoney(HISTORICAL_TARIFF_UNAVAILABLE);
  }
  return exactMoney(periodEffectiveTariffValue, PERIOD_EFFECTIVE_TARIFF_BASIS);
}

export function purchaseOrderSnapshotMoney(
  quantity: number,
  value: string | null | undefined,
  incompleteReason: string,
): MoneyMetric {
  if (quantity <= 0) return unavailableMoney('NO_QUANTITY');
  if (value == null) return unavailableMoney(incompleteReason);
  return exactMoney(value, PURCHASE_ORDER_SNAPSHOT_BASIS);
}

export function grossOperationalSpreadReference(
  tariffValue: MoneyMetric,
  supplierValue: MoneyMetric,
): MoneyMetric {
  if (tariffValue.availability !== 'EXACT' || supplierValue.availability !== 'EXACT') {
    return unavailableMoney('INCOMPARABLE_LINEAGE');
  }
  if (tariffValue.value == null || supplierValue.value == null) {
    return unavailableMoney('INCOMPARABLE_LINEAGE');
  }
  const basis =
    tariffValue.basis != null && tariffValue.basis === supplierValue.basis
      ? tariffValue.basis
      : null;
  return exactMoney(subtractMoney(tariffValue.value, supplierValue.value), basis);
}
