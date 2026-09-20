import * as XLSX from 'xlsx';
import { normalizeDeliveryPointCode, parseCumProductIdentity } from '@authorization/domain';

export type ProductDeliveryPointImportRow = Readonly<{
  rowNumber: number;
  cumCode: string;
  invimaRecord: string;
  invimaPresentation: string;
  serviceModel: string | null;
  siteName: string;
  siteCode: string;
}>;

export type ProductDeliveryPointWorkbook = Readonly<{
  rows: readonly ProductDeliveryPointImportRow[];
  duplicateRows: number;
}>;

export class ProductDeliveryPointFileError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly rowNumbers: readonly number[] = [],
  ) {
    super(message);
    this.name = 'ProductDeliveryPointFileError';
  }
}

function text(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function normalizeHeader(value: unknown): string {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function parseProductDeliveryPointWorkbook(content: Buffer): ProductDeliveryPointWorkbook {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(content, {
      type: 'buffer',
      raw: true,
      cellFormula: true,
      cellHTML: false,
    });
  } catch {
    throw new ProductDeliveryPointFileError(
      'DELIVERY_POINT_IMPORT_INVALID_FILE',
      'El archivo no es un XLSX válido.',
    );
  }

  const workbookWithVba = workbook as XLSX.WorkBook & {
    vbaraw?: unknown;
  };

  if (workbookWithVba.vbaraw) {
    throw new ProductDeliveryPointFileError(
      'DELIVERY_POINT_IMPORT_MACROS_NOT_ALLOWED',
      'El archivo no puede contener macros.',
    );
  }

  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new ProductDeliveryPointFileError(
      'DELIVERY_POINT_IMPORT_EMPTY_FILE',
      'El archivo no contiene hojas.',
    );
  }

  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new ProductDeliveryPointFileError(
      'DELIVERY_POINT_IMPORT_EMPTY_FILE',
      'La primera hoja no está disponible.',
    );
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
  });

  const headerRow = matrix[0];

  if (!headerRow) {
    throw new ProductDeliveryPointFileError(
      'DELIVERY_POINT_IMPORT_EMPTY_FILE',
      'El archivo no contiene encabezados.',
    );
  }

  const headers = headerRow.map(normalizeHeader);

  const cumIndex = headers.indexOf('CODIGO_CUM_FINAL');
  const modelIndex = headers.indexOf('MODELO');
  const siteIndex = headers.indexOf('SEDE_ENTREGA');

  if (cumIndex < 0 || siteIndex < 0) {
    throw new ProductDeliveryPointFileError(
      'DELIVERY_POINT_IMPORT_HEADERS_INVALID',
      'Se requieren las columnas Código CUM Final y SEDE ENTREGA.',
    );
  }

  const parsed: ProductDeliveryPointImportRow[] = [];
  const invalidRows: number[] = [];

  for (let index = 1; index < matrix.length; index += 1) {
    const row = matrix[index] ?? [];
    const rowNumber = index + 1;

    const cumRaw = row[cumIndex];
    const siteName = text(row[siteIndex]);
    const serviceModel = modelIndex >= 0 ? text(row[modelIndex]) : '';

    const entirelyEmpty = row.every((value) => text(value) === '');

    if (entirelyEmpty) {
      continue;
    }

    const identity = parseCumProductIdentity(cumRaw);
    const siteCode = normalizeDeliveryPointCode(siteName);

    if (!identity || !siteName || !siteCode) {
      invalidRows.push(rowNumber);
      continue;
    }

    parsed.push({
      rowNumber,
      cumCode: identity.cumCode,
      invimaRecord: identity.invimaRecord,
      invimaPresentation: identity.invimaPresentation,
      serviceModel: serviceModel || null,
      siteName,
      siteCode,
    });
  }

  if (invalidRows.length > 0) {
    throw new ProductDeliveryPointFileError(
      'DELIVERY_POINT_IMPORT_INVALID_ROWS',
      `Hay filas con CUM o sede inválidos: ${invalidRows.join(', ')}`,
      invalidRows,
    );
  }

  if (parsed.length === 0) {
    throw new ProductDeliveryPointFileError(
      'DELIVERY_POINT_IMPORT_EMPTY_FILE',
      'El archivo no contiene relaciones válidas.',
    );
  }

  const unique = new Map<string, ProductDeliveryPointImportRow>();
  let duplicateRows = 0;

  for (const row of parsed) {
    const key = `${row.invimaRecord}:${row.invimaPresentation}`;
    const previous = unique.get(key);

    if (!previous) {
      unique.set(key, row);
      continue;
    }

    if (previous.siteCode !== row.siteCode) {
      throw new ProductDeliveryPointFileError(
        'DELIVERY_POINT_IMPORT_CONFLICT',
        `La identidad ${key} aparece asociada a más de una sede.`,
        [previous.rowNumber, row.rowNumber],
      );
    }

    duplicateRows += 1;
  }

  return {
    rows: [...unique.values()],
    duplicateRows,
  };
}
