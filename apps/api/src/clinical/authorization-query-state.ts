import {
  evaluateAuthorizationOperationalWindow,
  type AuthorizationOperationalWindowStatus,
} from '@authorization/domain';

export type AuthorizationQueryValidityStatus = AuthorizationOperationalWindowStatus;

export type AuthorizationQueryFulfillmentStatus = 'PENDING' | 'DELIVERED' | 'APPLIED';

export type AuthorizationQueryInitialValidationStatus =
  | 'PASSED'
  | 'PENDING'
  | 'FAILED';

export type AuthorizationQueryAuditStatus =
  | 'PENDING'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

export function resolveAuthorizationValidityStatus(
  input: Readonly<{
    assignmentDate: string | null | undefined;

    validityEndDate: string | null | undefined;

    today: string;
  }>,
): AuthorizationQueryValidityStatus {
  return evaluateAuthorizationOperationalWindow({
    assignmentDate: input.assignmentDate,

    expirationDate: input.validityEndDate,

    todayBogota: input.today,
  }).status;
}

export function resolveAuthorizationInitialValidationStatus(
  input: Readonly<{
    enablementStatus: string | null | undefined;
    tariffMembershipStatus: string | null | undefined;
    coverageType: string | null | undefined;
    directionStatus: string | null | undefined;
    quantity?: string | number | null;
    minimumQuantity?: number | null;
  }>,
): AuthorizationQueryInitialValidationStatus {
  if (input.enablementStatus !== 'ENABLED') {
    return 'FAILED';
  }

  if (input.tariffMembershipStatus === 'NOT_LISTED') {
    return 'FAILED';
  }

  if (input.tariffMembershipStatus !== 'LISTED') {
    return 'PENDING';
  }

  if (
    input.quantity !== undefined ||
    input.minimumQuantity !== undefined
  ) {
    const quantity =
      Number(
        input.quantity,
      );

    const minimumQuantity =
      Number(
        input.minimumQuantity ??
        1,
      );

    if (
      !Number.isInteger(
        quantity,
      ) ||
      quantity <=
        0 ||
      !Number.isInteger(
        minimumQuantity,
      ) ||
      minimumQuantity <=
        0 ||
      quantity <
        minimumQuantity
    ) {
      return 'FAILED';
    }
  }

  if (input.coverageType === 'PBS') {
    return input.directionStatus === 'NOT_APPLICABLE'
      ? 'PASSED'
      : 'PENDING';
  }

  if (input.coverageType === 'NO_PBS') {
    return input.directionStatus === 'CONFIRMED'
      ? 'PASSED'
      : 'PENDING';
  }

  return 'PENDING';
}

export function resolveAuthorizationFulfillmentStatus(
  fulfillmentType: string | null | undefined,
): AuthorizationQueryFulfillmentStatus {
  if (fulfillmentType === 'APPLICATION') {
    return 'APPLIED';
  }

  if (fulfillmentType === 'DELIVERY') {
    return 'DELIVERED';
  }

  return 'PENDING';
}

export function resolveAuthorizationAuditStatus(
  auditStatus: string | null | undefined,
): AuthorizationQueryAuditStatus {
  if (auditStatus === 'APPROVED') {
    return 'APPROVED';
  }

  if (auditStatus === 'REJECTED') {
    return 'REJECTED';
  }

  if (auditStatus === 'IN_REVIEW') {
    return 'IN_REVIEW';
  }

  return 'PENDING';
}
