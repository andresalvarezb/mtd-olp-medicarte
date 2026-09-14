import { Injectable, NotFoundException } from '@nestjs/common';
import type { Scope } from '../common/request-scope';
import { InventoryRepository } from './inventory.repository';

@Injectable()
export class InventoryService {
  constructor(private readonly repository: InventoryRepository) {}
  list(
    scope: Scope,
    filters: {
      commercialCode?: string | undefined;
      dispensingPointId?: string | undefined;
      lotNumber?: string | undefined;
      expiration?: string | undefined;
      usable?: boolean | undefined;
    },
  ) {
    return this.repository.list(scope, filters);
  }
  async detail(id: string, scope: Scope) {
    const lot = await this.repository.detail(id, scope);
    if (!lot)
      throw new NotFoundException({
        code: 'INVENTORY_LOT_NOT_FOUND',
        message: 'Inventory lot not found',
      });
    return lot;
  }
  movements(id: string) {
    return this.repository.movements(id);
  }
  fefo(scope: Scope, commercialCode: string, dispensingPointId: string) {
    return this.repository.fefo(scope, commercialCode, dispensingPointId);
  }
}
