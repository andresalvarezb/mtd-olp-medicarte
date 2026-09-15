import type { ReconciliationSeverity } from './reconciliation-registry';

export const RECONCILIATION_ISSUE_STATUSES = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
  'ACCEPTED_RISK',
] as const;
export type ReconciliationIssueStatus = (typeof RECONCILIATION_ISSUE_STATUSES)[number];

export const RECONCILIATION_ISSUE_EVENT_TYPES = [
  'ISSUE_CREATED',
  'ISSUE_ACKNOWLEDGED',
  'ISSUE_ASSIGNED',
  'ISSUE_UNASSIGNED',
  'ISSUE_RESOLVED',
  'ISSUE_ACCEPTED_RISK',
  'ISSUE_REOPENED',
  'RISK_ACCEPTANCE_INVALIDATED',
  'ISSUE_MANUALLY_REOPENED',
] as const;
export type ReconciliationIssueEventType = (typeof RECONCILIATION_ISSUE_EVENT_TYPES)[number];

export const RECONCILIATION_RESOLUTION_CODES = [
  'DATA_CORRECTED',
  'PROCESS_CORRECTED',
  'RULE_UPDATED',
  'NO_LONGER_APPLICABLE',
  'OTHER',
] as const;
export type ReconciliationResolutionCode = (typeof RECONCILIATION_RESOLUTION_CODES)[number];

export const RECONCILIATION_ISSUE_COMMENT_MAX_LENGTH = 2000;

const SEVERITY_RANK: Record<ReconciliationSeverity, number> = {
  INFO: 0,
  WARNING: 1,
  ERROR: 2,
  CRITICAL: 3,
};

export function reconciliationSeverityRank(severity: ReconciliationSeverity): number {
  return SEVERITY_RANK[severity];
}

export function maxReconciliationSeverity(
  left: ReconciliationSeverity,
  right: ReconciliationSeverity,
): ReconciliationSeverity {
  return reconciliationSeverityRank(left) >= reconciliationSeverityRank(right) ? left : right;
}

export type RecurrenceInput = Readonly<{
  status: ReconciliationIssueStatus;
  acceptedRiskSeverity: ReconciliationSeverity | null;
  acceptedRiskRuleVersion: string | null;
}>;

export type RecurrenceFinding = Readonly<{
  severity: ReconciliationSeverity;
  ruleVersion: string;
}>;

export type RecurrenceDecision = Readonly<{
  nextStatus: ReconciliationIssueStatus;
  eventType: Extract<
    ReconciliationIssueEventType,
    'ISSUE_REOPENED' | 'RISK_ACCEPTANCE_INVALIDATED'
  > | null;
  clearResolution: boolean;
  clearAcceptedRisk: boolean;
}>;

export function decideIssueRecurrence(
  issue: RecurrenceInput,
  finding: RecurrenceFinding,
): RecurrenceDecision {
  if (issue.status === 'RESOLVED') {
    return {
      nextStatus: 'OPEN',
      eventType: 'ISSUE_REOPENED',
      clearResolution: true,
      clearAcceptedRisk: false,
    };
  }
  if (issue.status === 'ACCEPTED_RISK') {
    const acceptedSeverity = issue.acceptedRiskSeverity;
    const acceptedVersion = issue.acceptedRiskRuleVersion;
    const severityIncreased =
      acceptedSeverity != null &&
      reconciliationSeverityRank(finding.severity) > reconciliationSeverityRank(acceptedSeverity);
    const ruleVersionChanged = acceptedVersion == null || acceptedVersion !== finding.ruleVersion;
    if (severityIncreased || ruleVersionChanged) {
      return {
        nextStatus: 'OPEN',
        eventType: 'RISK_ACCEPTANCE_INVALIDATED',
        clearResolution: false,
        clearAcceptedRisk: true,
      };
    }
    return {
      nextStatus: 'ACCEPTED_RISK',
      eventType: null,
      clearResolution: false,
      clearAcceptedRisk: false,
    };
  }
  return {
    nextStatus: issue.status,
    eventType: null,
    clearResolution: false,
    clearAcceptedRisk: false,
  };
}

export type ManualIssueAction = 'acknowledge' | 'resolve' | 'acceptRisk' | 'reopen';

const MANUAL_FROM: Record<ManualIssueAction, readonly ReconciliationIssueStatus[]> = {
  acknowledge: ['OPEN'],
  resolve: ['OPEN', 'ACKNOWLEDGED', 'ACCEPTED_RISK'],
  acceptRisk: ['OPEN', 'ACKNOWLEDGED'],
  reopen: ['RESOLVED', 'ACCEPTED_RISK'],
};

const MANUAL_TO: Record<ManualIssueAction, ReconciliationIssueStatus> = {
  acknowledge: 'ACKNOWLEDGED',
  resolve: 'RESOLVED',
  acceptRisk: 'ACCEPTED_RISK',
  reopen: 'OPEN',
};

const MANUAL_EVENT: Record<ManualIssueAction, ReconciliationIssueEventType> = {
  acknowledge: 'ISSUE_ACKNOWLEDGED',
  resolve: 'ISSUE_RESOLVED',
  acceptRisk: 'ISSUE_ACCEPTED_RISK',
  reopen: 'ISSUE_MANUALLY_REOPENED',
};

export function canManuallyTransition(
  status: ReconciliationIssueStatus,
  action: ManualIssueAction,
): boolean {
  return MANUAL_FROM[action].includes(status);
}

export function manualIssueTransition(
  status: ReconciliationIssueStatus,
  action: ManualIssueAction,
): { toStatus: ReconciliationIssueStatus; eventType: ReconciliationIssueEventType } {
  if (!canManuallyTransition(status, action)) {
    throw new Error(`INVALID_ISSUE_TRANSITION:${status}:${action}`);
  }
  return { toStatus: MANUAL_TO[action], eventType: MANUAL_EVENT[action] };
}

export function validateResolutionNote(
  code: ReconciliationResolutionCode,
  note: string,
): string | null {
  const trimmed = note.trim();
  if (!trimmed) return 'RESOLUTION_NOTE_REQUIRED';
  if (code === 'OTHER' && trimmed.length < 20) return 'RESOLUTION_NOTE_TOO_SHORT';
  return null;
}

export function validateAcceptedRiskReason(reason: string): string | null {
  return reason.trim() ? null : 'ACCEPTED_RISK_REASON_REQUIRED';
}

export function isRiskReviewOverdue(
  status: ReconciliationIssueStatus,
  riskReviewAt: Date | string | null,
  now: Date = new Date(),
): boolean {
  if (status !== 'ACCEPTED_RISK' || riskReviewAt == null) return false;
  const when = riskReviewAt instanceof Date ? riskReviewAt : new Date(riskReviewAt);
  if (Number.isNaN(when.getTime())) return false;
  return when.getTime() < now.getTime();
}

export const MTD_GOVERNANCE_ROLE_CODES = [
  'MTD_ADMIN',
  'MTD_AUDITORIA',
  'MTD_OPERATOR',
  'MTD_GENERAL',
  'READ_ONLY',
  'MTD',
] as const;

export function isMtdGovernanceAssignee(input: {
  userActive: boolean;
  organizationCode: string;
  roleCode: string;
}): boolean {
  if (!input.userActive) return false;
  if (input.organizationCode !== 'MTD') return false;
  return (MTD_GOVERNANCE_ROLE_CODES as readonly string[]).includes(input.roleCode);
}
