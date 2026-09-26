import {
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';

import type {
  createDatabase,
} from '@authorization/database';

import * as XLSX from 'xlsx';

import {
  DATABASE,
} from '../tokens';

import type {
  Scope,
} from '../common/request-scope';


type Database =
  ReturnType<
    typeof createDatabase
  >;


export type ExportedWorkbook =
  Readonly<{
    filename: string;

    content: Buffer;

    rowCount: number;
  }>;


type CandidateRow =
  Readonly<{
    authorization_key: string;

    numero_autorizacion: string;

    codigo_medicamento: string;

    cantidad: number;
  }>;


type SpreadsheetValue =
  | string
  | number
  | boolean
  | null;


function safeSpreadsheetValue(
  value: unknown,
): SpreadsheetValue {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value ===
      'number' ||
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  const text =
    typeof value ===
      'object'
      ? JSON.stringify(
          value,
        )
      : String(
          value,
        );

  /*
   * Formula injection.
   *
   * Los XLSX descargados pueden contener valores
   * provenientes de archivos externos.
   */
  return /^[=+\-@]/.test(
    text.trimStart(),
  )
    ? `'${text}`
    : text;
}


function appendRecordSheet(
  workbook:
    XLSX.WorkBook,

  name:
    string,

  columns:
    readonly string[],

  rows:
    readonly Record<
      string,
      unknown
    >[],
): void {
  const matrix:
    SpreadsheetValue[][] =
      [
        [
          ...columns,
        ],

        ...rows.map(
          (row) =>
            columns.map(
              (column) =>
                safeSpreadsheetValue(
                  row[column],
                ),
            ),
        ),
      ];

  const sheet =
    XLSX.utils.aoa_to_sheet(
      matrix,
    );

  sheet['!cols'] =
    columns.map(
      (column) => ({
        wch:
          Math.min(
            Math.max(
              column.length +
                2,
              14,
            ),
            45,
          ),
      }),
    );

  XLSX.utils.book_append_sheet(
    workbook,
    sheet,
    name,
  );
}


function workbookBuffer(
  workbook:
    XLSX.WorkBook,
): Buffer {
  const result: unknown =
    XLSX.write(
      workbook,
      {
        type:
          'buffer',

        bookType:
          'xlsx',
      },
    );

  if (
    !Buffer.isBuffer(
      result,
    )
  ) {
    throw new Error(
      'XLSX_EXPORT_BUFFER_EXPECTED',
    );
  }

  return result;
}


function objectValue(
  value: unknown,
): Record<
  string,
  unknown
> {
  if (
    value &&
    typeof value ===
      'object' &&
    !Array.isArray(
      value,
    )
  ) {
    return value as Record<
      string,
      unknown
    >;
  }

  return {};
}


const PREFERRED_SOURCE_COLUMNS =
  [
    'NUMERO_AUTORIZACION',
    'IDENTIFICACION_PACIENTE',
    'NOMBRE_PACIENTE',
    'CDGN001',
    'CODIGO_COMERCIAL',
    'CUPS_AUTORIZADO',
    'CANTIDAD',
    'DOSIS',
    'FECHA_ASIGNACION',
    'FECHA_FINAL_VIGENCIA',
    'ESTADO_AUTORIZACION',
    'OBS_AUTORIZACION',
    'VALOR_CUOTA_MODERADORA',
    'NUMERO_PRESCRIPCION',
    'No.PRESCRIPCION',
  ] as const;


@Injectable()
export class ExportablesService {
  constructor(
    @Inject(
      DATABASE,
    )
    private readonly database:
      Database,
  ) {}


  private assertMtd(
    scope:
      Scope,
  ): void {
    if (
      scope.organizationCode !==
        'MTD'
    ) {
      throw new ForbiddenException({
        code:
          'EXPORT_MTD_ONLY',

        message:
          'Esta exportación está disponible únicamente para MTD.',
      });
    }
  }


  /*
   * ==================================================
   * EXPORT 1
   *
   * AUTO disponibles para generar OC.
   *
   * El archivo es directamente reutilizable por
   * PurchaseOrderImportService.
   *
   * Regla:
   *
   * - validación inicial PASSED;
   * - vigencia IN_WINDOW (Hoy + 30);
   * - sin OC activa.
   *
   * Una OC REJECTED/CANCELLED no representa cobertura
   * operacional vigente y no bloquea una nueva compra.
   * ==================================================
   */
  async purchaseOrderCandidates(
    scope:
      Scope,
  ): Promise<ExportedWorkbook> {
    this.assertMtd(
      scope,
    );

    const result =
      await this.database.pool.query<
        CandidateRow
      >(
        `
          with base as (
            select
              ai.id,
              ai.authorization_key,
              ai.numero_autorizacion,
              ai.codigo_medicamento,

              case
                when
                  btrim(
                    coalesce(
                      ai.source_data
                        ->> 'CANTIDAD',
                      ''
                    )
                  )
                  ~ '^[0-9]+$'

                then
                  (
                    ai.source_data
                      ->> 'CANTIDAD'
                  )::int

                else null
              end
                as cantidad,

              coalesce(
                tap.minimum_quantity,
                1
              )
                as minimum_quantity,

              ai.enablement_status,
              ai.tariff_membership_status,
              ai.coverage_type,
              ai.direction_status,

              case

                when
                  btrim(
                    coalesce(
                      ai.source_data
                        ->> 'FECHA_ASIGNACION',
                      ''
                    )
                  )
                  ~ '^[0-9]{8}$'

                  and
                  to_char(
                    to_date(
                      ai.source_data
                        ->> 'FECHA_ASIGNACION',
                      'YYYYMMDD'
                    ),
                    'YYYYMMDD'
                  )
                  =
                  ai.source_data
                    ->> 'FECHA_ASIGNACION'

                then
                  to_date(
                    ai.source_data
                      ->> 'FECHA_ASIGNACION',
                    'YYYYMMDD'
                  )


                when
                  btrim(
                    coalesce(
                      ai.source_data
                        ->> 'FECHA_ASIGNACION',
                      ''
                    )
                  )
                  ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'

                  and
                  to_char(
                    to_date(
                      ai.source_data
                        ->> 'FECHA_ASIGNACION',
                      'YYYY-MM-DD'
                    ),
                    'YYYY-MM-DD'
                  )
                  =
                  ai.source_data
                    ->> 'FECHA_ASIGNACION'

                then
                  to_date(
                    ai.source_data
                      ->> 'FECHA_ASIGNACION',
                    'YYYY-MM-DD'
                  )

                else null
              end
                as assignment_date,


              case

                when
                  btrim(
                    coalesce(
                      ai.source_data
                        ->> 'FECHA_FINAL_VIGENCIA',
                      ''
                    )
                  )
                  ~ '^[0-9]{8}$'

                  and
                  to_char(
                    to_date(
                      ai.source_data
                        ->> 'FECHA_FINAL_VIGENCIA',
                      'YYYYMMDD'
                    ),
                    'YYYYMMDD'
                  )
                  =
                  ai.source_data
                    ->> 'FECHA_FINAL_VIGENCIA'

                then
                  to_date(
                    ai.source_data
                      ->> 'FECHA_FINAL_VIGENCIA',
                    'YYYYMMDD'
                  )


                when
                  btrim(
                    coalesce(
                      ai.source_data
                        ->> 'FECHA_FINAL_VIGENCIA',
                      ''
                    )
                  )
                  ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'

                  and
                  to_char(
                    to_date(
                      ai.source_data
                        ->> 'FECHA_FINAL_VIGENCIA',
                      'YYYY-MM-DD'
                    ),
                    'YYYY-MM-DD'
                  )
                  =
                  ai.source_data
                    ->> 'FECHA_FINAL_VIGENCIA'

                then
                  to_date(
                    ai.source_data
                      ->> 'FECHA_FINAL_VIGENCIA',
                    'YYYY-MM-DD'
                  )

                else null
              end
                as expiration_date

            from
              authorization_items ai

            left join lateral (
              select
                product.minimum_quantity

              from
                tariff_annex_products product

              where
                product.active = true

                and
                upper(
                  btrim(
                    product.codigo_producto
                  )
                )
                =
                upper(
                  btrim(
                    ai.codigo_medicamento
                  )
                )

              order by
                product.version desc,
                product.id desc

              limit 1
            ) tap
              on true
          ),

          evaluated as (
            select
              base.*,

              case
                when
                  enablement_status
                    <>
                  'ENABLED'
                then 'FAILED'

                when
                  tariff_membership_status
                    <>
                  'LISTED'
                then 'FAILED'

                when
                  cantidad is null
                  or cantidad <= 0
                then 'FAILED'

                when
                  cantidad <
                  minimum_quantity
                then 'FAILED'

                when
                  coverage_type =
                    'PBS'
                  and
                  direction_status =
                    'NOT_APPLICABLE'
                then 'PASSED'

                when
                  coverage_type =
                    'NO_PBS'
                  and
                  direction_status =
                    'CONFIRMED'
                then 'PASSED'

                else 'PENDING'
              end
                as initial_validation,

              case
                when
                  assignment_date is null
                  or
                  expiration_date is null
                then
                  'INVALID_DATE'

                when
                  expiration_date <
                  (
                    now()
                    at time zone
                      'America/Bogota'
                  )::date
                then
                  'EXPIRED'

                when
                  assignment_date >
                  (
                    (
                      now()
                      at time zone
                        'America/Bogota'
                    )::date
                    +
                    30
                  )
                then
                  'OUTSIDE_HORIZON'

                else
                  'IN_WINDOW'
              end
                as validity_status

            from base
          )

          select
            authorization_key,
            numero_autorizacion,
            codigo_medicamento,
            cantidad

          from evaluated e

          where
            e.initial_validation =
              'PASSED'

            and
            e.validity_status =
              'IN_WINDOW'

            and not exists (
              select 1

              from
                purchase_order_authorization_sources
                  source

              join
                purchase_order_lines line
                on
                  line.id =
                  source.purchase_order_line_id

              join
                purchase_orders po
                on
                  po.id =
                  line.purchase_order_id

              where
                source.authorization_item_id =
                  e.id

                and
                po.status not in (
                  'REJECTED',
                  'CANCELLED'
                )
            )

          order by
            numero_autorizacion,
            codigo_medicamento
        `,
      );


    const workbook =
      XLSX.utils.book_new();


    /*
     * IMPORTANTE:
     *
     * Estos encabezados son exactamente los que
     * consume PurchaseOrderImportService.
     */
    const data =
      XLSX.utils.aoa_to_sheet(
        [
          [
            'CLAVE_AUTORIZACION',
            'OC',
            'CODIGO_PRODUCTO',
            'CANTIDAD',
          ],

          ...result.rows.map(
            (row) => [
              row.authorization_key,

              '',

              row.codigo_medicamento,

              Number(
                row.cantidad,
              ),
            ],
          ),
        ],
      );

    data['!cols'] =
      [
        {
          wch:
            38,
        },
        {
          wch:
            24,
        },
        {
          wch:
            24,
        },
        {
          wch:
            14,
        },
      ];

    XLSX.utils.book_append_sheet(
      workbook,
      data,
      'ORDENES_COMPRA',
    );


    const metadata =
      XLSX.utils.aoa_to_sheet(
        [
          [
            'templateVersion',
            'PURCHASE_ORDERS_V1',
          ],

          [
            'importType',
            'PURCHASE_ORDERS',
          ],

          [
            'generatedAt',
            new Date()
              .toISOString(),
          ],

          [
            'eligibility',
            'INITIAL_VALIDATION_PASSED + IN_WINDOW + WITHOUT_ACTIVE_PURCHASE_ORDER',
          ],
        ],
      );

    XLSX.utils.book_append_sheet(
      workbook,
      metadata,
      'METADATA',
    );


    return {
      filename:
        'AUTO-para-generar-OC.xlsx',

      content:
        workbookBuffer(
          workbook,
        ),

      rowCount:
        result.rows.length,
    };
  }


  /*
   * ==================================================
   * EXPORT 2
   *
   * Órdenes de compra completas.
   *
   * Relación explícita:
   *
   * OC
   * └── línea
   *     └── AUTO relacionada(s)
   * ==================================================
   */
  async purchaseOrders(
    scope:
      Scope,
  ): Promise<ExportedWorkbook> {
    this.assertMtd(
      scope,
    );


    /*
     * ==================================================
     * HOJA 1: OC_PRODUCTOS
     *
     * Unidad:
     *   OC + producto
     *
     * CANTIDAD_SOLICITADA:
     *   cantidad solicitada por MTD.
     *
     * CANTIDAD_OLP:
     *   cantidad acumulada gestionada por OLP.
     *
     * CANTIDAD_MEDICARTE:
     *   cantidad acumulada efectivamente recibida
     *   por Medicarte.
     *
     * La recepción usa exactamente las dos fuentes
     * autoritativas que consume el read model
     * operacional de PurchaseOrderRepository:
     *
     * - receipts / receipt_lines confirmados;
     * - purchase_order_receipts /
     *   purchase_order_receipt_lines.
     * ==================================================
     */
    const products =
      await this.database.pool.query<
        Record<
          string,
          unknown
        >
      >(
        `
          with received_sources as (
            select
              dl.purchase_order_line_id,

              rl.received_quantity

            from
              receipt_lines rl

            join
              receipts r
              on
                r.id =
                rl.receipt_id

            join
              delivery_lines dl
              on
                dl.id =
                rl.delivery_line_id

            join
              deliveries d
              on
                d.id =
                dl.delivery_id

            where
              r.status =
                'CONFIRMED'


            union all


            select
              porl.purchase_order_line_id,

              porl.received_quantity

            from
              purchase_order_receipt_lines
                porl

            join
              purchase_order_receipts por
              on
                por.id =
                porl.receipt_id
          ),


          received as (
            select
              purchase_order_line_id,

              coalesce(
                sum(
                  received_quantity
                ),
                0
              )::int
                as received_quantity

            from
              received_sources

            group by
              purchase_order_line_id
          ),


          line_base as (
            select
              po.id
                as purchase_order_id,

              po.purchase_order_code,

              pol.id
                as purchase_order_line_id,

              pol.commercial_code,

              coalesce(
                nullif(
                  btrim(
                    coalesce(
                      tap.descripcion_generica,
                      ''
                    )
                  ),
                  ''
                ),

                nullif(
                  btrim(
                    coalesce(
                      tap.descripcion_comercial,
                      ''
                    )
                  ),
                  ''
                ),

                nullif(
                  btrim(
                    coalesce(
                      pol.product_description,
                      ''
                    )
                  ),
                  ''
                ),

                pol.commercial_code
              )
                as product_description,

              pol.requested_quantity,

              coalesce(
                pol.olp_managed_quantity,
                pol.accepted_quantity,
                0
              )::int
                as olp_quantity,

              coalesce(
                received.received_quantity,
                0
              )::int
                as medicarte_quantity

            from
              purchase_order_lines pol

            join
              purchase_orders po
              on
                po.id =
                pol.purchase_order_id

            left join
              tariff_annex_products tap
              on
                tap.codigo_producto =
                pol.commercial_code

               and
                tap.active =
                true

            left join
              received
              on
                received.purchase_order_line_id =
                pol.id
          )


          select
            purchase_order_code
              as "OC",

            commercial_code
              as "CODIGO_PRODUCTO",

            max(
              product_description
            )
              as "PRODUCTO",

            sum(
              requested_quantity
            )::int
              as "CANTIDAD_SOLICITADA",

            sum(
              olp_quantity
            )::int
              as "CANTIDAD_OLP",

            sum(
              medicarte_quantity
            )::int
              as "CANTIDAD_MEDICARTE"

          from
            line_base

          group by
            purchase_order_id,
            purchase_order_code,
            commercial_code

          order by
            purchase_order_code
              nulls last,

            commercial_code
        `,
      );


    /*
     * ==================================================
     * HOJA 2: AUTO_RELACIONADAS
     *
     * No se reparten artificialmente las cantidades
     * OLP / Medicarte por paciente.
     *
     * La trazabilidad conserva:
     *
     * OC
     * -> línea
     * -> AUTO
     * -> cantidad de la AUTO
     * -> cantidad que aportó a la OC
     * ==================================================
     */
    const authorizations =
      await this.database.pool.query<
        Record<
          string,
          unknown
        >
      >(
        `
          select
            po.purchase_order_code
              as "OC",

            ai.authorization_key
              as "CLAVE_AUTO",

            ai.numero_autorizacion
              as "NUMERO_AUTORIZACION",

            pol.commercial_code
              as "CODIGO_PRODUCTO",

            case
              when
                btrim(
                  coalesce(
                    ai.source_data
                      ->> 'CANTIDAD',
                    ''
                  )
                )
                ~ '^[0-9]+$'

              then
                (
                  ai.source_data
                    ->> 'CANTIDAD'
                )::int

              else
                null
            end
              as "CANTIDAD_AUTO",

            source.source_quantity_snapshot
              as "CANTIDAD_APORTADA_A_OC"

          from
            purchase_order_authorization_sources
              source

          join
            purchase_order_lines pol
            on
              pol.id =
              source.purchase_order_line_id

          join
            purchase_orders po
            on
              po.id =
              pol.purchase_order_id

          join
            authorization_items ai
            on
              ai.id =
              source.authorization_item_id

          order by
            po.purchase_order_code
              nulls last,

            pol.commercial_code,

            ai.numero_autorizacion,

            ai.authorization_key
        `,
      );


    const workbook =
      XLSX.utils.book_new();


    appendRecordSheet(
      workbook,
      'OC_PRODUCTOS',
      [
        'OC',
        'CODIGO_PRODUCTO',
        'PRODUCTO',
        'CANTIDAD_SOLICITADA',
        'CANTIDAD_OLP',
        'CANTIDAD_MEDICARTE',
      ],
      products.rows,
    );


    appendRecordSheet(
      workbook,
      'AUTO_RELACIONADAS',
      [
        'OC',
        'CLAVE_AUTO',
        'NUMERO_AUTORIZACION',
        'CODIGO_PRODUCTO',
        'CANTIDAD_AUTO',
        'CANTIDAD_APORTADA_A_OC',
      ],
      authorizations.rows,
    );


    return {
      filename:
        'ordenes-compra.xlsx',

      content:
        workbookBuffer(
          workbook,
        ),

      rowCount:
        products.rows.length,
    };
  }



  /*
   * ==================================================
   * EXPORT 3
   *
   * Consolidado completo de autorizaciones.
   *
   * Una fila por authorization_item.
   *
   * Incluye:
   * - todos los campos originales encontrados en
   *   source_data;
   * - validación inicial;
   * - habilitación funcional;
   * - vigencia;
   * - OC;
   * - asignación;
   * - fulfillment;
   * - auditoría.
   * ==================================================
   */
  async authorizations(
    scope:
      Scope,
  ): Promise<ExportedWorkbook> {
    this.assertMtd(
      scope,
    );

    const result =
      await this.database.pool.query<
        Record<
          string,
          unknown
        >
      >(
        `
          with base as (
            select
              ai.id,
              ai.authorization_key,
              ai.numero_autorizacion,
              ai.codigo_medicamento,
              ai.source_data,
              ai.enablement_status,
              ai.tariff_membership_status,
              ai.coverage_type,
              ai.direction_status,
              ai.operation_status,
              ai.audit_status,
              ai.created_at,
              ai.updated_at,

              coalesce(
                tap.minimum_quantity,
                1
              )
                as minimum_quantity,


              case
                when
                  btrim(
                    coalesce(
                      ai.source_data
                        ->> 'CANTIDAD',
                      ''
                    )
                  )
                  ~ '^[0-9]+$'

                then
                  (
                    ai.source_data
                      ->> 'CANTIDAD'
                  )::int

                else null
              end
                as authorization_quantity,


              case
                when
                  btrim(
                    coalesce(
                      ai.source_data
                        ->> 'FECHA_ASIGNACION',
                      ''
                    )
                  )
                  ~ '^[0-9]{8}$'

                  and
                  to_char(
                    to_date(
                      ai.source_data
                        ->> 'FECHA_ASIGNACION',
                      'YYYYMMDD'
                    ),
                    'YYYYMMDD'
                  )
                  =
                  ai.source_data
                    ->> 'FECHA_ASIGNACION'

                then
                  to_date(
                    ai.source_data
                      ->> 'FECHA_ASIGNACION',
                    'YYYYMMDD'
                  )


                when
                  btrim(
                    coalesce(
                      ai.source_data
                        ->> 'FECHA_ASIGNACION',
                      ''
                    )
                  )
                  ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'

                  and
                  to_char(
                    to_date(
                      ai.source_data
                        ->> 'FECHA_ASIGNACION',
                      'YYYY-MM-DD'
                    ),
                    'YYYY-MM-DD'
                  )
                  =
                  ai.source_data
                    ->> 'FECHA_ASIGNACION'

                then
                  to_date(
                    ai.source_data
                      ->> 'FECHA_ASIGNACION',
                    'YYYY-MM-DD'
                  )

                else null
              end
                as assignment_date,


              case
                when
                  btrim(
                    coalesce(
                      ai.source_data
                        ->> 'FECHA_FINAL_VIGENCIA',
                      ''
                    )
                  )
                  ~ '^[0-9]{8}$'

                  and
                  to_char(
                    to_date(
                      ai.source_data
                        ->> 'FECHA_FINAL_VIGENCIA',
                      'YYYYMMDD'
                    ),
                    'YYYYMMDD'
                  )
                  =
                  ai.source_data
                    ->> 'FECHA_FINAL_VIGENCIA'

                then
                  to_date(
                    ai.source_data
                      ->> 'FECHA_FINAL_VIGENCIA',
                    'YYYYMMDD'
                  )


                when
                  btrim(
                    coalesce(
                      ai.source_data
                        ->> 'FECHA_FINAL_VIGENCIA',
                      ''
                    )
                  )
                  ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'

                  and
                  to_char(
                    to_date(
                      ai.source_data
                        ->> 'FECHA_FINAL_VIGENCIA',
                      'YYYY-MM-DD'
                    ),
                    'YYYY-MM-DD'
                  )
                  =
                  ai.source_data
                    ->> 'FECHA_FINAL_VIGENCIA'

                then
                  to_date(
                    ai.source_data
                      ->> 'FECHA_FINAL_VIGENCIA',
                    'YYYY-MM-DD'
                  )

                else null
              end
                as expiration_date,


              coalesce(
                po_relation.has_any_po,
                false
              )
                as has_any_po,

              coalesce(
                po_relation.has_active_po,
                false
              )
                as has_active_po,

              po_relation.purchase_order_codes,

              po_relation.dispensing_points,

              coalesce(
                allocation.allocated_quantity,
                0
              )
                as allocated_quantity,

              coalesce(
                allocation.consumed_quantity,
                0
              )
                as consumed_quantity,

              coalesce(
                allocation.released_quantity,
                0
              )
                as released_quantity,

              coalesce(
                allocation.remaining_quantity,
                0
              )
                as remaining_quantity,

              fulfillment.fulfillment_type,

              fulfillment.effective_date,

              fulfillment.fulfillment_quantity,

              coalesce(
                audit_review.status,
                ai.audit_status
              )
                as resolved_audit_status,

              audit_review.observations
                as audit_observations

            from
              authorization_items ai


            left join lateral (
              select
                product.minimum_quantity

              from
                tariff_annex_products product

              where
                product.active = true

                and
                upper(
                  btrim(
                    product.codigo_producto
                  )
                )
                =
                upper(
                  btrim(
                    ai.codigo_medicamento
                  )
                )

              order by
                product.version desc,
                product.id desc

              limit 1
            ) tap
              on true


            left join lateral (
              select
                count(*) > 0
                  as has_any_po,

                bool_or(
                  po.status not in (
                    'REJECTED',
                    'CANCELLED'
                  )
                )
                  as has_active_po,

                string_agg(
                  distinct
                  coalesce(
                    po.purchase_order_code,
                    po.id::text
                  ),
                  ', '
                )
                  as purchase_order_codes,

                string_agg(
                  distinct
                  coalesce(
                    point.name,
                    point.code
                  ),
                  ', '
                )
                  as dispensing_points

              from
                purchase_order_authorization_sources
                  source

              join
                purchase_order_lines line
                on
                  line.id =
                  source.purchase_order_line_id

              join
                purchase_orders po
                on
                  po.id =
                  line.purchase_order_id

              left join
                dispensing_points point
                on
                  point.id =
                  line.dispensing_point_id

              where
                source.authorization_item_id =
                  ai.id
            ) po_relation
              on true


            left join lateral (
              select
                coalesce(
                  sum(
                    allocation.allocated_quantity
                  ),
                  0
                )::int
                  as allocated_quantity,

                coalesce(
                  sum(
                    allocation.consumed_quantity
                  ),
                  0
                )::int
                  as consumed_quantity,

                coalesce(
                  sum(
                    allocation.released_quantity
                  ),
                  0
                )::int
                  as released_quantity,

                coalesce(
                  sum(
                    greatest(
                      allocation.allocated_quantity
                      -
                      allocation.consumed_quantity
                      -
                      allocation.released_quantity,
                      0
                    )
                  ),
                  0
                )::int
                  as remaining_quantity

              from
                inventory_authorization_allocations
                  allocation

              where
                allocation.authorization_item_id =
                  ai.id
            ) allocation
              on true


            left join lateral (
              select
                f.fulfillment_type,

                f.effective_date,

                f.quantity
                  as fulfillment_quantity

              from
                authorization_fulfillments f

              where
                f.authorization_item_id =
                  ai.id

              limit 1
            ) fulfillment
              on true


            left join lateral (
              select
                review.status,
                review.observations

              from
                audit_reviews review

              where
                review.authorization_item_id =
                  ai.id

              order by
                review.review_number desc,
                review.created_at desc

              limit 1
            ) audit_review
              on true
          ),


          evaluated as (
            select
              base.*,


              case
                when
                  enablement_status
                    <>
                  'ENABLED'
                then
                  'FAILED'

                when
                  tariff_membership_status
                    <>
                  'LISTED'
                then
                  'FAILED'

                when
                  authorization_quantity is null
                  or
                  authorization_quantity <= 0
                then
                  'FAILED'

                when
                  authorization_quantity <
                  minimum_quantity
                then
                  'FAILED'

                when
                  coverage_type =
                    'PBS'
                  and
                  direction_status =
                    'NOT_APPLICABLE'
                then
                  'PASSED'

                when
                  coverage_type =
                    'NO_PBS'
                  and
                  direction_status =
                    'CONFIRMED'
                then
                  'PASSED'

                else
                  'PENDING'
              end
                as initial_validation_status,


              case
                when
                  assignment_date is null
                  or
                  expiration_date is null
                then
                  'INVALID_DATE'

                when
                  expiration_date <
                  (
                    now()
                    at time zone
                      'America/Bogota'
                  )::date
                then
                  'EXPIRED'

                when
                  assignment_date >
                  (
                    (
                      now()
                      at time zone
                        'America/Bogota'
                    )::date
                    +
                    30
                  )
                then
                  'OUTSIDE_HORIZON'

                else
                  'IN_WINDOW'
              end
                as validity_status

            from base
          )


          select
            evaluated.*,


            case
              when
                initial_validation_status =
                  'FAILED'
              then
                'INHABILITADA'

              when
                initial_validation_status =
                  'PENDING'
              then
                'PENDIENTE'

              when
                validity_status =
                  'EXPIRED'
                and
                not has_any_po
              then
                'INHABILITADA'

              else
                'HABILITADA'
            end
              as lifecycle_enablement_status

          from evaluated

          order by
            numero_autorizacion,
            codigo_medicamento,
            id
        `,
      );


    const sourceKeys =
      new Set<
        string
      >();

    for (
      const row
      of result.rows
    ) {
      const source =
        objectValue(
          row[
            'source_data'
          ],
        );

      for (
        const key
        of Object.keys(
          source,
        )
      ) {
        sourceKeys.add(
          key,
        );
      }
    }


    const preferred =
      PREFERRED_SOURCE_COLUMNS
        .filter(
          (column) =>
            sourceKeys.has(
              column,
            ),
        );


    const remaining =
      [
        ...sourceKeys,
      ]
        .filter(
          (column) =>
            !preferred.includes(
              column as
                typeof PREFERRED_SOURCE_COLUMNS[number],
            ),
        )
        .sort(
          (
            left,
            right,
          ) =>
            left.localeCompare(
              right,
            ),
        );


    const sourceColumns =
      [
        ...preferred,
        ...remaining,
      ];


    const derivedColumns =
      [
        'IDENTIFICADOR_REGISTRO',
        'CLAVE_AUTORIZACION',
        'CODIGO_PRODUCTO_NORMALIZADO',
        'PRODUCTO_MINIMO',
        'VALIDACION_INICIAL',
        'HABILITACION',
        'VIGENCIA',
        'TIPO_COBERTURA',
        'ESTADO_DIRECCIONAMIENTO',
        'ESTADO_OPERACION',
        'TIENE_OC',
        'TIENE_OC_ACTIVA',
        'OC_RELACIONADAS',
        'PUNTOS_OC',
        'CANTIDAD_ASIGNADA',
        'CANTIDAD_CONSUMIDA',
        'CANTIDAD_LIBERADA',
        'CANTIDAD_RESERVADA_PENDIENTE',
        'ENTREGA_APLICACION',
        'CUMPLIMIENTO_FECHA',
        'CUMPLIMIENTO_CANTIDAD',
        'AUDITORIA',
        'OBSERVACION_AUDITORIA',
        'FECHA_CREACION_SISTEMA',
        'FECHA_ACTUALIZACION_SISTEMA',
      ] as const;


    const rows =
      result.rows.map(
        (row) => {
          const source =
            objectValue(
              row[
                'source_data'
              ],
            );

          const output:
            Record<
              string,
              unknown
            > =
              {};


          for (
            const column
            of sourceColumns
          ) {
            output[
              column
            ] =
              source[
                column
              ] ??
              null;
          }


          /*
           * Valores canónicos prevalecen sobre alias
           * originales en el consolidado.
           */
          output[
            'NUMERO_AUTORIZACION'
          ] =
            row[
              'numero_autorizacion'
            ];

          output[
            'CODIGO_COMERCIAL'
          ] =
            row[
              'codigo_medicamento'
            ];


          output[
            'IDENTIFICADOR_REGISTRO'
          ] =
            row[
              'id'
            ];

          output[
            'CLAVE_AUTORIZACION'
          ] =
            row[
              'authorization_key'
            ];

          output[
            'CODIGO_PRODUCTO_NORMALIZADO'
          ] =
            row[
              'codigo_medicamento'
            ];

          output[
            'PRODUCTO_MINIMO'
          ] =
            row[
              'minimum_quantity'
            ];


          const initial =
            String(
              row[
                'initial_validation_status'
              ] ??
              '',
            );

          output[
            'VALIDACION_INICIAL'
          ] =
            initial ===
              'PASSED'
              ? 'Cumple'
              : initial ===
                  'FAILED'
                ? 'No cumple'
                : 'Pendiente';


          const lifecycle =
            String(
              row[
                'lifecycle_enablement_status'
              ] ??
              '',
            );

          output[
            'HABILITACION'
          ] =
            lifecycle ===
              'HABILITADA'
              ? 'Habilitada'
              : lifecycle ===
                  'INHABILITADA'
                ? 'Inhabilitada'
                : 'Pendiente';


          const validity =
            String(
              row[
                'validity_status'
              ] ??
              '',
            );

          output[
            'VIGENCIA'
          ] =
            validity ===
              'IN_WINDOW'
              ? 'DENTRO DE RANGO'
              : validity ===
                  'EXPIRED'
                ? 'VENCIDA'
                : validity ===
                    'OUTSIDE_HORIZON'
                  ? 'FUERA DE RANGO +30'
                  : 'FECHA INVALIDA';


          output[
            'TIPO_COBERTURA'
          ] =
            row[
              'coverage_type'
            ];

          output[
            'ESTADO_DIRECCIONAMIENTO'
          ] =
            row[
              'direction_status'
            ];

          output[
            'ESTADO_OPERACION'
          ] =
            row[
              'operation_status'
            ];

          output[
            'TIENE_OC'
          ] =
            row[
              'has_any_po'
            ]
              ? 'SI'
              : 'NO';

          output[
            'TIENE_OC_ACTIVA'
          ] =
            row[
              'has_active_po'
            ]
              ? 'SI'
              : 'NO';

          output[
            'OC_RELACIONADAS'
          ] =
            row[
              'purchase_order_codes'
            ];

          output[
            'PUNTOS_OC'
          ] =
            row[
              'dispensing_points'
            ];

          output[
            'CANTIDAD_ASIGNADA'
          ] =
            row[
              'allocated_quantity'
            ];

          output[
            'CANTIDAD_CONSUMIDA'
          ] =
            row[
              'consumed_quantity'
            ];

          output[
            'CANTIDAD_LIBERADA'
          ] =
            row[
              'released_quantity'
            ];

          output[
            'CANTIDAD_RESERVADA_PENDIENTE'
          ] =
            row[
              'remaining_quantity'
            ];

          const fulfillment =
            String(
              row[
                'fulfillment_type'
              ] ??
              '',
            );

          output[
            'ENTREGA_APLICACION'
          ] =
            fulfillment ===
              'APPLICATION'
              ? 'Aplicación'
              : fulfillment ===
                  'DELIVERY'
                ? 'Entrega'
                : 'Pendiente';

          output[
            'CUMPLIMIENTO_FECHA'
          ] =
            row[
              'effective_date'
            ];

          output[
            'CUMPLIMIENTO_CANTIDAD'
          ] =
            row[
              'fulfillment_quantity'
            ];

          const audit =
            String(
              row[
                'resolved_audit_status'
              ] ??
              '',
            );

          output[
            'AUDITORIA'
          ] =
            audit ===
              'IN_REVIEW'
              ? 'En auditoría'
              : audit ===
                  'APPROVED'
                ? 'Se puede facturar'
                : audit ===
                    'REJECTED'
                  ? 'Rechazada'
                  : 'Pendiente';

          output[
            'OBSERVACION_AUDITORIA'
          ] =
            row[
              'audit_observations'
            ];

          output[
            'FECHA_CREACION_SISTEMA'
          ] =
            row[
              'created_at'
            ];

          output[
            'FECHA_ACTUALIZACION_SISTEMA'
          ] =
            row[
              'updated_at'
            ];


          return output;
        },
      );


    const workbook =
      XLSX.utils.book_new();


    appendRecordSheet(
      workbook,
      'AUTORIZACIONES',
      [
        ...sourceColumns,
        ...derivedColumns,
      ],
      rows,
    );


    const metadata =
      [
        {
          CAMPO:
            'FECHA_GENERACION',

          VALOR:
            new Date()
              .toISOString(),
        },

        {
          CAMPO:
            'TOTAL_AUTORIZACIONES',

          VALOR:
            result.rows.length,
        },

        {
          CAMPO:
            'VENTANA_OPERATIVA',

          VALOR:
            'HOY + 30 DIAS',
        },

        {
          CAMPO:
            'REGLA_PRODUCTO_MINIMO',

          VALOR:
            'CANTIDAD >= PRODUCTO_MINIMO',
        },

        {
          CAMPO:
            'REGLA_INHABILITACION_VENCIDA',

          VALOR:
            'VENCIDA SIN OC RELACIONADA',
        },
      ];


    appendRecordSheet(
      workbook,
      'METADATA',
      [
        'CAMPO',
        'VALOR',
      ],
      metadata,
    );


    return {
      filename:
        'autorizaciones-consolidado.xlsx',

      content:
        workbookBuffer(
          workbook,
        ),

      rowCount:
        result.rows.length,
    };
  }
}
