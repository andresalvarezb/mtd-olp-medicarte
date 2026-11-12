export type AutomaticAssignmentCandidate = Readonly<{
  authorizationKey: string;
  commercialCode: string;
  dispensingPointId: string;
  validityEndDate: string;
  pendingQuantity: number;
}>;

export type AutomaticAssignmentSource = Readonly<{
  purchaseOrderCode: string;
  purchaseOrderId: string;
  commercialCode: string;
  dispensingPointId: string;
  availableQuantity: number;
  expirationDate: string | null;
  receivedAt: string | null;
}>;

export type AutomaticAssignmentRequest = Readonly<{
  authorizationKey: string;
  purchaseOrderCode: string;
  quantity: number;
}>;

export type AutomaticAssignmentUnmatchedStock = Readonly<{
  commercialCode: string;
  dispensingPointId: string;
  quantity: number;
  reason: 'NO_ELIGIBLE_AUTHORIZATION' | 'NO_MATCHING_POINT' | 'NO_COMPLETE_AUTHORIZATION';
}>;

export type AutomaticAssignmentPlan = Readonly<{
  requests: readonly AutomaticAssignmentRequest[];
  assignedAuthorizationKeys: readonly string[];
  unmatchedStock: readonly AutomaticAssignmentUnmatchedStock[];
}>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSources(left: AutomaticAssignmentSource, right: AutomaticAssignmentSource): number {
  if (left.expirationDate && right.expirationDate) {
    const expiration = compareText(left.expirationDate, right.expirationDate);
    if (expiration !== 0) return expiration;
  } else if (left.expirationDate) {
    return -1;
  } else if (right.expirationDate) {
    return 1;
  }

  return (
    compareText(left.receivedAt ?? '', right.receivedAt ?? '') ||
    compareText(left.purchaseOrderCode, right.purchaseOrderCode) ||
    compareText(left.purchaseOrderId, right.purchaseOrderId)
  );
}

function sourceKey(source: AutomaticAssignmentSource): string {
  return `${source.purchaseOrderId}\u0000${source.commercialCode}\u0000${source.dispensingPointId}`;
}

function pointKey(commercialCode: string, dispensingPointId: string): string {
  return `${commercialCode}\u0000${dispensingPointId}`;
}

export function planAutomaticAssignments(
  candidates: readonly AutomaticAssignmentCandidate[],
  sources: readonly AutomaticAssignmentSource[],
): AutomaticAssignmentPlan {
  const usableSources = sources
    .filter((source) => source.availableQuantity > 0)
    .slice()
    .sort(compareSources);
  const remainingBySource = new Map(usableSources.map((source) => [sourceKey(source), source.availableQuantity]));
  const orderedCandidates = candidates
    .filter((candidate) => candidate.pendingQuantity > 0)
    .slice()
    .sort((left, right) =>
      compareText(left.validityEndDate, right.validityEndDate) ||
      compareText(left.authorizationKey, right.authorizationKey),
    );

  const requests: AutomaticAssignmentRequest[] = [];
  const assignedAuthorizationKeys: string[] = [];

  for (const candidate of orderedCandidates) {
    const matchingSources = usableSources.filter(
      (source) =>
        source.commercialCode === candidate.commercialCode &&
        source.dispensingPointId === candidate.dispensingPointId,
    );
    const available = matchingSources.reduce(
      (total, source) => total + (remainingBySource.get(sourceKey(source)) ?? 0),
      0,
    );

    // Do not reserve a partial amount for one authorization. Leave these units
    // available so a later, fully coverable authorization can use them.
    if (available < candidate.pendingQuantity) continue;

    let needed = candidate.pendingQuantity;
    const candidateRequests: AutomaticAssignmentRequest[] = [];
    for (const source of matchingSources) {
      if (needed === 0) break;
      const sourceAvailable = remainingBySource.get(sourceKey(source)) ?? 0;
      if (sourceAvailable === 0) continue;

      const quantity = Math.min(sourceAvailable, needed);
      candidateRequests.push({
        authorizationKey: candidate.authorizationKey,
        purchaseOrderCode: source.purchaseOrderCode,
        quantity,
      });
      remainingBySource.set(sourceKey(source), sourceAvailable - quantity);
      needed -= quantity;
    }

    if (needed !== 0) {
      // Defensive guard: the preflight total and allocation loop must agree.
      for (const request of candidateRequests) {
        const source = matchingSources.find(
          (item) => item.purchaseOrderCode === request.purchaseOrderCode,
        );
        if (source) remainingBySource.set(sourceKey(source), (remainingBySource.get(sourceKey(source)) ?? 0) + request.quantity);
      }
      continue;
    }

    requests.push(...candidateRequests);
    assignedAuthorizationKeys.push(candidate.authorizationKey);
  }

  const remainingGroups = new Map<string, AutomaticAssignmentUnmatchedStock>();
  for (const source of usableSources) {
    const quantity = remainingBySource.get(sourceKey(source)) ?? 0;
    if (quantity <= 0) continue;

    const key = pointKey(source.commercialCode, source.dispensingPointId);
    const group = remainingGroups.get(key);
    if (group) {
      remainingGroups.set(key, { ...group, quantity: group.quantity + quantity });
      continue;
    }

    const sameProduct = orderedCandidates.filter(
      (candidate) => candidate.commercialCode === source.commercialCode,
    );
    const samePoint = sameProduct.filter(
      (candidate) => candidate.dispensingPointId === source.dispensingPointId,
    );
    const reason: AutomaticAssignmentUnmatchedStock['reason'] =
      sameProduct.length === 0
        ? 'NO_ELIGIBLE_AUTHORIZATION'
        : samePoint.length === 0
          ? 'NO_MATCHING_POINT'
          : 'NO_COMPLETE_AUTHORIZATION';

    remainingGroups.set(key, {
      commercialCode: source.commercialCode,
      dispensingPointId: source.dispensingPointId,
      quantity,
      reason,
    });
  }

  return {
    requests,
    assignedAuthorizationKeys,
    unmatchedStock: [...remainingGroups.values()].sort(
      (left, right) =>
        compareText(left.commercialCode, right.commercialCode) ||
        compareText(left.dispensingPointId, right.dispensingPointId),
    ),
  };
}
