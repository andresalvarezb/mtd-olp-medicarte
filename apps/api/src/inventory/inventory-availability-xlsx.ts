import * as XLSX from 'xlsx';

export const INVENTORY_AVAILABILITY_TEMPLATE_VERSION = 'INVENTORY_AVAILABILITY_OC_V1';

export const INVENTORY_AVAILABILITY_SHEET = 'Asignaciones';

export const INVENTORY_AVAILABILITY_METADATA_SHEET = 'METADATA';

export const INVENTORY_AVAILABILITY_COLUMNS = [
  'CLAVE_AUTORIZACION',
  'OC',
  'CANTIDAD_PRODUCTO',
] as const;

export type InventoryAvailabilityImportRow = Readonly<{
  rowNumber: number;
  authorizationKey: string;
  purchaseOrderCode: string;
  requestedQuantity: number;
  rawPayload: Record<string, unknown>;
}>;

function textValue(value: unknown): string {
  if (value === null || value === undefined) {
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

function quantityValue(value: unknown): number {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error('INVENTORY_AVAILABILITY_INVALID_QUANTITY');
  }

  return number;
}

export function buildInventoryAvailabilityTemplate(): Buffer {
  const workbook = XLSX.utils.book_new();

  const assignments = XLSX.utils.aoa_to_sheet([[...INVENTORY_AVAILABILITY_COLUMNS]]);

  assignments['!cols'] = [
    {
      wch: 34,
    },
    {
      wch: 24,
    },
    {
      wch: 20,
    },
  ];

  XLSX.utils.book_append_sheet(workbook, assignments, INVENTORY_AVAILABILITY_SHEET);

  const metadata = XLSX.utils.aoa_to_sheet([
    ['TEMPLATE_VERSION', INVENTORY_AVAILABILITY_TEMPLATE_VERSION],
    ['DESCRIPTION', 'Asignación de inventario de OC a autorización'],
  ]);

  XLSX.utils.book_append_sheet(workbook, metadata, INVENTORY_AVAILABILITY_METADATA_SHEET);

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
}

export function parseInventoryAvailabilityWorkbook(
  content: Buffer,
): InventoryAvailabilityImportRow[] {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(content, {
      type: 'buffer',
      bookVBA: true,
      cellDates: false,
    });
  } catch {
    throw new Error('INVENTORY_AVAILABILITY_INVALID_XLSX');
  }

  if (
    (
      workbook as XLSX.WorkBook & {
        vbaraw?: unknown;
      }
    ).vbaraw
  ) {
    throw new Error('INVENTORY_AVAILABILITY_MACRO_NOT_ALLOWED');
  }

  const sheet = workbook.Sheets[INVENTORY_AVAILABILITY_SHEET];

  const metadata = workbook.Sheets[INVENTORY_AVAILABILITY_METADATA_SHEET];

  if (!sheet || !metadata) {
    throw new Error('INVENTORY_AVAILABILITY_TEMPLATE_INVALID');
  }

  const metadataRows = XLSX.utils.sheet_to_json<unknown[]>(metadata, {
    header: 1,
    raw: false,
    blankrows: false,
  });

  const version = metadataRows.find((row) => textValue(row[0]) === 'TEMPLATE_VERSION');

  if (textValue(version?.[1]) !== INVENTORY_AVAILABILITY_TEMPLATE_VERSION) {
    throw new Error('INVENTORY_AVAILABILITY_TEMPLATE_VERSION_UNSUPPORTED');
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
  });

  if (rows.length === 0) {
    throw new Error('INVENTORY_AVAILABILITY_TEMPLATE_EMPTY');
  }

  const header = rows[0]!.map(textValue);

  if (
    header.length < INVENTORY_AVAILABILITY_COLUMNS.length ||
    INVENTORY_AVAILABILITY_COLUMNS.some((column, index) => header[index] !== column)
  ) {
    throw new Error('INVENTORY_AVAILABILITY_HEADERS_INVALID');
  }

  const dataRows = rows.slice(1);

  if (dataRows.length > 5000) {
    throw new Error('INVENTORY_AVAILABILITY_ROW_LIMIT_EXCEEDED');
  }

  const result: InventoryAvailabilityImportRow[] = [];

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index]!;

    const authorizationKey = textValue(row[0]);

    const purchaseOrderCode = textValue(row[1]);

    const rawQuantity = row[2];

    if (!authorizationKey && !purchaseOrderCode && textValue(rawQuantity) === '') {
      continue;
    }

    if (!authorizationKey || !purchaseOrderCode) {
      throw new Error('INVENTORY_AVAILABILITY_REQUIRED_FIELD_MISSING');
    }

    const requestedQuantity = quantityValue(rawQuantity);

    result.push({
      rowNumber: index + 2,

      authorizationKey,

      purchaseOrderCode,

      requestedQuantity,

      rawPayload: {
        CLAVE_AUTORIZACION: authorizationKey,

        OC: purchaseOrderCode,

        CANTIDAD_PRODUCTO: requestedQuantity,
      },
    });
  }

  if (result.length === 0) {
    throw new Error('INVENTORY_AVAILABILITY_NO_ROWS');
  }

  return result;
}
