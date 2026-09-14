import { describe, expect, it } from 'vitest';
import {
  canTransitionPatientApplicationAudit,
  isTerminalPatientApplicationAudit,
} from './patient-application-audit';

describe('patient application audit state machine', () => {
  it('allows only IN_REVIEW to APPROVED or REJECTED', () => {
    expect(canTransitionPatientApplicationAudit('IN_REVIEW', 'APPROVED')).toBe(true);
    expect(canTransitionPatientApplicationAudit('IN_REVIEW', 'REJECTED')).toBe(true);
    expect(canTransitionPatientApplicationAudit('IN_REVIEW', 'IN_REVIEW')).toBe(false);
  });

  it('treats APPROVED and REJECTED as terminal', () => {
    expect(canTransitionPatientApplicationAudit('APPROVED', 'REJECTED')).toBe(false);
    expect(canTransitionPatientApplicationAudit('REJECTED', 'APPROVED')).toBe(false);
    expect(canTransitionPatientApplicationAudit('APPROVED', 'APPROVED')).toBe(false);
    expect(canTransitionPatientApplicationAudit('REJECTED', 'REJECTED')).toBe(false);
    expect(isTerminalPatientApplicationAudit('APPROVED')).toBe(true);
    expect(isTerminalPatientApplicationAudit('REJECTED')).toBe(true);
    expect(isTerminalPatientApplicationAudit('IN_REVIEW')).toBe(false);
  });
});
