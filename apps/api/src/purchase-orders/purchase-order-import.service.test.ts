import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import * as XLSX from 'xlsx';

import {
  PurchaseOrderImportService,
} from './purchase-order-import.service';


const scope = {
  organizationId:
    '10000000-0000-4000-8000-000000000001',

  organizationCode:
    'MTD',

  userId:
    '10000000-0000-4000-8000-000000000002',

  correlationId:
    '10000000-0000-4000-8000-000000000003',

  readSensitive:
    true,

  isFoundationAdmin:
    true,

  canCrossOrganizationOperationalExport:
    true,

  pointAccessKind:
    'unrestricted',
} as const;


function workbook(
  rows: unknown[][],
  metadata = true,
): Buffer {
  const book =
    XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet(
      rows,
    ),
    'ORDENES_COMPRA',
  );

  if (
    metadata
  ) {
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        [
          'templateVersion',
          'PURCHASE_ORDERS_V1',
        ],
        [
          'importType',
          'PURCHASE_ORDERS',
        ],
      ]),
      'METADATA',
    );
  }

  return XLSX.write(
    book,
    {
      type:
        'buffer',

      bookType:
        'xlsx',
    },
  ) as Buffer;
}


function uploaded(
  buffer: Buffer,
) {
  return {
    originalname:
      'oc.xlsx',

    mimetype:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

    size:
      buffer.length,

    buffer,
  };
}


function service() {
  const query =
    vi.fn(
      async () => {
        throw new Error(
          'DATABASE_MUST_NOT_BE_TOUCHED',
        );
      },
    );

  return {
    query,

    instance:
      new PurchaseOrderImportService(
        {
          pool: {
            query,
          },
        } as never,

        {} as never,
      ),
  };
}


describe(
  'PurchaseOrderImportService XLSX',
  () => {
    it(
      'genera exactamente las cuatro columnas canónicas',
      () => {
        const {
          instance,
        } =
          service();

        const output =
          instance.buildTemplate();

        const book =
          XLSX.read(
            output,
            {
              type:
                'buffer',
            },
          );

        const sheet =
          book.Sheets[
            'ORDENES_COMPRA'
          ];

        expect(
          sheet,
        ).toBeDefined();

        const matrix =
          XLSX.utils.sheet_to_json<
            unknown[]
          >(
            sheet!,
            {
              header:
                1,
            },
          );

        expect(
          matrix[
            0
          ],
        ).toEqual([
          'CLAVE_AUTORIZACION',
          'OC',
          'CODIGO_PRODUCTO',
          'CANTIDAD',
        ]);


        const metadata =
          XLSX.utils.sheet_to_json<
            unknown[]
          >(
            book.Sheets[
              'METADATA'
            ]!,
            {
              header:
                1,
            },
          );

        expect(
          metadata,
        ).toContainEqual([
          'templateVersion',
          'PURCHASE_ORDERS_V1',
        ]);

        expect(
          metadata,
        ).toContainEqual([
          'importType',
          'PURCHASE_ORDERS',
        ]);
      },
    );


    it(
      'rechaza encabezados diferentes',
      async () => {
        const {
          instance,
          query,
        } =
          service();

        const buffer =
          workbook([
            [
              'OC',
              'CODIGO_PRODUCTO',
              'CANTIDAD',
            ],
            [
              'OC-1',
              'ABC',
              1,
            ],
          ]);


        try {
          await instance.import(
            uploaded(
              buffer,
            ),
            scope,
          );

          throw new Error(
            'EXPECTED_REJECTION',
          );
        } catch (
          error
        ) {
          expect(
            error,
          ).toBeDefined();

          const response =
            (
              error as {
                getResponse?: () => unknown;
              }
            ).getResponse?.();

          expect(
            response,
          ).toMatchObject({
            code:
              'PURCHASE_ORDER_IMPORT_HEADERS_INVALID',
          });
        }


        expect(
          query,
        ).not.toHaveBeenCalled();
      },
    );


    it(
      'rechaza cantidad cero sin tocar base de datos',
      async () => {
        const {
          instance,
          query,
        } =
          service();

        const buffer =
          workbook([
            [
              'CLAVE_AUTORIZACION',
              'OC',
              'CODIGO_PRODUCTO',
              'CANTIDAD',
            ],
            [
              'AUTH-1|ABC',
              'OC-TEST-1',
              'ABC',
              0,
            ],
          ]);


        const result =
          await instance.import(
            uploaded(
              buffer,
            ),
            scope,
          );


        expect(
          result.totalRows,
        ).toBe(
          1,
        );

        expect(
          result.acceptedRows,
        ).toBe(
          0,
        );

        expect(
          result.rejectedRows,
        ).toBe(
          1,
        );

        expect(
          result.results[
            0
          ]?.errorCode,
        ).toBe(
          'PURCHASE_ORDER_QUANTITY_INVALID',
        );

        expect(
          query,
        ).not.toHaveBeenCalled();
      },
    );


    it(
      'rechaza todas las filas cuando CLAVE_AUTORIZACION está duplicada',
      async () => {
        const {
          instance,
          query,
        } =
          service();

        const buffer =
          workbook([
            [
              'CLAVE_AUTORIZACION',
              'OC',
              'CODIGO_PRODUCTO',
              'CANTIDAD',
            ],
            [
              'AUTH-DUP|ABC',
              'OC-A',
              'ABC',
              1,
            ],
            [
              'AUTH-DUP|ABC',
              'OC-B',
              'ABC',
              1,
            ],
          ]);


        const result =
          await instance.import(
            uploaded(
              buffer,
            ),
            scope,
          );


        expect(
          result.rejectedRows,
        ).toBe(
          2,
        );

        expect(
          result.results.every(
            (row) =>
              row.errorCode ===
              'PURCHASE_ORDER_DUPLICATE_AUTHORIZATION_KEY',
          ),
        ).toBe(
          true,
        );

        expect(
          query,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
