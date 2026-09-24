import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import * as XLSX from 'xlsx';

import {
  AuthorizationFulfillmentImportService,
} from './authorization-fulfillment-import.service';

import {
  createAuthorizationFulfillmentTemplate,
  parseAuthorizationFulfillmentWorkbook,
} from './authorization-fulfillment-xlsx';


const AUTH_ID =
  '91000000-0000-4000-8000-000000000001';

const FULFILLMENT_ID =
  '92000000-0000-4000-8000-000000000001';


const scope = {
  organizationId:
    '93000000-0000-4000-8000-000000000001',

  organizationCode:
    'MEDICARTE',

  userId:
    '94000000-0000-4000-8000-000000000001',

  correlationId:
    '95000000-0000-4000-8000-000000000001',

  readSensitive:
    false,

  isFoundationAdmin:
    false,

  canCrossOrganizationOperationalExport:
    false,

  pointAccessKind:
    'unrestricted',
} as const;


function workbook(
  rows:
    unknown[][],
): Buffer {
  const book =
    XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet(
      rows,
    ),
    'ENTREGA_APLICACION',
  );

  return XLSX.write(
    book,
    {
      type: 'buffer',
      bookType: 'xlsx',
    },
  ) as Buffer;
}


function uploaded(
  buffer:
    Buffer,
) {
  return {
    originalname:
      'entrega-aplicacion.xlsx',

    mimetype:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

    size:
      buffer.length,

    buffer,
  };
}


function setup(
  input?: {
    ids?:
      string[];

    result?:
      unknown;

    error?:
      unknown;
  },
) {
  const ids =
    input?.ids ??
    [
      AUTH_ID,
    ];


  const query =
    vi.fn(
      () => ({
        rows:
          ids.map(
            (id) => ({
              id,
            }),
          ),

        rowCount:
          ids.length,
      }),
    );


  const fulfill =
    vi.fn(
      () => {
        if (
          input?.error
        ) {
          if (
            input.error instanceof Error
          ) {
            throw input.error;
          }

          const error =
            new Error(
              typeof input.error === 'object' &&
              input.error !== null &&
              'message' in input.error &&
              typeof input.error.message === 'string'
                ? input.error.message
                : 'TEST_FULFILLMENT_ERROR',
            );

          if (
            typeof input.error === 'object' &&
            input.error !== null &&
            'code' in input.error &&
            typeof input.error.code === 'string'
          ) {
            Object.assign(
              error,
              {
                code:
                  input.error.code,
              },
            );
          }

          throw error;
        }

        return (
          input?.result ??
          {
            id:
              FULFILLMENT_ID,
          }
        );
      },
    );


  return {
    query,
    fulfill,

    service:
      new AuthorizationFulfillmentImportService(
        {
          pool: {
            query,
          },
        } as never,

        {
          fulfill,
        } as never,
      ),
  };
}


describe(
  'AuthorizationFulfillment XLSX',
  () => {
    it(
      'genera exactamente las cuatro columnas oficiales',
      () => {
        const output =
          createAuthorizationFulfillmentTemplate();

        const book =
          XLSX.read(
            output,
            {
              type: 'buffer',
            },
          );

        const sheet =
          book.Sheets[
            'ENTREGA_APLICACION'
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
              header: 1,
            },
          );

        expect(
          matrix,
        ).toEqual([
          [
            'CLAVE_AUTORIZACION',
            'OC',
            'TIPO_DISPENSACION',
            'FECHA',
          ],
        ]);
      },
    );


    it(
      'normaliza ENTREGA y APLICACION',
      () => {
        const rows =
          parseAuthorizationFulfillmentWorkbook(
            workbook([
              [
                'CLAVE_AUTORIZACION',
                'OC',
                'TIPO_DISPENSACION',
                'FECHA',
              ],
              [
                'AUTH-1',
                'OC-1001',
                'ENTREGA',
                '22/09/2026',
              ],
              [
                'AUTH-2',
                'OC-1002',
                'APLICACIÓN',
                '2026-09-21',
              ],
            ]),
          );

        expect(
          rows[0],
        ).toMatchObject({
          authorizationKey:
            'AUTH-1',

          purchaseOrderCode:
            'OC-1001',

          fulfillmentType:
            'DELIVERY',

          effectiveDate:
            '2026-09-22',
        });

        expect(
          rows[1],
        ).toMatchObject({
          authorizationKey:
            'AUTH-2',

          purchaseOrderCode:
            'OC-1002',

          fulfillmentType:
            'APPLICATION',

          effectiveDate:
            '2026-09-21',
        });
      },
    );


    it(
      'rechaza encabezados distintos',
      () => {
        expect(
          () =>
            parseAuthorizationFulfillmentWorkbook(
              workbook([
                [
                  'AUTORIZACION',
                  'TIPO',
                  'FECHA',
                ],
              ]),
            ),
        ).toThrow();
      },
    );


    it(
      'rechaza todas las filas duplicadas sin consultar DB ni ejecutar cierre',
      async () => {
        const {
          service,
          query,
          fulfill,
        } =
          setup();

        const result =
          await service.import(
            uploaded(
              workbook([
                [
                  'CLAVE_AUTORIZACION',
                  'OC',
                  'TIPO_DISPENSACION',
                  'FECHA',
                ],
                [
                  'AUTH-DUP',
                  'OC-DUP',
                  'ENTREGA',
                  '2026-09-20',
                ],
                [
                  'AUTH-DUP',
                  'OC-DUP',
                  'APLICACION',
                  '2026-09-20',
                ],
              ]),
            ),
            scope,
          );

        expect(
          result.rejectedRows,
        ).toBe(2);

        expect(
          result.results.every(
            (row) =>
              row.errorCode ===
              'DUPLICATE_AUTHORIZATION_KEY',
          ),
        ).toBe(true);

        expect(
          query,
        ).not.toHaveBeenCalled();

        expect(
          fulfill,
        ).not.toHaveBeenCalled();
      },
    );


    it(
      'usa exactamente el AuthorizationFulfillmentService con source XLSX',
      async () => {
        const {
          service,
          fulfill,
        } =
          setup();

        const result =
          await service.import(
            uploaded(
              workbook([
                [
                  'CLAVE_AUTORIZACION',
                  'OC',
                  'TIPO_DISPENSACION',
                  'FECHA',
                ],
                [
                  'AUTH-VALIDA',
                  'OC-VALIDA',
                  'ENTREGA',
                  '2026-09-20',
                ],
              ]),
            ),
            scope,
          );

        expect(
          result,
        ).toMatchObject({
          totalRows: 1,
          acceptedRows: 1,
          rejectedRows: 0,
        });

        expect(
          fulfill,
        ).toHaveBeenCalledTimes(1);

        expect(
          fulfill,
        ).toHaveBeenCalledWith(
          AUTH_ID,
          {
            purchaseOrderCode:
              'OC-VALIDA',

            fulfillmentType:
              'DELIVERY',

            effectiveDate:
              '2026-09-20',
          },
          scope,
          'XLSX',
        );
      },
    );


    it(
      'devuelve rechazo cuando el servicio canónico bloquea la operación',
      async () => {
        const error = {
          code:
            'AUTHORIZATION_FULFILLMENT_ALLOCATION_REQUIRED',

          message:
            'La autorización no tiene inventario asignado pendiente de consumo.',
        };

        const {
          service,
          fulfill,
        } =
          setup({
            error,
          });

        const result =
          await service.import(
            uploaded(
              workbook([
                [
                  'CLAVE_AUTORIZACION',
                  'OC',
                  'TIPO_DISPENSACION',
                  'FECHA',
                ],
                [
                  'AUTH-SIN-STOCK',
                  'OC-SIN-STOCK',
                  'APLICACION',
                  '2026-09-20',
                ],
              ]),
            ),
            scope,
          );

        expect(
          result.acceptedRows,
        ).toBe(0);

        expect(
          result.rejectedRows,
        ).toBe(1);

        expect(
          result.results[0],
        ).toMatchObject({
          errorCode:
            'AUTHORIZATION_FULFILLMENT_ALLOCATION_REQUIRED',
        });

        expect(
          result.rejectedWorkbookBase64,
        ).not.toBeNull();

        expect(
          fulfill,
        ).toHaveBeenCalledTimes(1);
      },
    );


    it(
      'rechaza autorización inexistente sin ejecutar fulfillment',
      async () => {
        const {
          service,
          fulfill,
        } =
          setup({
            ids: [],
          });

        const result =
          await service.import(
            uploaded(
              workbook([
                [
                  'CLAVE_AUTORIZACION',
                  'OC',
                  'TIPO_DISPENSACION',
                  'FECHA',
                ],
                [
                  'AUTH-NO-EXISTE',
                  'OC-NO-EXISTE',
                  'ENTREGA',
                  '2026-09-20',
                ],
              ]),
            ),
            scope,
          );

        expect(
          result.results[0],
        ).toMatchObject({
          status:
            'REJECTED',

          errorCode:
            'AUTHORIZATION_NOT_FOUND',
        });

        expect(
          fulfill,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
