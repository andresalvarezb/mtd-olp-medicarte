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


function queryResult<T>(
  rows: T[],
) {
  return {
    rows,

    rowCount:
      rows.length,
  };
}


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
  content:
    Buffer,
) {
  return {
    originalname:
      'oc.xlsx',

    mimetype:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

    size:
      content.length,

    buffer:
      content,
  };
}


type AuthorizationConfig =
  Readonly<{
    id: string;

    authorizationKey:
      string;

    commercialCode:
      string;

    quantity:
      number;

    closed:
      boolean;

    enablementStatus:
      string;

    sourceStatus:
      string;
  }>;


const destinationDefault:
  AuthorizationConfig = {
    id:
      DEST_ID,

    authorizationKey:
      'AUTO-DEST',

    commercialCode:
      'PROD-1',

    quantity:
      2,

    closed:
      false,

    enablementStatus:
      'ENABLED',

    sourceStatus:
      '5',
  };


const originDefault:
  AuthorizationConfig = {
    id:
      ORIGIN_ID,

    authorizationKey:
      'AUTO-ORIG',

    commercialCode:
      'PROD-1',

    quantity:
      2,

    closed:
      false,

    enablementStatus:
      'ENABLED',

    sourceStatus:
      '5',
  };


type ExistingOptions =
  Readonly<{
    destination?:
      Partial<
        AuthorizationConfig
      >;

    origin?:
      Partial<
        AuthorizationConfig
      >;

    destinationBusy?:
      boolean;

    availableQuantity?:
      number;

    sourceQuantity?:
      number;

    activeRemaining?:
      number;

    consumedQuantity?:
      number;

    otherPointRows?:
      number;

    productPointExists?:
      boolean;
  }>;


function authorizationRow(
  config:
    AuthorizationConfig,
) {
  return {
    id:
      config.id,

    authorization_key:
      config.authorizationKey,

    commercial_code:
      config.commercialCode,

    authorization_version:
      1,

    authorized_quantity:
      config.quantity,

    enablement_status:
      config.enablementStatus,

    source_status_normalized:
      config.sourceStatus,

    closed:
      config.closed,
  };
}


async function runExisting(
  row:
    readonly unknown[],

  options:
    ExistingOptions = {},
) {
  const destination = {
    ...destinationDefault,
    ...options.destination,
  };

  const origin = {
    ...originDefault,
    ...options.origin,
  };


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

        if (
          normalized.includes(
            'purchase_order_code = any($1::text[])',
          )
        ) {
          return queryResult([
            {
              purchase_order_code:
                'OC-EXISTENTE',
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
            .trim()
            .toLowerCase();


        if (
          normalized ===
            'begin' ||
          normalized ===
            'rollback' ||
          normalized ===
            'commit'
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
            authorizationRow(
              key ===
                origin.authorizationKey
                ? origin
                : destination,
            ),
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
                options.destinationBusy ??
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


        /*
         * Verificación OC + producto + punto.
         */
        if (
          normalized.includes(
            'from purchase_order_lines pol',
          ) &&
          normalized.includes(
            'limit 1',
          )
        ) {
          return queryResult(
            options.productPointExists ===
              false
              ? []
              : [
                  {
                    id:
                      '70000000-0000-4000-8000-000000000001',
                  },
                ],
          );
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
                options.availableQuantity ??
                2,
            },
          ]);
        }


        if (
          normalized.includes(
            'from purchase_order_authorization_sources poas',
          ) &&
          normalized.includes(
            'source_quantity',
          ) &&
          normalized.includes(
            'group by',
          )
        ) {
          const sourceQuantity =
            options.sourceQuantity ??
            2;

          return queryResult(
            sourceQuantity ===
              0
              ? []
              : [
                  {
                    dispensing_point_id:
                      POINT_ID,

                    source_quantity:
                      sourceQuantity,
                  },
                ],
          );
        }


        if (
          normalized.includes(
            'as active_remaining',
          )
        ) {
          return queryResult([
            {
              active_remaining:
                options.activeRemaining ??
                2,

              consumed_quantity:
                options.consumedQuantity ??
                0,

              other_point_rows:
                options.otherPointRows ??
                0,
            },
          ]);
        }


        /*
         * Ninguna prueba negativa debe llegar
         * a persistencia.
         */
        if (
          normalized.includes(
            'insert into inventory_allocation_batches',
          ) ||
          normalized.includes(
            'insert into inventory_authorization_allocations',
          ) ||
          normalized.includes(
            'update inventory_authorization_allocations',
          ) ||
          normalized.includes(
            'update purchase_order_authorization_sources',
          ) ||
          normalized.includes(
            'insert into audit_events',
          )
        ) {
          throw new Error(
            'NEGATIVE_RULE_MUST_NOT_WRITE',
          );
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

      {
        create:
          vi.fn(),

        issue:
          vi.fn(),

        cancel:
          vi.fn(),
      } as never,
    );


  const result =
    await instance.import(
      uploaded(
        workbook(
          row,
        ),
      ),
      scope,
    );


  return {
    result,
    clientQuery,
    release,
  };
}


async function runCreateGuard(
  guard:
    Readonly<{
      closed:
        boolean;

      assigned:
        boolean;
    }>,
) {
  const orders = {
    create:
      vi.fn(),

    issue:
      vi.fn(),

    cancel:
      vi.fn(),
  };


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


        /*
         * OC no existe:
         * debe entrar al flujo CREAR_OC.
         */
        if (
          normalized.includes(
            'purchase_order_code = any($1::text[])',
          )
        ) {
          return queryResult([]);
        }


        if (
          normalized.includes(
            'as closed',
          ) &&
          normalized.includes(
            'as assigned',
          )
        ) {
          return queryResult([
            {
              authorization_key:
                'AUTO-DEST',

              closed:
                guard.closed,

              assigned:
                guard.assigned,
            },
          ]);
        }


        if (
          normalized.includes(
            'with ranked as',
          )
        ) {
          return queryResult([
            {
              authorization_item_id:
                DEST_ID,

              authorization_key:
                'AUTO-DEST',

              commercial_code:
                'PROD-1',

              projected_demand_line_id:
                '80000000-0000-4000-8000-000000000001',

              planning_period_id:
                '60000000-0000-4000-8000-000000000001',

              demand_bucket:
                'REGULAR',

              source_quantity:
                2,

              already_committed:
                0,

              revision:
                1,
            },
          ]);
        }


        throw new Error(
          `UNEXPECTED_POOL_QUERY: ${normalized}`,
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
              () => {
                throw new Error(
                  'CREATE_GUARD_MUST_NOT_CONNECT',
                );
              },
            ),
        },
      } as never,

      orders as never,
    );


  const result =
    await instance.import(
      uploaded(
        workbook([
          '',
          'AUTO-DEST',
          'OC-NUEVA',
          'PROD-1',
          2,
        ]),
      ),
      scope,
    );


  return {
    result,
    orders,
  };
}


function expectRejected(
  result:
    Awaited<
      ReturnType<
        typeof runExisting
      >
    >['result'],

  code:
    string,
) {
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
    result.results[0]
      ?.errorCode,
  ).toBe(
    code,
  );
}


describe(
  'PurchaseOrderImportService reglas negativas',
  () => {
    it(
      'CREAR_OC rechaza AUTO_DESTINO cerrada',
      async () => {
        const {
          result,
          orders,
        } =
          await runCreateGuard({
            closed:
              true,

            assigned:
              false,
          });


        expect(
          result.results[0]
            ?.errorCode,
        ).toBe(
          'PURCHASE_ORDER_DESTINATION_CLOSED',
        );

        expect(
          orders.create,
        ).not.toHaveBeenCalled();
      },
    );


    it(
      'CREAR_OC rechaza AUTO_DESTINO que ya tiene otra OC o asignación activa',
      async () => {
        const {
          result,
          orders,
        } =
          await runCreateGuard({
            closed:
              false,

            assigned:
              true,
          });


        expect(
          result.results[0]
            ?.errorCode,
        ).toBe(
          'PURCHASE_ORDER_DESTINATION_ALREADY_ASSIGNED',
        );

        expect(
          orders.create,
        ).not.toHaveBeenCalled();
      },
    );


    it(
      'ASIGNAR_DISPONIBLE rechaza AUTO_DESTINO cerrada',
      async () => {
        const {
          result,
        } =
          await runExisting(
            [
              '',
              'AUTO-DEST',
              'OC-EXISTENTE',
              'PROD-1',
              2,
            ],
            {
              destination: {
                closed:
                  true,
              },
            },
          );


        expectRejected(
          result,
          'PURCHASE_ORDER_DESTINATION_CLOSED',
        );
      },
    );


    it(
      'ASIGNAR_DISPONIBLE rechaza producto diferente al de AUTO_DESTINO',
      async () => {
        const {
          result,
        } =
          await runExisting([
            '',
            'AUTO-DEST',
            'OC-EXISTENTE',
            'OTRO-PRODUCTO',
            2,
          ]);


        expectRejected(
          result,
          'PURCHASE_ORDER_PRODUCT_MISMATCH',
        );
      },
    );


    it(
      'ASIGNAR_DISPONIBLE rechaza cantidad diferente a la cantidad completa de AUTO_DESTINO',
      async () => {
        const {
          result,
        } =
          await runExisting([
            '',
            'AUTO-DEST',
            'OC-EXISTENTE',
            'PROD-1',
            1,
          ]);


        expectRejected(
          result,
          'PURCHASE_ORDER_DESTINATION_QUANTITY_MISMATCH',
        );
      },
    );


    it(
      'ASIGNAR_DISPONIBLE rechaza AUTO_DESTINO ya asignada',
      async () => {
        const {
          result,
        } =
          await runExisting(
            [
              '',
              'AUTO-DEST',
              'OC-EXISTENTE',
              'PROD-1',
              2,
            ],
            {
              destinationBusy:
                true,
            },
          );


        expectRejected(
          result,
          'PURCHASE_ORDER_DESTINATION_ALREADY_ASSIGNED',
        );
      },
    );


    it(
      'ASIGNAR_DISPONIBLE rechaza cuando Medicarte no tiene cantidad recibida libre suficiente',
      async () => {
        const {
          result,
        } =
          await runExisting(
            [
              '',
              'AUTO-DEST',
              'OC-EXISTENTE',
              'PROD-1',
              2,
            ],
            {
              availableQuantity:
                1,
            },
          );


        expectRejected(
          result,
          'PURCHASE_ORDER_AVAILABLE_QUANTITY_INSUFFICIENT',
        );
      },
    );


    it(
      'REASIGNAR rechaza AUTO_ORIGEN cerrada',
      async () => {
        const {
          result,
        } =
          await runExisting(
            [
              'AUTO-ORIG',
              'AUTO-DEST',
              'OC-EXISTENTE',
              'PROD-1',
              2,
            ],
            {
              origin: {
                closed:
                  true,
              },
            },
          );


        expectRejected(
          result,
          'PURCHASE_ORDER_ORIGIN_CLOSED',
        );
      },
    );


    it(
      'REASIGNAR rechaza productos diferentes entre origen y destino',
      async () => {
        const {
          result,
        } =
          await runExisting(
            [
              'AUTO-ORIG',
              'AUTO-DEST',
              'OC-EXISTENTE',
              'PROD-1',
              2,
            ],
            {
              origin: {
                commercialCode:
                  'PROD-2',
              },
            },
          );


        expectRejected(
          result,
          'PURCHASE_ORDER_REASSIGNMENT_PRODUCT_MISMATCH',
        );
      },
    );


    it(
      'REASIGNAR rechaza cantidades diferentes entre origen y destino',
      async () => {
        const {
          result,
        } =
          await runExisting(
            [
              'AUTO-ORIG',
              'AUTO-DEST',
              'OC-EXISTENTE',
              'PROD-1',
              2,
            ],
            {
              origin: {
                quantity:
                  3,
              },
            },
          );


        expectRejected(
          result,
          'PURCHASE_ORDER_REASSIGNMENT_QUANTITY_MISMATCH',
        );
      },
    );


    it(
      'REASIGNAR rechaza origen que no pertenece ni tiene reserva en la OC',
      async () => {
        const {
          result,
        } =
          await runExisting(
            [
              'AUTO-ORIG',
              'AUTO-DEST',
              'OC-EXISTENTE',
              'PROD-1',
              2,
            ],
            {
              sourceQuantity:
                0,

              activeRemaining:
                0,
            },
          );


        expectRejected(
          result,
          'PURCHASE_ORDER_REASSIGNMENT_ORIGIN_NOT_ASSIGNED',
        );
      },
    );


    it(
      'REASIGNAR rechaza producto de AUTO_ORIGEN que ya fue consumido entregado o aplicado',
      async () => {
        const {
          result,
        } =
          await runExisting(
            [
              'AUTO-ORIG',
              'AUTO-DEST',
              'OC-EXISTENTE',
              'PROD-1',
              2,
            ],
            {
              activeRemaining:
                0,

              consumedQuantity:
                2,
            },
          );


        expectRejected(
          result,
          'PURCHASE_ORDER_REASSIGNMENT_ALREADY_CONSUMED',
        );
      },
    );
  },
);
