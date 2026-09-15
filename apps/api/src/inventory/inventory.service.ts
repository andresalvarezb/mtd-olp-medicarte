import { Injectable, NotFoundException } from '@nestjs/common';
import { PointAccessDeniedError } from '@authorization/domain';
import type { Scope } from '../common/request-scope';
import { pointAccessDeniedException } from '../common/point-access';
import { OperationalAccessScopeService } from '../access-scopes/operational-access-scope.service';
import { InventoryRepository } from './inventory.repository';

@Injectable()
export class InventoryService {
  constructor(
    private readonly repository: InventoryRepository,
    private readonly pointAccess: OperationalAccessScopeService,
  ) {}
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
    await this.assertPoint(scope, String(lot.dispensingPointId));
    return lot;
  }
  movements(id: string) {
    return this.repository.movements(id);
  }
  async fefo(scope: Scope, commercialCode: string, dispensingPointId: string) {
    await this.assertPoint(scope, dispensingPointId);
    return this.repository.fefo(scope, commercialCode, dispensingPointId);
  }
  private async assertPoint(scope: Scope, pointId: string): Promise<void> {
    try {
      await this.pointAccess.assertCanAccessPoint(scope, pointId);
    } catch (error) {
      if (error instanceof PointAccessDeniedError) throw pointAccessDeniedException();
      throw error;
    }
  }
}
