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
export {
  PLANNING_PERIOD_STRUCTURAL_FIELDS,
  PlanningPeriodStructuralError,
  PlanningPeriodTransitionError,
  assertPlanningPeriodTransition,
  assertStructuralEditAllowed,
  bogotaDateOf,
  canTransitionPlanningPeriod,
  classifyScheduleTiming,
  isPlanningPeriodStructurallyEditable,
  validatePlanningPeriodDates,
} from './planning-period';
export type {
  PlanningPeriodDates,
  PlanningPeriodStructuralField,
  PlanningPeriodTiming,
  PlanningPeriodValidationIssue,
} from './planning-period';
export {
  PatientScheduleLateHandlingError,
  PatientScheduleTransitionError,
  assertLateHandling,
  assertPatientScheduleTransition,
  calculateAuthorizationPriority,
  canTransitionPatientSchedule,
  evaluateScheduleAuthorizationEligibility,
  parseAuthorizationExpiration,
  requiresLateHandling,
  scheduleToday,
} from './patient-schedule';
export type {
  ScheduleAuthorizationEligibility,
  ScheduleAuthorizationEligibilityInput,
  ScheduleExpirationClassification,
  ScheduleExpirationPolicy,
  ScheduleLateHandling,
} from './patient-schedule';
