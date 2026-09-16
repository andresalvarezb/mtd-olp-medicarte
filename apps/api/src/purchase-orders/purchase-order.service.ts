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
  review(
    id: string,
    lineId: string,
    input: { acceptedQuantity: number; supplierUnitCost?: number; expectedVersion: number },
    actor: Scope,
  ) {
    return this.run(() => this.repository.reviewLine(id, lineId, input, this.actor(actor)));
  }
  completeReview(id: string, version: number, actor: Scope) {
    return this.run(() => this.repository.completeReview(id, version, this.actor(actor)));
  }
  available(periodId: string) {
    return this.repository.available(periodId);
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
      if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
      const message = error instanceof Error ? error.message : '';
      const codes: Record<string, [number, string]> = {
        PURCHASE_ORDER_CODE_REQUIRED: [409, 'Purchase order code is required before issue'],
        PURCHASE_ORDER_FROZEN: [409, 'Issued purchase orders are frozen'],
        PURCHASE_ORDER_DEMAND_OVERALLOCATED: [409, 'Demand is no longer available'],
        PURCHASE_ORDER_DEMAND_EXCEEDS_AVAILABLE: [409, 'Demand exceeds available quantity'],
        PURCHASE_ORDER_DUPLICATE_DEMAND_LINE: [400, 'A purchase order cannot repeat a demand line'],
        PURCHASE_ORDER_DEMAND_PERIOD_MISMATCH: [400, 'Demand belongs to another planning period'],
        PURCHASE_ORDER_DEMAND_POINT_MISMATCH: [400, 'Demand belongs to another dispensing point'],
        PROJECTED_DEMAND_REVISION_CONFLICT: [409, 'Projected demand revision changed'],
        PURCHASE_ORDER_BUCKET_MISMATCH: [400, 'Order type and demand bucket do not match'],
        PURCHASE_ORDER_INVALID_TRANSITION: [409, 'Invalid purchase order transition'],
        TARIFF_RATE_NOT_FOUND: [400, 'No active COMPENSAR tariff exists for the product'],
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
