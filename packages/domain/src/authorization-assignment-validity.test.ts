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

  it('applies the assignment window even when expiration belongs to the current month', () => {
    expect(evaluate('2026-11-24', '2026-11-30', '2026-11-04')).toMatchObject({
      eligible: true,
      status: 'VIGENTE',
    });

    expect(evaluate('2026-12-11', '2026-11-30', '2026-11-20')).toMatchObject({
      eligible: false,
      reason: 'ASSIGNMENT_OUTSIDE_WINDOW',
    });
  });

  it('accepts today plus 20 inclusively and rejects day 21 outside the current month', () => {
    expect(evaluate('2026-12-10', '2027-01-31', '2026-11-20')).toMatchObject({
      eligible: true,
      status: 'VIGENTE',
    });

    expect(evaluate('2026-12-11', '2027-01-31', '2026-11-20')).toMatchObject({
      eligible: false,
      reason: 'ASSIGNMENT_OUTSIDE_WINDOW',
    });
  });

  it('accepts day five of grace across a month boundary when assignment qualifies', () => {
    expect(evaluate('2026-11-01', '2026-10-31', '2026-11-05')).toMatchObject({
      eligible: true,
      status: 'VIGENTE',
      managementMonth: '2026-11',
    });

    expect(evaluate('2026-11-01', '2026-10-31', '2026-11-06')).toMatchObject({
      eligible: false,
      reason: 'EXPIRED',
    });
  });

  it('applies grace across a year boundary and stops on day six', () => {
    expect(evaluate('2027-01-01', '2026-12-31', '2027-01-05')).toMatchObject({
      eligible: true,
      status: 'VIGENTE',
    });

    expect(evaluate('2027-01-01', '2026-12-31', '2027-01-06')).toMatchObject({
      eligible: false,
      reason: 'EXPIRED',
    });
  });

  it('still rejects an out-of-window assignment during grace', () => {
    expect(evaluate('2026-10-01', '2026-10-31', '2026-11-05')).toMatchObject({
      eligible: false,
      reason: 'ASSIGNMENT_OUTSIDE_WINDOW',
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
