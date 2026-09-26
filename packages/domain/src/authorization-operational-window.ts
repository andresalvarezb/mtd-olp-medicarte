export const AUTHORIZATION_OPERATIONAL_HORIZON_DAYS = 30;

export type AuthorizationOperationalWindowStatus =
  | 'IN_WINDOW'
  | 'EXPIRED'
  | 'OUTSIDE_HORIZON'
  | 'INVALID_DATE';

function isStrictIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const instant = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

export function normalizeAuthorizationOperationalDate(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();

  const compact = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);

  if (compact) {
    const iso = `${compact[1]}-${compact[2]}-${compact[3]}`;

    return isStrictIsoDate(iso) ? iso : null;
  }

  const isoPrefix = normalized.match(/^(\d{4}-\d{2}-\d{2})/);

  if (!isoPrefix) {
    return null;
  }

  return isStrictIsoDate(isoPrefix[1]!) ? isoPrefix[1]! : null;
}

export function authorizationOperationalHorizonEnd(todayBogota: string): string {
  if (normalizeAuthorizationOperationalDate(todayBogota) !== todayBogota) {
    throw new Error('INVALID_BOGOTA_DATE');
  }

  const instant = new Date(`${todayBogota}T00:00:00.000Z`);

  instant.setUTCDate(instant.getUTCDate() + AUTHORIZATION_OPERATIONAL_HORIZON_DAYS);

  return instant.toISOString().slice(0, 10);
}

export function evaluateAuthorizationOperationalWindow(
  input: Readonly<{
    assignmentDate: string | null | undefined;

    expirationDate: string | null | undefined;

    todayBogota: string;
  }>,
) {
  const horizonEnd = authorizationOperationalHorizonEnd(input.todayBogota);

  const assignmentDate = normalizeAuthorizationOperationalDate(input.assignmentDate);

  const expirationDate = normalizeAuthorizationOperationalDate(input.expirationDate);

  if (!assignmentDate || !expirationDate) {
    return {
      eligible: false,
      status: 'INVALID_DATE' as const,
      horizonEnd,
      assignmentDate,
      expirationDate,
    };
  }

  if (expirationDate < input.todayBogota) {
    return {
      eligible: false,
      status: 'EXPIRED' as const,
      horizonEnd,
      assignmentDate,
      expirationDate,
    };
  }

  if (assignmentDate > horizonEnd) {
    return {
      eligible: false,
      status: 'OUTSIDE_HORIZON' as const,
      horizonEnd,
      assignmentDate,
      expirationDate,
    };
  }

  return {
    eligible: true,
    status: 'IN_WINDOW' as const,
    horizonEnd,
    assignmentDate,
    expirationDate,
  };
}
