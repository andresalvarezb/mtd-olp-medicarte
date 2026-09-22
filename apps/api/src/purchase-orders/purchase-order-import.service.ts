import {
  BadRequestException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import {
  BULK_IMPORT_MAX_FILE_BYTES,
  BULK_IMPORT_MAX_ROWS,
} from '@authorization/contracts';
import { z } from 'zod';
import * as XLSX from 'xlsx';

import type { Scope } from '../common/request-scope';
import { PurchaseOrderService } from './purchase-order.service';

const TEMPLATE_VERSION =
  'PURCHASE_ORDERS_V1';

const REQUIRED_COLUMNS = [
  'CODIGO_OC',
  'PERIODO_ID',
  'TIPO_OC',
  'CODIGO_COMERCIAL',
  'CANTIDAD',
] as const;

type ImportFile = Readonly<{
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}>;

type ParsedRow = {
  rowNumber: number;
  raw: Record<string, unknown>;
  code: string;
  planningPeriodId: string;
  orderType:
    | 'STANDARD'
    | 'COMPLEMENTARY';
  commercialCode: string;
  quantity: number;
  requestedDeliveryDate: string | null;
};

type RowResult = {
  rowNumber: number;
  status: 'ACCEPTED' | 'REJECTED';
  code: string;
  planningPeriodId: string;
  orderType: string;
  commercialCode: string;
  quantity: number | null;
  requestedDeliveryDate: string | null;
  purchaseOrderId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  raw: Record<string, unknown>;
};

type AvailableDemand = {
  id: string;
  commercialCode: string;
  deliveryPointMapped: boolean;
  revision: number;
  regularAvailable: number;
  lateAvailable: number;
};

const uuid = z.string().uuid();

@Injectable()
export class PurchaseOrderImportService {
  constructor(
    private readonly orders:
      PurchaseOrderService,
  ) {}

  buildTemplate(): Buffer {
    const workbook =
      XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        [
          'CODIGO_OC',
          'PERIODO_ID',
          'TIPO_OC',
          'CODIGO_COMERCIAL',
          'CANTIDAD',
          'FECHA_ENTREGA',
        ],
      ]),
      'OrdenesCompra',
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['KEY', 'VALUE'],
        ['templateVersion', TEMPLATE_VERSION],
        ['importType', 'PURCHASE_ORDERS'],
      ]),
      'METADATA',
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        [
          'CAMPO',
          'OBLIGATORIO',
          'DESCRIPCION',
        ],
        [
          'CODIGO_OC',
          'SI',
          'Código de la orden de compra. Repetirlo cuando una OC tenga varias líneas.',
        ],
        [
          'PERIODO_ID',
          'SI',
          'UUID del período de planificación al que pertenece la OC.',
        ],
        [
          'TIPO_OC',
          'SI',
          'STANDARD para demanda regular o COMPLEMENTARY para demanda tardía.',
        ],
        [
          'CODIGO_COMERCIAL',
          'SI',
          'Código comercial del producto.',
        ],
        [
          'CANTIDAD',
          'SI',
          'Cantidad entera positiva a solicitar.',
        ],
        [
          'FECHA_ENTREGA',
          'NO',
          'Fecha AAAA-MM-DD. En el modelo moderno puede quedar vacía.',
        ],
        [
          'IMPORTANTE',
          '',
          'No incluir tarifas ni costos. El sistema toma los snapshots contractuales internamente.',
        ],
      ]),
      'Instrucciones',
    );

    return XLSX.write(
      workbook,
      {
        type: 'buffer',
        bookType: 'xlsx',
      },
    ) as Buffer;
  }

  async import(
    file: ImportFile | undefined,
    actor: Scope,
  ) {
    const parsed =
      this.parseFile(
        this.assertFile(file),
      );

    const results: RowResult[] = [];

    const groups =
      new Map<string, ParsedRow[]>();

    for (const row of parsed) {
      const current =
        groups.get(row.code) ?? [];

      current.push(row);
      groups.set(row.code, current);
    }

    const orderedGroups =
      [...groups.entries()]
        .sort(
          ([, a], [, b]) =>
            a[0]!.rowNumber -
            b[0]!.rowNumber,
        );

    for (const [code, rows] of orderedGroups) {
      await this.processGroup(
        code,
        rows,
        actor,
        results,
      );
    }

    results.sort(
      (a, b) =>
        a.rowNumber - b.rowNumber,
    );

    const rejected =
      results.filter(
        (row) =>
          row.status === 'REJECTED',
      );

    const accepted =
      results.filter(
        (row) =>
          row.status === 'ACCEPTED',
      );

    const createdOrderIds =
      new Set(
        accepted
          .map((row) => row.purchaseOrderId)
          .filter(
            (value): value is string =>
              Boolean(value),
          ),
      );

    return {
      totalRows: results.length,
      acceptedRows: accepted.length,
      rejectedRows: rejected.length,
      createdOrders:
        createdOrderIds.size,

      results:
        results.map((row) => ({
          rowNumber: row.rowNumber,
          status: row.status,
          purchaseOrderCode: row.code,
          planningPeriodId:
            row.planningPeriodId,
          orderType: row.orderType,
          commercialCode:
            row.commercialCode,
          quantity: row.quantity,
          requestedDeliveryDate:
            row.requestedDeliveryDate,
          purchaseOrderId:
            row.purchaseOrderId,
          errorCode: row.errorCode,
          errorMessage:
            row.errorMessage,
        })),

      rejectedWorkbookBase64:
        rejected.length > 0
          ? this.buildRejectedWorkbook(
              rejected,
            ).toString('base64')
          : null,
    };
  }

  private async processGroup(
    code: string,
    rows: ParsedRow[],
    actor: Scope,
    results: RowResult[],
  ) {
    const first = rows[0]!;

    const conflictingHeader =
      rows.some(
        (row) =>
          row.planningPeriodId !==
            first.planningPeriodId ||
          row.orderType !==
            first.orderType,
      );

    if (conflictingHeader) {
      this.rejectGroup(
        rows,
        results,
        'PURCHASE_ORDER_GROUP_CONFLICT',
        'Las líneas con el mismo CODIGO_OC deben tener el mismo PERIODO_ID y TIPO_OC.',
      );
      return;
    }

    const duplicatedProducts =
      new Set<string>();

    const seen =
      new Set<string>();

    for (const row of rows) {
      if (seen.has(row.commercialCode)) {
        duplicatedProducts.add(
          row.commercialCode,
        );
      }

      seen.add(row.commercialCode);
    }

    if (duplicatedProducts.size > 0) {
      this.rejectGroup(
        rows,
        results,
        'PURCHASE_ORDER_DUPLICATE_PRODUCT',
        `Una OC no puede repetir un mismo código comercial. Duplicados: ${[
          ...duplicatedProducts,
        ].join(', ')}`,
      );
      return;
    }

    let available:
      AvailableDemand[];

    try {
      available =
        (await this.orders.available(
          first.planningPeriodId,
        )) as AvailableDemand[];
    } catch (error) {
      const mapped =
        this.mapError(error);

      this.rejectGroup(
        rows,
        results,
        mapped.code,
        mapped.message,
      );

      return;
    }

    const lines: Array<{
      projectedDemandLineId: string;
      expectedDemandRevision: number;
      requestedQuantity: number;
      requestedDeliveryDate?: string;
      demandBucket:
        | 'REGULAR'
        | 'LATE';
    }> = [];

    for (const row of rows) {
      const candidates =
        available.filter(
          (candidate) =>
            candidate.commercialCode ===
            row.commercialCode,
        );

      if (candidates.length === 0) {
        this.rejectGroup(
          rows,
          results,
          'PURCHASE_DEMAND_NOT_FOUND',
          `No existe demanda disponible para ${row.commercialCode} en el período seleccionado.`,
        );
        return;
      }

      if (candidates.length > 1) {
        this.rejectGroup(
          rows,
          results,
          'PURCHASE_DEMAND_AMBIGUOUS',
          `Existe más de una línea de demanda disponible para ${row.commercialCode}.`,
        );
        return;
      }

      const demand =
        candidates[0]!;

      if (!demand.deliveryPointMapped) {
        this.rejectGroup(
          rows,
          results,
          'DELIVERY_POINT_MAPPING_MISSING',
          `El producto ${row.commercialCode} no tiene un punto Medicarte configurado.`,
        );
        return;
      }

      const bucket =
        row.orderType === 'STANDARD'
          ? 'REGULAR'
          : 'LATE';

      const availableQuantity =
        bucket === 'REGULAR'
          ? Number(
              demand.regularAvailable,
            )
          : Number(
              demand.lateAvailable,
            );

      if (
        row.quantity >
        availableQuantity
      ) {
        this.rejectGroup(
          rows,
          results,
          'PURCHASE_ORDER_DEMAND_EXCEEDS_AVAILABLE',
          `Cantidad solicitada ${row.quantity} para ${row.commercialCode}; disponible ${availableQuantity}.`,
        );
        return;
      }

      lines.push({
        projectedDemandLineId:
          demand.id,

        expectedDemandRevision:
          Number(demand.revision),

        requestedQuantity:
          row.quantity,

        demandBucket:
          bucket,

        ...(row.requestedDeliveryDate
          ? {
              requestedDeliveryDate:
                row.requestedDeliveryDate,
            }
          : {}),
      });
    }

    try {
      const created =
        (await this.orders.create(
          {
            planningPeriodId:
              first.planningPeriodId,

            orderType:
              first.orderType,

            purchaseOrderCode:
              code,

            lines,
          },
          actor,
        )) as {
          id: string;
        };

      for (const row of rows) {
        results.push({
          rowNumber: row.rowNumber,
          status: 'ACCEPTED',
          code: row.code,
          planningPeriodId:
            row.planningPeriodId,
          orderType: row.orderType,
          commercialCode:
            row.commercialCode,
          quantity: row.quantity,
          requestedDeliveryDate:
            row.requestedDeliveryDate,
          purchaseOrderId:
            created.id,
          errorCode: null,
          errorMessage: null,
          raw: row.raw,
        });
      }
    } catch (error) {
      const mapped =
        this.mapError(error);

      this.rejectGroup(
        rows,
        results,
        mapped.code,
        mapped.message,
      );
    }
  }

  private rejectGroup(
    rows: ParsedRow[],
    results: RowResult[],
    errorCode: string,
    errorMessage: string,
  ) {
    for (const row of rows) {
      results.push({
        rowNumber: row.rowNumber,
        status: 'REJECTED',
        code: row.code,
        planningPeriodId:
          row.planningPeriodId,
        orderType: row.orderType,
        commercialCode:
          row.commercialCode,
        quantity: row.quantity,
        requestedDeliveryDate:
          row.requestedDeliveryDate,
        purchaseOrderId: null,
        errorCode,
        errorMessage,
        raw: row.raw,
      });
    }
  }

  private assertFile(
    file: ImportFile | undefined,
  ): ImportFile {
    if (!file) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_FILE_REQUIRED',
        message:
          'Debe seleccionar un archivo XLSX.',
      });
    }

    if (
      file.size <= 0 ||
      file.size >
        BULK_IMPORT_MAX_FILE_BYTES
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_FILE_SIZE_INVALID',
        message:
          'El archivo está vacío o supera el tamaño permitido.',
      });
    }

    if (
      !/\.xlsx$/i.test(
        file.originalname,
      )
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_INVALID_FORMAT',
        message:
          'Solo se permiten archivos .xlsx.',
      });
    }

    return file;
  }

  private parseFile(
    file: ImportFile,
  ): ParsedRow[] {
    if (
      file.buffer.length < 4 ||
      file.buffer[0] !== 0x50 ||
      file.buffer[1] !== 0x4b
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_INVALID_FORMAT',
        message:
          'El archivo no es un XLSX válido.',
      });
    }

    let workbook: XLSX.WorkBook;

    try {
      workbook =
        XLSX.read(
          file.buffer,
          {
            type: 'buffer',
            raw: true,
            cellFormula: true,
            cellHTML: false,
          },
        );
    } catch {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_INVALID_FORMAT',
        message:
          'No fue posible leer el XLSX.',
      });
    }

    if (
      workbook.SheetNames.length > 5
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_TOO_MANY_SHEETS',
        message:
          'El archivo contiene demasiadas hojas.',
      });
    }

    for (
      const sheet
      of Object.values(
        workbook.Sheets,
      )
    ) {
      if (!sheet) continue;

      for (
        const cell
        of (Object.values(sheet) as unknown[])
      ) {
        if (
          cell !== null &&
          typeof cell === 'object' &&
          'f' in cell &&
          typeof cell.f === 'string' &&
          cell.f.length > 0
        ) {
          throw new BadRequestException({
            code:
              'PURCHASE_ORDER_IMPORT_FORMULA_NOT_ALLOWED',
            message:
              'No se permiten fórmulas en el archivo.',
          });
        }
      }
    }

    const metadata =
      workbook.Sheets.METADATA;

    if (!metadata) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_TEMPLATE_REQUIRED',
        message:
          'El archivo no contiene la hoja METADATA.',
      });
    }

    const metadataRows =
      XLSX.utils.sheet_to_json<
        unknown[]
      >(metadata, {
        header: 1,
        raw: true,
        defval: null,
      });

    const meta =
      new Map<string, string>();

    for (
      const row
      of metadataRows
    ) {
      const key =
        this.text(
          row?.[0],
        );

      const value =
        this.text(
          row?.[1],
        );

      if (key) {
        meta.set(key, value);
      }
    }

    if (
      meta.get('templateVersion') !==
        TEMPLATE_VERSION ||
      meta.get('importType') !==
        'PURCHASE_ORDERS'
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_TEMPLATE_INVALID',
        message:
          'La plantilla de OC no corresponde a la versión soportada.',
      });
    }

    const sheet =
      workbook.Sheets
        .OrdenesCompra;

    if (!sheet) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_SHEET_REQUIRED',
        message:
          'No existe la hoja OrdenesCompra.',
      });
    }

    const matrix =
      XLSX.utils.sheet_to_json<
        unknown[]
      >(sheet, {
        header: 1,
        raw: true,
        defval: null,
        blankrows: false,
      });

    const headers =
      (matrix[0] ?? [])
        .map((value) =>
          this.header(value),
        );

    const missing =
      REQUIRED_COLUMNS.filter(
        (column) =>
          !headers.includes(column),
      );

    if (missing.length > 0) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_HEADERS_INVALID',
        message:
          `Faltan columnas: ${missing.join(', ')}`,
      });
    }

    if (
      matrix.length - 1 >
      BULK_IMPORT_MAX_ROWS
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_TOO_MANY_ROWS',
        message:
          `El archivo supera ${BULK_IMPORT_MAX_ROWS} filas.`,
      });
    }

    const rows: ParsedRow[] = [];

    for (
      let index = 1;
      index < matrix.length;
      index += 1
    ) {
      const cells =
        matrix[index];

      if (
        !cells ||
        cells.every(
          (cell) =>
            cell === null ||
            cell === undefined ||
            cell === '',
        )
      ) {
        continue;
      }

      const raw:
        Record<string, unknown> = {};

      for (
        let columnIndex = 0;
        columnIndex <
          headers.length;
        columnIndex += 1
      ) {
        raw[
          headers[columnIndex] ??
            `COLUMNA_${columnIndex + 1}`
        ] =
          cells[columnIndex] ??
          null;
      }

      const code =
        this.text(
          raw.CODIGO_OC,
        );

      const planningPeriodId =
        this.text(
          raw.PERIODO_ID,
        );

      const type =
        this.text(
          raw.TIPO_OC,
        ).toUpperCase();

      const commercialCode =
        this.text(
          raw.CODIGO_COMERCIAL,
        );

      const quantity =
        Number(
          raw.CANTIDAD,
        );

      const dateText =
        this.text(
          raw.FECHA_ENTREGA,
        );

      if (!code) {
        throw this.rowError(
          index + 1,
          'CODIGO_OC',
          'CODIGO_OC es obligatorio.',
        );
      }

      if (
        !uuid.safeParse(
          planningPeriodId,
        ).success
      ) {
        throw this.rowError(
          index + 1,
          'PERIODO_ID',
          'PERIODO_ID debe ser un UUID válido.',
        );
      }

      if (
        type !== 'STANDARD' &&
        type !== 'COMPLEMENTARY'
      ) {
        throw this.rowError(
          index + 1,
          'TIPO_OC',
          'TIPO_OC debe ser STANDARD o COMPLEMENTARY.',
        );
      }

      if (!commercialCode) {
        throw this.rowError(
          index + 1,
          'CODIGO_COMERCIAL',
          'CODIGO_COMERCIAL es obligatorio.',
        );
      }

      if (
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        throw this.rowError(
          index + 1,
          'CANTIDAD',
          'CANTIDAD debe ser un entero positivo.',
        );
      }

      if (
        dateText &&
        !/^\d{4}-\d{2}-\d{2}$/.test(
          dateText,
        )
      ) {
        throw this.rowError(
          index + 1,
          'FECHA_ENTREGA',
          'FECHA_ENTREGA debe tener formato AAAA-MM-DD.',
        );
      }

      rows.push({
        rowNumber:
          index + 1,

        raw,

        code,

        planningPeriodId,

        orderType:
          type,

        commercialCode,

        quantity,

        requestedDeliveryDate:
          dateText || null,
      });
    }

    if (rows.length === 0) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_EMPTY',
        message:
          'La plantilla no contiene filas para procesar.',
      });
    }

    return rows;
  }

  private rowError(
    rowNumber: number,
    column: string,
    message: string,
  ) {
    return new BadRequestException({
      code:
        'PURCHASE_ORDER_IMPORT_ROW_INVALID',

      message:
        `Fila ${rowNumber}, ${column}: ${message}`,
    });
  }

  private header(
    value: unknown,
  ): string {
    return this.text(value)
      .normalize('NFD')
      .replace(
        /[\u0300-\u036f]/g,
        '',
      )
      .replace(
        /[^A-Za-z0-9]+/g,
        '_',
      )
      .replace(
        /^_+|_+$/g,
        '',
      )
      .toUpperCase();
  }

  private text(
    value: unknown,
  ): string {
    if (
      value === null ||
      value === undefined
    ) {
      return '';
    }

    if (typeof value === 'string') {
      return value.trim();
    }

    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value).trim();
    }

    return '';
  }

  private mapError(
    error: unknown,
  ): {
    code: string;
    message: string;
  } {
    if (
      error instanceof HttpException
    ) {
      const response =
        error.getResponse();

      if (
        response &&
        typeof response === 'object'
      ) {
        const payload =
          response as {
            code?: unknown;
            message?: unknown;
          };

        const code =
          typeof payload.code === 'string'
            ? payload.code
            : 'PURCHASE_ORDER_IMPORT_REJECTED';

        const message =
          typeof payload.message === 'string'
            ? payload.message
            : 'La OC fue rechazada por las reglas operacionales.';

        if (
          message.includes(
            'purchase_orders_code_idx',
          ) ||
          message
            .toLowerCase()
            .includes('duplicate key')
        ) {
          return {
            code:
              'PURCHASE_ORDER_CODE_EXISTS',
            message:
              'El código de OC ya existe.',
          };
        }

        return {
          code,
          message,
        };
      }
    }

    const message =
      error instanceof Error
        ? error.message
        : 'Error no controlado al crear la OC.';

    if (
      message.includes(
        'purchase_orders_code_idx',
      ) ||
      message
        .toLowerCase()
        .includes('duplicate key')
    ) {
      return {
        code:
          'PURCHASE_ORDER_CODE_EXISTS',
        message:
          'El código de OC ya existe.',
      };
    }

    return {
      code:
        'PURCHASE_ORDER_IMPORT_REJECTED',
      message,
    };
  }

  private buildRejectedWorkbook(
    rows: RowResult[],
  ): Buffer {
    const baseColumns =
      [
        'CODIGO_OC',
        'PERIODO_ID',
        'TIPO_OC',
        'CODIGO_COMERCIAL',
        'CANTIDAD',
        'FECHA_ENTREGA',
      ];

    const data =
      rows.map((row) => ({
        CODIGO_OC:
          row.code,

        PERIODO_ID:
          row.planningPeriodId,

        TIPO_OC:
          row.orderType,

        CODIGO_COMERCIAL:
          row.commercialCode,

        CANTIDAD:
          row.quantity,

        FECHA_ENTREGA:
          row.requestedDeliveryDate,

        RESULTADO:
          'RECHAZADO',

        CODIGO_ERROR:
          row.errorCode,

        DESCRIPCION_ERROR:
          row.errorMessage,
      }));

    const sheet =
      XLSX.utils.json_to_sheet(
        data,
        {
          header: [
            ...baseColumns,
            'RESULTADO',
            'CODIGO_ERROR',
            'DESCRIPCION_ERROR',
          ],
        },
      );

    const workbook =
      XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      sheet,
      'Rechazadas',
    );

    return XLSX.write(
      workbook,
      {
        type: 'buffer',
        bookType: 'xlsx',
      },
    ) as Buffer;
  }
}
