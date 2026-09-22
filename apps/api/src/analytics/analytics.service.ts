import { Injectable } from '@nestjs/common';
import type {
  AnalyticsDrilldownQuery,
  AnalyticsEconomics,
  AnalyticsQuery,
  OperationalAnalyticsResponse,
} from '@authorization/contracts';
import {
  ANALYTICS_DEFINITIONS_VERSION,
  INCOMPLETE_SUPPLIER_COST,
  INCOMPLETE_TARIFF_LOOKUP,
  appliedSupplierCostMetric,
  grossOperationalSpreadReference,
  projectedQuantity,
  projectedTariffReferenceMetric,
  purchaseOrderSnapshotMoney,
  ratioMetric,
  receivedMinusAppliedFlow,
  shortageQuantity,
} from '@authorization/domain';
import type { Scope } from '../common/request-scope';
import { AnalyticsRepository } from './analytics.repository';

@Injectable()
export class AnalyticsService {
  constructor(private readonly repository: AnalyticsRepository) {}

  async operational(
    query: AnalyticsQuery,
    scope: Scope,
    includeEconomics: boolean,
  ): Promise<OperationalAnalyticsResponse> {
    const [snapshot, distribution] = await Promise.all([
      this.repository.snapshot(query),
      this.repository.novelties(query),
    ]);
    void scope;
    const projected = projectedQuantity(
      snapshot.regularProjectedQuantity,
      snapshot.lateProjectedQuantity,
    );
    const terminalOperationalResultCount =
      snapshot.confirmedApplicationCount + snapshot.notAppliedCount;
    const notAppliedTotal = distribution.reduce((sum, item) => sum + item.count, 0);
    const funnel = {
      projectedQuantity: projected,
      requestedQuantity: snapshot.requestedQuantity,
      acceptedQuantity: snapshot.acceptedQuantity,
      dispatchedQuantity: snapshot.dispatchedQuantity,
      physicallyReceivedQuantity: snapshot.physicallyReceivedQuantity,
      acceptedIntoInventoryQuantity: snapshot.acceptedIntoInventoryQuantity,
      appliedQuantity: snapshot.appliedQuantity,
    };
    return {
      freshness: this.freshness(query, snapshot),
      demand: {
        regularProjectedQuantity: snapshot.regularProjectedQuantity,
        lateProjectedQuantity: snapshot.lateProjectedQuantity,
        projectedQuantity: projected,
        lastConsolidatedAt: snapshot.lastConsolidatedAt,
        stale: snapshot.demandStale,
      },
      procurement: {
        requestedQuantity: snapshot.requestedQuantity,
        acceptedQuantity: snapshot.acceptedQuantity,
        supplierShortageQuantity: shortageQuantity(
          snapshot.requestedQuantity,
          snapshot.acceptedQuantity,
        ),
        effectivePurchaseCoverage: snapshot.effectivePurchaseCoverage,
        procurementGapQuantity: shortageQuantity(projected, snapshot.effectivePurchaseCoverage),
        purchaseCoverageRate: ratioMetric(snapshot.effectivePurchaseCoverage, projected),
        supplierAcceptanceRate: ratioMetric(snapshot.acceptedQuantity, snapshot.requestedQuantity),
      },
      delivery: {
        dispatchedQuantity: snapshot.dispatchedQuantity,
        deliveryPendingQuantity: shortageQuantity(
          snapshot.acceptedQuantity,
          snapshot.dispatchedQuantity,
        ),
        dispatchFulfillmentRate: ratioMetric(
          snapshot.dispatchedQuantity,
          snapshot.acceptedQuantity,
        ),
      },
      receipt: {
        physicallyReceivedQuantity: snapshot.physicallyReceivedQuantity,
        acceptedIntoInventoryQuantity: snapshot.acceptedIntoInventoryQuantity,
        rejectedQuantity: snapshot.rejectedQuantity,
        receiptPhysicalShortageQuantity: snapshot.receiptPhysicalShortageQuantity,
        receiptAcceptanceRate: ratioMetric(
          snapshot.acceptedIntoInventoryQuantity,
          snapshot.physicallyReceivedQuantity,
        ),
      },
      application: {
        appliedQuantity: snapshot.appliedQuantity,
        applicationRate: ratioMetric(snapshot.appliedQuantity, projected),
      },
      inventory: {
        currentOnHandQuantity: snapshot.currentOnHandQuantity,
        usableBalance: snapshot.usableBalance,
        inTransitQuantity: snapshot.inTransitQuantity,
        expiredPhysicalQuantity: snapshot.expiredPhysicalQuantity,
        upcomingExpirationQuantity: snapshot.upcomingExpirationQuantity,
        nonReusableQuantity: snapshot.nonReusableQuantity,
        receivedMinusAppliedFlow: receivedMinusAppliedFlow(
          snapshot.acceptedIntoInventoryQuantity,
          snapshot.appliedQuantity,
        ),
      },
      outcomes: {
        notAppliedCount: snapshot.notAppliedCount,
        terminalOperationalResultCount,
        noShowCount: snapshot.noShowCount,
        noShowRate: ratioMetric(snapshot.noShowCount, terminalOperationalResultCount),
        distribution: distribution.map((item) => ({
          noveltyCode: item.noveltyCode,
          count: item.count,
          share: ratioMetric(item.count, notAppliedTotal),
        })),
      },
      audit: {
        readyForAudit: snapshot.readyForAudit,
        inReview: snapshot.inReview,
        approved: snapshot.approved,
        rejected: snapshot.rejected,
        approvedApplicationsCount: snapshot.approved,
      },
      economics: includeEconomics ? this.economicSection(snapshot, projected) : null,
      funnel,
    };
  }


  async dashboard(
    scope: Scope,
    includeEconomics: boolean,
  ) {
    return this.repository.dashboard({
      organizationId: scope.organizationId,
      organizationCode: scope.organizationCode,
      includeEconomics,
    });
  }

  async novelties(query: AnalyticsQuery, scope: Scope) {
    const result = await this.operational(query, scope, false);
    return { freshness: result.freshness, outcomes: result.outcomes };
  }

  async inventory(query: AnalyticsQuery, scope: Scope) {
    const [result, lots] = await Promise.all([
      this.operational(query, scope, false),
      this.repository.lots(query),
    ]);
    return { freshness: result.freshness, summary: result.inventory, lots };
  }

  async economics(query: AnalyticsQuery, scope: Scope) {
    const result = await this.operational(query, scope, true);
    return { freshness: result.freshness, economics: result.economics! };
  }

  drilldown(query: AnalyticsDrilldownQuery) {
    return this.repository.drilldown(query).then((items) => ({ kind: query.kind, items }));
  }

  private economicSection(
    snapshot: Awaited<ReturnType<AnalyticsRepository['snapshot']>>,
    projected: number,
  ): AnalyticsEconomics {
    const compensar = {
      projectedTariffReferenceValue: projectedTariffReferenceMetric(
        snapshot.projectedTariffReferenceValue,
        projected,
      ),
      requestedTariffSnapshotValue: purchaseOrderSnapshotMoney(
        snapshot.requestedQuantity,
        snapshot.requestedTariffSnapshotValue,
        INCOMPLETE_TARIFF_LOOKUP,
      ),
      acceptedTariffSnapshotValue: purchaseOrderSnapshotMoney(
        snapshot.acceptedQuantity,
        snapshot.acceptedTariffSnapshotValue,
        INCOMPLETE_TARIFF_LOOKUP,
      ),
    };
    const olp = {
      requestedSupplierValue: purchaseOrderSnapshotMoney(
        snapshot.requestedQuantity,
        snapshot.requestedSupplierValue,
        INCOMPLETE_SUPPLIER_COST,
      ),
      acceptedSupplierValue: purchaseOrderSnapshotMoney(
        snapshot.acceptedQuantity,
        snapshot.acceptedSupplierValue,
        INCOMPLETE_SUPPLIER_COST,
      ),
      dispatchedSupplierValue: purchaseOrderSnapshotMoney(
        snapshot.dispatchedQuantity,
        snapshot.dispatchedSupplierValue,
        INCOMPLETE_SUPPLIER_COST,
      ),
      acceptedReceiptSupplierValue: purchaseOrderSnapshotMoney(
        snapshot.acceptedIntoInventoryQuantity,
        snapshot.acceptedReceiptSupplierValue,
        INCOMPLETE_SUPPLIER_COST,
      ),
      appliedSupplierCost: appliedSupplierCostMetric(),
    };
    return {
      compensar,
      olp,
      grossOperationalSpreadReference: grossOperationalSpreadReference(
        compensar.acceptedTariffSnapshotValue,
        olp.acceptedSupplierValue,
      ),
    };
  }

  private freshness(
    query: AnalyticsQuery,
    snapshot: Awaited<ReturnType<AnalyticsRepository['snapshot']>>,
  ) {
    return {
      definitionsVersion: ANALYTICS_DEFINITIONS_VERSION,
      generatedAt: new Date().toISOString(),
      planningPeriodId: query.planningPeriodId ?? null,
      demandLastConsolidatedAt: snapshot.lastConsolidatedAt,
      projectedDemandStale: snapshot.demandStale,
    };
  }
}
