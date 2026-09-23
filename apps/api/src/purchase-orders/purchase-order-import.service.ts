import {
  BadRequestException,
  Inject,
  Injectable,
} from '@nestjs/common';

import type { createDatabase } from '@authorization/database';

import * as XLSX from 'xlsx';

import type { Scope } from '../common/request-scope';

import { DATABASE } from '../tokens';

import { PurchaseOrderService } from './purchase-order.service';


type Database =
  ReturnType<typeof createDatabase>;


export type UploadedPurchaseOrderFile =
  Readonly<{
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  }>;


type PurchaseOrderType =
  | 'STANDARD'
  | 'COMPLEMENTARY';


type DemandBucket =
  | 'REGULAR'
  | 'LATE';


type ImportRow = Readonly<{
  rowNumber: number;

  raw: Record<string, unknown>;

  authorizationKey: string | null;

  purchaseOrderCode: string | null;

  commercialCode: string | null;

  quantity: number | null;
}>;


type SourceLookupRow = Readonly<{
  authorization_item_id: string;

  authorization_key: string;

  commercial_code: string;

  projected_demand_line_id: string;

  planning_period_id: string;

  demand_bucket: DemandBucket;

  source_quantity: number;

  already_committed: number;

  revision: number;
}>;


type ResolvedRow =
  ImportRow &
  Readonly<{
    source: SourceLookupRow;
  }>;


export type PurchaseOrderImportRowResult =
  Readonly<{
    rowNumber: number;

    status:
      | 'ACCEPTED'
      | 'REJECTED';

    authorizationKey: string | null;

    purchaseOrderCode: string | null;

    planningPeriodId: string | null;

    orderType: PurchaseOrderType | null;

    commercialCode: string | null;

    quantity: number | null;

    requestedDeliveryDate: string | null;

    purchaseOrderId: string | null;

    errorCode: string | null;

    errorMessage: string | null;
  }>;


export type PurchaseOrderImportResult =
  Readonly<{
    totalRows: number;

    acceptedRows: number;

    rejectedRows: number;

    createdOrders: number;

    rejectedWorkbookBase64: string | null;

    results: PurchaseOrderImportRowResult[];
  }>;


const TEMPLATE_VERSION =
  'PURCHASE_ORDERS_V1';

const IMPORT_TYPE =
  'PURCHASE_ORDERS';

const TEMPLATE_HEADERS = [
  'CLAVE_AUTORIZACION',
  'OC',
  'CODIGO_PRODUCTO',
  'CANTIDAD',
] as const;



function scalarText(
  value: unknown,
): string {
  if (
    typeof value === 'string'
  ) {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  return '';
}


function normalizeHeader(
  value: unknown,
): string {
  return scalarText(
    value,
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


function normalizeText(
  value: unknown,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text =
    scalarText(
      value,
    ).trim();

  return text || null;
}


function positiveInteger(
  value: unknown,
): number | null {
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0
  ) {
    return value;
  }

  const text =
    normalizeText(value);

  if (
    !text ||
    !/^[1-9][0-9]*$/.test(text)
  ) {
    return null;
  }

  const parsed =
    Number(text);

  return Number.isSafeInteger(parsed)
    ? parsed
    : null;
}


function errorInformation(
  error: unknown,
): {
  code: string;
  message: string;
} {
  if (
    error &&
    typeof error === 'object' &&
    'getResponse' in error &&
    typeof (
      error as {
        getResponse?: unknown;
      }
    ).getResponse === 'function'
  ) {
    const response =
      (
        error as {
          getResponse: () => unknown;
        }
      ).getResponse();

    if (
      response &&
      typeof response === 'object'
    ) {
      const code =
        'code' in response &&
        typeof response.code === 'string'
          ? response.code
          : 'PURCHASE_ORDER_IMPORT_ERROR';

      const message =
        'message' in response &&
        typeof response.message === 'string'
          ? response.message
          : code;

      return {
        code,
        message,
      };
    }
  }

  if (
    error instanceof Error
  ) {
    return {
      code:
        error.message ||
        'PURCHASE_ORDER_IMPORT_ERROR',

      message:
        error.message ||
        'No fue posible crear la orden de compra.',
    };
  }

  return {
    code:
      'PURCHASE_ORDER_IMPORT_ERROR',

    message:
      'No fue posible crear la orden de compra.',
  };
}


@Injectable()
export class PurchaseOrderImportService {
  constructor(
    @Inject(DATABASE)
    private readonly database: Database,

    private readonly orders:
      PurchaseOrderService,
  ) {}


  buildTemplate(): Buffer {
    const workbook =
      XLSX.utils.book_new();

    const dataSheet =
      XLSX.utils.aoa_to_sheet([
        [...TEMPLATE_HEADERS],
      ]);

    dataSheet['!cols'] = [
      { wch: 38 },
      { wch: 22 },
      { wch: 24 },
      { wch: 12 },
    ];

    XLSX.utils.book_append_sheet(
      workbook,
      dataSheet,
      'ORDENES_COMPRA',
    );

    const metadataSheet =
      XLSX.utils.aoa_to_sheet([
        [
          'templateVersion',
          TEMPLATE_VERSION,
        ],
        [
          'importType',
          IMPORT_TYPE,
        ],
      ]);

    XLSX.utils.book_append_sheet(
      workbook,
      metadataSheet,
      'METADATA',
    );

    const content: unknown =
      XLSX.write(
        workbook,
        {
          type: 'buffer',
          bookType: 'xlsx',
        },
      );

    if (
      Buffer.isBuffer(
        content,
      )
    ) {
      return content;
    }

    if (
      content instanceof Uint8Array
    ) {
      return Buffer.from(
        content,
      );
    }

    throw new Error(
      'PURCHASE_ORDER_XLSX_WRITE_INVALID_OUTPUT',
    );
  }


  async import(
    file: UploadedPurchaseOrderFile,
    actor: Scope,
  ): Promise<PurchaseOrderImportResult> {
    if (
      !file.originalname
        .toLowerCase()
        .endsWith('.xlsx')
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_INVALID_XLSX',

        message:
          'Solo se admiten archivos XLSX (.xlsx).',
      });
    }

    if (
      file.size <= 0
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_FILE_EMPTY',

        message:
          'El archivo no puede estar vacío.',
      });
    }

    if (
      file.size >
      20 * 1024 * 1024
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_FILE_TOO_LARGE',

        message:
          'El archivo supera el máximo de 20 MB.',
      });
    }

    let workbook:
      XLSX.WorkBook;

    try {
      workbook =
        XLSX.read(
          file.buffer,
          {
            type: 'buffer',
            raw: true,
            cellDates: true,
          },
        );
    } catch {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_INVALID_XLSX',

        message:
          'El archivo XLSX no es legible.',
      });
    }

    this.validateMetadata(
      workbook,
    );

    const rows =
      this.parseRows(
        workbook,
      );

    const results =
      new Map<
        number,
        PurchaseOrderImportRowResult
      >();

    const reject = (
      row: ImportRow,
      code: string,
      message: string,
      source?: SourceLookupRow,
    ): void => {
      if (
        results.has(
          row.rowNumber,
        )
      ) {
        return;
      }

      results.set(
        row.rowNumber,
        {
          rowNumber:
            row.rowNumber,

          status:
            'REJECTED',

          authorizationKey:
            row.authorizationKey,

          purchaseOrderCode:
            row.purchaseOrderCode,

          planningPeriodId:
            source?.planning_period_id ??
            null,

          orderType:
            source
              ? this.orderType(
                  source.demand_bucket,
                )
              : null,

          commercialCode:
            row.commercialCode,

          quantity:
            row.quantity,

          requestedDeliveryDate:
            null,

          purchaseOrderId:
            null,

          errorCode:
            code,

          errorMessage:
            message,
        },
      );
    };


    /*
     * Validación estructural por fila.
     */
    for (
      const row of rows
    ) {
      if (
        !row.authorizationKey
      ) {
        reject(
          row,
          'PURCHASE_ORDER_AUTHORIZATION_KEY_REQUIRED',
          'CLAVE_AUTORIZACION es obligatoria.',
        );

        continue;
      }

      if (
        !row.purchaseOrderCode
      ) {
        reject(
          row,
          'PURCHASE_ORDER_CODE_REQUIRED',
          'OC es obligatoria.',
        );

        continue;
      }

      if (
        !row.commercialCode
      ) {
        reject(
          row,
          'PURCHASE_ORDER_PRODUCT_REQUIRED',
          'CODIGO_PRODUCTO es obligatorio.',
        );

        continue;
      }

      if (
        row.quantity === null
      ) {
        reject(
          row,
          'PURCHASE_ORDER_QUANTITY_INVALID',
          'CANTIDAD debe ser un entero positivo.',
        );
      }
    }


    /*
     * Una autorización solo puede aparecer una vez
     * dentro del archivo.
     */
    const keyCounts =
      new Map<
        string,
        number
      >();

    for (
      const row of rows
    ) {
      if (
        !row.authorizationKey
      ) {
        continue;
      }

      keyCounts.set(
        row.authorizationKey,
        (
          keyCounts.get(
            row.authorizationKey,
          ) ?? 0
        ) + 1,
      );
    }

    for (
      const row of rows
    ) {
      if (
        row.authorizationKey &&
        (
          keyCounts.get(
            row.authorizationKey,
          ) ?? 0
        ) > 1
      ) {
        reject(
          row,
          'PURCHASE_ORDER_DUPLICATE_AUTHORIZATION_KEY',
          'CLAVE_AUTORIZACION está repetida dentro del archivo.',
        );
      }
    }


    const lookupKeys =
      [
        ...new Set(
          rows
            .filter(
              (row) =>
                !results.has(
                  row.rowNumber,
                ) &&
                row.authorizationKey,
            )
            .map(
              (row) =>
                row.authorizationKey!,
            ),
        ),
      ];


    const sourceByKey =
      new Map<
        string,
        SourceLookupRow
      >();


    if (
      lookupKeys.length
    ) {
      const sourceResult =
        await this.database.pool.query<SourceLookupRow>(
          `
            with ranked as (
              select
                ai.id
                  as authorization_item_id,

                ai.authorization_key,

                ds.commercial_code,

                ds.projected_demand_line_id,

                ds.planning_period_id,

                ds.demand_bucket,

                ds.quantity::int
                  as source_quantity,

                pdl.revision::int
                  as revision,

                coalesce(
                  (
                    select
                      sum(
                        poas.source_quantity_snapshot
                      )

                    from
                      purchase_order_authorization_sources poas

                    join purchase_order_lines pol
                      on pol.id =
                         poas.purchase_order_line_id

                    join purchase_orders po
                      on po.id =
                         pol.purchase_order_id

                    where
                      poas.authorization_item_id =
                        ai.id

                      and po.status not in (
                        'CANCELLED',
                        'REJECTED'
                      )
                  ),
                  0
                )::int
                  as already_committed,

                row_number() over (
                  partition by
                    ai.authorization_key

                  order by
                    case pp.status
                      when 'PURCHASING'
                        then 1

                      when 'PLANNING_CLOSED'
                        then 2

                      when 'OPEN'
                        then 3

                      else 9
                    end,

                    pp.start_date desc,

                    pdl.updated_at desc
                ) as rn

              from
                authorization_items ai

              join demand_sources ds
                on ds.authorization_item_id =
                   ai.id

              join projected_demand_lines pdl
                on pdl.id =
                   ds.projected_demand_line_id

              join planning_periods pp
                on pp.id =
                   ds.planning_period_id

              where
                ai.authorization_key =
                  any($1::text[])

                and pdl.status in (
                  'OPEN',
                  'FROZEN'
                )

                and pp.status in (
                  'OPEN',
                  'PLANNING_CLOSED',
                  'PURCHASING'
                )
            )

            select
              authorization_item_id,
              authorization_key,
              commercial_code,
              projected_demand_line_id,
              planning_period_id,
              demand_bucket,
              source_quantity,
              already_committed,
              revision

            from ranked

            where rn = 1
          `,
          [
            lookupKeys,
          ],
        );

      for (
        const source of
        sourceResult.rows
      ) {
        sourceByKey.set(
          source.authorization_key,
          source,
        );
      }
    }


    const resolvedRows:
      ResolvedRow[] = [];


    for (
      const row of rows
    ) {
      if (
        results.has(
          row.rowNumber,
        )
      ) {
        continue;
      }

      const source =
        sourceByKey.get(
          row.authorizationKey!,
        );

      if (
        !source
      ) {
        reject(
          row,
          'PURCHASE_ORDER_AUTHORIZATION_DEMAND_NOT_FOUND',
          'La autorización no tiene demanda vigente disponible para compra.',
        );

        continue;
      }

      if (
        source.commercial_code
          .trim()
          .toUpperCase() !==
        row.commercialCode!
          .trim()
          .toUpperCase()
      ) {
        reject(
          row,
          'PURCHASE_ORDER_PRODUCT_MISMATCH',
          'CODIGO_PRODUCTO no corresponde a la CLAVE_AUTORIZACION.',
          source,
        );

        continue;
      }

      const sourceAvailable =
        Number(
          source.source_quantity,
        ) -
        Number(
          source.already_committed,
        );

      if (
        row.quantity! >
        sourceAvailable
      ) {
        reject(
          row,
          'PURCHASE_ORDER_AUTHORIZATION_QUANTITY_EXCEEDED',
          `La autorización solo tiene ${Math.max(
            sourceAvailable,
            0,
          )} unidad(es) disponibles para compra.`,
          source,
        );

        continue;
      }

      resolvedRows.push({
        ...row,
        source,
      });
    }


    /*
     * Una OC se importa como unidad atómica:
     * si una fila de la misma OC falló,
     * no se crea una OC parcial.
     */
    const rowsByOc =
      new Map<
        string,
        ImportRow[]
      >();

    for (
      const row of rows
    ) {
      if (
        !row.purchaseOrderCode
      ) {
        continue;
      }

      const collection =
        rowsByOc.get(
          row.purchaseOrderCode,
        ) ?? [];

      collection.push(
        row,
      );

      rowsByOc.set(
        row.purchaseOrderCode,
        collection,
      );
    }

    for (
      const [
        ,
        groupRows,
      ] of rowsByOc
    ) {
      const groupHasFailure =
        groupRows.some(
          (row) =>
            results.has(
              row.rowNumber,
            ),
        );

      if (
        !groupHasFailure
      ) {
        continue;
      }

      for (
        const row of groupRows
      ) {
        if (
          !results.has(
            row.rowNumber,
          )
        ) {
          reject(
            row,
            'PURCHASE_ORDER_GROUP_REJECTED',
            'La OC contiene otra fila inválida; no se creó parcialmente.',
            sourceByKey.get(
              row.authorizationKey!,
            ),
          );
        }
      }
    }


    const readyRows =
      resolvedRows.filter(
        (row) =>
          !results.has(
            row.rowNumber,
          ),
      );


    const groups =
      new Map<
        string,
        ResolvedRow[]
      >();

    for (
      const row of readyRows
    ) {
      const collection =
        groups.get(
          row.purchaseOrderCode!,
        ) ?? [];

      collection.push(
        row,
      );

      groups.set(
        row.purchaseOrderCode!,
        collection,
      );
    }


    let createdOrders = 0;


    for (
      const [
        purchaseOrderCode,
        groupRows,
      ] of groups
    ) {
      const periodIds =
        new Set(
          groupRows.map(
            (row) =>
              row.source
                .planning_period_id,
          ),
        );

      const buckets =
        new Set(
          groupRows.map(
            (row) =>
              row.source
                .demand_bucket,
          ),
        );

      if (
        periodIds.size !== 1 ||
        buckets.size !== 1
      ) {
        for (
          const row of groupRows
        ) {
          reject(
            row,
            'PURCHASE_ORDER_GROUP_CONTEXT_MISMATCH',
            'Todas las filas de una misma OC deben pertenecer al mismo período y tipo de demanda.',
            row.source,
          );
        }

        continue;
      }


      const existing =
        await this.database.pool.query<{
          id: string;
        }>(
          `
            select id

            from purchase_orders

            where purchase_order_code =
              $1

            limit 1
          `,
          [
            purchaseOrderCode,
          ],
        );

      if (
        existing.rowCount
      ) {
        for (
          const row of groupRows
        ) {
          reject(
            row,
            'PURCHASE_ORDER_CODE_ALREADY_EXISTS',
            'La OC ya existe en el sistema.',
            row.source,
          );
        }

        continue;
      }


      const planningPeriodId =
        groupRows[0]!
          .source
          .planning_period_id;

      const demandBucket =
        groupRows[0]!
          .source
          .demand_bucket;

      const orderType =
        this.orderType(
          demandBucket,
        );


      const lineGroups =
        new Map<
          string,
          {
            projectedDemandLineId: string;
            expectedDemandRevision: number;
            requestedQuantity: number;
            demandBucket: DemandBucket;
          }
        >();


      for (
        const row of groupRows
      ) {
        const demandLineId =
          row.source
            .projected_demand_line_id;

        const current =
          lineGroups.get(
            demandLineId,
          );

        if (
          current
        ) {
          current.requestedQuantity +=
            row.quantity!;
        } else {
          lineGroups.set(
            demandLineId,
            {
              projectedDemandLineId:
                demandLineId,

              expectedDemandRevision:
                Number(
                  row.source.revision,
                ),

              requestedQuantity:
                row.quantity!,

              demandBucket:
                row.source
                  .demand_bucket,
            },
          );
        }
      }


      let created:
        {
          id: string;
          version: number;
        }
        | null = null;


      try {
        const createdResult =
          await this.orders.create(
            {
              planningPeriodId,

              orderType,

              purchaseOrderCode,

              lines: [
                ...lineGroups.values(),
              ],
            },
            actor,
          );


        if (
          !createdResult ||
          typeof createdResult !==
            'object' ||
          !('id' in createdResult) ||
          !('version' in createdResult)
        ) {
          throw new Error(
            'PURCHASE_ORDER_IMPORT_CREATE_INVALID_RESPONSE',
          );
        }


        created =
          createdResult as {
            id: string;
            version: number;
          };


        /*
         * La demanda física sigue siendo fungible por producto.
         * La trazabilidad lógica sí queda limitada a las
         * CLAVE_AUTORIZACION incluidas en el XLSX.
         */
        await this.replaceAuthorizationSources(
          created.id,
          groupRows,
          actor,
        );


        /*
         * Un cargue válido de OC debe dejarla disponible
         * inmediatamente para OLP.
         */
        await this.orders.issue(
          created.id,
          created.version,
          actor,
        );


        createdOrders += 1;


        for (
          const row of groupRows
        ) {
          results.set(
            row.rowNumber,
            {
              rowNumber:
                row.rowNumber,

              status:
                'ACCEPTED',

              authorizationKey:
                row.authorizationKey,

              purchaseOrderCode,

              planningPeriodId,

              orderType,

              commercialCode:
                row.commercialCode,

              quantity:
                row.quantity,

              requestedDeliveryDate:
                null,

              purchaseOrderId:
                created.id,

              errorCode:
                null,

              errorMessage:
                null,
            },
          );
        }
      } catch (
        error
      ) {
        /*
         * Si se alcanzó a crear el DRAFT pero falló la
         * selección de fuentes o la emisión, se cancela.
         * No queda cobertura activa parcial.
         */
        if (
          created
        ) {
          try {
            await this.orders.cancel(
              created.id,
              created.version,
              actor,
            );
          } catch {
            // La validación posterior detectará cualquier
            // estado excepcional. No ocultar el error original.
          }
        }

        const failure =
          errorInformation(
            error,
          );

        for (
          const row of groupRows
        ) {
          reject(
            row,
            failure.code,
            failure.message,
            row.source,
          );
        }
      }
    }


    for (
      const row of rows
    ) {
      if (
        !results.has(
          row.rowNumber,
        )
      ) {
        reject(
          row,
          'PURCHASE_ORDER_IMPORT_UNRESOLVED_ROW',
          'La fila no pudo resolverse.',
          row.authorizationKey
            ? sourceByKey.get(
                row.authorizationKey,
              )
            : undefined,
        );
      }
    }


    const orderedResults =
      [
        ...results.values(),
      ].sort(
        (a, b) =>
          a.rowNumber -
          b.rowNumber,
      );


    const acceptedRows =
      orderedResults.filter(
        (row) =>
          row.status ===
          'ACCEPTED',
      ).length;

    const rejectedRows =
      orderedResults.length -
      acceptedRows;


    return {
      totalRows:
        rows.length,

      acceptedRows,

      rejectedRows,

      createdOrders,

      rejectedWorkbookBase64:
        rejectedRows > 0
          ? this.buildRejectedWorkbook(
              rows,
              orderedResults,
            )
          : null,

      results:
        orderedResults,
    };
  }


  private validateMetadata(
    workbook: XLSX.WorkBook,
  ): void {
    const metadataSheet =
      workbook.Sheets[
        'METADATA'
      ];

    if (
      !metadataSheet
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_METADATA_REQUIRED',

        message:
          'La plantilla no contiene la hoja METADATA.',
      });
    }

    const matrix =
      XLSX.utils.sheet_to_json<
        unknown[]
      >(
        metadataSheet,
        {
          header: 1,
          raw: true,
          defval: null,
          blankrows: false,
        },
      );

    const metadata =
      new Map<
        string,
        string
      >();

    for (
      const row of matrix
    ) {
      const key =
        normalizeText(
          row[0],
        );

      const value =
        normalizeText(
          row[1],
        );

      if (
        key &&
        value
      ) {
        metadata.set(
          key,
          value,
        );
      }
    }

    if (
      metadata.get(
        'templateVersion',
      ) !== TEMPLATE_VERSION ||
      metadata.get(
        'importType',
      ) !== IMPORT_TYPE
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_TEMPLATE_VERSION_INVALID',

        message:
          'La plantilla de OC no corresponde a la versión esperada.',
      });
    }
  }


  private parseRows(
    workbook: XLSX.WorkBook,
  ): ImportRow[] {
    const sheetName =
      workbook.SheetNames.find(
        (name) =>
          name !==
          'METADATA',
      );

    if (
      !sheetName
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_DATA_SHEET_REQUIRED',

        message:
          'La plantilla no contiene una hoja de datos.',
      });
    }

    const sheet =
      workbook.Sheets[
        sheetName
      ];

    if (
      !sheet
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_DATA_SHEET_REQUIRED',

        message:
          'No fue posible leer la hoja de datos.',
      });
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

    const headerRow =
      matrix[0];

    if (
      !headerRow
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_HEADERS_REQUIRED',

        message:
          'La plantilla no contiene encabezados.',
      });
    }

    const headers =
      headerRow.map(
        normalizeHeader,
      );

    if (
      headers.length !==
        TEMPLATE_HEADERS.length ||
      TEMPLATE_HEADERS.some(
        (
          expected,
          index,
        ) =>
          headers[index] !==
          expected,
      )
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_HEADERS_INVALID',

        message:
          `Los encabezados deben ser exactamente: ${TEMPLATE_HEADERS.join(
            ', ',
          )}.`,
      });
    }


    const rows:
      ImportRow[] = [];


    for (
      let index = 1;
      index <
      matrix.length;
      index += 1
    ) {
      const values =
        matrix[index] ?? [];

      const blank =
        values.every(
          (value) =>
            normalizeText(
              value,
            ) === null,
        );

      if (
        blank
      ) {
        continue;
      }

      const raw:
        Record<
          string,
          unknown
        > = {};

      for (
        let column = 0;
        column <
        TEMPLATE_HEADERS.length;
        column += 1
      ) {
        raw[
          TEMPLATE_HEADERS[
            column
          ]!
        ] =
          values[column] ??
          null;
      }

      rows.push({
        rowNumber:
          index + 1,

        raw,

        authorizationKey:
          normalizeText(
            raw[
              'CLAVE_AUTORIZACION'
            ],
          ),

        purchaseOrderCode:
          normalizeText(
            raw[
              'OC'
            ],
          ),

        commercialCode:
          normalizeText(
            raw[
              'CODIGO_PRODUCTO'
            ],
          ),

        quantity:
          positiveInteger(
            raw[
              'CANTIDAD'
            ],
          ),
      });
    }


    if (
      rows.length === 0
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_NO_ROWS',

        message:
          'La plantilla no contiene filas para procesar.',
      });
    }


    return rows;
  }


  private orderType(
    bucket: DemandBucket,
  ): PurchaseOrderType {
    return bucket ===
      'REGULAR'
      ? 'STANDARD'
      : 'COMPLEMENTARY';
  }


  private async replaceAuthorizationSources(
    purchaseOrderId: string,
    rows: ResolvedRow[],
    actor: Scope,
  ): Promise<void> {
    const client =
      await this.database.pool.connect();

    try {
      await client.query(
        'begin',
      );

      const lines =
        await client.query<{
          id: string;

          projected_demand_line_id: string;

          projected_demand_revision: number;

          requested_quantity: number;
        }>(
          `
            select
              id,
              projected_demand_line_id,
              projected_demand_revision,
              requested_quantity

            from purchase_order_lines

            where purchase_order_id =
              $1

            for update
          `,
          [
            purchaseOrderId,
          ],
        );


      const lineByDemand =
        new Map(
          lines.rows.map(
            (line) => [
              line.projected_demand_line_id,
              line,
            ],
          ),
        );


      const selectedByDemand =
        new Map<
          string,
          number
        >();


      for (
        const row of rows
      ) {
        selectedByDemand.set(
          row.source
            .projected_demand_line_id,

          (
            selectedByDemand.get(
              row.source
                .projected_demand_line_id,
            ) ?? 0
          ) +
            row.quantity!,
        );
      }


      for (
        const line of
        lines.rows
      ) {
        if (
          (
            selectedByDemand.get(
              line.projected_demand_line_id,
            ) ?? 0
          ) !==
          line.requested_quantity
        ) {
          throw new Error(
            'PURCHASE_ORDER_IMPORT_SOURCE_TOTAL_MISMATCH',
          );
        }
      }


      await client.query(
        `
          delete from
            purchase_order_authorization_sources

          where
            purchase_order_line_id in (
              select id

              from purchase_order_lines

              where purchase_order_id =
                $1
            )
        `,
        [
          purchaseOrderId,
        ],
      );


      for (
        const row of rows
      ) {
        const line =
          lineByDemand.get(
            row.source
              .projected_demand_line_id,
          );

        if (
          !line
        ) {
          throw new Error(
            'PURCHASE_ORDER_IMPORT_LINE_NOT_FOUND',
          );
        }


        await client.query(
          `
            insert into
              purchase_order_authorization_sources (
                purchase_order_line_id,
                authorization_item_id,
                projected_demand_line_id,
                projected_demand_revision,
                source_quantity_snapshot
              )

            values (
              $1,
              $2,
              $3,
              $4,
              $5
            )
          `,
          [
            line.id,

            row.source
              .authorization_item_id,

            row.source
              .projected_demand_line_id,

            line.projected_demand_revision,

            row.quantity,
          ],
        );
      }


      await client.query(
        `
          insert into audit_events (
            actor_type,
            actor_id,
            organization_id,
            action,
            resource_type,
            resource_id,
            after,
            correlation_id,
            request_id,
            result
          )

          values (
            'USER',
            $1,
            $2,
            'PURCHASE_ORDER_IMPORT_AUTHORIZATION_SOURCES_SELECTED',
            'purchase_order',
            $3,
            $4::jsonb,
            $5,
            $5,
            'SUCCESS'
          )
        `,
        [
          actor.userId,

          actor.organizationId,

          purchaseOrderId,

          JSON.stringify({
            authorizationCount:
              rows.length,

            sourceQuantity:
              rows.reduce(
                (
                  total,
                  row,
                ) =>
                  total +
                  row.quantity!,
                0,
              ),
          }),

          actor.correlationId,
        ],
      );


      await client.query(
        'commit',
      );
    } catch (
      error
    ) {
      await client.query(
        'rollback',
      );

      throw error;
    } finally {
      client.release();
    }
  }


  private buildRejectedWorkbook(
    rows: ImportRow[],
    results:
      PurchaseOrderImportRowResult[],
  ): string {
    const resultByRow =
      new Map(
        results.map(
          (result) => [
            result.rowNumber,
            result,
          ],
        ),
      );


    const rejected =
      rows
        .map(
          (row) => {
            const result =
              resultByRow.get(
                row.rowNumber,
              );

            if (
              !result ||
              result.status !==
                'REJECTED'
            ) {
              return null;
            }

            return {
              CLAVE_AUTORIZACION:
                row.authorizationKey,

              OC:
                row.purchaseOrderCode,

              CODIGO_PRODUCTO:
                row.commercialCode,

              CANTIDAD:
                row.quantity,

              RESULTADO:
                'RECHAZADO',

              CODIGO_ERROR:
                result.errorCode,

              DESCRIPCION_ERROR:
                result.errorMessage,
            };
          },
        )
        .filter(
          (
            row,
          ): row is NonNullable<
            typeof row
          > =>
            row !== null,
        );


    const workbook =
      XLSX.utils.book_new();

    const sheet =
      XLSX.utils.json_to_sheet(
        rejected,
        {
          header: [
            ...TEMPLATE_HEADERS,
            'RESULTADO',
            'CODIGO_ERROR',
            'DESCRIPCION_ERROR',
          ],
        },
      );


    XLSX.utils.book_append_sheet(
      workbook,
      sheet,
      'RECHAZADOS',
    );


    return XLSX.write(
      workbook,
      {
        type: 'base64',
        bookType: 'xlsx',
      },
    ) as string;
  }
}
