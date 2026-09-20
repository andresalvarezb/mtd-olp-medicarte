import { describe, expect, it } from 'vitest';

import {
  AUTHORIZATION_COVERAGE_ALLOCATION_POLICY,
  projectFungibleAuthorizationCoverage,
} from './authorization-coverage-projection';

describe('W2B authorization coverage projection', () => {
  it('projects fungible stock and open purchase coverage without reserving inventory', () => {
    const result = projectFungibleAuthorizationCoverage({
      usableStockQuantity: 5,
      openPurchaseCoverageQuantity: 4,
      sources: [
        {
          authorizationItemId: 'auth-c',
          authorizationNumber: 'AUTO-C',
          demandBucket: 'LATE',
          quantity: 3,
          assignmentDate: '2026-09-01',
          expirationDate: '2026-09-20',
        },
        {
          authorizationItemId: 'auth-b',
          authorizationNumber: 'AUTO-B',
          demandBucket: 'REGULAR',
          quantity: 5,
          assignmentDate: '2026-09-01',
          expirationDate: '2026-09-30',
        },
        {
          authorizationItemId: 'auth-a',
          authorizationNumber: 'AUTO-A',
          demandBucket: 'REGULAR',
          quantity: 4,
          assignmentDate: '2026-09-01',
          expirationDate: '2026-09-25',
        },
      ],
    });

    expect(result.allocationPolicy).toBe(AUTHORIZATION_COVERAGE_ALLOCATION_POLICY);

    expect(result.physicalReservation).toBe(false);

    expect(result.fungiblePool).toBe(true);

    expect(result).toMatchObject({
      usableStockQuantity: 5,
      openPurchaseCoverageQuantity: 4,
      totalCoveragePoolQuantity: 9,
      totalDemandQuantity: 12,
      projectedCoveredQuantity: 9,
      projectedUncoveredQuantity: 3,
      unusedCoverageQuantity: 0,
    });

    expect(
      result.items.map((item) => ({
        authorizationNumber: item.authorizationNumber,
        bucket: item.demandBucket,
        stock: item.projectedStockCoverage,
        open: item.projectedOpenPurchaseCoverage,
        covered: item.projectedCoveredQuantity,
        uncovered: item.projectedUncoveredQuantity,
        status: item.coverageStatus,
      })),
    ).toEqual([
      {
        authorizationNumber: 'AUTO-A',
        bucket: 'REGULAR',
        stock: 4,
        open: 0,
        covered: 4,
        uncovered: 0,
        status: 'COVERED',
      },
      {
        authorizationNumber: 'AUTO-B',
        bucket: 'REGULAR',
        stock: 1,
        open: 4,
        covered: 5,
        uncovered: 0,
        status: 'COVERED',
      },
      {
        authorizationNumber: 'AUTO-C',
        bucket: 'LATE',
        stock: 0,
        open: 0,
        covered: 0,
        uncovered: 3,
        status: 'UNCOVERED',
      },
    ]);
  });

  it('reports partial projected coverage without mutating the source input', () => {
    const sources = [
      {
        authorizationItemId: 'auth-a',
        authorizationNumber: 'AUTO-A',
        demandBucket: 'REGULAR' as const,
        quantity: 4,
        assignmentDate: '2026-09-01',
        expirationDate: '2026-09-25',
      },
    ];

    const result = projectFungibleAuthorizationCoverage({
      usableStockQuantity: 2,
      openPurchaseCoverageQuantity: 1,
      sources,
    });

    expect(result.items[0]).toMatchObject({
      projectedStockCoverage: 2,
      projectedOpenPurchaseCoverage: 1,
      projectedCoveredQuantity: 3,
      projectedUncoveredQuantity: 1,
      coverageStatus: 'PARTIAL',
    });

    expect(sources[0]).toEqual({
      authorizationItemId: 'auth-a',
      authorizationNumber: 'AUTO-A',
      demandBucket: 'REGULAR',
      quantity: 4,
      assignmentDate: '2026-09-01',
      expirationDate: '2026-09-25',
    });
  });

  it('keeps REGULAR ahead of LATE even when the LATE authorization expires first', () => {
    const result = projectFungibleAuthorizationCoverage({
      usableStockQuantity: 1,
      openPurchaseCoverageQuantity: 0,
      sources: [
        {
          authorizationItemId: 'late',
          authorizationNumber: 'AUTO-LATE',
          demandBucket: 'LATE',
          quantity: 1,
          assignmentDate: '2026-09-01',
          expirationDate: '2026-09-10',
        },
        {
          authorizationItemId: 'regular',
          authorizationNumber: 'AUTO-REG',
          demandBucket: 'REGULAR',
          quantity: 1,
          assignmentDate: '2026-09-01',
          expirationDate: '2026-09-30',
        },
      ],
    });

    expect(result.items.map((item) => item.authorizationNumber)).toEqual(['AUTO-REG', 'AUTO-LATE']);

    expect(result.items[0]?.projectedStockCoverage).toBe(1);

    expect(result.items[1]?.projectedStockCoverage).toBe(0);
  });
});
