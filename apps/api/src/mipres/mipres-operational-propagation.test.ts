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
  it('clinical initial validation uses MTD decision instead of CONFIRMED evidence', () => {
    const value = source('src/clinical/authorization-query.repository.ts');

    const block = windowAfter(value, 'private initialValidationStatusSql(): SQL {', 4500);

    expect(block).toContain('i.mipres_manual_decision');

    expect(block).toContain("'MANUALLY_ENABLED'");

    expect(block).toContain("'MANUALLY_DISABLED'");

    expect(block).not.toMatch(
      /i\.coverage_type\s*=\s*'NO_PBS'[\s\S]{0,500}i\.direction_status\s*=\s*'CONFIRMED'/,
    );
  });

  it('clinical ordering priority mirrors manual decision', () => {
    const value = source('src/clinical/authorization-query.repository.ts');

    const block = windowAfter(value, 'const validationPriority =', 4500);

    expect(block).toContain('i.mipres_manual_decision');

    expect(block).toContain("'MANUALLY_ENABLED'");

    expect(block).toContain("'MANUALLY_DISABLED'");

    expect(block).not.toMatch(
      /i\.coverage_type\s*=\s*'NO_PBS'[\s\S]{0,500}i\.direction_status\s*=\s*'CONFIRMED'/,
    );
  });

  it('clinical TypeScript uses canonical effective MIPRES evaluator', () => {
    const value = source('src/clinical/authorization-query-state.ts');

    expect(value).toContain('evaluateEffectiveMipresEligibility');

    expect(value).toContain('normalizeMipresManualDecision');

    expect(value).toContain("'MIPRES_MANUAL_ENABLEMENT_PENDING'");

    expect(value).toContain("'MIPRES_MANUALLY_DISABLED'");
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
