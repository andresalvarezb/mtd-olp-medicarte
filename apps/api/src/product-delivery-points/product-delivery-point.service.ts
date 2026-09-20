import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Scope } from '../common/request-scope';
import {
  parseProductDeliveryPointWorkbook,
  ProductDeliveryPointFileError,
} from './product-delivery-point-xlsx';
import { ProductDeliveryPointRepository } from './product-delivery-point.repository';

export type UploadedProductDeliveryPointFile = Readonly<{
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}>;

@Injectable()
export class ProductDeliveryPointService {
  constructor(private readonly repository: ProductDeliveryPointRepository) {}

  async import(input: { file: UploadedProductDeliveryPointFile; scope: Scope }) {
    this.assertMtd(input.scope);

    if (!input.file.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException({
        code: 'DELIVERY_POINT_IMPORT_INVALID_FILE',
        message: 'Solo se admiten archivos XLSX.',
      });
    }

    try {
      const parsed = parseProductDeliveryPointWorkbook(input.file.buffer);

      return await this.repository.applyImport({
        rows: parsed.rows,
        duplicateRows: parsed.duplicateRows,
        scope: input.scope,
      });
    } catch (error) {
      if (error instanceof ProductDeliveryPointFileError) {
        throw new BadRequestException({
          code: error.code,
          message: error.message,
          fields:
            error.rowNumbers.length > 0
              ? {
                  rows: error.rowNumbers.map(String),
                }
              : undefined,
        });
      }

      throw error;
    }
  }

  async list(scope: Scope) {
    this.assertMtd(scope);
    return this.repository.list();
  }

  private assertMtd(scope: Scope): void {
    if (scope.organizationCode !== 'MTD') {
      throw new ForbiddenException({
        code: 'MTD_ONLY_OPERATION',
        message: 'La operación está restringida a MTD.',
      });
    }
  }
}
