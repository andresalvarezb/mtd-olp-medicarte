/**
 * ESP-016: classification and unidirectional mapping for authorization_items
 * operational columns that the modern domain replaced.
 *
 * Direction: NEW DOMAIN → LEGACY COMPATIBILITY only.
 * Never: LEGACY → NEW DOMAIN, except an explicit historical read adapter.
 */

export const LEGACY_FIELD_CLASSIFICATIONS = [
  'AUTHORITATIVE',
  'DERIVED_COMPATIBILITY',
  'HISTORICAL_ONLY',
  'DEPRECATED',
  'SAFE_TO_DROP_LATER',
] as const;

export type LegacyFieldClassification = (typeof LEGACY_FIELD_CLASSIFICATIONS)[number];

export const COMPATIBILITY_PROJECTION_DIRECTION = 'NEW_DOMAIN_TO_LEGACY' as const;

export const MODERN_SOURCE_OF_TRUTH = {
  scheduling: 'patient_schedules',
  demand: 'projected_demand_lines + demand_sources',
  purchase: 'purchase_orders + purchase_order_lines',
  delivery: 'deliveries + delivery_lines',
  receipt: 'receipts + receipt_lines',
  inventory: 'inventory_movements',
  transfer: 'stock_transfers + movement lineage',
  application: 'patient_applications',
  operationalOutcome: 'patient_schedule_outcomes',
  audit: 'patient_application_audits',
  admission: 'authorization_items.admission_status (ESP-012 downstream READY only)',
  analytics: 'derived read models from modern facts',
  bulk: 'bulk_import_* staging + domain sources',
  pointAccess: 'user_point_scopes',
} as const;

export type LegacyCutoverField = Readonly<{
  field: string;
  oldMeaning: string;
  modernSource: string;
  classification: LegacyFieldClassification;
  compatibilityRequired: boolean;
  dropBlockers: readonly string[];
}>;

export const LEGACY_CUTOVER_FIELDS = [
  {
    field: 'lugar_dispensacion',
    oldMeaning: 'Free-text dispensing location on the authorization item',
    modernSource: 'patient_schedules.dispensing_point_id → dispensing_points',
    classification: 'HISTORICAL_ONLY',
    compatibilityRequired: false,
    dropBlockers: [
      'historical reader',
      'pre-ESP-001 rows without modern schedule lineage',
      'no accepted loss of historical location text',
    ],
  },
  {
    field: 'fecha_programada',
    oldMeaning: 'Single scheduled date collapsed onto the authorization',
    modernSource: 'patient_schedules.scheduled_date + revision/history',
    classification: 'HISTORICAL_ONLY',
    compatibilityRequired: false,
    dropBlockers: [
      'historical reader',
      'modern scheduling allows many dates/revisions per authorization',
    ],
  },
  {
    field: 'fecha_dispensacion',
    oldMeaning: 'Collapsed dispensation date on the authorization',
    modernSource: 'deliveries.delivered_at / receipts.confirmed_at lineage — not 1:1',
    classification: 'HISTORICAL_ONLY',
    compatibilityRequired: false,
    dropBlockers: [
      'historical reader',
      'delivery and receipt are distinct events; no single replacement column',
    ],
  },
  {
    field: 'fecha_aplicacion',
    oldMeaning: 'Collapsed application date implying APPLIED',
    modernSource: 'patient_applications.application_date where status = CONFIRMED',
    classification: 'HISTORICAL_ONLY',
    compatibilityRequired: false,
    dropBlockers: [
      'historical reader',
      'date alone cannot reconstruct patient_application_lines or lots',
    ],
  },
  {
    field: 'cod_autorizacion_medicarte',
    oldMeaning: 'External Medicarte authorization reference stored on the item',
    modernSource: 'none — still an identifier, unused by ESP-001…015 operational flows',
    classification: 'HISTORICAL_ONLY',
    compatibilityRequired: false,
    dropBlockers: [
      'no modern producer',
      'may be an external business identifier on historical rows',
      'not proven unused by unknown downstream consumers',
    ],
  },
  {
    field: 'orden_compra',
    oldMeaning: 'Free-text purchase order number on the authorization',
    modernSource: 'purchase_orders / purchase_order_lines',
    classification: 'HISTORICAL_ONLY',
    compatibilityRequired: false,
    dropBlockers: ['historical reader', 'POs are consolidated, not 1:1 with an authorization'],
  },
  {
    field: 'process_status',
    oldMeaning: 'Monolithic process pipeline status',
    modernSource:
      'planning + operational + application + audit + admission + purchase/delivery/receipt states',
    classification: 'HISTORICAL_ONLY',
    compatibilityRequired: false,
    dropBlockers: [
      'historical reader',
      'modern model split the collapsed status; no single replacement',
    ],
  },
  {
    field: 'operation_status',
    oldMeaning: 'Collapsed operational status including DISPENSED',
    modernSource: 'patient_applications / patient_schedule_outcomes / logistics entity status',
    classification: 'HISTORICAL_ONLY',
    compatibilityRequired: false,
    dropBlockers: [
      'historical reader',
      'CHECK constraints still mention DISPENSED ↔ audit_status',
    ],
  },
  {
    field: 'operational_version',
    oldMeaning: 'Legacy operational field-change versioning',
    modernSource: 'entity version / patient_schedules.revision / optimistic locking on new tables',
    classification: 'HISTORICAL_ONLY',
    compatibilityRequired: false,
    dropBlockers: [
      'historical reader',
      'operational_field_changes still stores previous/new operational_version',
    ],
  },
  {
    field: 'audit_status',
    oldMeaning: 'Authorization-level audit state and READY/APPROVED authority',
    modernSource: 'patient_application_audits.status (READY_FOR_AUDIT is derived)',
    classification: 'DERIVED_COMPATIBILITY',
    compatibilityRequired: true,
    dropBlockers: [
      'CHECK admission_status READY requires audit_status APPROVED',
      'CHECK DISPENSED requires audit_status APPROVED',
      'compatibility projection written in the same transaction as ESP-012',
    ],
  },
  {
    field: 'admission_status',
    oldMeaning: 'Downstream admission hand-off; READY is produced by ESP-012 approval',
    modernSource:
      'authorization_items.admission_status — AUTHORITATIVE for downstream READY only; decision authority is patient_application_audits',
    classification: 'AUTHORITATIVE',
    compatibilityRequired: true,
    dropBlockers: [
      'ESP-012 contract: APPROVED → READY in the same transaction',
      'downstream consumers of READY',
      'states after READY remain out of scope',
    ],
  },
] as const satisfies readonly LegacyCutoverField[];

export type LegacyCutoverFieldName = (typeof LEGACY_CUTOVER_FIELDS)[number]['field'];

/** HISTORICAL_ONLY + DERIVED_COMPATIBILITY. admission_status is AUTHORITATIVE (ESP-012), not in this list. */
export const LEGACY_SCAN_FORBIDDEN_FIELDS = LEGACY_CUTOVER_FIELDS.filter(
  (entry) =>
    entry.classification === 'HISTORICAL_ONLY' || entry.classification === 'DERIVED_COMPATIBILITY',
).map((entry) => entry.field);

export type AuditCompatibilityProjection = Readonly<{
  auditStatus: 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
  setAdmissionReady: boolean;
}>;

export function auditCompatibilityProjection(
  modernStatus: 'IN_REVIEW' | 'APPROVED' | 'REJECTED',
): AuditCompatibilityProjection {
  return {
    auditStatus: modernStatus,
    setAdmissionReady: modernStatus === 'APPROVED',
  };
}

export function classifyLegacyField(field: string): LegacyFieldClassification | null {
  return LEGACY_CUTOVER_FIELDS.find((entry) => entry.field === field)?.classification ?? null;
}

export function isForbiddenModernLegacyUsage(field: string): boolean {
  return (LEGACY_SCAN_FORBIDDEN_FIELDS as readonly string[]).includes(field);
}

export type OperationalGeneration = 'modern' | 'legacy_historical';

export function classifyOperationalGeneration(input: {
  hasModernLineage: boolean;
}): OperationalGeneration {
  return input.hasModernLineage ? 'modern' : 'legacy_historical';
}

export function assertNoSilentLegacyFallback(input: {
  operation: 'command' | 'historical_read';
  modernLineageExpected: boolean;
  modernLineagePresent: boolean;
}): 'use_modern' | 'historical_only' | 'inconsistency' {
  if (input.operation === 'command') {
    if (input.modernLineageExpected && !input.modernLineagePresent) return 'inconsistency';
    return 'use_modern';
  }
  if (input.modernLineagePresent) return 'use_modern';
  return 'historical_only';
}

export const LEGACY_DROP_CANDIDATES: ReadonlyArray<{
  field: string;
  classification: LegacyFieldClassification;
  blockers: readonly string[];
  proposedFutureMigration: string;
  safeToDropLater: false;
}> = LEGACY_CUTOVER_FIELDS.map((entry) => ({
  field: entry.field,
  classification: entry.classification,
  blockers: entry.dropBlockers,
  proposedFutureMigration: `Drop ${entry.field} only after a later spec removes blockers`,
  safeToDropLater: false,
}));
