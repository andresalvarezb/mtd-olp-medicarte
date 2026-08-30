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
  evaluateOperationalFieldTransition,
  isValidOperationalText,
  normalizeOperationalText,
} from './operational';
export type { OperationalFieldTransition } from './operational';
export { GmailSendError } from './gmail';
export type { GmailPort, GmailSendInput, GmailSendResult } from './gmail';
