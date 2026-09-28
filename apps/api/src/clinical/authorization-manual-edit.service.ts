import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  sql,
} from 'drizzle-orm';

import type {
  createDatabase,
} from '@authorization/database';

import {
  normalizeCommercialCode,
} from '@authorization/domain';

import type {
  Scope,
} from '../common/request-scope';

import {
  REALTIME_AUDIENCE,
  realtimeInvalidationSql,
} from '../common/realtime-outbox';

import {
  DATABASE,
} from '../tokens';


type Database =
  ReturnType<
    typeof createDatabase
  >;


type AuthorizationManualEditInput =
  Readonly<{
    commercialCode:
      string;

    quantity:
      number;

    validityEndDate:
      string;

    expectedVersion:
      number;
  }>;


type AuthorizationRow =
  Readonly<{
    id:
      string;

    numero_autorizacion:
      string;

    codigo_medicamento:
      string;

    authorization_key:
      string;

    source_data:
      Record<string, unknown>;

    coverage_type:
      string;

    direction_status:
      string;

    version:
      number;
  }>;


type TariffRow =
  Readonly<{
    minimum_quantity:
      number;

    tipo_inclusion:
      string | null;

    version:
      number;

    product_description:
      string | null;

    unit_rate:
      string | null;
  }>;


type AllocationRow =
  Readonly<{
    id:
      string;

    allocated_quantity:
      number;

    consumed_quantity:
      number;

    released_quantity:
      number;

    status:
      string;

    created_at:
      Date | string;
  }>;


type ActiveScheduleRow =
  Readonly<{
    id:
      string;

    planning_period_id:
      string;

    dispensing_point_id:
      string;

    commercial_code:
      string;

    scheduled_date:
      string;

    quantity:
      number;

    status:
      string;

    schedule_timing:
      string;

    late_handling:
      string | null;

    deferred_planning_period_id:
      string | null;

    revision:
      number;
  }>;


type PurchaseOrderLink =
  Readonly<{
    purchase_order_id:
      string;

    purchase_order_code:
      string | null;

    purchase_order_status:
      string;

    olp_accepted_at:
      Date | string | null;

    purchase_order_line_id:
      string;

    commercial_code:
      string;

    requested_quantity:
      number;

    source_quantity_snapshot:
      number;

    dispensing_point_id:
      string | null;

    requested_delivery_date:
      string | null;

    has_direct_receipt:
      boolean;

    has_legacy_receipt:
      boolean;

    has_delivery:
      boolean;
  }>;


@Injectable()
export class AuthorizationManualEditService {
  constructor(
    @Inject(DATABASE)
    private readonly database:
      Database,
  ) {}


  async edit(
    authorizationItemId:
      string,

    input:
      AuthorizationManualEditInput,

    scope:
      Scope,
  ) {
    if (
      scope.organizationCode !==
      'MTD'
    ) {
      throw new ForbiddenException({
        code:
          'AUTHORIZATION_MANUAL_EDIT_MTD_ONLY',

        message:
          'Solo MTD puede editar manualmente una autorización.',
      });
    }

    return this.database.db.transaction(
      async (tx) => {
        const current =
          (
            await tx.execute<
              AuthorizationRow
            >(sql`
              select
                i.id,
                i.numero_autorizacion,
                i.codigo_medicamento,
                i.authorization_key,
                i.source_data,
                i.coverage_type,
                i.direction_status,
                i.version

              from
                authorization_items i

              where
                i.id =
                  ${authorizationItemId}

              for update
            `)
          ).rows[0];

        if (!current) {
          throw new NotFoundException({
            code:
              'AUTHORIZATION_NOT_FOUND',

            message:
              'La autorización no existe.',
          });
        }

        if (
          current.version !==
          input.expectedVersion
        ) {
          throw new ConflictException({
            code:
              'AUTHORIZATION_VERSION_CONFLICT',

            message:
              'La autorización cambió desde que fue abierta.',
          });
        }


        const commercialCode =
          normalizeCommercialCode(
            input.commercialCode,
          );

        const previousQuantity =
          this.sourceQuantity(
            current.source_data,
          );

        const previousValidity =
          this.sourceText(
            current.source_data,
            'FECHA_FINAL_VIGENCIA',
          );

        const productChanged =
          commercialCode !==
          current.codigo_medicamento;

        const quantityChanged =
          input.quantity !==
          previousQuantity;

        const validityChanged =
          input.validityEndDate !==
          previousValidity;


        const tariff =
          (
            await tx.execute<
              TariffRow
            >(sql`
              select
                tap.minimum_quantity,
                tap.tipo_inclusion,
                tap.version,

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

                tap.tarifa_unidad_canonical::text
                  as unit_rate

              from
                tariff_annex_products tap

              where
                tap.organization_id =
                  ${scope.organizationId}

                and
                tap.codigo_producto =
                  ${commercialCode}

                and
                tap.active =
                  true

              order by
                tap.updated_at desc,
                tap.id desc

              limit 1

              for share
            `)
          ).rows[0];

        if (!tariff) {
          throw new BadRequestException({
            code:
              'AUTHORIZATION_PRODUCT_NOT_ACTIVE',

            message:
              'El código no existe o no está activo en el Anexo Tarifario.',
          });
        }

        if (
          input.quantity <
          Number(
            tariff.minimum_quantity,
          )
        ) {
          throw new BadRequestException({
            code:
              'AUTHORIZATION_BELOW_MINIMUM_QUANTITY',

            message:
              'La cantidad es inferior a la cantidad mínima configurada para el producto.',
          });
        }


        const authorizationKey =
          `${current.numero_autorizacion}|${commercialCode}`;


        if (productChanged) {
          const duplicate =
            (
              await tx.execute<{
                id:
                  string;
              }>(sql`
                select
                  id

                from
                  authorization_items

                where
                  numero_autorizacion =
                    ${current.numero_autorizacion}

                  and
                  codigo_medicamento =
                    ${commercialCode}

                  and
                  id <>
                    ${authorizationItemId}

                limit 1

                for update
              `)
            ).rows[0];

          if (duplicate) {
            throw new ConflictException({
              code:
                'AUTHORIZATION_IDENTITY_CONFLICT',

              message:
                'Ya existe esta autorización con el código de producto indicado.',
            });
          }
        }


        const fulfillment =
          (
            await tx.execute<{
              quantity:
                number;

              effective_date:
                string;
            }>(sql`
              select
                af.quantity::int
                  as quantity,

                af.effective_date::text
                  as effective_date

              from
                authorization_fulfillments af

              where
                af.authorization_item_id =
                  ${authorizationItemId}

              order by
                af.confirmed_at desc,
                af.id desc

              limit 1
            `)
          ).rows[0];


        const application =
          (
            await tx.execute<{
              quantity:
                number;

              effective_date:
                string | null;
            }>(sql`
              select
                coalesce(
                  sum(
                    pal.quantity
                  ),
                  0
                )::int
                  as quantity,

                max(
                  pa.application_date
                )::text
                  as effective_date

              from
                patient_applications pa

              left join
                patient_application_lines pal
                  on pal.patient_application_id =
                     pa.id

              where
                pa.authorization_item_id =
                  ${authorizationItemId}

                and
                pa.status =
                  'CONFIRMED'
            `)
          ).rows[0];


        const consumed =
          (
            await tx.execute<{
              quantity:
                number;
            }>(sql`
              select
                coalesce(
                  sum(
                    iaa.consumed_quantity
                  ),
                  0
                )::int
                  as quantity

              from
                inventory_authorization_allocations iaa

              where
                iaa.authorization_item_id =
                  ${authorizationItemId}
            `)
          ).rows[0]
          ?.quantity
          ??
          0;


        const fulfilledQuantity =
          fulfillment
            ? Number(
                fulfillment.quantity,
              )
            : Number(
                application?.quantity
                ??
                0,
              ) > 0
              ? Number(
                  application?.quantity
                  ??
                  0,
                )
              : Number(
                  consumed,
                );


        if (
          productChanged
          &&
          (
            Boolean(
              fulfillment,
            )
            ||
            Number(
              application?.quantity
              ??
              0,
            ) > 0
            ||
            Number(
              consumed,
            ) > 0
          )
        ) {
          throw new ConflictException({
            code:
              'AUTHORIZATION_PRODUCT_ALREADY_FULFILLED',

            message:
              'No es posible cambiar el producto porque la autorización ya registra entrega/aplicación o consumo de inventario.',
          });
        }


        if (
          input.quantity <
          fulfilledQuantity
        ) {
          throw new ConflictException({
            code:
              'AUTHORIZATION_QUANTITY_BELOW_FULFILLED',

            message:
              'La cantidad no puede ser menor que la cantidad ya entregada/aplicada.',
          });
        }


        const effectiveDates =
          [
            fulfillment
              ?.effective_date
              ??
              null,

            application
              ?.effective_date
              ??
              null,
          ]
            .filter(
              (
                value,
              ): value is string =>
                Boolean(
                  value,
                ),
            )
            .sort();


        const latestEffectiveDate =
          effectiveDates.at(
            -1,
          )
          ??
          null;


        if (
          latestEffectiveDate
          &&
          input.validityEndDate <
            latestEffectiveDate
        ) {
          throw new ConflictException({
            code:
              'AUTHORIZATION_VALIDITY_BEFORE_FULFILLMENT',

            message:
              'La vigencia no puede terminar antes de la entrega/aplicación registrada.',
          });
        }


        /*
         * PROGRAMACIÓN MEDICARTE
         * ======================
         *
         * El código de patient_schedules es un snapshot operacional.
         *
         * Si todavía no existe aplicación DRAFT/CONFIRMED:
         * - cambio de producto -> sincroniza programación activa;
         * - cambio de cantidad -> sincroniza si existe como máximo
         *   una programación activa.
         *
         * No se reescribe patient_schedule_history:
         * se agrega una nueva revisión UPDATED.
         */
        const draftApplication =
          (
            productChanged
            ||
            quantityChanged
          )
            ? (
                await tx.execute<{
                  id:
                    string;
                }>(sql`
                  select
                    id

                  from
                    patient_applications

                  where
                    authorization_item_id =
                      ${authorizationItemId}

                    and
                    status =
                      'DRAFT'

                  order by
                    created_at,
                    id

                  limit 1

                  for update
                `)
              ).rows[0]
            : undefined;


        if (draftApplication) {
          throw new ConflictException({
            code:
              'AUTHORIZATION_DRAFT_APPLICATION_EXISTS',

            message:
              'Existe una aplicación en borrador para esta autorización. Debe resolverse antes de modificar producto o cantidad.',
          });
        }


        const activeSchedules =
          (
            productChanged
            ||
            quantityChanged
          )
            ? (
                await tx.execute<
                  ActiveScheduleRow
                >(sql`
                  select
                    ps.id,
                    ps.planning_period_id,
                    ps.dispensing_point_id,
                    ps.commercial_code,
                    ps.scheduled_date::text,
                    ps.quantity::int,
                    ps.status,
                    ps.schedule_timing,
                    ps.late_handling,
                    ps.deferred_planning_period_id,
                    ps.revision::int

                  from
                    patient_schedules ps

                  where
                    ps.authorization_item_id =
                      ${authorizationItemId}

                    and
                    ps.status in (
                      'SCHEDULED',
                      'RESCHEDULED'
                    )

                  order by
                    ps.id

                  for update
                `)
              ).rows
            : [];


        if (
          quantityChanged
          &&
          activeSchedules.length >
            1
        ) {
          throw new ConflictException({
            code:
              'AUTHORIZATION_SCHEDULE_RECONCILIATION_COMPLEX',

            message:
              'La autorización tiene varias programaciones activas y la cantidad no puede redistribuirse automáticamente.',
          });
        }


        const synchronizedScheduleIds:
          string[] =
          [];


        for (
          const schedule
          of activeSchedules
        ) {
          const nextCommercialCode =
            productChanged
              ? commercialCode
              : schedule.commercial_code;

          const nextQuantity =
            quantityChanged
              ? input.quantity
              : Number(
                  schedule.quantity,
                );


          if (
            nextCommercialCode ===
              schedule.commercial_code
            &&
            nextQuantity ===
              Number(
                schedule.quantity,
              )
          ) {
            continue;
          }


          const nextRevision =
            Number(
              schedule.revision,
            )
            +
            1;


          await tx.execute(sql`
            update
              patient_schedules

            set
              commercial_code =
                ${nextCommercialCode},

              quantity =
                ${nextQuantity},

              revision =
                ${nextRevision},

              updated_by =
                ${scope.userId},

              updated_at =
                now()

            where
              id =
                ${schedule.id}
          `);


          await tx.execute(sql`
            insert into
              patient_schedule_history
            (
              patient_schedule_id,
              revision,
              authorization_item_id,
              planning_period_id,
              dispensing_point_id,
              commercial_code,
              scheduled_date,
              quantity,
              status,
              schedule_timing,
              late_handling,
              deferred_planning_period_id,
              change_type,
              changed_by,
              correlation_id
            )
            values
            (
              ${schedule.id},
              ${nextRevision},
              ${authorizationItemId},
              ${schedule.planning_period_id},
              ${schedule.dispensing_point_id},
              ${nextCommercialCode},
              ${schedule.scheduled_date}::date,
              ${nextQuantity},
              ${schedule.status},
              ${schedule.schedule_timing},
              ${schedule.late_handling},
              ${schedule.deferred_planning_period_id},
              'UPDATED',
              ${scope.userId},
              ${scope.correlationId}
            )
          `);


          await tx.execute(sql`
            insert into
              audit_events
            (
              actor_type,
              actor_id,
              organization_id,
              action,
              resource_type,
              resource_id,
              before,
              after,
              correlation_id,
              request_id,
              result
            )
            values
            (
              'USER',
              ${scope.userId},
              ${scope.organizationId},
              'PATIENT_SCHEDULE_UPDATED',
              'patient_schedule',
              ${schedule.id},
              ${JSON.stringify({
                commercialCode:
                  schedule.commercial_code,

                quantity:
                  Number(
                    schedule.quantity,
                  ),

                revision:
                  Number(
                    schedule.revision,
                  ),
              })}::jsonb,
              ${JSON.stringify({
                commercialCode:
                  nextCommercialCode,

                quantity:
                  nextQuantity,

                revision:
                  nextRevision,

                source:
                  'AUTHORIZATION_MANUAL_EDIT',
              })}::jsonb,
              ${scope.correlationId},
              ${scope.correlationId},
              'SUCCESS'
            )
          `);


          /*
           * Los placeholders anteriores se reemplazan inmediatamente
           * por valores tipados dentro del mismo archivo fuente.
           */
          synchronizedScheduleIds.push(
            schedule.id,
          );
        }


        const purchaseOrderLinks =
          (
            await tx.execute<
              PurchaseOrderLink
            >(sql`
              select
                po.id
                  as purchase_order_id,

                po.purchase_order_code,

                po.status
                  as purchase_order_status,

                po.olp_accepted_at,

                pol.id
                  as purchase_order_line_id,

                pol.commercial_code,

                pol.requested_quantity::int
                  as requested_quantity,

                poas.source_quantity_snapshot::int
                  as source_quantity_snapshot,

                pol.dispensing_point_id,

                pol.requested_delivery_date::text
                  as requested_delivery_date,

                exists (
                  select 1

                  from
                    purchase_order_receipts por

                  where
                    por.purchase_order_id =
                      po.id
                )
                  as has_direct_receipt,

                exists (
                  select 1

                  from
                    deliveries d

                  join
                    receipts r
                      on r.delivery_id =
                         d.id

                  where
                    d.purchase_order_id =
                      po.id

                    and
                    r.status =
                      'CONFIRMED'
                )
                  as has_legacy_receipt,

                exists (
                  select 1

                  from
                    deliveries d2

                  where
                    d2.purchase_order_id =
                      po.id

                    and
                    d2.status <>
                      'CANCELLED'
                )
                  as has_delivery

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
                  ${authorizationItemId}

                and
                po.status not in (
                  'CANCELLED',
                  'REJECTED'
                )

              order by
                po.created_at,
                pol.created_at,
                pol.id

              for update of
                po,
                pol,
                poas
            `)
          ).rows;


        const historicalPurchaseOrderIds =
          [
            ...new Set(
              purchaseOrderLinks.map(
                (row) =>
                  row.purchase_order_id,
              ),
            ),
          ];


        const olpAlreadyAccepted =
          purchaseOrderLinks.some(
            (row) =>
              Boolean(
                row.olp_accepted_at,
              )
              ||
              ![
                'DRAFT',
                'ISSUED',
              ].includes(
                row.purchase_order_status,
              ),
          );


        const medicarteAlreadyReceived =
          purchaseOrderLinks.some(
            (row) =>
              row.has_direct_receipt
              ||
              row.has_legacy_receipt,
          );


        /*
         * OC SOLO MTD
         * ===========
         *
         * Solo se reconcilia mientras:
         * - OLP no la haya aceptado;
         * - siga DRAFT/ISSUED;
         * - no existan entregas/despachos;
         * - no exista recepción Medicarte.
         *
         * Una vez OLP intervino, la OC se conserva
         * como hecho histórico y no se reescribe.
         */
        const mutableMtdLinks =
          purchaseOrderLinks.filter(
            (row) =>
              row.commercial_code ===
                current.codigo_medicamento
              &&
              !row.olp_accepted_at
              &&
              [
                'DRAFT',
                'ISSUED',
              ].includes(
                row.purchase_order_status,
              )
              &&
              !row.has_direct_receipt
              &&
              !row.has_legacy_receipt
              &&
              !row.has_delivery,
          );


        if (
          (
            productChanged
            ||
            quantityChanged
          )
          &&
          mutableMtdLinks.length > 1
        ) {
          throw new ConflictException({
            code:
              'AUTHORIZATION_PO_RECONCILIATION_COMPLEX',

            message:
              'La autorización está distribuida en varias líneas de OC de MTD y requiere revisión antes de modificar producto o cantidad.',
          });
        }


        const touchedPurchaseOrders =
          new Set<string>();


        if (
          productChanged
          &&
          mutableMtdLinks.length ===
            1
        ) {
          const link =
            mutableMtdLinks[0]!;

          const remainingOldLineQuantity =
            Number(
              link.requested_quantity,
            )
            -
            Number(
              link.source_quantity_snapshot,
            );


          /*
           * La relación anterior se retira SOLO porque
           * todavía es una OC exclusivamente controlada
           * por MTD y sin actividad downstream.
           *
           * El audit event conserva before/after y la OC
           * continúa siendo trazable por su propio historial.
           */
          await tx.execute(sql`
            delete from
              purchase_order_authorization_sources

            where
              purchase_order_line_id =
                ${link.purchase_order_line_id}

              and
              authorization_item_id =
                ${authorizationItemId}
          `);


          if (
            remainingOldLineQuantity >
            0
          ) {
            await tx.execute(sql`
              update
                purchase_order_lines

              set
                requested_quantity =
                  ${remainingOldLineQuantity},

                updated_at =
                  now()

              where
                id =
                  ${link.purchase_order_line_id}
            `);
          } else {
            /*
             * Aún no existe actividad OLP/Medicarte.
             * Las allocations de demanda de ESTA línea
             * pueden retirarse junto con la línea obsoleta.
             */
            await tx.execute(sql`
              delete from
                purchase_order_demand_allocations

              where
                purchase_order_line_id =
                  ${link.purchase_order_line_id}
            `);

            await tx.execute(sql`
              delete from
                purchase_order_lines

              where
                id =
                  ${link.purchase_order_line_id}
            `);
          }


          const target =
            (
              await tx.execute<{
                id:
                  string;

                requested_quantity:
                  number;
              }>(sql`
                select
                  pol.id,

                  pol.requested_quantity::int
                    as requested_quantity

                from
                  purchase_order_lines pol

                where
                  pol.purchase_order_id =
                    ${link.purchase_order_id}

                  and
                  pol.commercial_code =
                    ${commercialCode}

                  and
                  pol.dispensing_point_id
                    is not distinct from
                    ${link.dispensing_point_id}::uuid

                order by
                  pol.created_at,
                  pol.id

                limit 1

                for update
              `)
            ).rows[0];


          let targetLineId:
            string;


          if (target) {
            targetLineId =
              target.id;

            await tx.execute(sql`
              update
                purchase_order_lines

              set
                requested_quantity =
                  requested_quantity +
                  ${input.quantity},

                updated_at =
                  now()

              where
                id =
                  ${target.id}
            `);
          } else {
            targetLineId =
              (
                await tx.execute<{
                  id:
                    string;
                }>(sql`
                  insert into
                    purchase_order_lines
                  (
                    purchase_order_id,
                    commercial_code,
                    provenance,
                    product_description,
                    presentation,
                    dispensing_point_id,
                    requested_quantity,
                    olp_managed_quantity,
                    accepted_quantity,
                    requested_delivery_date,
                    compensar_unit_rate_snapshot,
                    tariff_snapshot_provenance,
                    legacy_tariff_revision_id,
                    supplier_unit_cost,
                    projected_demand_line_id,
                    projected_demand_revision,
                    demand_bucket
                  )
                  values
                  (
                    ${link.purchase_order_id},
                    ${commercialCode},
                    'LEGACY_AUTHORIZATION',
                    ${tariff.product_description},
                    null,
                    ${link.dispensing_point_id}::uuid,
                    ${input.quantity},
                    null,
                    null,
                    ${link.requested_delivery_date}::date,
                    null,
                    'LEGACY_UNRESOLVED',
                    null,
                    null,
                    null,
                    null,
                    null
                  )
                  returning
                    id
                `)
              ).rows[0]!.id;
          }


          await tx.execute(sql`
            insert into
              purchase_order_authorization_sources
            (
              purchase_order_line_id,
              authorization_item_id,
              projected_demand_line_id,
              projected_demand_revision,
              source_quantity_snapshot,
              provenance,
              evidence_at
            )
            values
            (
              ${targetLineId},
              ${authorizationItemId},
              null,
              null,
              ${input.quantity},
              'LEGACY_DIRECT_ASSIGNMENT',
              now()
            )
            on conflict (
              purchase_order_line_id,
              authorization_item_id
            )
            do update
            set
              projected_demand_line_id =
                null,

              projected_demand_revision =
                null,

              source_quantity_snapshot =
                excluded.source_quantity_snapshot,

              provenance =
                'LEGACY_DIRECT_ASSIGNMENT',

              evidence_at =
                now()
          `);


          touchedPurchaseOrders.add(
            link.purchase_order_id,
          );
        }


        if (
          !productChanged
          &&
          quantityChanged
          &&
          mutableMtdLinks.length ===
            1
        ) {
          const link =
            mutableMtdLinks[0]!;

          const nextLineQuantity =
            Number(
              link.requested_quantity,
            )
            -
            Number(
              link.source_quantity_snapshot,
            )
            +
            input.quantity;


          if (
            nextLineQuantity <=
            0
          ) {
            throw new ConflictException({
              code:
                'AUTHORIZATION_PO_RECONCILIATION_CONFLICT',

              message:
                'No fue posible reconciliar la cantidad de la OC de MTD de forma segura.',
            });
          }


          await tx.execute(sql`
            update
              purchase_order_lines

            set
              requested_quantity =
                ${nextLineQuantity},

              updated_at =
                now()

            where
              id =
                ${link.purchase_order_line_id}
          `);


          await tx.execute(sql`
            update
              purchase_order_authorization_sources

            set
              source_quantity_snapshot =
                ${input.quantity}

            where
              purchase_order_line_id =
                ${link.purchase_order_line_id}

              and
              authorization_item_id =
                ${authorizationItemId}
          `);


          touchedPurchaseOrders.add(
            link.purchase_order_id,
          );
        }


        for (
          const purchaseOrderId
          of touchedPurchaseOrders
        ) {
          await tx.execute(sql`
            update
              purchase_orders

            set
              version =
                version + 1,

              updated_by =
                ${scope.userId},

              updated_at =
                now()

            where
              id =
                ${purchaseOrderId}
          `);
        }


        /*
         * INVENTARIO / ALLOCATION
         * =======================
         *
         * Producto cambiado:
         *   se libera TODO saldo no consumido.
         *
         * Cantidad reducida:
         *   solo se libera el exceso necesario.
         *
         * Cantidad aumentada:
         *   nunca se inventa allocation.
         */
        const allocations =
          (
            await tx.execute<
              AllocationRow
            >(sql`
              select
                iaa.id,
                iaa.allocated_quantity::int,
                iaa.consumed_quantity::int,
                iaa.released_quantity::int,
                iaa.status,
                iaa.created_at

              from
                inventory_authorization_allocations iaa

              where
                iaa.authorization_item_id =
                  ${authorizationItemId}

                and
                iaa.status in (
                  'ALLOCATED',
                  'PARTIALLY_CONSUMED'
                )

                and (
                  iaa.allocated_quantity
                  -
                  iaa.consumed_quantity
                  -
                  iaa.released_quantity
                ) > 0

              order by
                iaa.created_at desc,
                iaa.id desc

              for update
            `)
          ).rows;


        let releasedInventoryQuantity =
          0;


        if (productChanged) {
          for (
            const allocation
            of allocations
          ) {
            const active =
              Math.max(
                Number(
                  allocation.allocated_quantity,
                )
                -
                Number(
                  allocation.consumed_quantity,
                )
                -
                Number(
                  allocation.released_quantity,
                ),
                0,
              );

            if (
              active <=
              0
            ) {
              continue;
            }

            await tx.execute(sql`
              update
                inventory_authorization_allocations

              set
                released_quantity =
                  released_quantity +
                  ${active},

                status =
                  'RELEASED',

                updated_by =
                  ${scope.userId},

                updated_at =
                  now()

              where
                id =
                  ${allocation.id}
            `);

            releasedInventoryQuantity +=
              active;
          }
        } else if (
          quantityChanged
        ) {
          const activeBefore =
            allocations.reduce(
              (
                total,
                allocation,
              ) =>
                total
                +
                Math.max(
                  Number(
                    allocation.allocated_quantity,
                  )
                  -
                  Number(
                    allocation.consumed_quantity,
                  )
                  -
                  Number(
                    allocation.released_quantity,
                  ),
                  0,
                ),
              0,
            );


          const targetActive =
            Math.max(
              input.quantity
              -
              Number(
                consumed,
              ),
              0,
            );


          let excess =
            Math.max(
              activeBefore
              -
              targetActive,
              0,
            );


          for (
            const allocation
            of allocations
          ) {
            if (
              excess <=
              0
            ) {
              break;
            }

            const active =
              Math.max(
                Number(
                  allocation.allocated_quantity,
                )
                -
                Number(
                  allocation.consumed_quantity,
                )
                -
                Number(
                  allocation.released_quantity,
                ),
                0,
              );

            if (
              active <=
              0
            ) {
              continue;
            }

            const release =
              Math.min(
                active,
                excess,
              );

            const nextReleased =
              Number(
                allocation.released_quantity,
              )
              +
              release;

            const remaining =
              Number(
                allocation.allocated_quantity,
              )
              -
              Number(
                allocation.consumed_quantity,
              )
              -
              nextReleased;

            const nextStatus =
              remaining <=
                0
                ? 'RELEASED'
                : Number(
                      allocation.consumed_quantity,
                    ) > 0
                  ? 'PARTIALLY_CONSUMED'
                  : 'ALLOCATED';


            await tx.execute(sql`
              update
                inventory_authorization_allocations

              set
                released_quantity =
                  ${nextReleased},

                status =
                  ${nextStatus},

                updated_by =
                  ${scope.userId},

                updated_at =
                  now()

              where
                id =
                  ${allocation.id}
            `);


            releasedInventoryQuantity +=
              release;

            excess -=
              release;
          }
        }


        const tariffInclusion =
          (
            tariff.tipo_inclusion
            ??
            ''
          )
            .trim()
            .toUpperCase()
            .replace(
              /\s+/g,
              '_',
            );


        const nextCoverageType:
          'PBS'
          |
          'NO_PBS'
          |
          'UNCLASSIFIED' =
          tariffInclusion ===
            'PBS'
            ? 'PBS'
            : tariffInclusion ===
                'NO_PBS'
              ? 'NO_PBS'
              : 'UNCLASSIFIED';


        const nextDirectionStatus =
          productChanged
            ? nextCoverageType ===
                'PBS'
              ? 'NOT_APPLICABLE'
              : 'PENDING'
            : current.direction_status;


        const sourceData =
          current.source_data
          &&
          typeof current.source_data ===
            'object'
          &&
          !Array.isArray(
            current.source_data,
          )
            ? {
                ...current.source_data,
              }
            : {};


        sourceData.CODIGO_COMERCIAL =
          commercialCode;

        if (
          Object.prototype.hasOwnProperty.call(
            sourceData,
            'COD_COMERCIAL',
          )
        ) {
          sourceData.COD_COMERCIAL =
            commercialCode;
        }

        sourceData.CANTIDAD =
          String(
            input.quantity,
          );

        sourceData.FECHA_FINAL_VIGENCIA =
          input.validityEndDate;


        const tariffRuleVersion =
          `TARIFF-ANNEX-1:${Number(
            tariff.version,
          )}`;


        const updated =
          (
            await tx.execute<{
              version:
                number;
            }>(sql`
              update
                authorization_items

              set
                codigo_medicamento =
                  ${commercialCode},

                authorization_key =
                  ${authorizationKey},

                source_data =
                  ${JSON.stringify(
                    sourceData,
                  )}::jsonb,

                coverage_type =
                  ${nextCoverageType},

                direction_status =
                  ${nextDirectionStatus},

                tariff_membership_status =
                  'LISTED',

                tariff_membership_evaluated_at =
                  now(),

                tariff_rule_version =
                  ${tariffRuleVersion},

                updated_by =
                  ${scope.userId},

                updated_at =
                  now(),

                version =
                  version + 1

              where
                id =
                  ${authorizationItemId}

              returning
                version
            `)
          ).rows[0]!;


        const activePurchaseOrderEffect =
          touchedPurchaseOrders.size >
            0
            ? 'RECONCILED_MTD_ONLY'
            : (
                productChanged
                ||
                quantityChanged
              )
              &&
              purchaseOrderLinks.length >
                0
              ? 'HISTORICAL_PRESERVED'
              : 'NONE';


        const before =
          {
            authorizationKey:
              current.authorization_key,

            commercialCode:
              current.codigo_medicamento,

            quantity:
              previousQuantity,

            validityEndDate:
              previousValidity,

            version:
              current.version,
          };


        const after =
          {
            authorizationKey,

            commercialCode,

            quantity:
              input.quantity,

            validityEndDate:
              input.validityEndDate,

            version:
              updated.version,
          };


        await tx.execute(sql`
          insert into
            audit_events
          (
            actor_type,
            actor_id,
            organization_id,
            action,
            resource_type,
            resource_id,
            before,
            after,
            correlation_id,
            request_id,
            result
          )
          values
          (
            'USER',
            ${scope.userId},
            ${scope.organizationId},
            'AUTHORIZATION_MANUAL_EDITED',
            'authorization_item',
            ${authorizationItemId},
            ${JSON.stringify(
              before,
            )}::jsonb,
            ${JSON.stringify({
              ...after,

              impact: {
                productChanged,
                quantityChanged,
                validityChanged,

                releasedInventoryQuantity,

                historicalPurchaseOrderIds,

                activePurchaseOrderEffect,

                olpAlreadyAccepted,

                medicarteAlreadyReceived,

                synchronizedScheduleIds,
              },
            })}::jsonb,
            ${scope.correlationId},
            ${scope.correlationId},
            'SUCCESS'
          )
        `);


        const topics:
          Array<
            | 'AUTHORIZATIONS'
            | 'INVENTORY'
            | 'PURCHASE_ORDERS'
            | 'DASHBOARD'
          > =
          [
            'AUTHORIZATIONS',
            'DASHBOARD',
          ];


        if (
          productChanged
          ||
          quantityChanged
          ||
          touchedPurchaseOrders.size >
            0
        ) {
          topics.push(
            'PURCHASE_ORDERS',
          );
        }


        if (
          releasedInventoryQuantity >
          0
        ) {
          topics.push(
            'INVENTORY',
          );
        }


        await tx.execute(
          realtimeInvalidationSql({
            organizationCodes:
              (
                productChanged
                ||
                quantityChanged
                ||
                releasedInventoryQuantity >
                  0
              )
                ? REALTIME_AUDIENCE
                    .PROCUREMENT
                : REALTIME_AUDIENCE
                    .AUTHORIZATION,

            topics,

            correlationId:
              scope.correlationId,

            resource: {
              type:
                'authorization_item',

              id:
                authorizationItemId,

              version:
                updated.version,
            },
          }),
        );


        return {
          id:
            authorizationItemId,

          authorizationKey,

          commercialCode,

          quantity:
            input.quantity,

          validityEndDate:
            input.validityEndDate,

          version:
            updated.version,

          impact: {
            productChanged,
            quantityChanged,
            validityChanged,

            releasedInventoryQuantity,

            historicalPurchaseOrderIds,

            activePurchaseOrderEffect,

            olpAlreadyAccepted,

            medicarteAlreadyReceived,
          },
        };
      },
    );
  }


  private sourceText(
    sourceData:
      Record<string, unknown>,

    key:
      string,
  ) {
    const value =
      sourceData[
        key
      ];

    if (
      value ===
        null
      ||
      value ===
        undefined
    ) {
      return null;
    }

    if (
      typeof value === 'string'
      ||
      typeof value === 'number'
      ||
      typeof value === 'boolean'
    ) {
      return String(
        value,
      ).trim();
    }

    return null;
  }


  private sourceQuantity(
    sourceData:
      Record<string, unknown>,
  ) {
    const raw =
      this.sourceText(
        sourceData,
        'CANTIDAD',
      );

    const quantity =
      Number(
        raw,
      );

    return Number.isInteger(
      quantity,
    )
      ? quantity
      : 0;
  }
}
