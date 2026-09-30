import {
  BadRequestException,
  Inject,
  Injectable,
} from '@nestjs/common';

import type { createDatabase } from '@authorization/database';

import {
  currentBogotaDate,
  evaluateAuthorizationOperationalWindow,
} from '@authorization/domain';

import * as XLSX from 'xlsx';

import type {
  PoolClient,
} from 'pg';

import type { Scope } from '../common/request-scope';

import { DATABASE } from '../tokens';

import { PurchaseOrderService } from './purchase-order.service';


type Database =
  ReturnType<typeof createDatabase>;

type ExistingAuthorizationRow =
  Readonly<{
    id: string;

    authorization_key: string;

    commercial_code: string;

    authorization_version: number;

    authorized_quantity: number;

    enablement_status: string;

    source_status_normalized: string;

    assignment_raw:
      string | null;

    expiration_raw:
      string | null;

    closed: boolean;
  }>;




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

  originAuthorizationKey: string | null;

  destinationAuthorizationKey: string | null;

  /*
   * Compatibilidad interna con el flujo histórico
   * de creación de OC:
   *
   * authorizationKey siempre representa
   * AUTO_DESTINO.
   */
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
  'PURCHASE_ORDERS_V3';

const LEGACY_TEMPLATE_VERSION =
  'PURCHASE_ORDERS_V2';

const IMPORT_TYPE =
  'PURCHASE_ORDERS';

const TEMPLATE_HEADERS = [
  'CLAVE_AUTORIZACION_ORIGEN',
  'CLAVE_AUTORIZACION_DESTINO',
  'OC',
  'CODIGO_PRODUCTO',
  'CANTIDAD',
] as const;

const LEGACY_TEMPLATE_HEADERS = [
  'AUTO_ORIGEN',
  'AUTO_DESTINO',
  'OC',
  'CODIGO_PRODUCTO',
  'CANTIDAD',
] as const;

const SUPPORTED_TEMPLATE_VERSIONS =
  new Set<string>([
    TEMPLATE_VERSION,
    LEGACY_TEMPLATE_VERSION,
  ]);



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
        !row.destinationAuthorizationKey
      ) {
        reject(
          row,
          'PURCHASE_ORDER_DESTINATION_AUTHORIZATION_REQUIRED',
          'CLAVE_AUTORIZACION_DESTINO es obligatoria.',
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
          'CLAVE_AUTORIZACION_DESTINO está repetida dentro del archivo.',
        );
      }
    }


    /*
     * ==================================================
     * INFERENCIA DE OPERACIÓN
     *
     * No existe columna ACCION.
     *
     * OC inexistente
     * + AUTO_ORIGEN vacía
     *   => CREAR_OC
     *
     * OC existente
     * + AUTO_ORIGEN vacía
     *   => ASIGNAR_DISPONIBLE
     *
     * OC existente
     * + AUTO_ORIGEN informada
     *   => REASIGNAR
     * ==================================================
     */

    const candidateOrderCodes =
      [
        ...new Set(
          rows
            .filter(
              (row) =>
                !results.has(
                  row.rowNumber,
                ) &&
                row.purchaseOrderCode,
            )
            .map(
              (row) =>
                row.purchaseOrderCode!,
            ),
        ),
      ];


    const existingOrderCodes =
      new Set<string>();


    if (
      candidateOrderCodes.length
    ) {
      const existingOrders =
        await this.database.pool.query<{
          purchase_order_code:
            string;
        }>(
          `
            select
              purchase_order_code

            from
              purchase_orders

            where
              purchase_order_code =
                any($1::text[])
          `,
          [
            candidateOrderCodes,
          ],
        );

      for (
        const order of
        existingOrders.rows
      ) {
        existingOrderCodes.add(
          order.purchase_order_code,
        );
      }
    }


    /*
     * AUTO_ORIGEN solo tiene sentido sobre
     * una OC ya existente.
     *
     * Nunca se interpreta AUTO_ORIGEN como
     * parte de la creación de una nueva OC.
     */
    for (
      const row of rows
    ) {
      if (
        results.has(
          row.rowNumber,
        ) ||
        !row.purchaseOrderCode ||
        !row.originAuthorizationKey
      ) {
        continue;
      }

      if (
        !existingOrderCodes.has(
          row.purchaseOrderCode,
        )
      ) {
        reject(
          row,
          'PURCHASE_ORDER_REASSIGNMENT_OC_NOT_FOUND',
          'AUTO_ORIGEN solo puede usarse para reasignar una OC que ya existe.',
        );
      }
    }


    /*
     * Procesar OC existentes antes del flujo
     * histórico de creación.
     *
     * Cada OC es una unidad atómica.
     */
    const existingGroups =
      new Map<
        string,
        ImportRow[]
      >();


    for (
      const row of rows
    ) {
      if (
        !row.purchaseOrderCode ||
        !existingOrderCodes.has(
          row.purchaseOrderCode,
        )
      ) {
        continue;
      }

      const collection =
        existingGroups.get(
          row.purchaseOrderCode,
        ) ?? [];

      collection.push(
        row,
      );

      existingGroups.set(
        row.purchaseOrderCode,
        collection,
      );
    }


    for (
      const [
        purchaseOrderCode,
        groupRows,
      ] of existingGroups
    ) {
      /*
       * Si una fila de la OC ya falló validación
       * estructural, no ejecutar parcialmente.
       */
      if (
        groupRows.some(
          (row) =>
            results.has(
              row.rowNumber,
            ),
        )
      ) {
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
              'La OC contiene otra fila inválida; no se procesó parcialmente.',
            );
          }
        }

        continue;
      }


      try {
        const context =
          await this.processExistingPurchaseOrderGroup(
            purchaseOrderCode,
            groupRows,
            actor,
          );


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
                row.destinationAuthorizationKey,

              purchaseOrderCode,

              planningPeriodId:
                context.planningPeriodId,

              orderType:
                context.orderType,

              commercialCode:
                row.commercialCode,

              quantity:
                row.quantity,

              requestedDeliveryDate:
                null,

              purchaseOrderId:
                context.purchaseOrderId,

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
          );
        }
      }
    }


    /*
     * ==================================================
     * DIRECT_AUTHORIZATION_IMPORT_WAVE
     *
     * Una OC nueva cargada por XLSX nace directamente
     * de las autorizaciones incluidas en la plantilla.
     *
     * NO requiere:
     * - demand_sources
     * - projected_demand_lines
     * - planning_periods
     * - agenda del paciente
     *
     * La AUTO determina producto/cantidad.
     * El AT determina el punto MEDICARTE.
     * ==================================================
     */
    let directCreatedOrders =
      0;


    const newOrderGroups =
      new Map<
        string,
        ImportRow[]
      >();


    for (
      const row of rows
    ) {
      if (
        !row.purchaseOrderCode ||
        existingOrderCodes.has(
          row.purchaseOrderCode,
        )
      ) {
        continue;
      }

      const collection =
        newOrderGroups.get(
          row.purchaseOrderCode,
        ) ?? [];

      collection.push(
        row,
      );

      newOrderGroups.set(
        row.purchaseOrderCode,
        collection,
      );
    }


    for (
      const [
        purchaseOrderCode,
        groupRows,
      ] of newOrderGroups
    ) {
      if (
        groupRows.some(
          (row) =>
            results.has(
              row.rowNumber,
            ),
        )
      ) {
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
            );
          }
        }

        continue;
      }


      try {
        const created =
          await this.createDirectAuthorizationPurchaseOrderGroup(
            purchaseOrderCode,
            groupRows,
            actor,
          );


        directCreatedOrders +=
          1;


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
                row.destinationAuthorizationKey,

              purchaseOrderCode,

              planningPeriodId:
                null,

              orderType:
                'STANDARD',

              commercialCode:
                row.commercialCode,

              quantity:
                row.quantity,

              requestedDeliveryDate:
                null,

              purchaseOrderId:
                created.purchaseOrderId,

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
          );
        }
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


    const destinationGuardByKey =
      new Map<
        string,
        {
          closed: boolean;
          assigned: boolean;
        }
      >();


    if (
      lookupKeys.length
    ) {
      const destinationGuards =
        await this.database.pool.query<{
          authorization_key:
            string;

          closed:
            boolean;

          assigned:
            boolean;
        }>(
          `
            select
              ai.authorization_key,

              (
                exists (
                  select
                    1

                  from
                    authorization_fulfillments af

                  where
                    af.authorization_item_id =
                      ai.id
                )

                or

                exists (
                  select
                    1

                  from
                    patient_applications pa

                  where
                    pa.authorization_item_id =
                      ai.id

                    and pa.status =
                      'CONFIRMED'
                )
              )
                as closed,

              (
                exists (
                  select
                    1

                  from
                    purchase_order_authorization_sources poas

                  join
                    purchase_order_lines pol
                      on pol.id =
                         poas.purchase_order_line_id

                  join
                    purchase_orders po
                      on po.id =
                         pol.purchase_order_id

                  where
                    poas.authorization_item_id =
                      ai.id

                    and po.status not in (
                      'CANCELLED',
                      'REJECTED'
                    )
                )

                or

                exists (
                  select
                    1

                  from
                    inventory_authorization_allocations iaa

                  join
                    purchase_orders po
                      on po.id =
                         iaa.purchase_order_id

                  where
                    iaa.authorization_item_id =
                      ai.id

                    and po.status not in (
                      'CANCELLED',
                      'REJECTED'
                    )

                    and iaa.status in (
                      'ALLOCATED',
                      'PARTIALLY_CONSUMED'
                    )

                    and greatest(
                      iaa.allocated_quantity
                      -
                      iaa.consumed_quantity
                      -
                      iaa.released_quantity,
                      0
                    ) > 0
                )
              )
                as assigned

            from
              authorization_items ai

            where
              ai.authorization_key =
                any($1::text[])

              and exists (
                select
                  1

                from
                  authorization_item_organizations aio

                where
                  aio.authorization_item_id =
                    ai.id

                  and aio.organization_id =
                    $2
              )
          `,
          [
            lookupKeys,
            actor.organizationId,
          ],
        );


      for (
        const guard of
        destinationGuards.rows
      ) {
        destinationGuardByKey.set(
          guard.authorization_key,
          {
            closed:
              guard.closed,

            assigned:
              guard.assigned,
          },
        );
      }
    }


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

      const destinationGuard =
        destinationGuardByKey.get(
          row.authorizationKey!,
        );


      if (
        destinationGuard?.closed
      ) {
        reject(
          row,
          'PURCHASE_ORDER_DESTINATION_CLOSED',
          'AUTO_DESTINO ya está cerrada por entrega o aplicación.',
        );

        continue;
      }


      if (
        destinationGuard?.assigned
      ) {
        reject(
          row,
          'PURCHASE_ORDER_DESTINATION_ALREADY_ASSIGNED',
          'AUTO_DESTINO ya tiene una OC o una asignación activa.',
        );

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

      if (
        row.quantity !==
        Number(
          source.source_quantity,
        )
      ) {
        reject(
          row,
          'PURCHASE_ORDER_DESTINATION_QUANTITY_MISMATCH',
          `La cantidad de AUTO_DESTINO es ${source.source_quantity}; la fila intenta asignar ${row.quantity}. La OC debe asignar la cantidad completa de la autorización.`,
          source,
        );

        continue;
      }


      if (
        row.quantity !==
        Number(
          source.source_quantity,
        )
      ) {
        reject(
          row,
          'PURCHASE_ORDER_DESTINATION_QUANTITY_MISMATCH',
          `La cantidad de AUTO_DESTINO es ${source.source_quantity}; la fila intenta asignar ${row.quantity}. La OC debe asignar la cantidad completa de la autorización.`,
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
        row.quantity >
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

      createdOrders:
        createdOrders +
        directCreatedOrders,

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

    const templateVersion =
      metadata.get(
        'templateVersion',
      );

    if (
      !templateVersion ||
      !SUPPORTED_TEMPLATE_VERSIONS.has(
        templateVersion,
      ) ||
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

    const currentHeaders =
      headers.length ===
        TEMPLATE_HEADERS.length
      &&
      TEMPLATE_HEADERS.every(
        (
          expected,
          index,
        ) =>
          headers[index] ===
          expected,
      );


    const legacyHeaders =
      headers.length ===
        LEGACY_TEMPLATE_HEADERS.length
      &&
      LEGACY_TEMPLATE_HEADERS.every(
        (
          expected,
          index,
        ) =>
          headers[index] ===
          expected,
      );


    if (
      !currentHeaders &&
      !legacyHeaders
    ) {
      throw new BadRequestException({
        code:
          'PURCHASE_ORDER_IMPORT_HEADERS_INVALID',

        message:
          `Los encabezados actuales deben ser exactamente: ${TEMPLATE_HEADERS.join(
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

      /*
       * Tanto V2 como V3 se normalizan internamente
       * al contrato V3.
       *
       * La posición semántica de las columnas no cambia.
       */
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

        originAuthorizationKey:
          normalizeText(
            raw[
              'CLAVE_AUTORIZACION_ORIGEN'
            ],
          ),

        destinationAuthorizationKey:
          normalizeText(
            raw[
              'CLAVE_AUTORIZACION_DESTINO'
            ],
          ),

        authorizationKey:
          normalizeText(
            raw[
              'CLAVE_AUTORIZACION_DESTINO'
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


  private existingOrderError(
    code: string,
    message: string,
  ): never {
    throw new BadRequestException({
      code,
      message,
    });
  }


  private async loadExistingAuthorization(
    client: PoolClient,
    authorizationKey: string,
    actor: Scope,
  ): Promise<ExistingAuthorizationRow> {
    const result =
      await client.query<ExistingAuthorizationRow>(
        `
          select
            ai.id,

            ai.authorization_key,

            ai.codigo_medicamento
              as commercial_code,

            ai.version
              as authorization_version,

            case
              when btrim(
                     coalesce(
                       ai.source_data
                         ->> 'CANTIDAD',
                       ''
                     )
                   )
                   ~ '^[1-9][0-9]*$'

              then (
                ai.source_data
                  ->> 'CANTIDAD'
              )::int

              else 0
            end
              as authorized_quantity,

            ai.enablement_status,

            ai.source_status_normalized,

            ai.source_data
              ->> 'FECHA_ASIGNACION'
              as assignment_raw,

            ai.source_data
              ->> 'FECHA_FINAL_VIGENCIA'
              as expiration_raw,

            (
              exists (
                select
                  1

                from
                  authorization_fulfillments af

                where
                  af.authorization_item_id =
                    ai.id
              )

              or

              exists (
                select
                  1

                from
                  patient_applications pa

                where
                  pa.authorization_item_id =
                    ai.id

                  and pa.status =
                    'CONFIRMED'
              )
            )
              as closed

          from
            authorization_items ai

          where
            ai.authorization_key =
              $1

            and exists (
              select
                1

              from
                authorization_item_organizations aio

              where
                aio.authorization_item_id =
                  ai.id

                and aio.organization_id =
                  $2
            )

          limit 2

          for update
        `,
        [
          authorizationKey,
          actor.organizationId,
        ],
      );


    if (
      result.rows.length ===
      0
    ) {
      this.existingOrderError(
        'PURCHASE_ORDER_AUTHORIZATION_NOT_FOUND',
        `No existe la autorización ${authorizationKey}.`,
      );
    }


    if (
      result.rows.length >
      1
    ) {
      this.existingOrderError(
        'PURCHASE_ORDER_AUTHORIZATION_AMBIGUOUS',
        `La autorización ${authorizationKey} no es unívoca.`,
      );
    }


    return result.rows[0]!;
  }


  private assertDestinationOperationalWindow(
    destination:
      ExistingAuthorizationRow,
  ): void {
    const operationalWindow =
      evaluateAuthorizationOperationalWindow({
        assignmentDate:
          destination.assignment_raw,

        expirationDate:
          destination.expiration_raw,

        todayBogota:
          currentBogotaDate(),
      });


    if (
      !operationalWindow.eligible
    ) {
      this.existingOrderError(
        'PURCHASE_ORDER_DESTINATION_OUT_OF_OPERATION',
        `AUTO_DESTINO ${destination.authorization_key} no está dentro de la ventana operacional vigente (${operationalWindow.status}).`,
      );
    }
  }


  private async destinationIsBusy(
    client: PoolClient,
    authorizationItemId: string,
  ): Promise<boolean> {
    const result =
      await client.query<{
        source_busy:
          boolean;

        allocation_busy:
          boolean;
      }>(
        `
          select
            exists (
              select
                1

              from
                purchase_order_authorization_sources poas

              join
                purchase_order_lines pol
                  on pol.id =
                     poas.purchase_order_line_id

              join
                purchase_orders po
                  on po.id =
                     pol.purchase_order_id

              where
                poas.authorization_item_id =
                  $1

                and po.status not in (
                  'CANCELLED',
                  'REJECTED'
                )
            )
              as source_busy,

            exists (
              select
                1

              from
                inventory_authorization_allocations iaa

              join
                purchase_orders po
                  on po.id =
                     iaa.purchase_order_id

              where
                iaa.authorization_item_id =
                  $1

                and po.status not in (
                  'CANCELLED',
                  'REJECTED'
                )

                and iaa.status in (
                  'ALLOCATED',
                  'PARTIALLY_CONSUMED'
                )

                and greatest(
                  iaa.allocated_quantity
                  -
                  iaa.consumed_quantity
                  -
                  iaa.released_quantity,
                  0
                ) > 0
            )
              as allocation_busy
        `,
        [
          authorizationItemId,
        ],
      );


    return Boolean(
      result.rows[0]
        ?.source_busy ||
      result.rows[0]
        ?.allocation_busy,
    );
  }


  private async destinationPoint(
    client: PoolClient,
    commercialCode: string,
  ): Promise<string> {
    /*
     * FUENTE AUTORITATIVA DEL PUNTO
     * =============================
     *
     * La plantilla de OC NO recibe punto.
     * La agenda del paciente NO determina el punto.
     * La OC NO determina el punto.
     *
     * La relación logística autoritativa es:
     *
     * CODIGO_PRODUCTO
     *   -> Anexo Tarifario
     *   -> expediente INVIMA + presentación
     *   -> product_delivery_point_mappings
     *   -> punto MEDICARTE
     */
    const result =
      await client.query<{
        dispensing_point_id:
          string;
      }>(
        `
          select distinct
            mapping.dispensing_point_id

          from
            tariff_annex_products tap

          join
            product_delivery_point_mappings mapping
              on mapping.invima_record_normalized =
                 coalesce(
                   nullif(
                     ltrim(
                       btrim(
                         tap.numero_expediente_invima
                       ),
                       '0'
                     ),
                     ''
                   ),
                   '0'
                 )

             and mapping.invima_presentation_normalized =
                 coalesce(
                   nullif(
                     ltrim(
                       btrim(
                         tap.consecutivo_invima_presentacion
                       ),
                       '0'
                     ),
                     ''
                   ),
                   '0'
                 )

          where
            tap.codigo_producto =
              $1

            and tap.active =
              true

          order by
            mapping.dispensing_point_id

          limit 2
        `,
        [
          commercialCode,
        ],
      );


    if (
      result.rows.length ===
      1
    ) {
      return result.rows[0]!
        .dispensing_point_id;
    }


    if (
      result.rows.length ===
      0
    ) {
      this.existingOrderError(
        'PURCHASE_ORDER_AT_POINT_REQUIRED',
        `El producto ${commercialCode} no tiene punto de dispensación parametrizado en el Anexo Tarifario.`,
      );
    }


    this.existingOrderError(
      'PURCHASE_ORDER_AT_POINT_AMBIGUOUS',
      `El producto ${commercialCode} resuelve más de un punto de dispensación desde el Anexo Tarifario.`,
    );
  }


  private async assertOrderProductPoint(
    client: PoolClient,
    purchaseOrderId: string,
    commercialCode: string,
    dispensingPointId: string,
  ): Promise<void> {
    const result =
      await client.query<{
        id:
          string;
      }>(
        `
          select
            pol.id

          from
            purchase_order_lines pol

          left join
            tariff_annex_products tap
              on tap.codigo_producto =
                 pol.commercial_code

             and tap.active =
                 true

          left join
            product_delivery_point_mappings mapping
              on pol.dispensing_point_id
                 is null

             and btrim(
                   coalesce(
                     tap.numero_expediente_invima,
                     ''
                   )
                 ) ~ '^[0-9]+$'

             and btrim(
                   coalesce(
                     tap.consecutivo_invima_presentacion,
                     ''
                   )
                 ) ~ '^[0-9]+$'

             and mapping.invima_record_normalized =
                 coalesce(
                   nullif(
                     ltrim(
                       btrim(
                         tap.numero_expediente_invima
                       ),
                       '0'
                     ),
                     ''
                   ),
                   '0'
                 )

             and mapping.invima_presentation_normalized =
                 coalesce(
                   nullif(
                     ltrim(
                       btrim(
                         tap.consecutivo_invima_presentacion
                       ),
                       '0'
                     ),
                     ''
                   ),
                   '0'
                 )

          where
            pol.purchase_order_id =
              $1

            and pol.commercial_code =
              $2

            and coalesce(
                  pol.dispensing_point_id,
                  mapping.dispensing_point_id
                ) =
                $3

          limit 1
        `,
        [
          purchaseOrderId,
          commercialCode,
          dispensingPointId,
        ],
      );


    if (
      result.rows.length ===
      0
    ) {
      this.existingOrderError(
        'PURCHASE_ORDER_PRODUCT_POINT_MISMATCH',
        'El producto de la OC no corresponde al punto vigente de AUTO_DESTINO.',
      );
    }
  }


  private async activeTariffSnapshot(
    client: PoolClient,
    commercialCode: string,
  ): Promise<{
    unitRate: string;
    productDescription: string | null;
    presentation: string | null;
  }> {
    const result =
      await client.query<{
        unit_rate:
          string | null;

        product_description:
          string | null;

        presentation:
          string | null;
      }>(
        `
          select
            tap.tarifa_unidad
              as unit_rate,

            coalesce(
              nullif(
                btrim(
                  tap.descripcion_generica
                ),
                ''
              ),

              nullif(
                btrim(
                  tap.descripcion_comercial
                ),
                ''
              )
            )
              as product_description,

            nullif(
              btrim(
                tap.consecutivo_invima_presentacion
              ),
              ''
            )
              as presentation

          from
            tariff_annex_products tap

          where
            tap.codigo_producto =
              $1

            and tap.active =
              true

          limit 2
        `,
        [
          commercialCode,
        ],
      );


    if (
      result.rows.length ===
      0
    ) {
      this.existingOrderError(
        'PURCHASE_ORDER_AT_PRODUCT_REQUIRED',
        `El producto ${commercialCode} no existe activo en el Anexo Tarifario.`,
      );
    }


    if (
      result.rows.length >
      1
    ) {
      this.existingOrderError(
        'PURCHASE_ORDER_AT_PRODUCT_AMBIGUOUS',
        `El producto ${commercialCode} no es unívoco en el Anexo Tarifario.`,
      );
    }


    const row =
      result.rows[0]!;

    const unitRate =
      row.unit_rate
        ?.trim();


    if (
      !unitRate
    ) {
      this.existingOrderError(
        'TARIFF_RATE_NOT_FOUND',
        `El producto ${commercialCode} no tiene tarifa activa en el Anexo Tarifario.`,
      );
    }


    return {
      unitRate,

      productDescription:
        row.product_description,

      presentation:
        row.presentation,
    };
  }


  private async attachDirectAuthorizationToOrder(
    client: PoolClient,
    purchaseOrderId: string,
    destination:
      ExistingAuthorizationRow,
    dispensingPointId: string,
    quantity: number,
  ): Promise<void> {
    /*
     * Una línea DIRECT_AUTHORIZATION agrupa únicamente
     * autorizaciones incorporadas directamente desde
     * la plantilla universal.
     *
     * Nunca fabrica projected demand.
     */
    const tariff =
      await this.activeTariffSnapshot(
        client,
        destination.commercial_code,
      );


    const current =
      await client.query<{
        id:
          string;
      }>(
        `
          select
            pol.id

          from
            purchase_order_lines pol

          where
            pol.purchase_order_id =
              $1

            and pol.commercial_code =
              $2

            and pol.dispensing_point_id =
              $3

            and pol.provenance =
              'DIRECT_AUTHORIZATION'

          order by
            pol.created_at,
            pol.id

          limit 1

          for update
        `,
        [
          purchaseOrderId,
          destination.commercial_code,
          dispensingPointId,
        ],
      );


    let lineId:
      string;


    if (
      current.rows[0]
    ) {
      lineId =
        current.rows[0].id;


      await client.query(
        `
          update
            purchase_order_lines

          set
            requested_quantity =
              requested_quantity +
              $1,

            updated_at =
              now()

          where
            id =
              $2
        `,
        [
          quantity,
          lineId,
        ],
      );
    } else {
      const inserted =
        await client.query<{
          id:
            string;
        }>(
          `
            insert into
              purchase_order_lines (
                purchase_order_id,
                commercial_code,
                provenance,
                product_description,
                presentation,
                dispensing_point_id,
                requested_quantity,
                requested_delivery_date,
                compensar_unit_rate_snapshot,
                tariff_snapshot_provenance,
                legacy_tariff_revision_id,
                projected_demand_line_id,
                projected_demand_revision,
                demand_bucket
              )

            values (
              $1,
              $2,
              'DIRECT_AUTHORIZATION',
              $3,
              $4,
              $5,
              $6,
              null,
              $7,
              'LIVE_SNAPSHOT',
              null,
              null,
              null,
              null
            )

            returning
              id
          `,
          [
            purchaseOrderId,
            destination.commercial_code,
            tariff.productDescription,
            tariff.presentation,
            dispensingPointId,
            quantity,
            tariff.unitRate,
          ],
        );


      lineId =
        inserted.rows[0]!.id;
    }


    await client.query(
      `
        insert into
          purchase_order_authorization_sources (
            purchase_order_line_id,
            authorization_item_id,
            projected_demand_line_id,
            projected_demand_revision,
            source_quantity_snapshot,
            provenance,
            evidence_at
          )

        values (
          $1,
          $2,
          null,
          null,
          $3,
          'DIRECT_AUTHORIZATION',
          now()
        )
      `,
      [
        lineId,
        destination.id,
        quantity,
      ],
    );
  }


  private async createDirectAuthorizationPurchaseOrderGroup(
    purchaseOrderCode: string,
    rows: ImportRow[],
    actor: Scope,
  ): Promise<{
    purchaseOrderId:
      string;
  }> {
    const client =
      await this.database.pool.connect();


    try {
      await client.query(
        'begin',
      );


      /*
       * Serializa creación por código OC.
       */
      await client.query(
        `
          select
            pg_advisory_xact_lock(
              hashtextextended(
                $1,
                0::bigint
              )
            )
        `,
        [
          `purchase-order:${purchaseOrderCode}`,
        ],
      );


      const existing =
        await client.query<{
          id:
            string;
        }>(
          `
            select
              id

            from
              purchase_orders

            where
              purchase_order_code =
                $1

            limit 1

            for update
          `,
          [
            purchaseOrderCode,
          ],
        );


      if (
        existing.rows.length
      ) {
        this.existingOrderError(
          'PURCHASE_ORDER_CODE_ALREADY_EXISTS',
          `La OC ${purchaseOrderCode} ya existe en el sistema.`,
        );
      }


      const plans:
        Array<{
          row:
            ImportRow;

          destination:
            ExistingAuthorizationRow;

          dispensingPointId:
            string;
        }> =
        [];


      for (
        const row of rows
      ) {
        const destination =
          await this.loadExistingAuthorization(
            client,
            row.destinationAuthorizationKey!,
            actor,
          );


        if (
          destination.closed
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_DESTINATION_CLOSED',
            `AUTO_DESTINO ${destination.authorization_key} ya está cerrada por entrega o aplicación.`,
          );
        }


        if (
          destination.enablement_status !==
            'ENABLED' ||
          destination.source_status_normalized !==
            '5'
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_DESTINATION_NOT_ENABLED',
            `AUTO_DESTINO ${destination.authorization_key} no está habilitada para operación.`,
          );
        }


        this.assertDestinationOperationalWindow(
          destination,
        );


        if (
          destination.commercial_code
            .trim()
            .toUpperCase() !==
          row.commercialCode!
            .trim()
            .toUpperCase()
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_PRODUCT_MISMATCH',
            'CODIGO_PRODUCTO no corresponde a AUTO_DESTINO.',
          );
        }


        if (
          destination.authorized_quantity !==
            row.quantity
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_DESTINATION_QUANTITY_MISMATCH',
            `AUTO_DESTINO requiere exactamente ${destination.authorized_quantity} unidad(es); la fila contiene ${row.quantity}.`,
          );
        }


        if (
          await this.destinationIsBusy(
            client,
            destination.id,
          )
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_DESTINATION_ALREADY_ASSIGNED',
            `AUTO_DESTINO ${destination.authorization_key} ya tiene una OC o asignación activa.`,
          );
        }


        const dispensingPointId =
          await this.destinationPoint(
            client,
            destination.commercial_code,
          );


        /*
         * Validar que además exista la información
         * comercial vigente del AT antes de crear la OC.
         */
        await this.activeTariffSnapshot(
          client,
          destination.commercial_code,
        );


        plans.push({
          row,
          destination,
          dispensingPointId,
        });
      }


      const inserted =
        await client.query<{
          id:
            string;
        }>(
          `
            insert into
              purchase_orders (
                purchase_order_code,
                planning_period_id,
                order_type,
                status,
                version,
                issued_at,
                issued_by,
                created_by,
                updated_by,
                origin
              )

            values (
              $1,
              null,
              'STANDARD',
              'ISSUED',
              1,
              now(),
              $2,
              $2,
              $2,
              'DIRECT_AUTHORIZATION'
            )

            returning
              id
          `,
          [
            purchaseOrderCode,
            actor.userId,
          ],
        );


      const purchaseOrderId =
        inserted.rows[0]!.id;


      for (
        const plan of plans
      ) {
        await this.attachDirectAuthorizationToOrder(
          client,
          purchaseOrderId,
          plan.destination,
          plan.dispensingPointId,
          plan.row.quantity!,
        );
      }


      await client.query(
        `
          insert into
            audit_events (
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
            'PURCHASE_ORDER_DIRECT_AUTHORIZATION_IMPORTED',
            'purchase_order',
            $3,
            $4::jsonb,
            $5::uuid,
            $5::text,
            'SUCCESS'
          )
        `,
        [
          actor.userId,
          actor.organizationId,
          purchaseOrderId,

          JSON.stringify({
            purchaseOrderCode,

            authorizationCount:
              plans.length,

            requestedQuantity:
              plans.reduce(
                (
                  total,
                  plan,
                ) =>
                  total +
                  plan.row.quantity!,
                0,
              ),

            origin:
              'DIRECT_AUTHORIZATION',

            demandRequired:
              false,
          }),

          actor.correlationId,
        ],
      );


      await client.query(
        'commit',
      );


      return {
        purchaseOrderId,
      };
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


  private async processExistingPurchaseOrderGroup(
    purchaseOrderCode: string,
    rows: ImportRow[],
    actor: Scope,
  ): Promise<{
    purchaseOrderId:
      string;

    planningPeriodId:
      string | null;

    orderType:
      PurchaseOrderType;
  }> {
    const client =
      await this.database.pool.connect();


    try {
      await client.query(
        'begin',
      );


      const orderResult =
        await client.query<{
          id:
            string;

          planning_period_id:
            string | null;

          order_type:
            PurchaseOrderType;

          status:
            string;
        }>(
          `
            select
              id,
              planning_period_id,
              order_type,
              status

            from
              purchase_orders

            where
              purchase_order_code =
                $1

            limit 2

            for update
          `,
          [
            purchaseOrderCode,
          ],
        );


      if (
        orderResult.rows.length ===
        0
      ) {
        this.existingOrderError(
          'PURCHASE_ORDER_NOT_FOUND',
          `La OC ${purchaseOrderCode} no existe.`,
        );
      }


      if (
        orderResult.rows.length >
        1
      ) {
        this.existingOrderError(
          'PURCHASE_ORDER_CODE_AMBIGUOUS',
          `La OC ${purchaseOrderCode} no es unívoca.`,
        );
      }


      const order =
        orderResult.rows[0]!;


      if (
        [
          'CANCELLED',
          'REJECTED',
        ].includes(
          order.status,
        )
      ) {
        this.existingOrderError(
          'PURCHASE_ORDER_NOT_ACTIVE',
          `La OC ${purchaseOrderCode} está cancelada o rechazada.`,
        );
      }


      const plans:
        Array<
          | {
              kind:
                'ASSIGN_AVAILABLE';

              row:
                ImportRow;

              destination:
                ExistingAuthorizationRow;

              dispensingPointId:
                string;
            }

          | {
              kind:
                'REASSIGN';

              row:
                ImportRow;

              origin:
                ExistingAuthorizationRow;

              destination:
                ExistingAuthorizationRow;

              dispensingPointId:
                string;

              moveSource:
                boolean;

              moveAllocation:
                boolean;
            }
        > =
        [];


      const seenOrigins =
        new Set<
          string
        >();


      for (
        const row of rows
      ) {
        const destination =
          await this.loadExistingAuthorization(
            client,
            row.destinationAuthorizationKey!,
            actor,
          );


        if (
          destination.closed
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_DESTINATION_CLOSED',
            `AUTO_DESTINO ${destination.authorization_key} ya está cerrada por entrega o aplicación.`,
          );
        }


        if (
          destination.enablement_status !==
            'ENABLED' ||
          destination.source_status_normalized !==
            '5'
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_DESTINATION_NOT_ENABLED',
            `AUTO_DESTINO ${destination.authorization_key} no está habilitada para operación.`,
          );
        }


        this.assertDestinationOperationalWindow(
          destination,
        );


        if (
          destination.commercial_code
            .trim()
            .toUpperCase() !==
          row.commercialCode!
            .trim()
            .toUpperCase()
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_PRODUCT_MISMATCH',
            'CODIGO_PRODUCTO no corresponde a AUTO_DESTINO.',
          );
        }


        if (
          destination.authorized_quantity !==
            row.quantity
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_DESTINATION_QUANTITY_MISMATCH',
            `AUTO_DESTINO requiere exactamente ${destination.authorized_quantity} unidad(es); la fila contiene ${row.quantity}.`,
          );
        }


        if (
          await this.destinationIsBusy(
            client,
            destination.id,
          )
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_DESTINATION_ALREADY_ASSIGNED',
            `AUTO_DESTINO ${destination.authorization_key} ya tiene una OC o asignación activa.`,
          );
        }


        const dispensingPointId =
          await this.destinationPoint(
            client,
            destination.commercial_code,
          );


        /*
         * ==================================================
         * OC EXISTENTE + ORIGEN VACÍO
         *
         * AGREGAR AUTO A LA OC.
         *
         * Esto NO consume stock y NO exige recepción
         * previa. La relación de compra nace aquí.
         *
         * El consumo físico ocurre después:
         * OLP -> recepción MEDICARTE -> fulfillment.
         * ==================================================
         */
        if (
          !row.originAuthorizationKey
        ) {
          plans.push({
            kind:
              'ASSIGN_AVAILABLE',

            row,

            destination,

            dispensingPointId,
          });


          continue;
        }


        /*
         * REASIGNAR sí requiere que el producto de la
         * OC/origen corresponda al mismo punto vigente.
         */
        await this.assertOrderProductPoint(
          client,
          order.id,
          destination.commercial_code,
          dispensingPointId,
        );


        /*
         * ==================================================
         * OC EXISTENTE + ORIGEN + DESTINO
         *
         * REASIGNACIÓN 1:1.
         * ==================================================
         */

        if (
          row.originAuthorizationKey ===
          row.destinationAuthorizationKey
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_REASSIGNMENT_SAME_AUTHORIZATION',
            'AUTO_ORIGEN y AUTO_DESTINO no pueden ser la misma autorización.',
          );
        }


        if (
          seenOrigins.has(
            row.originAuthorizationKey,
          )
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_REASSIGNMENT_DUPLICATE_ORIGIN',
            `AUTO_ORIGEN ${row.originAuthorizationKey} está repetida dentro de la misma OC.`,
          );
        }


        seenOrigins.add(
          row.originAuthorizationKey,
        );


        const origin =
          await this.loadExistingAuthorization(
            client,
            row.originAuthorizationKey,
            actor,
          );


        if (
          origin.closed
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_ORIGIN_CLOSED',
            `AUTO_ORIGEN ${origin.authorization_key} ya está cerrada por entrega o aplicación y no puede reasignarse.`,
          );
        }


        if (
          origin.commercial_code
            .trim()
            .toUpperCase() !==
          destination.commercial_code
            .trim()
            .toUpperCase()
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_REASSIGNMENT_PRODUCT_MISMATCH',
            'AUTO_ORIGEN y AUTO_DESTINO deben corresponder exactamente al mismo producto.',
          );
        }


        if (
          origin.authorized_quantity !==
            destination.authorized_quantity ||
          origin.authorized_quantity !==
            row.quantity
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_REASSIGNMENT_QUANTITY_MISMATCH',
            `La reasignación exige la misma cantidad completa. AUTO_ORIGEN=${origin.authorized_quantity}, AUTO_DESTINO=${destination.authorized_quantity}, FILA=${row.quantity}.`,
          );
        }


        const sourceRelations =
          await client.query<{
            dispensing_point_id:
              string | null;

            source_quantity:
              number;
          }>(
            `
              select
                coalesce(
                  pol.dispensing_point_id,
                  mapping.dispensing_point_id
                )
                  as dispensing_point_id,

                sum(
                  poas.source_quantity_snapshot
                )::int
                  as source_quantity

              from
                purchase_order_authorization_sources poas

              join
                purchase_order_lines pol
                  on pol.id =
                     poas.purchase_order_line_id

              left join
                tariff_annex_products tap
                  on tap.codigo_producto =
                     pol.commercial_code

                 and tap.active =
                     true

              left join
                product_delivery_point_mappings mapping
                  on pol.dispensing_point_id
                     is null

                 and btrim(
                       coalesce(
                         tap.numero_expediente_invima,
                         ''
                       )
                     ) ~ '^[0-9]+$'

                 and btrim(
                       coalesce(
                         tap.consecutivo_invima_presentacion,
                         ''
                       )
                     ) ~ '^[0-9]+$'

                 and mapping.invima_record_normalized =
                     coalesce(
                       nullif(
                         ltrim(
                           btrim(
                             tap.numero_expediente_invima
                           ),
                           '0'
                         ),
                         ''
                       ),
                       '0'
                     )

                 and mapping.invima_presentation_normalized =
                     coalesce(
                       nullif(
                         ltrim(
                           btrim(
                             tap.consecutivo_invima_presentacion
                           ),
                           '0'
                         ),
                         ''
                       ),
                       '0'
                     )

              where
                pol.purchase_order_id =
                  $1

                and poas.authorization_item_id =
                  $2

                and pol.commercial_code =
                  $3

              group by
                coalesce(
                  pol.dispensing_point_id,
                  mapping.dispensing_point_id
                )
            `,
            [
              order.id,
              origin.id,
              origin.commercial_code,
            ],
          );


        let sourceAtPoint =
          0;

        let sourceAtOtherPoint =
          0;


        for (
          const sourceRelation of
          sourceRelations.rows
        ) {
          if (
            sourceRelation.dispensing_point_id ===
            dispensingPointId
          ) {
            sourceAtPoint +=
              Number(
                sourceRelation.source_quantity,
              );
          } else {
            sourceAtOtherPoint +=
              Number(
                sourceRelation.source_quantity,
              );
          }
        }


        if (
          sourceAtOtherPoint >
          0
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_REASSIGNMENT_POINT_MISMATCH',
            'AUTO_ORIGEN está relacionada a un punto distinto al punto vigente de AUTO_DESTINO.',
          );
        }


        const allocationState =
          await client.query<{
            active_remaining:
              number;

            consumed_quantity:
              number;

            other_point_rows:
              number;
          }>(
            `
              select
                coalesce(
                  sum(
                    case
                      when iaa.status in (
                        'ALLOCATED',
                        'PARTIALLY_CONSUMED'
                      )

                      and iaa.dispensing_point_id =
                        $4

                      then greatest(
                        iaa.allocated_quantity
                        -
                        iaa.consumed_quantity
                        -
                        iaa.released_quantity,
                        0
                      )

                      else 0
                    end
                  ),
                  0
                )::int
                  as active_remaining,

                coalesce(
                  sum(
                    iaa.consumed_quantity
                  ),
                  0
                )::int
                  as consumed_quantity,

                count(*) filter (
                  where
                    iaa.status in (
                      'ALLOCATED',
                      'PARTIALLY_CONSUMED'
                    )

                    and greatest(
                      iaa.allocated_quantity
                      -
                      iaa.consumed_quantity
                      -
                      iaa.released_quantity,
                      0
                    ) > 0

                    and iaa.dispensing_point_id
                      <>
                      $4
                )::int
                  as other_point_rows

              from
                inventory_authorization_allocations iaa

              where
                iaa.purchase_order_id =
                  $1

                and iaa.authorization_item_id =
                  $2

                and iaa.commercial_code =
                  $3
            `,
            [
              order.id,
              origin.id,
              origin.commercial_code,
              dispensingPointId,
            ],
          );


        const activeRemaining =
          Number(
            allocationState.rows[0]
              ?.active_remaining ??
            0,
          );

        const consumedQuantity =
          Number(
            allocationState.rows[0]
              ?.consumed_quantity ??
            0,
          );

        const otherPointRows =
          Number(
            allocationState.rows[0]
              ?.other_point_rows ??
            0,
          );


        if (
          consumedQuantity >
          0
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_REASSIGNMENT_ALREADY_CONSUMED',
            'AUTO_ORIGEN ya tiene producto entregado/aplicado y no puede reasignarse.',
          );
        }


        if (
          otherPointRows >
          0
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_REASSIGNMENT_POINT_MISMATCH',
            'La reserva física de AUTO_ORIGEN pertenece a otro punto.',
          );
        }


        if (
          sourceAtPoint >
            0 &&
          sourceAtPoint !==
            row.quantity
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_REASSIGNMENT_SOURCE_QUANTITY_MISMATCH',
            `La relación OC → AUTO_ORIGEN contiene ${sourceAtPoint} unidad(es), pero la reasignación solicita ${row.quantity}.`,
          );
        }


        if (
          activeRemaining >
            0 &&
          activeRemaining !==
            row.quantity
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_REASSIGNMENT_ALLOCATION_QUANTITY_MISMATCH',
            `La reserva física de AUTO_ORIGEN contiene ${activeRemaining} unidad(es), pero la reasignación solicita ${row.quantity}.`,
          );
        }


        if (
          sourceAtPoint ===
            0 &&
          activeRemaining ===
            0
        ) {
          this.existingOrderError(
            'PURCHASE_ORDER_REASSIGNMENT_ORIGIN_NOT_ASSIGNED',
            'AUTO_ORIGEN no tiene relación ni reserva activa dentro de esta OC.',
          );
        }


        plans.push({
          kind:
            'REASSIGN',

          row,

          origin,

          destination,

          dispensingPointId,

          moveSource:
            sourceAtPoint >
            0,

          moveAllocation:
            activeRemaining >
            0,
        });
      }


      /*
       * ORIGEN vacío ya no significa consumir
       * disponibilidad recibida.
       *
       * Significa incorporar AUTO_DESTINO a la OC.
       */
      for (
        const plan of plans
      ) {
        if (
          plan.kind ===
          'ASSIGN_AVAILABLE'
        ) {
          await this.attachDirectAuthorizationToOrder(
            client,
            order.id,
            plan.destination,
            plan.dispensingPointId,
            plan.row.quantity!,
          );
        } else {
          /*
           * La recepción MEDICARTE NO se toca.
           *
           * Si el producto ya estaba reservado físicamente,
           * la misma reserva cambia de AUTO.
           */
          if (
            plan.moveAllocation
          ) {
            await client.query(
              `
                update
                  inventory_authorization_allocations

                set
                  authorization_item_id =
                    $1,

                  authorization_version =
                    $2,

                  updated_by =
                    $3,

                  updated_at =
                    now()

                where
                  purchase_order_id =
                    $4

                  and authorization_item_id =
                    $5

                  and commercial_code =
                    $6

                  and dispensing_point_id =
                    $7

                  and status in (
                    'ALLOCATED',
                    'PARTIALLY_CONSUMED'
                  )

                  and consumed_quantity =
                    0

                  and greatest(
                    allocated_quantity
                    -
                    consumed_quantity
                    -
                    released_quantity,
                    0
                  ) > 0
              `,
              [
                plan.destination.id,
                plan.destination
                  .authorization_version,
                actor.userId,
                order.id,
                plan.origin.id,
                plan.origin
                  .commercial_code,
                plan.dispensingPointId,
              ],
            );
          }


          /*
           * Si la AUTO era fuente de compra de la OC,
           * sustituir la fuente para que una recepción
           * posterior no vuelva a reservar el producto
           * para AUTO_ORIGEN.
           *
           * Cantidad, producto, línea y OC permanecen.
           */
          if (
            plan.moveSource
          ) {
            await client.query(
              `
                update
                  purchase_order_authorization_sources poas

                set
                  authorization_item_id =
                    $1

                where
                  poas.authorization_item_id =
                    $2

                  and poas.purchase_order_line_id
                    in (
                      select
                        pol.id

                      from
                        purchase_order_lines pol

                      where
                        pol.purchase_order_id =
                          $3

                        and pol.commercial_code =
                          $4
                    )
              `,
              [
                plan.destination.id,
                plan.origin.id,
                order.id,
                plan.origin
                  .commercial_code,
              ],
            );
          }
        }


        await client.query(
          `
            insert into
              audit_events (
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
              $3,
              'purchase_order',
              $4,
              $5::jsonb,
              $6::uuid,
              $6::text,
              'SUCCESS'
            )
          `,
          [
            actor.userId,
            actor.organizationId,

            plan.kind ===
              'ASSIGN_AVAILABLE'
              ? 'PURCHASE_ORDER_AUTHORIZATION_ADDED'
              : 'PURCHASE_ORDER_AUTHORIZATION_REASSIGNED',

            order.id,

            JSON.stringify({
              purchaseOrderCode,

              commercialCode:
                plan.destination
                  .commercial_code,

              quantity:
                plan.row.quantity,

              originAuthorizationKey:
                plan.kind ===
                  'REASSIGN'
                  ? plan.origin
                      .authorization_key
                  : null,

              destinationAuthorizationKey:
                plan.destination
                  .authorization_key,

              dispensingPointId:
                plan.dispensingPointId,

              medicarteReceiptModified:
                false,
            }),

            actor.correlationId,
          ],
        );
      }


      await client.query(
        'commit',
      );


      return {
        purchaseOrderId:
          order.id,

        planningPeriodId:
          order.planning_period_id,

        orderType:
          order.order_type,
      };
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
            $5::uuid,
            $5::text,
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
              CLAVE_AUTORIZACION_ORIGEN:
                row.originAuthorizationKey,

              CLAVE_AUTORIZACION_DESTINO:
                row.destinationAuthorizationKey,

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
