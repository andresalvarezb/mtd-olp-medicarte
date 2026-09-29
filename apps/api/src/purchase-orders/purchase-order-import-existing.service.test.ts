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


const PO_ID =
  '20000000-0000-4000-8000-000000000001';

const DEST_ID =
  '30000000-0000-4000-8000-000000000001';

const ORIGIN_ID =
  '30000000-0000-4000-8000-000000000002';

const POINT_ID =
  '40000000-0000-4000-8000-000000000001';

const BATCH_ID =
  '50000000-0000-4000-8000-000000000001';


function workbook(
  row:
    readonly unknown[],
): Buffer {
  const book =
    XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      [
        'AUTO_ORIGEN',
        'AUTO_DESTINO',
        'OC',
        'CODIGO_PRODUCTO',
        'CANTIDAD',
      ],
      [...row],
    ]),
    'ORDENES_COMPRA',
  );

  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      [
        'templateVersion',
        'PURCHASE_ORDERS_V2',
      ],
      [
        'importType',
        'PURCHASE_ORDERS',
      ],
    ]),
    'METADATA',
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
  buffer:
    Buffer,
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


function queryResult<T>(
  rows:
    T[],
) {
  return {
    rows,

    rowCount:
      rows.length,
  };
}


describe(
  'PurchaseOrderImportService OC existente',
  () => {
    it(
      'asigna disponibilidad recibida por Medicarte sin crear ni modificar la OC',
      async () => {
        const poolQuery =
          vi.fn(
            (
              sql:
                string,
            ) => {
              const normalized =
                String(
                  sql,
                )
                  .replace(
                    /\s+/g,
                    ' ',
                  );

              if (
                normalized.includes(
                  'purchase_order_code = any($1::text[])',
                )
              ) {
                return queryResult([
                  {
                    purchase_order_code:
                      'OC-100',
                  },
                ]);
              }

              throw new Error(
                `UNEXPECTED_POOL_QUERY: ${normalized}`,
              );
            },
          );


        const clientQuery =
          vi.fn(
            (
              sql:
                string,
              params?:
                unknown[],
            ) => {
              const normalized =
                String(
                  sql,
                )
                  .replace(
                    /\s+/g,
                    ' ',
                  )
                  .trim();

              if (
                [
                  'begin',
                  'commit',
                  'rollback',
                ].includes(
                  normalized.toLowerCase(),
                )
              ) {
                return queryResult([]);
              }

              if (
                normalized.includes(
                  'select id, planning_period_id, order_type, status',
                )
              ) {
                return queryResult([
                  {
                    id:
                      PO_ID,

                    planning_period_id:
                      '60000000-0000-4000-8000-000000000001',

                    order_type:
                      'STANDARD',

                    status:
                      'ISSUED',
                  },
                ]);
              }

              if (
                normalized.includes(
                  'from authorization_items ai',
                )
              ) {
                return queryResult([
                  {
                    id:
                      DEST_ID,

                    authorization_key:
                      'AUTO-DEST',

                    commercial_code:
                      'PROD-1',

                    authorization_version:
                      1,

                    authorized_quantity:
                      2,

                    enablement_status:
                      'ENABLED',

                    source_status_normalized:
                      '5',

                    closed:
                      false,
                  },
                ]);
              }

              if (
                normalized.includes(
                  'as source_busy',
                )
              ) {
                return queryResult([
                  {
                    source_busy:
                      false,

                    allocation_busy:
                      false,
                  },
                ]);
              }

              if (
                normalized.includes(
                  'from patient_schedules ps',
                )
              ) {
                return queryResult([
                  {
                    dispensing_point_id:
                      POINT_ID,
                  },
                ]);
              }

              if (
                normalized.includes(
                  'from purchase_order_lines pol',
                ) &&
                normalized.includes(
                  'limit 1',
                )
              ) {
                return queryResult([
                  {
                    id:
                      '70000000-0000-4000-8000-000000000001',
                  },
                ]);
              }

              if (
                normalized.includes(
                  'pg_advisory_xact_lock',
                )
              ) {
                return queryResult([]);
              }

              if (
                normalized.includes(
                  'as available_quantity',
                )
              ) {
                return queryResult([
                  {
                    available_quantity:
                      2,
                  },
                ]);
              }

              if (
                normalized.includes(
                  'insert into inventory_allocation_batches',
                )
              ) {
                return queryResult([
                  {
                    id:
                      BATCH_ID,
                  },
                ]);
              }

              if (
                normalized.includes(
                  'insert into inventory_authorization_allocations',
                ) ||
                normalized.includes(
                  'insert into audit_events',
                )
              ) {
                return queryResult([]);
              }

              throw new Error(
                `UNEXPECTED_CLIENT_QUERY: ${normalized} PARAMS=${JSON.stringify(
                  params,
                )}`,
              );
            },
          );


        const release =
          vi.fn();


        const instance =
          new PurchaseOrderImportService(
            {
              pool: {
                query:
                  poolQuery,

                connect:
                  vi.fn(
                    () => ({
                      query:
                        clientQuery,

                      release,
                    }),
                  ),
              },
            } as never,

            {} as never,
          );


        const result =
          await instance.import(
            uploaded(
              workbook([
                '',
                'AUTO-DEST',
                'OC-100',
                'PROD-1',
                2,
              ]),
            ),
            scope,
          );


        expect(
          result.acceptedRows,
        ).toBe(
          1,
        );

        expect(
          result.rejectedRows,
        ).toBe(
          0,
        );

        expect(
          result.createdOrders,
        ).toBe(
          0,
        );

        expect(
          clientQuery.mock.calls.some(
            ([sql]) =>
              String(
                sql,
              ).includes(
                'insert into\n                inventory_authorization_allocations',
              ),
          ),
        ).toBe(
          true,
        );

        expect(
          release,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );


    it(
      'reasigna 1 a 1 conservando la recepción de Medicarte',
      async () => {
        const poolQuery =
          vi.fn(
            (
              sql:
                string,
            ) => {
              const normalized =
                String(
                  sql,
                )
                  .replace(
                    /\s+/g,
                    ' ',
                  );

              if (
                normalized.includes(
                  'purchase_order_code = any($1::text[])',
                )
              ) {
                return queryResult([
                  {
                    purchase_order_code:
                      'OC-200',
                  },
                ]);
              }

              throw new Error(
                `UNEXPECTED_POOL_QUERY: ${normalized}`,
              );
            },
          );


        const clientQuery =
          vi.fn(
            (
              sql:
                string,
              params?:
                unknown[],
            ) => {
              const normalized =
                String(
                  sql,
                )
                  .replace(
                    /\s+/g,
                    ' ',
                  )
                  .trim();

              if (
                [
                  'begin',
                  'commit',
                  'rollback',
                ].includes(
                  normalized.toLowerCase(),
                )
              ) {
                return queryResult([]);
              }

              if (
                normalized.includes(
                  'select id, planning_period_id, order_type, status',
                )
              ) {
                return queryResult([
                  {
                    id:
                      PO_ID,

                    planning_period_id:
                      '60000000-0000-4000-8000-000000000001',

                    order_type:
                      'STANDARD',

                    status:
                      'ISSUED',
                  },
                ]);
              }

              if (
                normalized.includes(
                  'from authorization_items ai',
                )
              ) {
                const keyValue =
                  params?.[0];

                const key =
                  typeof keyValue ===
                    'string'
                    ? keyValue
                    : '';

                return queryResult([
                  {
                    id:
                      key ===
                        'AUTO-ORIG'
                        ? ORIGIN_ID
                        : DEST_ID,

                    authorization_key:
                      key,

                    commercial_code:
                      'PROD-1',

                    authorization_version:
                      1,

                    authorized_quantity:
                      2,

                    enablement_status:
                      'ENABLED',

                    source_status_normalized:
                      '5',

                    closed:
                      false,
                  },
                ]);
              }

              if (
                normalized.includes(
                  'as source_busy',
                )
              ) {
                return queryResult([
                  {
                    source_busy:
                      false,

                    allocation_busy:
                      false,
                  },
                ]);
              }

              if (
                normalized.includes(
                  'from patient_schedules ps',
                )
              ) {
                return queryResult([
                  {
                    dispensing_point_id:
                      POINT_ID,
                  },
                ]);
              }

              if (
                normalized.includes(
                  'from purchase_order_lines pol',
                ) &&
                normalized.includes(
                  'limit 1',
                )
              ) {
                return queryResult([
                  {
                    id:
                      '70000000-0000-4000-8000-000000000001',
                  },
                ]);
              }

              if (
                normalized.includes(
                  'sum( poas.source_quantity_snapshot )',
                )
              ) {
                return queryResult([
                  {
                    dispensing_point_id:
                      POINT_ID,

                    source_quantity:
                      2,
                  },
                ]);
              }

              if (
                normalized.includes(
                  'as active_remaining',
                )
              ) {
                return queryResult([
                  {
                    active_remaining:
                      2,

                    consumed_quantity:
                      0,

                    other_point_rows:
                      0,
                  },
                ]);
              }

              if (
                normalized.includes(
                  'update inventory_authorization_allocations',
                ) ||
                normalized.includes(
                  'update purchase_order_authorization_sources poas',
                ) ||
                normalized.includes(
                  'insert into audit_events',
                )
              ) {
                return queryResult([]);
              }

              throw new Error(
                `UNEXPECTED_CLIENT_QUERY: ${normalized} PARAMS=${JSON.stringify(
                  params,
                )}`,
              );
            },
          );


        const instance =
          new PurchaseOrderImportService(
            {
              pool: {
                query:
                  poolQuery,

                connect:
                  vi.fn(
                    () => ({
                      query:
                        clientQuery,

                      release:
                        vi.fn(),
                    }),
                  ),
              },
            } as never,

            {} as never,
          );


        const result =
          await instance.import(
            uploaded(
              workbook([
                'AUTO-ORIG',
                'AUTO-DEST',
                'OC-200',
                'PROD-1',
                2,
              ]),
            ),
            scope,
          );


        expect(
          result.acceptedRows,
        ).toBe(
          1,
        );

        expect(
          result.rejectedRows,
        ).toBe(
          0,
        );

        expect(
          result.createdOrders,
        ).toBe(
          0,
        );

        /*
         * Reasignar nunca escribe sobre tablas
         * de recepción.
         */
        expect(
          clientQuery.mock.calls.some(
            ([sql]) =>
              String(
                sql,
              ).toLowerCase()
                .includes(
                  'update purchase_order_receipt',
                ),
          ),
        ).toBe(
          false,
        );
      },
    );
  },
);
