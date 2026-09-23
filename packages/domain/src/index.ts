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
  authorizationPurchaseMonthEnd,
  evaluateAuthorizationPurchaseEligibility,
  isAuthorizationSourceEnabled,
} from './authorization-purchase-eligibility';
export type {
  AuthorizationPurchaseEligibility,
  AuthorizationPurchaseEligibilityInput,
  AuthorizationPurchaseEligibilityReason,
} from './authorization-purchase-eligibility';
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
  COMPATIBILITY_PROJECTION_DIRECTION,
  LEGACY_CUTOVER_FIELDS,
  LEGACY_DROP_CANDIDATES,
  LEGACY_FIELD_CLASSIFICATIONS,
  LEGACY_SCAN_FORBIDDEN_FIELDS,
  MODERN_SOURCE_OF_TRUTH,
  assertNoSilentLegacyFallback,
  auditCompatibilityProjection,
  classifyLegacyField,
  classifyOperationalGeneration,
  isForbiddenModernLegacyUsage,
} from './legacy-operational-cutover';
export {
  HISTORICAL_COMPATIBILITY_CONTRACT_MARKER,
  LEGACY_SCAN_ALLOWLIST,
  LEGACY_SCAN_ALLOWLIST_PATHS,
  LEGACY_SCAN_ALLOWED_TEST_SUFFIX,
  LEGACY_SCAN_COVERAGE_BY_ROOT,
  LEGACY_SCAN_NEGATIVE_FIXTURES,
  LEGACY_SCAN_POLICY_REPORT,
  LEGACY_SCAN_POSITIVE_FIXTURES,
  LEGACY_SCAN_REQUIRED_COVERAGE,
  LEGACY_SCAN_RUNTIME_ROOTS,
  LEGACY_SCAN_SKIP_DIRECTORY_NAMES,
  SCHEMA_DECLARATION_PATH,
  collectLegacyOperationalUsageHits,
  findLegacyAuthorizationAuditStatusUsages,
  forbiddenLegacyScanTokens,
  isLegacyScanSourceFile,
  isPathAllowlistedForLegacyScan,
} from './legacy-operational-usage-scan';
export type { LegacyScanHit } from './legacy-operational-usage-scan';
export type {
  AuditCompatibilityProjection,
  LegacyCutoverField,
  LegacyCutoverFieldName,
  LegacyFieldClassification,
  OperationalGeneration,
} from './legacy-operational-cutover';
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
  DemandConsolidationError,
  resolveEffectiveSchedulePeriod,
  sumDemandQuantities,
} from './demand-consolidation';
export { canTransitionPurchaseOrder, purchaseOrderBucket } from './purchase-order';
export type {
  DemandSourceClassification,
  EffectiveSchedulePeriod,
  EffectiveSchedulePeriodInput,
} from './demand-consolidation';
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
export {
  derivePurchaseOrderReceiptStatus,
  deriveReceiptConformity,
  validateReceiptQuantities,
} from './receipt';
export {
  canTransitionPatientApplicationAudit,
  isTerminalPatientApplicationAudit,
} from './patient-application-audit';
export type { PatientApplicationAuditStatus } from './patient-application-audit';
export {
  ANALYTICS_DEFINITIONS_VERSION,
  APPLIED_SUPPLIER_COST_UNAVAILABLE_REASON,
  CURRENT_ON_HAND_LABEL,
  HISTORICAL_TARIFF_UNAVAILABLE,
  INCOMPLETE_SUPPLIER_COST,
  INCOMPLETE_TARIFF_LOOKUP,
  PERIOD_EFFECTIVE_TARIFF_BASIS,
  PERIOD_FLOW_DISCLAIMER,
  PERIOD_FLOW_LABEL,
  PURCHASE_ORDER_SNAPSHOT_BASIS,
  addMoney,
  aggregateExactMoney,
  appliedSupplierCostMetric,
  exactMoney,
  formatMoneyCents,
  grossOperationalSpreadReference,
  multiplyQuantityByUnitAmount,
  parseMoneyCents,
  projectedQuantity,
  projectedTariffReferenceMetric,
  purchaseOrderSnapshotMoney,
  ratioMetric,
  receivedMinusAppliedFlow,
  shortageQuantity,
  subtractMoney,
  unavailableMoney,
} from './operational-analytics';
export type {
  MoneyAvailability,
  MoneyLineageBasis,
  MoneyMetric,
  RatioMetric,
} from './operational-analytics';
export {
  ANALYTICS_EXPORT_UNAVAILABLE_LABEL,
  exportMoneyCell,
  moneyExportRow,
} from './analytics-export';
export type { AnalyticsExportSheet } from './analytics-export';
export {
  BULK_IMPORT_JOB_STATUSES,
  BULK_IMPORT_MAX_COLUMNS,
  BULK_IMPORT_MAX_FILE_BYTES,
  BULK_IMPORT_MAX_ROWS,
  BULK_IMPORT_MAX_SHEETS,
  BULK_IMPORT_ROW_CLAIM_LEASE_SECONDS,
  BULK_IMPORT_ROW_EXECUTION_STATUSES,
  BULK_IMPORT_ROW_VALIDATION_STATUSES,
  BULK_IMPORT_TYPE_SCHEDULING,
  ESP014_SCHEDULING_TEMPLATE_VERSION,
  SCHEDULING_TEMPLATE_OPTIONAL_COLUMNS,
  SCHEDULING_TEMPLATE_REQUIRED_COLUMNS,
  assertBulkImportJobTransition,
  canCancelBulkImportJob,
  canCompleteBulkImportRowClaim,
  canConfirmBulkImportJob,
  canResumeBulkImportJob,
  canRetryFailedBulkImportJob,
  decideBulkImportCompletion,
  findInternalSchedulingDuplicates,
  initialExecutionStatus,
  isExpiredBulkImportClaim,
  isSupportedSchedulingTemplate,
  phiSafeBulkImportLog,
  rowIdempotencyKey,
  schedulingIdentityKey,
} from './bulk-import';
export type {
  BulkImportJobStatus,
  BulkImportRowExecutionStatus,
  BulkImportRowValidationStatus,
} from './bulk-import';
export {
  POINT_ACCESS_DENIED,
  PointAccessDeniedError,
  canAccessPoint,
  canAccessPoints,
  isExplicitPointScope,
  isGlobalPointScope,
  isPointScopeEligibleTarget,
  isPointScopeGlobalActor,
  requiresPointGrant,
} from './operational-point-scope';
export type { PointAccessKind, PointAccessScope } from './operational-point-scope';
export {
  EXECUTABLE_RECONCILIATION_RULES,
  RECONCILIATION_CATEGORIES,
  RECONCILIATION_DETECTION_MODES,
  RECONCILIATION_DOMAINS,
  RECONCILIATION_MAX_FINDINGS_PER_RULE,
  RECONCILIATION_OPERATIONAL_TABLES,
  RECONCILIATION_RULES,
  RECONCILIATION_RULES_VERSION,
  RECONCILIATION_RULE_BY_CODE,
  RECONCILIATION_RULE_STATUSES,
  RECONCILIATION_RUN_STATUSES,
  RECONCILIATION_SEVERITIES,
  RECONCILIATION_STATEMENT_TIMEOUT_MS,
  RECONCILIATION_WRITABLE_TABLES,
  formatReconciliationRuleCatalog,
  isBlockingReconciliationSeverity,
  reconciliationFindingFingerprint,
} from './reconciliation-registry';
export type {
  ReconciliationCategory,
  ReconciliationDetectionMode,
  ReconciliationDomain,
  ReconciliationRuleDefinition,
  ReconciliationRuleStatus,
  ReconciliationRunStatus,
  ReconciliationSeverity,
} from './reconciliation-registry';
export {
  MTD_GOVERNANCE_ROLE_CODES,
  RECONCILIATION_ISSUE_COMMENT_MAX_LENGTH,
  RECONCILIATION_ISSUE_EVENT_TYPES,
  RECONCILIATION_ISSUE_STATUSES,
  RECONCILIATION_RESOLUTION_CODES,
  canManuallyTransition,
  decideIssueRecurrence,
  isMtdGovernanceAssignee,
  isRiskReviewOverdue,
  manualIssueTransition,
  maxReconciliationSeverity,
  reconciliationSeverityRank,
  validateAcceptedRiskReason,
  validateResolutionNote,
} from './reconciliation-issue-lifecycle';
export type {
  ManualIssueAction,
  RecurrenceDecision,
  ReconciliationIssueEventType,
  ReconciliationIssueStatus,
  ReconciliationResolutionCode,
} from './reconciliation-issue-lifecycle';
export type { ReceiptConformity, ReceiptQuantityInput } from './receipt';
export type {
  ScheduleAuthorizationEligibility,
  ScheduleAuthorizationEligibilityInput,
  ScheduleExpirationClassification,
  ScheduleExpirationPolicy,
  ScheduleLateHandling,
} from './patient-schedule';
export {
  ACTOR_BOUNDARY_VIOLATION,
  ActorBoundaryPolicyError,
  assertPermissionAllowedForActor,
  isPermissionAllowedForActor,
} from './actor-boundary-policy';
export {
  ORGANIZATION_ROLE_MATRIX,
  ORGANIZATION_ROLE_NOT_ALLOWED,
  CUSTOM_ROLE_PREFIX,
  PREDEFINED_ROLE_CODES,
  PROTECTED_ROLE_CODES,
  OrganizationRolePolicyError,
  allowedRolesForOrganization,
  assertRoleAllowedForOrganization,
  findInvalidRoleAssignments,
  isPredefinedRole,
  isCustomRole,
  isProtectedRole,
  isRoleAllowedForOrganization,
} from './organization-role-policy';
export type {
  OrganizationCode,
  PredefinedRoleCode,
  RoleAssignmentCandidate,
} from './organization-role-policy';
export {
  MTD_ADMIN_ROLE_CODE,
  effectivePermissionCodes,
  isAllowAllAdministrator,
  isPermissionGrantedByAllowAll,
} from './admin-access-policy';
export type { AccessRoleSnapshot } from './admin-access-policy';
export {
  RECONCILIATION_CADENCES,
  RECONCILIATION_DEFAULT_TIMEZONE,
  RECONCILIATION_EXECUTION_STATUSES,
  RECONCILIATION_NOTIFICATION_CHANNELS,
  RECONCILIATION_NOTIFICATION_STATUSES,
  RECONCILIATION_NOTIFICATION_TYPES,
  RECONCILIATION_SEVERITY_ALERT_THRESHOLDS,
  RECONCILIATION_TRIGGER_TYPES,
  calculateNextSlot,
  countMissedSlots,
  deriveRunHealth,
  evaluateHealthAlert,
  getZonedDate,
  getZonedParts,
  isComparableScope,
  parseLocalTime,
  shouldEmitRecovery,
} from './reconciliation-operations';
export type {
  PolicyScheduleConfig,
  ReconciliationCadence,
  ReconciliationExecutionStatus,
  ReconciliationNotificationChannel,
  ReconciliationNotificationStatus,
  ReconciliationNotificationType,
  ReconciliationSeverityAlertThreshold,
  ReconciliationTriggerType,
} from './reconciliation-operations';

export {
  normalizeDeliveryPointCode,
  normalizeInvimaComponent,
  parseCumProductIdentity,
} from './product-delivery-point';
export type { CumProductIdentity } from './product-delivery-point';
export * from './authorization-coverage-projection';

export {
  PURCHASE_ORDER_MACRO_STATUSES,
  PURCHASE_ORDER_MACRO_STATUS_LABELS,
  PurchaseOrderOperationalFlowError,
  applyPurchaseOrderReceipt,
  derivePurchaseOrderActions,
  derivePurchaseOrderMacroStatus,
  hasAnyPurchaseOrderReceipt,
  isPurchaseOrderFullyReceived,
  purchaseOrderBalances,
  purchaseOrderLineBalance,
} from './purchase-order-operational-flow';
export type {
  PurchaseOrderLineBalance,
  PurchaseOrderMacroStatus,
  PurchaseOrderOperationalActions,
  PurchaseOrderOperationalSnapshot,
  PurchaseOrderQuantityLine,
  PurchaseOrderReceiptInputLine,
} from './purchase-order-operational-flow';

export {
  PURCHASE_ORDER_ACTORS,
  assertPurchaseOrderAction,
  derivePurchaseOrderAllowedActions,
  derivePurchaseOrderFieldAccess,
} from './purchase-order-access-policy';
export type {
  PurchaseOrderActor,
  PurchaseOrderAllowedActions,
  PurchaseOrderFieldAccess,
  PurchaseOrderOperationalContext,
} from './purchase-order-access-policy';

export {
  AUTHORIZATION_FULFILLMENT_TYPES,
  AuthorizationFulfillmentError,
  assertAuthorizationFulfillment,
} from './authorization-fulfillment';
export type {
  AuthorizationFulfillmentInput,
  AuthorizationFulfillmentType,
} from './authorization-fulfillment';
