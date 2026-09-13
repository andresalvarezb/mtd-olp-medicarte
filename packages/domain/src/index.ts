export type ActorContext = Readonly<{
  userId: string;
  organizationId: string;
  correlationId: string;
}>;

export { MIPRES_VIGENCIA_RULE_VERSION, currentBogotaDate, evaluateMipresVigencia } from './mipres';
export type {
  MipresDirection,
  MipresPort,
  MipresQueryOutcome,
  MipresQueryResult,
  MipresVigenciaEvaluation,
} from './mipres';
export {
  LEGACY_OPERATIONAL_FIELDS,
  createClinicalAuthorizationReference,
  isLegacyOperationalField,
  normalizeCommercialCode,
} from './clinical-logistics-boundary';
export type {
  ClinicalAuthorization,
  ClinicalAuthorizationReference,
  LegacyAuthorizationHistory,
  LegacyOperationalField,
} from './clinical-logistics-boundary';
