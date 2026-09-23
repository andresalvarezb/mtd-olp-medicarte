import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import * as XLSX from 'xlsx';

import {
  DispensationImportService,
} from './dispensation-import.service';


const AUTH_ID =
  '81000000-0000-4000-8000-000000000001';

const DISP_ID =
  '82000000-0000-4000-8000-000000000001';


const scope = {
  organizationId:
    '83000000-0000-4000-8000-000000000001',

  organizationCode:
    'MEDICARTE',

  userId:
    '84000000-0000-4000-8000-000000000001',

  correlationId:
    '85000000-0000-4000-8000-000000000001',

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
  rows: unknown[][],
): Buffer {
  const book =
    XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet(
      rows,
    ),
    'DISPENSACION',
  );

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
      'dispensacion.xlsx',

    mimetype:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

    size:
      buffer.length,

    buffer,
  };
}


function mockedService(
  queryImplementation?:
    (
      sql: string,
      values?: unknown[],
    ) =>
      | Promise<{
          rows: unknown[];
          rowCount?: number;
        }>
      | {
          rows: unknown[];
          rowCount?: number;
        },
) {
  const query =
    vi.fn(
      queryImplementation ??
        (
          () => ({
            rows:
              [],
            rowCount:
              0,
          })
        ),
    );


  const release =
    vi.fn();


  const connect =
    vi.fn(
      () => ({
        query,
        release,
      }),
    );


  return {
    query,
    release,
    connect,

    instance:
      new DispensationImportService(
        {
          pool: {
            connect,
          },
        } as never,
      ),
  };
}


describe(
  'DispensationImportService',
  () => {
    it(
      'genera plantilla exacta CLAVE_AUTORIZACION + FECHA_DISPENSACION',
      () => {
        const {
          instance,
        } =
          mockedService();

        const output =
          instance.template();

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
            'DISPENSACION'
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
          'FECHA_DISPENSACION',
        ]);

        expect(
          matrix,
        ).toHaveLength(
          1,
        );
      },
    );


    it(
      'rechaza encabezados incorrectos antes de tocar la base',
      async () => {
        const {
          instance,
          connect,
        } =
          mockedService();

        const buffer =
          workbook([
            [
              'CLAVE_AUTORIZACION',
              'FECHA',
            ],
            [
              'AUTH-1',
              '22/09/2026',
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
              'DISPENSATION_INVALID_HEADERS',
          });
        }


        expect(
          connect,
        ).not.toHaveBeenCalled();
      },
    );


    it(
      'rechaza claves repetidas dentro del mismo XLSX',
      async () => {
        const {
          instance,
          query,
        } =
          mockedService();


        const buffer =
          workbook([
            [
              'CLAVE_AUTORIZACION',
              'FECHA_DISPENSACION',
            ],
            [
              'AUTH-DUP',
              '22/09/2026',
            ],
            [
              'AUTH-DUP',
              '22/09/2026',
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
          result.acceptedRows,
        ).toBe(
          0,
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
              'DUPLICATE_AUTHORIZATION_KEY',
          ),
        ).toBe(
          true,
        );


        /*
         * Solo BEGIN + COMMIT.
         * Ningún lookup ni escritura operacional.
         */
        expect(
          query,
        ).toHaveBeenCalledTimes(
          2,
        );
      },
    );


    it(
      'crea una dispensación moderna válida',
      async () => {
        const {
          instance,
          query,
        } =
          mockedService(
            (
              sql,
            ) => {
              const normalized =
                sql.replace(
                  /\s+/g,
                  ' ',
                );


              if (
                normalized.includes(
                  'from authorization_items ai',
                )
              ) {
                return {
                  rows: [
                    {
                      id:
                        AUTH_ID,
                    },
                  ],
                  rowCount:
                    1,
                };
              }


              if (
                normalized.includes(
                  'from authorization_dispensations',
                )
              ) {
                return {
                  rows:
                    [],
                  rowCount:
                    0,
                };
              }


              if (
                normalized.includes(
                  'insert into authorization_dispensations',
                )
              ) {
                return {
                  rows: [
                    {
                      id:
                        DISP_ID,
                    },
                  ],
                  rowCount:
                    1,
                };
              }


              return {
                rows:
                  [],
                rowCount:
                  1,
              };
            },
          );


        const buffer =
          workbook([
            [
              'CLAVE_AUTORIZACION',
              'FECHA_DISPENSACION',
            ],
            [
              'AUTH-VALIDA',
              '22/09/2026',
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
          result,
        ).toMatchObject({
          totalRows:
            1,

          acceptedRows:
            1,

          unchangedRows:
            0,

          rejectedRows:
            0,
        });


        const sql =
          query.mock.calls
            .map(
              ([statement]) =>
                String(
                  statement,
                ),
            )
            .join(
              '\n',
            );


        expect(
          sql,
        ).toContain(
          'authorization_dispensations',
        );

        expect(
          sql,
        ).toContain(
          'AUTHORIZATION_DISPENSATION_CREATED',
        );


        /*
         * La carga de fecha no puede consumir stock
         * ni cerrar la autorización.
         */
        expect(
          sql,
        ).not.toContain(
          'inventory_movements',
        );

        expect(
          sql,
        ).not.toContain(
          'authorization_fulfillments',
        );
      },
    );


    it(
      'misma clave y misma fecha es idempotente',
      async () => {
        const {
          instance,
          query,
        } =
          mockedService(
            (
              sql,
            ) => {
              const normalized =
                sql.replace(
                  /\s+/g,
                  ' ',
                );


              if (
                normalized.includes(
                  'from authorization_items ai',
                )
              ) {
                return {
                  rows: [
                    {
                      id:
                        AUTH_ID,
                    },
                  ],
                  rowCount:
                    1,
                };
              }


              if (
                normalized.includes(
                  'from authorization_dispensations',
                )
              ) {
                return {
                  rows: [
                    {
                      id:
                        DISP_ID,

                      dispensation_date:
                        '2026-09-22',
                    },
                  ],
                  rowCount:
                    1,
                };
              }


              return {
                rows:
                  [],
                rowCount:
                  1,
              };
            },
          );


        const buffer =
          workbook([
            [
              'CLAVE_AUTORIZACION',
              'FECHA_DISPENSACION',
            ],
            [
              'AUTH-VALIDA',
              '2026-09-22',
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
          result,
        ).toMatchObject({
          acceptedRows:
            0,

          unchangedRows:
            1,

          rejectedRows:
            0,
        });


        const sql =
          query.mock.calls
            .map(
              ([statement]) =>
                String(
                  statement,
                ),
            )
            .join(
              '\n',
            );


        expect(
          sql,
        ).not.toContain(
          'insert into\n                  authorization_dispensations',
        );
      },
    );
  },
);
