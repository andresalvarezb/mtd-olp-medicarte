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
