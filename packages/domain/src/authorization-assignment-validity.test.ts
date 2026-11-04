import { describe, expect, it } from 'vitest';
import { evaluateAuthorizationAssignmentValidity } from './authorization-assignment-validity';

describe('authorization assignment validity for purchase orders', () => {
  const evaluate = (assignmentDate: unknown, expirationDate: unknown, todayBogota: string) =>
    evaluateAuthorizationAssignmentValidity({ assignmentDate, expirationDate, todayBogota });

  it('accepts a date in the current management month even when it is more than 20 days ahead', () => {
    expect(evaluate('2026-12-31', '2027-01-01', '2026-12-01')).toMatchObject({
      eligible: true,
      status: 'VIGENTE',
      managementMonth: '2026-12',
    });
  });

  it('accepts today plus 20 inclusively across a year boundary', () => {
    expect(evaluate('2027-01-09', '2027-01-09', '2026-12-20')).toMatchObject({
      eligible: true,
      status: 'VIGENTE',
      managementMonth: '2027-01',
    });
  });

  it('rejects today plus 21 when it is outside the current month', () => {
    expect(evaluate('2027-01-10', '2027-01-10', '2026-12-20')).toMatchObject({
      eligible: false,
      status: 'NO VIGENTE',
      reason: 'ASSIGNMENT_OUTSIDE_WINDOW',
    });
  });

  it('accepts expiration through today and rejects expiration before today', () => {
    expect(evaluate('2026-12-01', '2026-12-20', '2026-12-20')).toMatchObject({
      eligible: true,
      status: 'VIGENTE',
    });
    expect(evaluate('2026-12-01', '2026-12-19', '2026-12-20')).toMatchObject({
      eligible: false,
      status: 'NO VIGENTE',
      reason: 'EXPIRED',
    });
  });

  it.each([
    ['invalid assignment date', '2026-02-31', '2027-01-01', 'INVALID_ASSIGNMENT_DATE'],
    ['invalid expiration date', '2026-12-01', '2026-13-01', 'INVALID_EXPIRATION_DATE'],
  ] as const)('classifies an %s as NO VIGENTE', (_label, assignmentDate, expirationDate, reason) => {
    expect(evaluate(assignmentDate, expirationDate, '2026-12-20')).toMatchObject({
      eligible: false,
      status: 'NO VIGENTE',
      reason,
    });
  });
});
