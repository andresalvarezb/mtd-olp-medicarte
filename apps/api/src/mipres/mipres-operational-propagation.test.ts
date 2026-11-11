import { readFileSync } from 'node:fs';

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8').replace(/\r\n/g, '\n');
}

function windowAfter(
  value: string,

  marker: string,

  length: number,
): string {
  const start = value.indexOf(marker);

  expect(start).toBeGreaterThanOrEqual(0);

  return value.slice(start, start + length);
}

describe('MIPRES WAVE 4 operational propagation', () => {
  it('keeps clinical AUTO initial validation independent from the MIPRES gate', () => {
    const value = source(
      'src/clinical/authorization-query.repository.ts',
    );

    const validationSqlStart = value.indexOf(
      'private initialValidationStatusSql(): SQL {',
    );

    expect(validationSqlStart).toBeGreaterThanOrEqual(0);

    const validationSqlEnd = value.indexOf(
      '\n  private ',
      validationSqlStart + 1,
    );

    expect(validationSqlEnd).toBeGreaterThan(validationSqlStart);

    const validationSql = value.slice(
      validationSqlStart,
      validationSqlEnd,
    );

    expect(validationSql).toContain(
      "this.initialValidationStatusFor(\n      sql.raw('i')",
    );

    const validationRuleStart = value.indexOf(
      'private initialValidationStatusFor(',
    );

    const validationRuleEnd = value.indexOf(
      '\n  private ',
      validationRuleStart + 1,
    );

    expect(validationRuleStart).toBeGreaterThan(validationSqlEnd);
    expect(validationRuleEnd).toBeGreaterThan(validationRuleStart);

    const validationRules = value.slice(
      validationRuleStart,
      validationRuleEnd,
    );

    expect(validationRules).toContain(
      '${rowAlias}.enablement_status',
    );

    expect(validationRules).toContain(
      '${rowAlias}.tariff_membership_status',
    );

    expect(validationRules).toContain(
      '${rowAlias}.coverage_type in (\'PBS\', \'NO_PBS\')',
    );

    expect(validationRules).not.toContain(
      'i.mipres_manual_decision',
    );

    expect(validationRules).not.toContain(
      'i.direction_status',
    );
  });
  it('keeps clinical validation ordering independent from the MIPRES gate', () => {
    const value = source(
      'src/clinical/authorization-query.repository.ts',
    );

    const validationStart = value.indexOf(
      'authorization_validation as materialized (',
    );

    const operationalGate = value.indexOf(
      "calculated.mipres_manual_decision = 'MANUALLY_ENABLED'",
      validationStart,
    );
    const operationalCandidatesStart = value.indexOf(
      'operational_candidates as materialized (',
    );
    const operationalCandidatesEnd = value.indexOf(
      '\n      confirmed_fulfillment_progress as (',
      operationalCandidatesStart,
    );

    expect(validationStart).toBeGreaterThanOrEqual(0);
    expect(operationalGate).toBeGreaterThan(validationStart);
    expect(operationalCandidatesStart).toBeGreaterThan(validationStart);
    expect(operationalCandidatesEnd).toBeGreaterThan(operationalCandidatesStart);

    const operationalCandidates = value.slice(
      operationalCandidatesStart,
      operationalCandidatesEnd,
    );
    expect(operationalCandidates).not.toContain('mipres_manual_decision');

    const validationRules = windowAfter(
      value,
      'private initialValidationStatusFor(',
      1800,
    );

    expect(validationRules).toContain(
      '${rowAlias}.enablement_status',
    );

    expect(validationRules).toContain(
      '${rowAlias}.tariff_membership_status',
    );

    expect(validationRules).toContain(
      '${rowAlias}.coverage_type in (\'PBS\', \'NO_PBS\')',
    );

    expect(validationRules).not.toContain(
      'i.mipres_manual_decision',
    );

    expect(validationRules).not.toContain(
      'i.direction_status',
    );
  });
  it('keeps clinical lifecycle state independent from the MIPRES operational gate', () => {
    const value = source(
      'src/clinical/authorization-query-state.ts',
    );

    expect(value).toContain(
      'resolveAuthorizationLifecycleStatus',
    );

    expect(value).toContain(
      'resolveAuthorizationInitialValidationStatus',
    );

    expect(value).toContain(
      'Habilitación AUTO y MIPRES son dimensiones',
    );

    expect(value).not.toContain(
      'evaluateEffectiveMipresEligibility',
    );

    expect(value).not.toContain(
      'normalizeMipresManualDecision',
    );
  });
  it('clinical response propagates MTD decision into validation and lifecycle', () => {
    const value = source('src/clinical/authorization-query.repository.ts');

    expect(
      value.match(/mipresManualDecision:\s*row\.mipres_manual_decision/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);

    expect(value).toContain('mipres_manual_decision');
  });

  it('planned purchase order revalidates canonical MIPRES eligibility', () => {
    const value = source('src/purchase-orders/purchase-order.repository.ts');

    expect(value).toContain('evaluateEffectiveMipresEligibility');

    expect(value).toContain('authorization.mipres_manual_decision');

    expect(value).toContain('mipresEligible');
  });

  it('direct and existing purchase-order paths validate destination MIPRES', () => {
    const value = source('src/purchase-orders/purchase-order-import.service.ts');

    expect(value).toContain('evaluateEffectiveMipresEligibility');

    expect(value).toContain('assertDestinationMipresEligibility');

    expect(value).toContain('destination.mipres_manual_decision');

    expect(
      value.match(/this\.assertDestinationMipresEligibility\(/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
  });

  it('new inventory allocation requires manual MIPRES enablement for NO_PBS', () => {
    const value = source('src/inventory/inventory-availability.repository.ts');

    const block = windowAfter(value, 'private async resolveAssignment(', 9000);

    expect(block).toContain('ai.mipres_manual_decision');

    expect(block).toContain("'MANUALLY_ENABLED'");

    expect(block).toContain("'NOT_APPLICABLE'");
  });

  it('fulfillment revalidates canonical MIPRES eligibility', () => {
    const value = source('src/fulfillments/authorization-fulfillment.repository.ts');

    expect(value).toContain('evaluateEffectiveMipresEligibility');

    expect(value).toContain('authorization.mipres_manual_decision');

    expect(value).toContain('!mipresEligible ||');
  });

  it('existing inventory reservations preserve non-destructive retention policy', () => {
    const value = source('src/inventory/inventory-availability.repository.ts');

    expect(value).toContain('RESERVATION RETENTION POLICY');

    expect(value).toContain('return Promise.resolve(0);');
  });
});
