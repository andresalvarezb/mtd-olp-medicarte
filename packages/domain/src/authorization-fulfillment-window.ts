import { normalizeAuthorizationOperationalDate } from './authorization-operational-window';

export const AUTHORIZATION_FULFILLMENT_GRACE_DAYS = 5;

export type AuthorizationFulfillmentWindowStatus =
  | 'CURRENT'
  | 'GRACE'
  | 'PARTIAL_CONTINUATION'
  | 'BLOCKED_AFTER_GRACE'
  | 'COMPLETE'
  | 'INVALID_DATE';

export type AuthorizationFulfillmentWindowInput = Readonly<{
  expirationDate: string | null | undefined;
  todayBogota: string;
  hasConfirmedAttention: boolean;
  remainingAuthorizedQuantity: number;
}>;

export function evaluateAuthorizationFulfillmentWindow(input: AuthorizationFulfillmentWindowInput) {
  const expirationDate = normalizeAuthorizationOperationalDate(input.expirationDate);
  const todayBogota = normalizeAuthorizationOperationalDate(input.todayBogota);

  if (!expirationDate || todayBogota !== input.todayBogota) {
    return {
      eligible: false,
      eligibleForNewReservation: false,
      status: 'INVALID_DATE' as const,
      daysAfterExpiration: null,
      expirationDate,
    };
  }

  if (!Number.isFinite(input.remainingAuthorizedQuantity)) {
    return {
      eligible: false,
      eligibleForNewReservation: false,
      status: 'INVALID_DATE' as const,
      daysAfterExpiration: null,
      expirationDate,
    };
  }

  const daysAfterExpiration = Math.floor(
    (Date.parse(`${todayBogota}T00:00:00.000Z`) - Date.parse(`${expirationDate}T00:00:00.000Z`)) /
      86_400_000,
  );

  if (input.remainingAuthorizedQuantity <= 0) {
    return {
      eligible: false,
      eligibleForNewReservation: false,
      status: 'COMPLETE' as const,
      daysAfterExpiration,
      expirationDate,
    };
  }

  if (daysAfterExpiration <= 0) {
    return {
      eligible: true,
      eligibleForNewReservation: true,
      status: 'CURRENT' as const,
      daysAfterExpiration,
      expirationDate,
    };
  }

  if (daysAfterExpiration <= AUTHORIZATION_FULFILLMENT_GRACE_DAYS) {
    return {
      eligible: true,
      eligibleForNewReservation: true,
      status: 'GRACE' as const,
      daysAfterExpiration,
      expirationDate,
    };
  }

  if (input.hasConfirmedAttention) {
    return {
      eligible: true,
      // This only permits a physical top-up against an already active
      // AUTO–OC source. New commercial links still pass this rule with
      // hasConfirmedAttention=false and remain blocked after grace.
      eligibleForNewReservation: true,
      status: 'PARTIAL_CONTINUATION' as const,
      daysAfterExpiration,
      expirationDate,
    };
  }

  return {
    eligible: false,
    eligibleForNewReservation: false,
    status: 'BLOCKED_AFTER_GRACE' as const,
    daysAfterExpiration,
    expirationDate,
  };
}
