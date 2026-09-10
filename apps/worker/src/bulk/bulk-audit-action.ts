import type { BulkUpdateOperationType } from '@authorization/contracts';

export type DispensationLocationAuditAction =
  | 'DISPENSATION_LOCATION_ASSIGNED'
  | 'DISPENSATION_LOCATION_CHANGED';

export type BulkAuditAction =
  | DispensationLocationAuditAction
  | 'DISPENSATION_SCHEDULE_CHANGED'
  | 'PURCHASE_ORDER_ASSIGNED'
  | 'DISPENSATION_DATE_REPORTED'
  | 'APPLICATION_DATE_REPORTED';

export function resolveBulkAuditAction(
  input: Readonly<{
    operationType: BulkUpdateOperationType;
    locationEventType: DispensationLocationAuditAction | null;
    scheduledDateChanged: boolean;
  }>,
): BulkAuditAction {
  switch (input.operationType) {
    case 'ASSIGN_DISPENSATION_LOCATION':
      if (input.locationEventType) {
        return input.locationEventType;
      }

      if (input.scheduledDateChanged) {
        return 'DISPENSATION_SCHEDULE_CHANGED';
      }

      throw new Error('ASSIGN_DISPENSATION_LOCATION reached audit without an auditable change');

    case 'ASSIGN_PURCHASE_ORDER':
      return 'PURCHASE_ORDER_ASSIGNED';

    case 'REPORT_DISPENSATION_DATE':
      return 'DISPENSATION_DATE_REPORTED';

    case 'REPORT_APPLICATION_DATE':
      return 'APPLICATION_DATE_REPORTED';

    default: {
      const exhaustive: never = input.operationType;
      throw new Error(`Unsupported bulk update operation: ${String(exhaustive)}`);
    }
  }
}
