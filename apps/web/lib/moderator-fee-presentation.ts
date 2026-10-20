import type { ModeratorFeeResponse } from '@authorization/contracts';

const amountPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

/** Amounts are kept in cents so subtraction never accumulates float errors. */
function cents(value: string | null): number | null {
  if (value === null || !amountPattern.test(value)) return null;
  return Math.round(Number(value) * 100);
}

export function normalizeModeratorFeeAmount(value: string): string | null {
  const amount = cents(value);
  return amount !== null && amount > 0 ? (amount / 100).toFixed(2) : null;
}

export function moderatorFeeBalances(
  detail: Pick<ModeratorFeeResponse, 'expectedAmountCop' | 'amountCop' | 'status'>,
): { expected: number | null; collected: number | null; pending: number | null } {
  const expectedCents = cents(detail.expectedAmountCop);
  const collectedCents = detail.status === 'COLLECTED'
    ? cents(detail.amountCop)
    : 0;

  return {
    expected: expectedCents === null ? null : expectedCents / 100,
    collected: collectedCents === null ? null : collectedCents / 100,
    pending: expectedCents === null || collectedCents === null
      ? null
      : Math.max(0, expectedCents - collectedCents) / 100,
  };
}

export function moderatorFeeMoney(value: number | null): string {
  if (value === null) return 'No disponible';

  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function bogotaToday(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Date-only selection: store as midnight in Colombia, never the browser timezone. */
export function moderatorFeeCollectionDateIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > bogotaToday()) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00-05:00`);
  if (
    Number.isNaN(parsed.getTime()) ||
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(parsed) !== value
  ) {
    return null;
  }

  return parsed.toISOString();
}

export function moderatorFeeDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';

  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
}
