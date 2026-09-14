import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateStockTransferRequest,
  UpdateStockTransferRequest,
} from '@authorization/contracts';
import type { Scope } from '../common/request-scope';
import { StockTransferRepository } from './stock-transfer.repository';

@Injectable()
export class StockTransferService {
  constructor(private readonly repository: StockTransferRepository) {}
  create(body: CreateStockTransferRequest, scope: Scope) {
    return this.run(() => this.repository.create(body, scope));
  }
  update(id: string, body: UpdateStockTransferRequest, scope: Scope) {
    return this.run(() => this.repository.update(id, body, scope));
  }
  dispatch(id: string, version: number, scope: Scope) {
    return this.run(() => this.repository.dispatch(id, version, scope));
  }
  receive(id: string, version: number, scope: Scope) {
    return this.run(() => this.repository.receive(id, version, scope));
  }
  cancel(id: string, version: number, scope: Scope) {
    return this.run(() => this.repository.cancel(id, version, scope));
  }
  list(scope: Scope, status?: string) {
    return this.repository.list(scope, status);
  }
  async detail(id: string, scope: Scope) {
    const value = await this.repository.find(id, scope);
    if (!value)
      throw new NotFoundException({
        code: 'STOCK_TRANSFER_NOT_FOUND',
        message: 'Stock transfer not found',
      });
    return value;
  }
  private async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      const result = await action();
      if (result && typeof result === 'object' && 'outcome' in result) {
        const outcome = result as { outcome: string; currentVersion?: number };
        if (outcome.outcome === 'not_found')
          throw new NotFoundException({
            code: 'STOCK_TRANSFER_NOT_FOUND',
            message: 'Stock transfer not found',
          });
        if (outcome.outcome === 'version_conflict')
          throw new ConflictException({
            code: 'VERSION_CONFLICT',
            message: 'Stock transfer changed during the operation',
            fields: { currentVersion: [String(outcome.currentVersion)] },
          });
      }
      return result;
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
      const code = error instanceof Error ? error.message : 'INVALID_STOCK_TRANSFER';
      const conflicts = [
        'STOCK_TRANSFER_SAME_POINT',
        'STOCK_TRANSFER_POINT_OUT_OF_SCOPE',
        'STOCK_TRANSFER_LINE_OUT_OF_SCOPE',
        'STOCK_TRANSFER_FROZEN',
        'STOCK_TRANSFER_INVALID_STATUS',
        'STOCK_TRANSFER_INSUFFICIENT_BALANCE',
        'STOCK_TRANSFER_EXPIRED_STOCK',
        'STOCK_TRANSFER_CANCEL_NOT_ALLOWED',
        'STOCK_TRANSFER_LINES_REQUIRED',
      ];
      if (conflicts.includes(code)) throw new ConflictException({ code, message: code });
      throw new BadRequestException({ code, message: code });
    }
  }
}
