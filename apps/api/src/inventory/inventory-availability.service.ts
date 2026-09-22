import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { Scope } from '../common/request-scope';

import {
  InventoryAvailabilityRepository,
  type AllocationRequest,
  type AvailabilityFilters,
} from './inventory-availability.repository';

import { parseInventoryAvailabilityWorkbook } from './inventory-availability-xlsx';

@Injectable()
export class InventoryAvailabilityService {
  constructor(private readonly repository: InventoryAvailabilityRepository) {}

  private requireMtd(scope: Scope) {
    if (scope.organizationCode !== 'MTD') {
      throw new ForbiddenException({
        code: 'INVENTORY_ALLOCATION_MTD_ONLY',
      });
    }
  }

  list(scope: Scope, filters: AvailabilityFilters) {
    this.requireMtd(scope);

    return this.repository.list(scope, filters);
  }

  assign(scope: Scope, assignments: readonly AllocationRequest[]) {
    this.requireMtd(scope);

    if (assignments.length === 0) {
      throw new BadRequestException({
        code: 'INVENTORY_ALLOCATION_LINES_REQUIRED',
      });
    }

    return this.run(() => this.repository.assignBatch(scope, assignments, 'UI'));
  }

  prepareImport(
    scope: Scope,
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
    sha256: string,
  ) {
    this.requireMtd(scope);

    const rows = parseInventoryAvailabilityWorkbook(file.buffer);

    return this.run(() =>
      this.repository.prepareImport(
        scope,
        {
          originalname: file.originalname,

          mimetype: file.mimetype,

          size: file.size,

          sha256,

          content: file.buffer,
        },
        rows,
      ),
    );
  }

  async importDetail(scope: Scope, id: string) {
    this.requireMtd(scope);

    const result = await this.repository.importDetail(scope, id);

    if (!result) {
      throw new NotFoundException({
        code: 'INVENTORY_ALLOCATION_BATCH_NOT_FOUND',
      });
    }

    return result;
  }

  confirmImport(scope: Scope, id: string) {
    this.requireMtd(scope);

    return this.run(() => this.repository.confirmImport(scope, id));
  }

  reconcile(scope: Scope) {
    this.requireMtd(scope);

    return this.run(() => this.repository.reconcile(scope));
  }

  private async run<T>(callback: () => Promise<T>): Promise<T> {
    try {
      return await callback();
    } catch (error) {
      const code = error instanceof Error ? error.message : 'INVENTORY_ALLOCATION_INVALID';

      const conflict = new Set([
        'INVENTORY_ALLOCATION_DUPLICATE_IMPORT',
        'INVENTORY_ALLOCATION_IMPORT_INVALID_ROWS',
        'INVENTORY_ALLOCATION_BATCH_FROZEN',
        'INVENTORY_ALLOCATION_EXCEEDS_AUTHORIZATION_PENDING',
        'INVENTORY_ALLOCATION_INSUFFICIENT',
      ]);

      const notFound = new Set([
        'INVENTORY_ALLOCATION_BATCH_NOT_FOUND',
        'INVENTORY_ALLOCATION_AUTHORIZATION_NOT_FOUND',
        'INVENTORY_ALLOCATION_OC_PRODUCT_NOT_FOUND',
      ]);

      if (conflict.has(code)) {
        throw new ConflictException({
          code,
          message: code,
        });
      }

      if (notFound.has(code)) {
        throw new NotFoundException({
          code,
          message: code,
        });
      }

      throw new BadRequestException({
        code,
        message: code,
      });
    }
  }
}
