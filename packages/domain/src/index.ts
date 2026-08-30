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
