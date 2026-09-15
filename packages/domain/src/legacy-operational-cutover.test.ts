import { describe, expect, it } from 'vitest';
import {
  COMPATIBILITY_PROJECTION_DIRECTION,
  LEGACY_CUTOVER_FIELDS,
  LEGACY_DROP_CANDIDATES,
  LEGACY_SCAN_FORBIDDEN_FIELDS,
  MODERN_SOURCE_OF_TRUTH,
  assertNoSilentLegacyFallback,
  auditCompatibilityProjection,
  classifyLegacyField,
  classifyOperationalGeneration,
  isForbiddenModernLegacyUsage,
  type LegacyFieldClassification,
} from './legacy-operational-cutover';
import { isPathAllowlistedForLegacyScan } from './legacy-operational-usage-scan';

describe('ESP-016 legacy operational cutover', () => {
  it('classifies every audited field and never marks SAFE_TO_DROP_LATER without evidence', () => {
    expect(LEGACY_CUTOVER_FIELDS.map((entry) => entry.field)).toEqual([
      'lugar_dispensacion',
      'fecha_programada',
      'fecha_dispensacion',
      'fecha_aplicacion',
      'cod_autorizacion_medicarte',
      'orden_compra',
      'process_status',
      'operation_status',
      'operational_version',
      'audit_status',
      'admission_status',
    ]);
    expect(classifyLegacyField('audit_status')).toBe('DERIVED_COMPATIBILITY');
    expect(classifyLegacyField('admission_status')).toBe('AUTHORITATIVE');
    expect(classifyLegacyField('fecha_aplicacion')).toBe('HISTORICAL_ONLY');
    expect(classifyLegacyField('cod_autorizacion_medicarte')).toBe('HISTORICAL_ONLY');
    expect(LEGACY_CUTOVER_FIELDS.map((entry) => entry.classification)).not.toContain(
      'SAFE_TO_DROP_LATER' as LegacyFieldClassification,
    );
    expect(LEGACY_DROP_CANDIDATES.every((entry) => entry.safeToDropLater === false)).toBe(true);
  });

  it('maps modern audit decisions to a unidirectional compatibility projection', () => {
    expect(COMPATIBILITY_PROJECTION_DIRECTION).toBe('NEW_DOMAIN_TO_LEGACY');
    expect(auditCompatibilityProjection('IN_REVIEW')).toEqual({
      auditStatus: 'IN_REVIEW',
      setAdmissionReady: false,
    });
    expect(auditCompatibilityProjection('APPROVED')).toEqual({
      auditStatus: 'APPROVED',
      setAdmissionReady: true,
    });
    expect(auditCompatibilityProjection('REJECTED')).toEqual({
      auditStatus: 'REJECTED',
      setAdmissionReady: false,
    });
  });

  it('forbids silent modern fallback to legacy and labels historical reads', () => {
    expect(
      assertNoSilentLegacyFallback({
        operation: 'command',
        modernLineageExpected: true,
        modernLineagePresent: false,
      }),
    ).toBe('inconsistency');
    expect(
      assertNoSilentLegacyFallback({
        operation: 'command',
        modernLineageExpected: true,
        modernLineagePresent: true,
      }),
    ).toBe('use_modern');
    expect(
      assertNoSilentLegacyFallback({
        operation: 'historical_read',
        modernLineageExpected: false,
        modernLineagePresent: false,
      }),
    ).toBe('historical_only');
    expect(classifyOperationalGeneration({ hasModernLineage: true })).toBe('modern');
    expect(classifyOperationalGeneration({ hasModernLineage: false })).toBe('legacy_historical');
  });

  it('keeps the modern source-of-truth map and a tight scan allowlist', () => {
    expect(MODERN_SOURCE_OF_TRUTH.scheduling).toBe('patient_schedules');
    expect(MODERN_SOURCE_OF_TRUTH.audit).toBe('patient_application_audits');
    expect(MODERN_SOURCE_OF_TRUTH.pointAccess).toBe('user_point_scopes');
    expect(isForbiddenModernLegacyUsage('audit_status')).toBe(true);
    expect(isForbiddenModernLegacyUsage('admission_status')).toBe(false);
    expect(LEGACY_SCAN_FORBIDDEN_FIELDS).not.toContain('admission_status');
    expect(
      isPathAllowlistedForLegacyScan(
        'apps/api/src/legacy/legacy-compatibility-projection.service.ts',
      ),
    ).toBe(true);
    expect(
      isPathAllowlistedForLegacyScan('apps/api/src/scheduling/patient-schedule.service.ts'),
    ).toBe(false);
    expect(
      isPathAllowlistedForLegacyScan('apps/api/src/scheduling/patient-schedule.service.test.ts'),
    ).toBe(true);
  });
});
