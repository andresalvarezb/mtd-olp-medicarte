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
  normalizeSourceText,
} from './authorization-classification';
export type {
  AuthorizationClassificationInput,
  OperationStatusInput,
} from './authorization-classification';
