import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateDeliveryRequest,
  DeliveryDispatchRequest,
  UpdateDeliveryRequest,
} from '@authorization/contracts';
import type { Scope } from '../common/request-scope';
import { DeliveryRepository } from './delivery.repository';

@Injectable()
export class DeliveryService {
  constructor(private readonly repository: DeliveryRepository) {}
  create(body: CreateDeliveryRequest, scope: Scope) { return this.run(() => this.repository.create(body, scope)); }
  update(id: string, body: UpdateDeliveryRequest, scope: Scope) { return this.run(() => this.repository.update(id, body, scope)); }
  dispatch(
    id: string,
    body: DeliveryDispatchRequest,
    scope: Scope,
  ) {
    return this.run(
      () =>
        this.repository.dispatch(
          id,
          body,
          scope,
        ),
    );
  }
  cancel(id: string, version: number, scope: Scope) { return this.run(() => this.repository.cancel(id, version, scope)); }
  list(scope: Scope) { return this.repository.list(scope); }
  async detail(id: string, scope: Scope) { const result = await this.repository.findById(id, scope); if (!result) throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found' }); return result; }
  private async run<T>(action: () => Promise<T>): Promise<T> { try { const result = await action(); if (result && typeof result === 'object' && 'outcome' in result) { const outcome = result as { outcome: string; currentVersion?: number }; if (outcome.outcome === 'not_found') throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found' }); if (outcome.outcome === 'version_conflict') throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Delivery changed during the operation', fields: { currentVersion: [String(outcome.currentVersion)] } }); } return result; } catch (error) { if (error instanceof ConflictException || error instanceof NotFoundException) throw error; const message = error instanceof Error ? error.message : ''; const codes: Record<string, [number, string]> = { DELIVERY_ORDER_NOT_DELIVERABLE: [409, 'Purchase order is not accepted for delivery'], DELIVERY_LINE_NOT_ACCEPTED: [409, 'Only accepted purchase order lines can be delivered'], DELIVERY_OVER_DISPATCHED: [409, 'Delivery exceeds accepted quantity'], DELIVERY_LOT_EXPIRATION_REQUIRED: [400, 'Lot and expiration date are required'], DELIVERY_SNAPSHOT_MISMATCH: [400, 'Delivery product or dispensing point does not match the purchase order'], DELIVERY_FROZEN: [409, 'Dispatched deliveries are frozen'], DELIVERY_INVALID_TRANSITION: [409, 'Delivery is not in draft'], DELIVERY_ONLY_DRAFT_CANCEL: [409, 'Only draft deliveries can be cancelled'], DELIVERY_LINE_OUT_OF_SCOPE: [403, 'Delivery line is out of scope'] }; const [status, text] = codes[message] ?? [400, message || 'Invalid delivery']; throw status === 409 ? new ConflictException({ code: message, message: text }) : status === 403 ? new ConflictException({ code: message, message: text }) : new BadRequestException({ code: message, message: text }); } }
}
