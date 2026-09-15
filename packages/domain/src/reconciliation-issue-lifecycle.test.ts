import { describe, expect, it } from 'vitest';
import {
  canManuallyTransition,
  decideIssueRecurrence,
  isMtdGovernanceAssignee,
  isRiskReviewOverdue,
  maxReconciliationSeverity,
  manualIssueTransition,
  reconciliationSeverityRank,
  validateAcceptedRiskReason,
  validateResolutionNote,
} from './reconciliation-issue-lifecycle';

describe('ESP-018 issue lifecycle', () => {
  it('orders severities INFO < WARNING < ERROR < CRITICAL', () => {
    expect(reconciliationSeverityRank('INFO')).toBeLessThan(reconciliationSeverityRank('WARNING'));
    expect(reconciliationSeverityRank('WARNING')).toBeLessThan(reconciliationSeverityRank('ERROR'));
    expect(reconciliationSeverityRank('ERROR')).toBeLessThan(
      reconciliationSeverityRank('CRITICAL'),
    );
    expect(maxReconciliationSeverity('WARNING', 'CRITICAL')).toBe('CRITICAL');
    expect(maxReconciliationSeverity('ERROR', 'INFO')).toBe('ERROR');
  });

  it('keeps OPEN and ACKNOWLEDGED on recurrence', () => {
    expect(
      decideIssueRecurrence(
        { status: 'OPEN', acceptedRiskSeverity: null, acceptedRiskRuleVersion: null },
        { severity: 'CRITICAL', ruleVersion: 'ESP-017.1' },
      ),
    ).toMatchObject({ nextStatus: 'OPEN', eventType: null });
    expect(
      decideIssueRecurrence(
        { status: 'ACKNOWLEDGED', acceptedRiskSeverity: null, acceptedRiskRuleVersion: null },
        { severity: 'ERROR', ruleVersion: 'ESP-017.1' },
      ),
    ).toMatchObject({ nextStatus: 'ACKNOWLEDGED', eventType: null });
  });

  it('reopens RESOLVED on recurrence without losing the historical event trail', () => {
    expect(
      decideIssueRecurrence(
        { status: 'RESOLVED', acceptedRiskSeverity: null, acceptedRiskRuleVersion: null },
        { severity: 'CRITICAL', ruleVersion: 'ESP-017.1' },
      ),
    ).toEqual({
      nextStatus: 'OPEN',
      eventType: 'ISSUE_REOPENED',
      clearResolution: true,
      clearAcceptedRisk: false,
    });
  });

  it('keeps ACCEPTED_RISK when severity and rule version are unchanged', () => {
    expect(
      decideIssueRecurrence(
        {
          status: 'ACCEPTED_RISK',
          acceptedRiskSeverity: 'CRITICAL',
          acceptedRiskRuleVersion: 'ESP-017.1',
        },
        { severity: 'CRITICAL', ruleVersion: 'ESP-017.1' },
      ),
    ).toMatchObject({ nextStatus: 'ACCEPTED_RISK', eventType: null });
    expect(
      decideIssueRecurrence(
        {
          status: 'ACCEPTED_RISK',
          acceptedRiskSeverity: 'CRITICAL',
          acceptedRiskRuleVersion: 'ESP-017.1',
        },
        { severity: 'WARNING', ruleVersion: 'ESP-017.1' },
      ),
    ).toMatchObject({ nextStatus: 'ACCEPTED_RISK', eventType: null });
  });

  it('invalidates ACCEPTED_RISK when severity increases or the rule version changes', () => {
    expect(
      decideIssueRecurrence(
        {
          status: 'ACCEPTED_RISK',
          acceptedRiskSeverity: 'ERROR',
          acceptedRiskRuleVersion: 'ESP-017.1',
        },
        { severity: 'CRITICAL', ruleVersion: 'ESP-017.1' },
      ),
    ).toMatchObject({
      nextStatus: 'OPEN',
      eventType: 'RISK_ACCEPTANCE_INVALIDATED',
      clearAcceptedRisk: true,
    });
    expect(
      decideIssueRecurrence(
        {
          status: 'ACCEPTED_RISK',
          acceptedRiskSeverity: 'CRITICAL',
          acceptedRiskRuleVersion: 'ESP-017.1',
        },
        { severity: 'CRITICAL', ruleVersion: 'ESP-017.2' },
      ),
    ).toMatchObject({ nextStatus: 'OPEN', eventType: 'RISK_ACCEPTANCE_INVALIDATED' });
  });

  it('rejects invalid manual transitions and allows the documented ones', () => {
    expect(canManuallyTransition('OPEN', 'acknowledge')).toBe(true);
    expect(canManuallyTransition('RESOLVED', 'acknowledge')).toBe(false);
    expect(canManuallyTransition('ACCEPTED_RISK', 'acceptRisk')).toBe(false);
    expect(manualIssueTransition('OPEN', 'acceptRisk')).toEqual({
      toStatus: 'ACCEPTED_RISK',
      eventType: 'ISSUE_ACCEPTED_RISK',
    });
    expect(manualIssueTransition('RESOLVED', 'reopen')).toEqual({
      toStatus: 'OPEN',
      eventType: 'ISSUE_MANUALLY_REOPENED',
    });
    expect(() => manualIssueTransition('RESOLVED', 'resolve')).toThrow(/INVALID_ISSUE_TRANSITION/);
  });

  it('requires a resolution note and a longer note for OTHER', () => {
    expect(validateResolutionNote('DATA_CORRECTED', '   ')).toBe('RESOLUTION_NOTE_REQUIRED');
    expect(validateResolutionNote('DATA_CORRECTED', 'Corrected via application module')).toBeNull();
    expect(validateResolutionNote('OTHER', 'too short')).toBe('RESOLUTION_NOTE_TOO_SHORT');
    expect(
      validateResolutionNote('OTHER', 'Investigated in the application module and closed.'),
    ).toBe(null);
    expect(validateAcceptedRiskReason('')).toBe('ACCEPTED_RISK_REASON_REQUIRED');
    expect(validateAcceptedRiskReason('Known lineage gap until next receipt')).toBeNull();
  });

  it('marks past risk reviews overdue without changing status', () => {
    const now = new Date('2026-09-15T12:00:00.000Z');
    expect(isRiskReviewOverdue('ACCEPTED_RISK', '2026-09-01T00:00:00.000Z', now)).toBe(true);
    expect(isRiskReviewOverdue('ACCEPTED_RISK', '2026-10-01T00:00:00.000Z', now)).toBe(false);
    expect(isRiskReviewOverdue('OPEN', '2026-09-01T00:00:00.000Z', now)).toBe(false);
    expect(isRiskReviewOverdue('ACCEPTED_RISK', null, now)).toBe(false);
  });

  it('allows assignment only to active MTD governance users', () => {
    expect(
      isMtdGovernanceAssignee({
        userActive: true,
        organizationCode: 'MTD',
        roleCode: 'MTD_AUDITORIA',
      }),
    ).toBe(true);
    expect(
      isMtdGovernanceAssignee({
        userActive: false,
        organizationCode: 'MTD',
        roleCode: 'MTD_ADMIN',
      }),
    ).toBe(false);
    expect(
      isMtdGovernanceAssignee({
        userActive: true,
        organizationCode: 'MEDICARTE',
        roleCode: 'MEDICARTE_OPERATOR',
      }),
    ).toBe(false);
    expect(
      isMtdGovernanceAssignee({
        userActive: true,
        organizationCode: 'OLP',
        roleCode: 'OLP',
      }),
    ).toBe(false);
  });
});
