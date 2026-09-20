export const AUTHORIZATION_COVERAGE_ALLOCATION_POLICY =
  'REGULAR_THEN_LATE_EARLIEST_EXPIRATION' as const;

export type AuthorizationCoverageDemandBucket = 'REGULAR' | 'LATE';

export type AuthorizationCoverageStatus = 'COVERED' | 'PARTIAL' | 'UNCOVERED';

export type AuthorizationCoverageSource = Readonly<{
  authorizationItemId: string;
  authorizationNumber: string;
  demandBucket: AuthorizationCoverageDemandBucket;
  quantity: number;
  assignmentDate: string;
  expirationDate: string;
}>;

export type AuthorizationCoverageProjectionItem = AuthorizationCoverageSource &
  Readonly<{
    projectedStockCoverage: number;
    projectedOpenPurchaseCoverage: number;
    projectedCoveredQuantity: number;
    projectedUncoveredQuantity: number;
    coverageStatus: AuthorizationCoverageStatus;
  }>;

export type AuthorizationCoverageProjection = Readonly<{
  allocationPolicy: typeof AUTHORIZATION_COVERAGE_ALLOCATION_POLICY;
  physicalReservation: false;
  fungiblePool: true;
  usableStockQuantity: number;
  openPurchaseCoverageQuantity: number;
  totalCoveragePoolQuantity: number;
  totalDemandQuantity: number;
  projectedCoveredQuantity: number;
  projectedUncoveredQuantity: number;
  unusedCoverageQuantity: number;
  items: readonly AuthorizationCoverageProjectionItem[];
}>;

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertNonnegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`INVALID_AUTHORIZATION_COVERAGE_${field}`);
  }
}

function assertPositiveInteger(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('INVALID_AUTHORIZATION_COVERAGE_SOURCE_QUANTITY');
  }
}

/**
 * W2B
 *
 * Proyección puramente calculada.
 *
 * NO reserva inventario.
 * NO enlaza lotes a pacientes.
 * NO escribe estado operacional.
 *
 * El pool continúa siendo fungible por código comercial.
 *
 * Prioridad de visualización/proyección:
 * 1. REGULAR antes que LATE, igual que el netting de procurement.
 * 2. Menor FECHA_FINAL_VIGENCIA.
 * 3. Menor FECHA_ASIGNACION.
 * 4. Número de autorización.
 * 5. ID técnico.
 *
 * Stock disponible se consume virtualmente antes de cobertura de OC
 * abiertas. La proyección puede recalcularse en cualquier momento.
 */
export function projectFungibleAuthorizationCoverage(
  input: Readonly<{
    sources: readonly AuthorizationCoverageSource[];
    usableStockQuantity: number;
    openPurchaseCoverageQuantity: number;
  }>,
): AuthorizationCoverageProjection {
  assertNonnegativeInteger(input.usableStockQuantity, 'USABLE_STOCK');

  assertNonnegativeInteger(input.openPurchaseCoverageQuantity, 'OPEN_PURCHASE');

  for (const source of input.sources) {
    assertPositiveInteger(source.quantity);
  }

  const ordered = [...input.sources].sort((left, right) => {
    const bucket =
      left.demandBucket === right.demandBucket ? 0 : left.demandBucket === 'REGULAR' ? -1 : 1;

    if (bucket !== 0) {
      return bucket;
    }

    return (
      compareText(left.expirationDate, right.expirationDate) ||
      compareText(left.assignmentDate, right.assignmentDate) ||
      compareText(left.authorizationNumber, right.authorizationNumber) ||
      compareText(left.authorizationItemId, right.authorizationItemId)
    );
  });

  let stockRemaining = input.usableStockQuantity;

  let openPurchaseRemaining = input.openPurchaseCoverageQuantity;

  const items = ordered.map((source): AuthorizationCoverageProjectionItem => {
    const projectedStockCoverage = Math.min(source.quantity, stockRemaining);

    stockRemaining -= projectedStockCoverage;

    const afterStock = source.quantity - projectedStockCoverage;

    const projectedOpenPurchaseCoverage = Math.min(afterStock, openPurchaseRemaining);

    openPurchaseRemaining -= projectedOpenPurchaseCoverage;

    const projectedCoveredQuantity = projectedStockCoverage + projectedOpenPurchaseCoverage;

    const projectedUncoveredQuantity = source.quantity - projectedCoveredQuantity;

    const coverageStatus: AuthorizationCoverageStatus =
      projectedCoveredQuantity === source.quantity
        ? 'COVERED'
        : projectedCoveredQuantity > 0
          ? 'PARTIAL'
          : 'UNCOVERED';

    return {
      ...source,
      projectedStockCoverage,
      projectedOpenPurchaseCoverage,
      projectedCoveredQuantity,
      projectedUncoveredQuantity,
      coverageStatus,
    };
  });

  const totalDemandQuantity = ordered.reduce((total, source) => total + source.quantity, 0);

  const projectedCoveredQuantity = items.reduce(
    (total, item) => total + item.projectedCoveredQuantity,
    0,
  );

  const projectedUncoveredQuantity = totalDemandQuantity - projectedCoveredQuantity;

  const totalCoveragePoolQuantity = input.usableStockQuantity + input.openPurchaseCoverageQuantity;

  return {
    allocationPolicy: AUTHORIZATION_COVERAGE_ALLOCATION_POLICY,
    physicalReservation: false,
    fungiblePool: true,
    usableStockQuantity: input.usableStockQuantity,
    openPurchaseCoverageQuantity: input.openPurchaseCoverageQuantity,
    totalCoveragePoolQuantity,
    totalDemandQuantity,
    projectedCoveredQuantity,
    projectedUncoveredQuantity,
    unusedCoverageQuantity: Math.max(totalCoveragePoolQuantity - totalDemandQuantity, 0),
    items,
  };
}
