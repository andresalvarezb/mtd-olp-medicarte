import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReceiptRepository, type ReceiptOutcome } from './receipt.repository';
import type { Scope } from '../common/request-scope';
import { throwIfPointAccessDenied, pointAccessDeniedException } from '../common/point-access';
import type {
  PurchaseOrderDirectReceiptRequest,
  UpdateReceiptRequest,
} from '@authorization/contracts';
@Injectable()
export class ReceiptService {
  constructor(private readonly repository: ReceiptRepository) {}
  createPurchaseOrderReceipt(
    purchaseOrderId: string,
    body: PurchaseOrderDirectReceiptRequest,
    scope: Scope,
  ) {
    return this.run(
      () =>
        this.repository.createPurchaseOrderReceipt(
          purchaseOrderId,
          body,
          scope,
        ),
    );
  }


  create(id: string, scope: Scope) {
    return this.run(() => this.repository.create(id, scope));
  }
  update(id: string, body: UpdateReceiptRequest, scope: Scope) {
    return this.run(() => this.repository.update(id, body, scope));
  }
  confirm(id: string, version: number, scope: Scope) {
    return this.run(() => this.repository.confirm(id, version, scope));
  }
  list(scope: Scope, pending = false) {
    return this.repository.list(scope, pending);
  }
  async detail(id: string, scope: Scope) {
    const value = await this.repository.find(id, scope);
    if (value) return value;
    if (await this.repository.existsIgnoringPoint(id, scope)) throw pointAccessDeniedException();
    throw new NotFoundException({ code: 'RECEIPT_NOT_FOUND', message: 'Receipt not found' });
  }
  private async run<T extends object | null>(
    action: () => Promise<T | ReceiptOutcome>,
  ): Promise<T> {
    try {
      const result = await action();
      if (result !== null && 'outcome' in result && result.outcome === 'not_found')
        throw new NotFoundException({ code: 'RECEIPT_NOT_FOUND', message: 'Receipt not found' });
      if (result !== null && 'outcome' in result && result.outcome === 'version_conflict')
        throw new ConflictException({
          code: 'VERSION_CONFLICT',
          message: 'Receipt changed during the operation',
          fields: { currentVersion: [String(result.currentVersion)] },
        });
      return result;
    } catch (error) {
      throwIfPointAccessDenied(error);
      if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
      const message = error instanceof Error ? error.message : 'Invalid receipt';
      const conflicts = [
        'RECEIPT_DELIVERY_NOT_DISPATCHED',
        'RECEIPT_ALREADY_CONFIRMED',
        'RECEIPT_FROZEN',
        'RECEIPT_OVER_RECEIVED',
        'RECEIPT_ACCEPTED_INVALID',
        'RECEIPT_REJECTED_INVALID',
        'RECEIPT_QUANTITY_SUM_INVALID',
        'RECEIPT_EXPIRED_PRODUCT',
        'RECEIPT_LINE_OUT_OF_SCOPE',
        'DIRECT_RECEIPT_MEDICARTE_ONLY',
        'DIRECT_RECEIPT_ORDER_NOT_FOUND',
        'DIRECT_RECEIPT_OLP_NOT_ACCEPTED',
        'DIRECT_RECEIPT_LEGACY_FLOW_EXISTS',
        'DIRECT_RECEIPT_LINE_DUPLICATE',
        'DIRECT_RECEIPT_LINE_NOT_FOUND',
        'DIRECT_RECEIPT_POINT_NOT_FOUND',
        'DIRECT_RECEIPT_ALREADY_COMPLETE',
        'DIRECT_RECEIPT_OVER_RECEIVED',
        'DIRECT_RECEIPT_OUTCOME_INVALID',
        'DIRECT_RECEIPT_LOT_REQUIRED',
        'DIRECT_RECEIPT_EXPIRED_PRODUCT',
      ];
      if (conflicts.includes(message)) throw new ConflictException({ code: message, message });
      throw new BadRequestException({ code: message, message });
    }
  }
}
