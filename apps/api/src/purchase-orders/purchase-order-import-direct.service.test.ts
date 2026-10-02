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

const POINT_ID =
  '40000000-0000-4000-8000-000000000001';

const LINE_ID =
  '50000000-0000-4000-8000-000000000001';


function result<T>(
  rows:
    T[],
) {
  return {
    rows,
    rowCount:
      rows.length,
  };
}


function workbook(): Buffer {
  const book =
    XLSX.utils.book_new();


  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      [
        'CLAVE_AUTORIZACION_ORIGEN',
        'CLAVE_AUTORIZACION_DESTINO',
        'OC',
        'CODIGO_PRODUCTO',
        'CANTIDAD',
      ],
      [
        '',
        'AUTO-DEST',
        'OC-NUEVA-100',
        'PROD-1',
        2,
      ],
    ]),
    'ORDENES_COMPRA',
  );


  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      [
        'templateVersion',
        'PURCHASE_ORDERS_V3',
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


describe(
  'PurchaseOrderImportService OC directa desde autorización',
  () => {
    it(
      'crea OC sin demanda, sin agenda y sin recepción previa',
      async () => {
        const poolQueries:
          string[] = [];

        const clientQueries:
          string[] = [];


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
                  )
                  .toLowerCase();

              poolQueries.push(
                normalized,
              );


              if (
                normalized.includes(
                  'purchase_order_code = any($1::text[])',
                )
              ) {
                return result([]);
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
            ) => {
              const normalized =
                String(
                  sql,
                )
                  .replace(
                    /\s+/g,
                    ' ',
                  )
                  .trim()
                  .toLowerCase();

              clientQueries.push(
                normalized,
              );


              if (
                [
                  'begin',
                  'commit',
                  'rollback',
                ].includes(
                  normalized,
                )
              ) {
                return result([]);
              }


              if (
                normalized.includes(
                  'pg_advisory_xact_lock',
                )
              ) {
                return result([]);
              }


              if (
                normalized.includes(
                  'from purchase_orders',
                ) &&
                normalized.includes(
                  'purchase_order_code =',
                )
              ) {
                return result([]);
              }


              if (
                normalized.includes(
                  'from authorization_items ai',
                )
              ) {
                return result([
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

                    coverage_type:
                      'PBS',

                    direction_status:
                      'NOT_APPLICABLE',

                    mipres_manual_decision:
                      'PENDING_MANUAL_ENABLEMENT',

                    assignment_raw:
                      '20200101',

                    expiration_raw:
                      '20991231',

                    closed:
                      false,
                  },
                ]);
              }


              if (
                normalized.includes(
                  'as fulfilled_quantity',
                ) &&
                normalized.includes(
                  'as assigned_quantity',
                ) &&
                normalized.includes(
                  'as committed_quantity',
                )
              ) {
                return result([
                  {
                    fulfilled_quantity:
                      0,

                    assigned_quantity:
                      0,

                    committed_quantity:
                      0,
                  },
                ]);
              }


              if (
                normalized.includes(
                  'as source_busy',
                )
              ) {
                return result([
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
                  'from tariff_annex_products tap',
                ) &&
                normalized.includes(
                  'join product_delivery_point_mappings mapping',
                )
              ) {
                return result([
                  {
                    dispensing_point_id:
                      POINT_ID,
                  },
                ]);
              }


              if (
                normalized.includes(
                  'select tap.tarifa_unidad',
                ) &&
                normalized.includes(
                  'as unit_rate',
                )
              ) {
                return result([
                  {
                    unit_rate:
                      '1000',

                    product_description:
                      'Producto 1',

                    presentation:
                      '1',
                  },
                ]);
              }


              if (
                normalized.includes(
                  'insert into purchase_orders',
                )
              ) {
                return result([
                  {
                    id:
                      PO_ID,
                  },
                ]);
              }


              if (
                normalized.includes(
                  "pol.provenance = 'direct_authorization'",
                )
              ) {
                return result([]);
              }


              if (
                normalized.includes(
                  'insert into purchase_order_lines',
                )
              ) {
                return result([
                  {
                    id:
                      LINE_ID,
                  },
                ]);
              }


              if (
                normalized.includes(
                  'insert into purchase_order_authorization_sources',
                ) ||
                normalized.includes(
                  'insert into audit_events',
                )
              ) {
                return result([]);
              }


              throw new Error(
                `UNEXPECTED_CLIENT_QUERY: ${normalized}`,
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


        const file =
          workbook();


        const imported =
          await instance.import(
            {
              originalname:
                'oc.xlsx',

              mimetype:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

              size:
                file.length,

              buffer:
                file,
            },
            scope,
          );


        expect(
          imported.acceptedRows,
        ).toBe(
          1,
        );

        expect(
          imported.rejectedRows,
        ).toBe(
          0,
        );

        expect(
          imported.createdOrders,
        ).toBe(
          1,
        );


        const allQueries =
          [
            ...poolQueries,
            ...clientQueries,
          ].join(
            '\n',
          );


        expect(
          allQueries,
        ).not.toContain(
          'demand_sources',
        );

        expect(
          allQueries,
        ).not.toContain(
          'projected_demand_lines',
        );

        expect(
          allQueries,
        ).not.toContain(
          'planning_periods',
        );

        expect(
          allQueries,
        ).not.toContain(
          'patient_schedules',
        );

        /*
         * Puede CONSULTAR allocations para comprobar
         * que AUTO_DESTINO no esté ya asignada.
         *
         * Lo que NO puede hacer al crear la OC es
         * fabricar una reserva física anticipada.
         */
        expect(
          allQueries,
        ).not.toContain(
          'insert into inventory_authorization_allocations',
        );


        expect(
          allQueries,
        ).toContain(
          'product_delivery_point_mappings',
        );

        expect(
          allQueries,
        ).toContain(
          'direct_authorization',
        );


        expect(
          release,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);
