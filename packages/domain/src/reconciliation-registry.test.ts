import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EXECUTABLE_RECONCILIATION_RULES,
  RECONCILIATION_DOMAINS,
  RECONCILIATION_MAX_FINDINGS_PER_RULE,
  RECONCILIATION_OPERATIONAL_TABLES,
  RECONCILIATION_RULES,
  RECONCILIATION_RULES_VERSION,
  RECONCILIATION_RULE_BY_CODE,
  RECONCILIATION_WRITABLE_TABLES,
  formatReconciliationRuleCatalog,
  isBlockingReconciliationSeverity,
  reconciliationFindingFingerprint,
} from './reconciliation-registry';
import {
  appliedSupplierCostMetric,
  projectedTariffReferenceMetric,
  unavailableMoney,
} from './operational-analytics';

describe('ESP-017 reconciliation registry', () => {
  it('keeps stable rule codes and a single versioned catalog', () => {
    expect(RECONCILIATION_RULES_VERSION).toBe('ESP-017.1');
    expect(RECONCILIATION_MAX_FINDINGS_PER_RULE).toBe(1000);
    const codes = RECONCILIATION_RULES.map((rule) => rule.ruleCode);
    expect(codes).toHaveLength(75);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => /^REC-[A-Z]+-\d{3}$/.test(code))).toBe(true);
    expect(RECONCILIATION_RULE_BY_CODE['REC-APP-003']?.executable).toBe(true);
    expect(RECONCILIATION_RULE_BY_CODE['REC-OUT-002']?.ownedBy).toBe('REC-APP-006');
    expect(RECONCILIATION_RULE_BY_CODE['REC-LEG-003']?.ownedBy).toBe('REC-AUD-002');
    expect(RECONCILIATION_RULES.filter((rule) => rule.executable)).toHaveLength(67);
  });

  it('covers every declared domain and does not mix observation with integrity', () => {
    const domains = new Set(RECONCILIATION_RULES.map((rule) => rule.domain));
    expect([...RECONCILIATION_DOMAINS].every((domain) => domains.has(domain))).toBe(true);
    expect(RECONCILIATION_RULE_BY_CODE['REC-DEM-004']?.category).toBe('OBSERVATION');
    expect(RECONCILIATION_RULE_BY_CODE['REC-DEM-004']?.defaultSeverity).toBe('WARNING');
    expect(RECONCILIATION_RULE_BY_CODE['REC-BULK-004']?.category).toBe('OBSERVATION');
    expect(RECONCILIATION_RULE_BY_CODE['REC-INV-001']?.category).toBe('INTEGRITY');
    expect(RECONCILIATION_RULE_BY_CODE['REC-TRF-006']?.category).toBe('OBSERVATION');
    expect(RECONCILIATION_RULE_BY_CODE['REC-LEG-004']?.category).toBe('OBSERVATION');
  });

  it('does not treat INFO as a blocking severity', () => {
    expect(isBlockingReconciliationSeverity('CRITICAL')).toBe(true);
    expect(isBlockingReconciliationSeverity('ERROR')).toBe(true);
    expect(isBlockingReconciliationSeverity('WARNING')).toBe(false);
    expect(isBlockingReconciliationSeverity('INFO')).toBe(false);
  });

  it('keeps fingerprints stable without PHI', () => {
    const fingerprint = reconciliationFindingFingerprint({
      ruleCode: 'REC-APP-003',
      entityType: 'patient_application_line',
      entityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(fingerprint).toContain('REC-APP-003');
    expect(fingerprint).not.toMatch(/nombre|documento|historia/i);
    expect(createHash('sha256').update(fingerprint).digest('hex')).toHaveLength(64);
  });

  it('lists writable reconciliation tables separately from operational facts', () => {
    expect(RECONCILIATION_WRITABLE_TABLES).toEqual([
      'reconciliation_runs',
      'reconciliation_findings',
      'reconciliation_issues',
      'reconciliation_issue_events',
      'reconciliation_issue_comments',
    ]);
    expect(RECONCILIATION_OPERATIONAL_TABLES).not.toContain('reconciliation_runs');
    expect(EXECUTABLE_RECONCILIATION_RULES.every((rule) => rule.executable)).toBe(true);
  });

  it('emits a catalog that names every rule', () => {
    const catalog = formatReconciliationRuleCatalog();
    for (const rule of RECONCILIATION_RULES) {
      expect(catalog).toContain(rule.ruleCode);
    }
    expect(catalog).toContain('PREVENTED_BY_DB?');
    expect(catalog).toContain('RECONCILIATION_DETECTABLE?');
  });

  it('keeps analytics UNAVAILABLE distinct from a fabricated zero', () => {
    expect(appliedSupplierCostMetric()).toMatchObject({ availability: 'UNAVAILABLE', value: null });
    expect(projectedTariffReferenceMetric(null, 3).availability).toBe('UNAVAILABLE');
    expect(unavailableMoney('HISTORICAL_TARIFF_UNAVAILABLE').value).toBeNull();
    expect(unavailableMoney('HISTORICAL_TARIFF_UNAVAILABLE').value).not.toBe('0.00');
  });
});
