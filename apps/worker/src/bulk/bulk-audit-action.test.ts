import { describe, expect, it } from 'vitest';
import { resolveBulkAuditAction } from './bulk-audit-action';

describe('resolveBulkAuditAction', () => {
  it('audits the first dispensation location assignment', () => {
    expect(
      resolveBulkAuditAction({
        operationType: 'ASSIGN_DISPENSATION_LOCATION',
        locationEventType: 'DISPENSATION_LOCATION_ASSIGNED',
        scheduledDateChanged: true,
      }),
    ).toBe('DISPENSATION_LOCATION_ASSIGNED');
  });

  it('audits a dispensation location change', () => {
    expect(
      resolveBulkAuditAction({
        operationType: 'ASSIGN_DISPENSATION_LOCATION',
        locationEventType: 'DISPENSATION_LOCATION_CHANGED',
        scheduledDateChanged: false,
      }),
    ).toBe('DISPENSATION_LOCATION_CHANGED');
  });

  it('never returns null when only FECHA_PROGRAMADA changes', () => {
    expect(
      resolveBulkAuditAction({
        operationType: 'ASSIGN_DISPENSATION_LOCATION',
        locationEventType: null,
        scheduledDateChanged: true,
      }),
    ).toBe('DISPENSATION_SCHEDULE_CHANGED');
  });

  it('audits purchase orders with their own action', () => {
    expect(
      resolveBulkAuditAction({
        operationType: 'ASSIGN_PURCHASE_ORDER',
        locationEventType: null,
        scheduledDateChanged: false,
      }),
    ).toBe('PURCHASE_ORDER_ASSIGNED');
  });

  it('audits dispensation and application reports explicitly', () => {
    expect(
      resolveBulkAuditAction({
        operationType: 'REPORT_DISPENSATION_DATE',
        locationEventType: null,
        scheduledDateChanged: false,
      }),
    ).toBe('DISPENSATION_DATE_REPORTED');

    expect(
      resolveBulkAuditAction({
        operationType: 'REPORT_APPLICATION_DATE',
        locationEventType: null,
        scheduledDateChanged: false,
      }),
    ).toBe('APPLICATION_DATE_REPORTED');
  });

  it('rejects an assignment with no actual auditable change', () => {
    expect(() =>
      resolveBulkAuditAction({
        operationType: 'ASSIGN_DISPENSATION_LOCATION',
        locationEventType: null,
        scheduledDateChanged: false,
      }),
    ).toThrow('without an auditable change');
  });
});
