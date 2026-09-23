import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreatePurchaseOrderRequest,
  PurchaseOrderListQuery,
  UpdatePurchaseOrderRequest,
} from '@authorization/contracts';
import type { Scope } from '../common/request-scope';
import { PurchaseOrderRepository } from './purchase-order.repository';

@Injectable()
export class PurchaseOrderService {
  constructor(private readonly repository: PurchaseOrderRepository) {}
  create(body: CreatePurchaseOrderRequest, actor: Scope) {
    return this.run(() => this.repository.create({ body, actor: this.actor(actor) }));
  }
  update(id: string, body: UpdatePurchaseOrderRequest, actor: Scope) {
    return this.run(() => this.repository.update({ id, body, actor: this.actor(actor) }));
  }
  issue(id: string, version: number, actor: Scope) {
    return this.run(() => this.repository.issue(id, version, this.actor(actor)));
  }
  cancel(id: string, version: number, actor: Scope) {
    return this.run(() => this.repository.cancel(id, version, this.actor(actor)));
  }
  list(query: PurchaseOrderListQuery, actor: Scope, supplier = false) {
    return this.repository.list(query, actor, supplier);
  }
  async detail(id: string, supplier = false, actor?: Scope) {
    const result = actor
      ? await this.repository.findVisibleById(id, actor, supplier)
      : await this.repository.findById(id, supplier);
    if (!result && actor && (await this.repository.findById(id, supplier)))
      throw new ForbiddenException({
        code: 'POINT_ACCESS_DENIED',
        message: 'Purchase order is outside the actor scope',
      });
    if (!result)
      throw new NotFoundException({
        code: 'PURCHASE_ORDER_NOT_FOUND',
        message: 'Purchase order not found',
      });
    return result;
  }

  acceptBySupplier(
    id: string,

    input: {
      expectedVersion: number;

      committedDate: string;

      observation?: string;

      lines: readonly {
        lineId: string;

        supplierUnitCost: number;
      }[];
    },

    actor: Scope,
  ) {
    this.requireOlp(
      actor,
    );

    return this.run(
      () =>
        this.repository.acceptBySupplier(
          id,
          input,
          this.actor(
            actor,
          ),
        ),
    );
  }

  review(
    id: string,
    lineId: string,
    input: { acceptedQuantity: number; supplierUnitCost?: number; expectedVersion: number },
    actor: Scope,
  ) {
    this.requireOlp(actor);

    return this.run(() => this.repository.reviewLine(id, lineId, input, this.actor(actor)));
  }
  returnBySupplier(id: string, version: number, observation: string, actor: Scope) {
    this.requireOlp(actor);

    return this.run(() =>
      this.repository.returnBySupplier(id, version, observation, this.actor(actor)),
    );
  }

  completeReview(id: string, version: number, actor: Scope) {
    this.requireOlp(actor);

    return this.run(() => this.repository.completeReview(id, version, this.actor(actor)));
  }

  async operationalDetail(
    id: string,
    scope: Parameters<PurchaseOrderRepository['findVisibleById']>[1],
  ) {
    /*
     * Reutilizamos la validación de visibilidad existente.
     * Si no es visible, detail() conserva el comportamiento
     * HTTP actual del módulo.
     */
    await this.detail(
      id,
      scope.organizationCode === 'OLP',
      scope,
    );

    return this.repository.operationalDetail(
      id,
      scope,
    );
  }

  available(periodId: string) {
    return this.repository.available(periodId);
  }
  private requireOlp(scope: Scope): void {
    if (scope.organizationCode !== 'OLP') {
      throw new ForbiddenException({
        code: 'PURCHASE_ORDER_OLP_ONLY',

        message: 'Only OLP can perform supplier purchase order actions',
      });
    }
  }

  private actor(scope: Scope) {
    return {
      userId: scope.userId,
      organizationId: scope.organizationId,
      correlationId: scope.correlationId,
    };
  }
  private async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      const result = await action();
      if (result && typeof result === 'object' && 'outcome' in result) {
        const outcome = result as { outcome: string; currentVersion?: number };
        if (outcome.outcome === 'not_found')
          throw new NotFoundException({
            code: 'PURCHASE_ORDER_NOT_FOUND',
            message: 'Purchase order not found',
          });
        if (outcome.outcome === 'version_conflict')
          throw new ConflictException({
            code: 'VERSION_CONFLICT',
            message: 'Purchase order changed during the operation',
            fields: { currentVersion: [String(outcome.currentVersion)] },
          });
      }
      return result;
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      )
        throw error;
      const message = error instanceof Error ? error.message : '';
      const codes: Record<string, [number, string]> = {
        PURCHASE_ORDER_CODE_REQUIRED: [409, 'Purchase order code is required before issue'],
        PURCHASE_ORDER_FROZEN: [409, 'Issued purchase orders are frozen'],
        PURCHASE_ORDER_DEMAND_OVERALLOCATED: [409, 'Demand is no longer available'],
        PURCHASE_ORDER_DEMAND_EXCEEDS_AVAILABLE: [409, 'Demand exceeds available quantity'],
        PURCHASE_ORDER_DEMAND_STALE: [
          409,
          'Projected demand is stale and must be reconsolidated before purchase',
        ],
        PURCHASE_ORDER_DUPLICATE_DEMAND_LINE: [400, 'A purchase order cannot repeat a demand line'],
        PURCHASE_ORDER_DEMAND_PERIOD_MISMATCH: [400, 'Demand belongs to another planning period'],
        PURCHASE_ORDER_DEMAND_POINT_MISMATCH: [400, 'Demand belongs to another dispensing point'],
        PURCHASE_ORDER_MODERN_DEMAND_POINT_NOT_ALLOWED: [
          400,
          'The delivery point for modern authorization demand is derived automatically',
        ],
        DELIVERY_POINT_MAPPING_MISSING: [
          409,
          'The product does not have an active Medicarte delivery-point mapping',
        ],
        PROJECTED_DEMAND_REVISION_CONFLICT: [409, 'Projected demand revision changed'],
        PURCHASE_ORDER_BUCKET_MISMATCH: [400, 'Order type and demand bucket do not match'],
        PURCHASE_ORDER_INVALID_TRANSITION: [409, 'Invalid purchase order transition'],
        TARIFF_RATE_NOT_FOUND: [400, 'No active COMPENSAR tariff exists for the product'],
        PURCHASE_ORDER_TARIFF_NOT_PBS: [409, 'Product is no longer PBS in the active tariff annex'],
        PURCHASE_ORDER_NOT_ACCEPTABLE: [409, 'Purchase order is not available for OLP acceptance'],
        PURCHASE_ORDER_ALREADY_ACCEPTED: [409, 'Purchase order was already accepted by OLP'],
        PURCHASE_ORDER_LINES_REQUIRED: [409, 'Purchase order has no lines to accept'],

        PURCHASE_ORDER_SUPPLIER_COSTS_REQUIRED: [
          400,
          'OLP must provide a supplier unit cost for every purchase-order line',
        ],

        PURCHASE_ORDER_SUPPLIER_COST_DUPLICATE: [
          400,
          'A purchase-order line cannot repeat its supplier unit cost',
        ],

        PURCHASE_ORDER_SUPPLIER_COST_LINE_MISMATCH: [
          400,
          'Supplier unit costs must match exactly all purchase-order lines',
        ],
        PURCHASE_ORDER_NOT_REVIEWABLE: [409, 'Purchase order is not under supplier review'],
        PURCHASE_ORDER_REVIEW_INCOMPLETE: [409, 'All lines must be reviewed'],
      };
      const [status, text] = codes[message] ?? [400, message || 'Invalid purchase order'];
      throw status === 409
        ? new ConflictException({ code: message, message: text })
        : new BadRequestException({ code: message, message: text });
    }
  }
}
