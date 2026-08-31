export type ActorContext = Readonly<{
  userId: string;
  organizationId: string;
  correlationId: string;
}>;

export {
  buildAuthorizationKey,
  deriveAuthorizationClassification,
  deriveCoverageType,
  deriveDirectionStatus,
  deriveEnablementStatus,
  deriveOperationStatus,
  derivePrescripcion,
  normalizeSourceText,
  parseAuthorizationKeyInput,
  parseVigenciaDate,
} from './authorization-classification';
export type {
  AuthorizationClassificationInput,
  DerivedPrescripcion,
  OperationStatusInput,
} from './authorization-classification';
export { MIPRES_VIGENCIA_RULE_VERSION, currentBogotaDate, evaluateMipresVigencia } from './mipres';
export type {
  MipresDirection,
  MipresPort,
  MipresQueryOutcome,
  MipresQueryResult,
  MipresVigenciaEvaluation,
} from './mipres';
export {
  OPERATIONAL_FIELD_LUGAR_DISPENSACION,
  deriveApplicationSiteStatus,
  deriveOperationalStatuses,
  evaluateOperationalFieldTransition,
  isOperationalUpdateAllowed,
  isValidOperationalDate,
  isValidOperationalText,
  normalizeOperationalDate,
  normalizeOperationalText,
} from './operational';
export type { OperationalFieldTransition } from './operational';
export {
  AUDIT_RULE_VERSION,
  canDecideAuditReview,
  canStartAuditReview,
  deriveAdmissionStatus,
} from './audit';
export { GmailSendError } from './gmail';
export type { GmailPort, GmailSendInput, GmailSendResult } from './gmail';
