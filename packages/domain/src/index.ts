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
  normalizeSourceText,
} from './authorization-classification';
export type { AuthorizationClassificationInput } from './authorization-classification';
