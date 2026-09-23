import * as XLSX from 'xlsx';

import type {
  AuthorizationFulfillmentType,
} from '@authorization/domain';


/*
 * Contrato oficial:
 * CLAVE_AUTORIZACION,TIPO_DISPENSACION,FECHA
 */
export const AUTHORIZATION_FULFILLMENT_XLSX_COLUMNS = [
  'CLAVE_AUTORIZACION',
  'TIPO_DISPENSACION',
  'FECHA',
] as const;

export const AUTHORIZATION_FULFILLMENT_XLSX_SHEET =
  'ENTREGA_APLICACION';


export type AuthorizationFulfillmentImportRow =
  Readonly<{
    rowNumber: number;

    authorizationKey:
      string | null;

    fulfillmentType:
      AuthorizationFulfillmentType | null;

    rawFulfillmentType:
      string | null;

    effectiveDate:
      string | null;
  }>;


export class AuthorizationFulfillmentXlsxError
  extends Error {
  constructor(
    public readonly code:
      string,

    message:
      string,
  ) {
    super(message);

    this.name =
      'AuthorizationFulfillmentXlsxError';
  }
}


function text(
  value:
    unknown,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  return normalized || null;
}


function header(
  value:
    unknown,
): string {
  return String(
    value ?? '',
  )
    .replace(/^\uFEFF/, '')
    .trim()
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      '',
    )
    .replace(
      /[^A-Z0-9_]+/gi,
      '_',
    )
    .replace(
      /_+/g,
      '_',
    )
    .replace(
      /^_+|_+$/g,
      '',
    )
    .toUpperCase();
}


function isIsoDate(
  value:
    string,
): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    return false;
  }

  const date =
    new Date(
      `${value}T00:00:00Z`,
    );

  return (
    !Number.isNaN(
      date.getTime(),
    ) &&
    date
      .toISOString()
      .slice(0, 10) ===
      value
  );
}


function parseDate(
  value:
    unknown,
): string | null {
  if (
    value instanceof Date &&
    !Number.isNaN(
      value.getTime(),
    )
  ) {
    const result =
      [
        String(
          value.getUTCFullYear(),
        ).padStart(4, '0'),

        String(
          value.getUTCMonth() + 1,
        ).padStart(2, '0'),

        String(
          value.getUTCDate(),
        ).padStart(2, '0'),
      ].join('-');

    return isIsoDate(result)
      ? result
      : null;
  }


  if (
    typeof value === 'number' &&
    Number.isFinite(value)
  ) {
    const parsed =
      XLSX.SSF.parse_date_code(
        value,
      );

    if (!parsed) {
      return null;
    }

    const result =
      [
        String(parsed.y)
          .padStart(4, '0'),

        String(parsed.m)
          .padStart(2, '0'),

        String(parsed.d)
          .padStart(2, '0'),
      ].join('-');

    return isIsoDate(result)
      ? result
      : null;
  }


  const normalized =
    text(value);

  if (!normalized) {
    return null;
  }


  if (
    isIsoDate(normalized)
  ) {
    return normalized;
  }


  const colombian =
    /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(
      normalized,
    );

  if (!colombian) {
    return null;
  }


  const result =
    `${colombian[3]}-${colombian[2]}-${colombian[1]}`;

  return isIsoDate(result)
    ? result
    : null;
}


function parseType(
  value:
    unknown,
): AuthorizationFulfillmentType | null {
  const raw =
    text(value);

  if (!raw) {
    return null;
  }

  const normalized =
    raw
      .normalize('NFD')
      .replace(
        /[\u0300-\u036f]/g,
        '',
      )
      .trim()
      .toUpperCase();


  if (
    normalized === 'ENTREGA' ||
    normalized === 'DELIVERY'
  ) {
    return 'DELIVERY';
  }


  if (
    normalized === 'APLICACION' ||
    normalized === 'APPLICATION'
  ) {
    return 'APPLICATION';
  }


  return null;
}


export function createAuthorizationFulfillmentTemplate():
  Buffer {
  const workbook =
    XLSX.utils.book_new();

  const sheet =
    XLSX.utils.aoa_to_sheet([
      [
        ...AUTHORIZATION_FULFILLMENT_XLSX_COLUMNS,
      ],
    ]);

  sheet['!cols'] = [
    { wch: 42 },
    { wch: 22 },
    { wch: 18 },
  ];

  XLSX.utils.book_append_sheet(
    workbook,
    sheet,
    AUTHORIZATION_FULFILLMENT_XLSX_SHEET,
  );

  const output =
    XLSX.write(
      workbook,
      {
        type: 'buffer',
        bookType: 'xlsx',
      },
    );

  return Buffer.isBuffer(output)
    ? output
    : Buffer.from(
        output as Uint8Array,
      );
}


export function parseAuthorizationFulfillmentWorkbook(
  content:
    Buffer,
): AuthorizationFulfillmentImportRow[] {
  let workbook:
    XLSX.WorkBook;

  try {
    workbook =
      XLSX.read(
        content,
        {
          type: 'buffer',
          raw: true,
          cellDates: true,
        },
      );
  } catch {
    throw new AuthorizationFulfillmentXlsxError(
      'AUTHORIZATION_FULFILLMENT_INVALID_XLSX',
      'El archivo no es un XLSX válido.',
    );
  }


  const sheetName =
    workbook.SheetNames[0];

  if (!sheetName) {
    throw new AuthorizationFulfillmentXlsxError(
      'AUTHORIZATION_FULFILLMENT_EMPTY_WORKBOOK',
      'El archivo no contiene una hoja de datos.',
    );
  }


  const sheet =
    workbook.Sheets[
      sheetName
    ];

  if (!sheet) {
    throw new AuthorizationFulfillmentXlsxError(
      'AUTHORIZATION_FULFILLMENT_SHEET_NOT_FOUND',
      'No fue posible leer la hoja de Entrega/Aplicación.',
    );
  }


  const matrix =
    XLSX.utils.sheet_to_json<
      unknown[]
    >(
      sheet,
      {
        header: 1,
        raw: true,
        defval: null,
        blankrows: false,
      },
    );


  const firstRow =
    matrix[0];

  if (!firstRow) {
    throw new AuthorizationFulfillmentXlsxError(
      'AUTHORIZATION_FULFILLMENT_HEADERS_REQUIRED',
      'El archivo no contiene encabezados.',
    );
  }


  const headers =
    firstRow.map(header);


  if (
    headers.length !==
      AUTHORIZATION_FULFILLMENT_XLSX_COLUMNS.length ||
    AUTHORIZATION_FULFILLMENT_XLSX_COLUMNS.some(
      (
        expected,
        index,
      ) =>
        headers[index] !==
        expected,
    )
  ) {
    throw new AuthorizationFulfillmentXlsxError(
      'AUTHORIZATION_FULFILLMENT_HEADERS_INVALID',
      `Los encabezados deben ser exactamente: ${AUTHORIZATION_FULFILLMENT_XLSX_COLUMNS.join(
        ', ',
      )}.`,
    );
  }


  const rows:
    AuthorizationFulfillmentImportRow[] = [];


  for (
    let index = 1;
    index < matrix.length;
    index += 1
  ) {
    const values =
      matrix[index] ?? [];

    const authorizationKey =
      text(values[0]);

    const rawFulfillmentType =
      text(values[1]);

    const rawDate =
      values[2];


    const hasDate =
      rawDate !== null &&
      rawDate !== undefined &&
      String(rawDate).trim() !== '';


    if (
      !authorizationKey &&
      !rawFulfillmentType &&
      !hasDate
    ) {
      continue;
    }


    rows.push({
      rowNumber:
        index + 1,

      authorizationKey,

      rawFulfillmentType,

      fulfillmentType:
        parseType(
          rawFulfillmentType,
        ),

      effectiveDate:
        parseDate(
          rawDate,
        ),
    });
  }


  return rows;
}
