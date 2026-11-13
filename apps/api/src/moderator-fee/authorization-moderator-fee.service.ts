import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type {
  ModeratorFeeInvoiceUrlResponse,
  ModeratorFeeResponse,
  RegisterModeratorFeeRequest,
} from '@authorization/contracts';

import type { createDatabase } from '@authorization/database';
import type { PoolClient, QueryResultRow } from 'pg';

import type { Scope } from '../common/request-scope';
import { API_CONFIG, DATABASE } from '../tokens';
import type { ApiConfig } from '@authorization/config';
import { ModeratorFeeSheetService } from './moderator-fee-sheet.service';

type Database = ReturnType<typeof createDatabase>;

type AuthorizationRow = QueryResultRow & {
  id: string;
  numero_autorizacion: string | null;
  codigo_medicamento: string | null;
  product_description: string | null;
  patient_document: string | null;
  patient_document_type: string | null;
  patient_name: string | null;
  expected_amount_cop: string | null;
  fulfillment_effective_date: string | null;
  authorization_item_count: string;
  has_confirmed_fulfillment: boolean;
  has_active_reservation: boolean;
  annulled_at: Date | string | null;
};

type EventRow = QueryResultRow & {
  id: string;
  version: number;
  status: 'COLLECTED' | 'NOT_COLLECTED' | 'REFUNDED' | 'INVALIDATED';
  amount_cop: string | null;
  collected_at: Date | string | null;
  observation: string | null;
  reference: string | null;
  registered_by: string;
  created_at: Date | string;
  idempotency_key: string;
  effective_at: Date | string | null;
  reason: string | null;
  related_event_id: string | null;
  manual_amount: boolean;
  source_amount_cop: string | null;
  difference_cop: string | null;
  sync_status: 'PENDING' | 'SYNCED' | 'FAILED' | 'RECONCILIATION_REQUIRED' | null;
};

type QueryClient = Pick<PoolClient, 'query'>;

/**
 * Una autorización de MEDICARTE debe estar relacionada
 * operativamente con un punto del usuario y del producto.
 *
 * No es suficiente que el producto exista en el AT:
 * también debe existir un vínculo operacional específico
 * con la autorización.
 */
const MEDICARTE_VISIBILITY = (lockGrants: boolean): string => `
  and exists (
    select 1

    from dispensing_points dp

    left join product_delivery_point_mappings mapping
      on mapping.dispensing_point_id = dp.id

    left join tariff_annex_products tap
      on tap.codigo_producto = i.codigo_medicamento
     and tap.active = true

     and btrim(
       coalesce(tap.numero_expediente_invima, '')
     ) ~ '^[0-9]+$'

     and btrim(
       coalesce(tap.consecutivo_invima_presentacion, '')
     ) ~ '^[0-9]+$'

     and mapping.invima_record_normalized =
       coalesce(
         nullif(
           ltrim(btrim(tap.numero_expediente_invima), '0'),
           ''
         ),
         '0'
       )

     and mapping.invima_presentation_normalized =
       coalesce(
         nullif(
           ltrim(
             btrim(tap.consecutivo_invima_presentacion),
             '0'
           ),
           ''
         ),
         '0'
       )

    where dp.organization_id = $2::uuid
      and dp.active = true

      and (
        (
          not $4::boolean
          and exists (
            select 1
            from user_point_scopes ups
            where ups.user_id = $3::uuid
              and ups.dispensing_point_id = dp.id
              and ups.revoked_at is null
              ${lockGrants ? 'for share of ups' : ''}
          )
        )
        or (
          (
            $4::boolean
            or not exists (
              select 1
              from user_point_scopes ups_previous
              where ups_previous.user_id = $3::uuid
            )
          )
          and mapping.dispensing_point_id is not null
          and tap.codigo_producto is not null
        )
      )

      and (
        exists (
          select 1
          from patient_schedules ps
          where ps.authorization_item_id = i.id
            and ps.dispensing_point_id = dp.id
            and ps.status in ('SCHEDULED', 'RESCHEDULED')
        )

        or exists (
          select 1
          from patient_default_dispensing_points pdp
          where pdp.dispensing_point_id = dp.id
            and pdp.active = true
            and pdp.patient_document = coalesce(
              nullif(
                btrim(
                  i.source_data->>'IDENTIFICACION_PACIENTE'
                ),
                ''
              ),
              nullif(
                btrim(i.source_data->>'NUM_DOCUMENTO'),
                ''
              )
            )
        )

        or exists (
          select 1
          from purchase_order_authorization_sources poas
          join purchase_order_lines pol
            on pol.id = poas.purchase_order_line_id
          join purchase_orders po
            on po.id = pol.purchase_order_id
          where poas.authorization_item_id = i.id
            and poas.released_at is null
            and pol.dispensing_point_id = dp.id
            and pol.commercial_code = i.codigo_medicamento
            and po.status not in ('CANCELLED', 'REJECTED')
        )

        or exists (
          select 1
          from inventory_authorization_allocations iaa
          where iaa.authorization_item_id = i.id
            and iaa.dispensing_point_id = dp.id
            and iaa.commercial_code = i.codigo_medicamento
        )
      )
  )
`;

const HISTORY_SQL = `
  select
    id,
    version,
    status,
    amount_cop,
    collected_at,
    observation,
    reference,
    registered_by,
    created_at,
    idempotency_key
    ,effective_at, reason, related_event_id, manual_amount, source_amount_cop,
    difference_cop,
    (select status from moderator_fee_sheet_sync where event_id = authorization_moderator_fee_events.id) as sync_status

  from authorization_moderator_fee_events

  where authorization_item_id = $1::uuid

  order by version desc
`;

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function nullableIso(value: Date | string | null | undefined): string | null {
  return value == null ? null : iso(value);
}

function nullableText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function authorizationSql(scope: Scope, forUpdate: boolean): string {
  return `
    select
      i.id,
      i.numero_autorizacion,
      i.codigo_medicamento,
      i.source_data->>'NOMBRE_MEDICAMENTO' as product_description,
      coalesce(
        i.source_data->>'IDENTIFICACION_PACIENTE',
        i.source_data->>'NUM_DOCUMENTO'
      ) as patient_document,
      coalesce(
        i.source_data->>'TIPO_IDENTIFICACION',
        i.source_data->>'TIPO_DOCUMENTO'
      ) as patient_document_type,
      i.source_data->>'NOMBRE_PACIENTE' as patient_name,
      i.source_data->>'VALOR_CUOTA_MODERADORA' as expected_amount_cop,
      i.annulled_at,
      (
        select count(*)::text
        from authorization_items sibling
        where sibling.numero_autorizacion = i.numero_autorizacion
      ) as authorization_item_count,
      exists (
        select 1
        from authorization_fulfillments confirmed_fulfillment
        where confirmed_fulfillment.authorization_item_id = i.id
          and confirmed_fulfillment.quantity > 0
      ) as has_confirmed_fulfillment,
      exists (
        select 1
        from inventory_authorization_allocations active_reservation
        where active_reservation.authorization_item_id = i.id
          and active_reservation.status in ('ALLOCATED', 'PARTIALLY_CONSUMED')
          and greatest(
            active_reservation.allocated_quantity
              - active_reservation.consumed_quantity
              - active_reservation.released_quantity,
            0
          ) > 0
      ) as has_active_reservation,
      (
        select to_char(f.effective_date, 'YYYY-MM-DD')
        from authorization_fulfillments f
        where f.authorization_item_id = i.id
        order by f.confirmed_at desc
        limit 1
      ) as fulfillment_effective_date

    from authorization_items i

    where i.id = $1::uuid

    ${scope.organizationCode === 'MEDICARTE' ? MEDICARTE_VISIBILITY(forUpdate) : ''}

    ${forUpdate ? 'for update of i' : ''}
  `;
}

function authorizationParams(id: string, scope: Scope): unknown[] {
  if (scope.organizationCode === 'MTD') {
    return [id];
  }

  return [id, scope.organizationId, scope.userId, scope.pointAccessKind !== 'explicit'];
}

@Injectable()
export class AuthorizationModeratorFeeService {
  private readonly logger = new Logger(AuthorizationModeratorFeeService.name);

  constructor(
    @Inject(DATABASE)
    private readonly database: Database,
    @Inject(API_CONFIG)
    private readonly config: ApiConfig,
    private readonly sheetService: ModeratorFeeSheetService,
  ) {}

  private assertRead(scope: Scope): void {
    if (scope.organizationCode !== 'MTD' && scope.organizationCode !== 'MEDICARTE') {
      throw new ForbiddenException({
        code: 'MODERATOR_FEE_ORGANIZATION_DENIED',
        message: 'Organización no autorizada para consultar recaudos.',
      });
    }
  }

  private assertManage(scope: Scope): void {
    if (scope.organizationCode !== 'MTD') {
      throw new ForbiddenException({
        code: 'MODERATOR_FEE_MTD_ONLY',
        message: 'Solo MTD puede registrar recaudos de cuota moderadora.',
      });
    }
  }

  private async authorization(
    client: QueryClient,
    id: string,
    scope: Scope,
    forUpdate: boolean,
  ): Promise<AuthorizationRow> {
    if (
      forUpdate &&
      scope.organizationCode === 'MEDICARTE' &&
      scope.pointAccessKind === 'explicit'
    ) {
      const actor = await client.query<{ id: string }>(
        'select id from users where id = $1::uuid for share',
        [scope.userId],
      );

      if (!actor.rows[0]) {
        throw new NotFoundException({
          code: 'MODERATOR_FEE_USER_NOT_FOUND',
          message: 'El usuario no está disponible.',
        });
      }
    }

    const result = await client.query<AuthorizationRow>(
      authorizationSql(scope, forUpdate),
      authorizationParams(id, scope),
    );

    const authorization = result.rows[0];

    if (!authorization) {
      throw new NotFoundException({
        code: 'MODERATOR_FEE_AUTHORIZATION_NOT_FOUND',
        message: 'La autorización no existe o está fuera del alcance del usuario.',
      });
    }

    return authorization;
  }

  private async history(client: QueryClient, id: string): Promise<EventRow[]> {
    const result = await client.query<EventRow>(HISTORY_SQL, [id]);

    return result.rows;
  }

  private response(authorization: AuthorizationRow, events: EventRow[]): ModeratorFeeResponse {
    const latest = events[0];
    const reversed = new Set(events.filter(event =>
      event.status === 'INVALIDATED',
    ).map(event => event.related_event_id));
    const validCollections = events.filter(event =>
      event.status === 'COLLECTED' && !reversed.has(event.id),
    );
    const refunded = events.filter(event => event.status === 'REFUNDED');
    const latestCollection = events.find(event => event.status === 'COLLECTED');
    const hasActiveCollection = latestCollection && !events.some(event =>
      (event.status === 'REFUNDED' || event.status === 'INVALIDATED') &&
      event.related_event_id === latestCollection.id,
    );
    const sum = (rows: EventRow[]) => (rows.reduce((cents, event) =>
      cents + Math.round(Number(event.amount_cop ?? 0) * 100), 0) / 100).toFixed(2);
    const collectedCents = validCollections.reduce((total, event) =>
      total + Math.round(Number(event.amount_cop ?? 0) * 100), 0);
    const refundedCents = refunded.reduce((total, event) =>
      total + Math.round(Number(event.amount_cop ?? 0) * 100), 0);

    return {
      authorizationItemId: authorization.id,

      expectedAmountCop: authorization.expected_amount_cop,

      status: hasActiveCollection ? 'COLLECTED' : latest?.status ?? 'NOT_RECORDED',

      amountCop: hasActiveCollection ? latestCollection.amount_cop : latest?.amount_cop ?? null,

      collectedAt: hasActiveCollection ? nullableIso(latestCollection.collected_at)
        : latest ? nullableIso(latest.collected_at) : null,

      version: latest ? Number(latest.version) : 0,

      lastRegisteredAt: latest ? iso(latest.created_at) : null,
      totalCollectedCop: sum(validCollections),
      totalRefundedCop: sum(refunded),
      netCollectedCop: ((collectedCents - refundedCents) / 100).toFixed(2),

      history: events.map((event) => ({
        id: event.id,

        version: Number(event.version),

        status: event.status,

        amountCop: event.amount_cop,

        collectedAt: nullableIso(event.collected_at),

        observation: event.observation,

        reference: event.reference,

        registeredBy: event.registered_by,

        registeredAt: iso(event.created_at),
        movementType: event.status,
        effectiveAt: nullableIso(event.effective_at ?? event.collected_at),
        reason: event.reason,
        relatedEventId: event.related_event_id,
        manualAmount: event.manual_amount ?? false,
        sourceAmountCop: event.source_amount_cop,
        differenceCop: event.difference_cop,
        ...(event.sync_status ? { syncStatus: event.sync_status } : {}),
      })),
    };
  }

  async detail(authorizationItemId: string, scope: Scope): Promise<ModeratorFeeResponse> {
    this.assertRead(scope);

    const authorization = await this.authorization(
      this.database.pool,
      authorizationItemId,
      scope,
      false,
    );

    const events = await this.history(this.database.pool, authorizationItemId);

    return this.response(authorization, events);
  }

  async getInvoiceUrl(
    authorizationItemId: string,
    scope: Scope,
  ): Promise<ModeratorFeeInvoiceUrlResponse> {
    this.assertRead(scope);

    const authorization = await this.authorization(
      this.database.pool,
      authorizationItemId,
      scope,
      false,
    );

    const invoiceUrl = await this.sheetService.getInvoiceUrl(authorization.numero_autorizacion);

    return { invoiceUrl };
  }

  async retrySheetSync(
    authorizationItemId: string,
    eventId: string,
    scope: Scope,
  ): Promise<ModeratorFeeResponse> {
    this.assertManage(scope);
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const authorization = await this.authorization(client, authorizationItemId, scope, true);
      const events = await this.history(client, authorizationItemId);
      const event = events.find(item => item.id === eventId);
      if (!event) throw new NotFoundException('Movimiento financiero no encontrado.');
      const sync = await client.query<{ status: string }>(
        `select status from moderator_fee_sheet_sync where event_id = $1::uuid for update`,
        [eventId],
      );
      if (!sync.rows[0] || sync.rows[0].status === 'SYNCED' ||
        sync.rows[0].status === 'RECONCILIATION_REQUIRED') {
        await client.query('COMMIT');
        return this.response(authorization, events);
      }
      try {
        const eventBalance = this.response(authorization,
          events.filter(item => Number(item.version) <= Number(event.version)));
        await this.sheetService.appendRow({
          eventId,
          relatedEventId: event.related_event_id,
          netAmountCop: eventBalance.netCollectedCop,
          authorizationItemId,
          authorizationNumber: authorization.numero_autorizacion,
          patientDocument: authorization.patient_document,
          patientDocumentType: authorization.patient_document_type,
          patientName: authorization.patient_name,
          effectiveDate: nullableIso(event.effective_at ?? event.collected_at),
          professionalDocument: event.reference,
          status: event.status,
          expectedAmountCop: authorization.expected_amount_cop,
          amountCop: event.amount_cop,
          observation: event.observation,
          registeredAt: iso(event.created_at),
          registeredBy: event.registered_by,
        });
        await client.query(`update moderator_fee_sheet_sync set status = $2,
          attempts = attempts + 1, last_error = null, updated_at = now()
          where event_id = $1::uuid`, [eventId,
          event.status === 'REFUNDED' || event.status === 'INVALIDATED'
            ? 'RECONCILIATION_REQUIRED' : 'SYNCED']);
      } catch (cause: unknown) {
        await client.query(`update moderator_fee_sheet_sync set status = 'FAILED',
          attempts = attempts + 1, last_error = $2, updated_at = now()
          where event_id = $1::uuid`,
          [eventId, cause instanceof Error ? cause.message : String(cause)]);
      }
      const updated = await this.history(client, authorizationItemId);
      await client.query('COMMIT');
      return this.response(authorization, updated);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async register(
    authorizationItemId: string,
    body: RegisterModeratorFeeRequest,
    scope: Scope,
  ): Promise<ModeratorFeeResponse> {
    this.assertManage(scope);

    const collectedAt = body.status === 'COLLECTED' ? iso(body.collectedAt) : null;
    const effectiveAt = body.status === 'REFUNDED' ? iso(body.effectiveAt) : collectedAt;

    if (effectiveAt !== null && new Date(effectiveAt).getTime() > Date.now()) {
      throw new BadRequestException({
        code: 'MODERATOR_FEE_FUTURE_COLLECTION',
        message: 'La fecha de recaudo no puede ser futura.',
      });
    }

    const observation = nullableText(body.observation);
    const reference = nullableText(body.professionalDocument ?? body.reference);
    const reason = body.status === 'REFUNDED' || body.status === 'INVALIDATED'
      ? body.reason.trim() : null;
    const relatedEventId = body.status === 'REFUNDED' || body.status === 'INVALIDATED'
      ? body.relatedEventId : null;

    const client = await this.database.pool.connect();

    try {
      await client.query('BEGIN');

      // Bloqueo por AUTO, serializa los cambios concurrentes.
      const authorization = await this.authorization(client, authorizationItemId, scope, true);

      // Consultar los eventos antes de calcular el importe vigente:
      // un reintento debe conservar el importe del evento original.
      const events = await this.history(client, authorizationItemId);

      const previousAttempt = events.find((event) => event.idempotency_key === body.idempotencyKey);

      if (previousAttempt) {
        const amountMatches =
          body.status === 'COLLECTED' || body.status === 'REFUNDED'
            ? body.amountCop === undefined ||
              Number(body.amountCop).toFixed(2) === previousAttempt.amount_cop
            : previousAttempt.amount_cop === null;

        const samePayload =
          previousAttempt.status === body.status &&
          amountMatches &&
          nullableIso(previousAttempt.collected_at) === collectedAt &&
          previousAttempt.observation === observation &&
          previousAttempt.reference === reference &&
          (body.status === 'COLLECTED' || body.status === 'REFUNDED'
            ? nullableIso(previousAttempt.effective_at ?? previousAttempt.collected_at) === effectiveAt
            : true) &&
          previousAttempt.reason === reason &&
          (previousAttempt.related_event_id ?? null) === relatedEventId &&
          (previousAttempt.manual_amount ?? false) ===
            (body.status === 'COLLECTED' ? (body.manualAmount ?? false) : false);

        if (!samePayload) {
          throw new ConflictException({
            code: 'MODERATOR_FEE_IDEMPOTENCY_CONFLICT',
            message: 'La clave de idempotencia ya se utilizó con información diferente.',
          });
        }

        await client.query('COMMIT');

        return this.response(authorization, events);
      }

      if (Number(authorization.authorization_item_count) !== 1) {
        throw new ConflictException({
          code: 'MODERATOR_FEE_AUTHORIZATION_IDENTITY_AMBIGUOUS',
          message:
            'El número de autorización está asociado a más de un producto histórico y requiere conciliación antes del recaudo.',
        });
      }

      const latestCollection = events.find(event => event.status === 'COLLECTED');
      const activeCollection = latestCollection && !events.some(event =>
        (event.status === 'REFUNDED' || event.status === 'INVALIDATED') &&
        event.related_event_id === latestCollection.id,
      ) ? latestCollection : null;

      if (activeCollection && body.status === 'COLLECTED') {
        throw new ConflictException({
          code: 'MODERATOR_FEE_ALREADY_COLLECTED',
          message: 'Ya existe un recaudo activo.',
        });
      }
      if (activeCollection && body.status === 'NOT_COLLECTED') {
        throw new ConflictException({
          code: 'MODERATOR_FEE_ACTIVE_COLLECTION',
          message: 'Un pago activo solo puede cerrarse mediante devolución o invalidación.',
        });
      }
      if (body.status === 'REFUNDED' || body.status === 'INVALIDATED') {
        if (!activeCollection || activeCollection.id !== body.relatedEventId) {
          throw new ConflictException({
            code: 'MODERATOR_FEE_NO_ACTIVE_COLLECTION',
            message: 'No existe el recaudo activo indicado.',
          });
        }
        if (body.status === 'REFUNDED' &&
          Number(body.amountCop).toFixed(2) !== Number(activeCollection.amount_cop).toFixed(2)) {
          throw new BadRequestException({
            code: 'MODERATOR_FEE_PARTIAL_REFUND_UNSUPPORTED',
            message: 'La devolución debe corresponder al recaudo total.',
          });
        }
        if (body.status === 'REFUNDED' && activeCollection.collected_at &&
          new Date(body.effectiveAt).getTime() < new Date(activeCollection.collected_at).getTime()) {
          throw new BadRequestException({
            code: 'MODERATOR_FEE_REFUND_BEFORE_COLLECTION',
            message: 'La devolución no puede anteceder al recaudo.',
          });
        }
      }

      // Solo los registros nuevos utilizan la cuota vigente.
      // El cliente no determina el importe financiero.
      let amountCop: string | null = null;
      let manualAmount = false;
      let sourceAmountCop: string | null = null;
      let differenceCop: string | null = null;

      if (body.status === 'COLLECTED') {
        const expected = authorization.expected_amount_cop?.trim() ?? '';

        if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(expected) || Number(expected) <= 0) {
          if (!body.amountCop || !observation || body.manualAmount !== true) {
            throw new BadRequestException({
              code: 'MODERATOR_FEE_MANUAL_AMOUNT_REQUIRED',
              message: 'Indica el importe real, una observación y confirma el valor manual.',
            });
          }
          manualAmount = true;
          amountCop = Number(body.amountCop).toFixed(2);
          sourceAmountCop = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(expected)
            ? Number(expected).toFixed(2) : null;
          differenceCop = sourceAmountCop === null ? null
            : (Number(amountCop) - Number(sourceAmountCop)).toFixed(2);
        } else {
          sourceAmountCop = Number(expected).toFixed(2);
          amountCop = sourceAmountCop;
          if (body.amountCop !== undefined && Number(body.amountCop).toFixed(2) !== amountCop) {
            throw new BadRequestException({
              code: 'MODERATOR_FEE_AMOUNT_MISMATCH',
              message: 'El importe informado no coincide con la cuota definida en la autorización.',
            });
          }
        }
      } else if (body.status === 'REFUNDED') {
        amountCop = Number(body.amountCop).toFixed(2);
      }

      const previous = events[0];
      const currentVersion = previous ? Number(previous.version) : 0;

      if (body.expectedVersion !== currentVersion) {
        throw new ConflictException({
          code: 'MODERATOR_FEE_VERSION_CONFLICT',
          message:
            'El recaudo fue actualizado por otro usuario. Consulta el estado vigente antes de guardar.',
        });
      }

      const version = currentVersion + 1;
      const recordedEffectiveAt = effectiveAt ?? new Date().toISOString();

      const inserted = await client.query<{ id: string }>(
        `
          insert into authorization_moderator_fee_events (
            authorization_item_id,
            version,
            status,
            amount_cop,
            collected_at,
            observation,
            reference,
            registered_by,
            organization_id,
            correlation_id,
            idempotency_key,
            movement_type,
            related_event_id,
            effective_at,
            reason,
            manual_amount,
            source_amount_cop,
            difference_cop
          )

          values (
            $1::uuid,
            $2,
            $3,
            $4::numeric,
            $5::timestamptz,
            $6,
            $7,
            $8::uuid,
            $9::uuid,
            $10::uuid,
            $11::uuid,
            $12,
            $13::uuid,
            $14::timestamptz,
            $15,
            $16,
            $17::numeric,
            $18::numeric
          )

          returning id
        `,
        [
          authorizationItemId,
          version,
          body.status,
          amountCop,
          collectedAt,
          observation,
          reference,
          scope.userId,
          scope.organizationId,
          scope.correlationId,
          body.idempotencyKey,
          body.status,
          relatedEventId,
          recordedEffectiveAt,
          reason,
          manualAmount,
          sourceAmountCop,
          differenceCop,
        ],
      );

      const eventId = inserted.rows[0]?.id;

      if (!eventId) {
        throw new Error('MODERATOR_FEE_EVENT_INSERT_FAILED');
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
            before,
            after,
            correlation_id,
            request_id,
            result
          )
          values (
            'USER',
            $1::uuid,
            $2::uuid,
            'AUTHORIZATION_MODERATOR_FEE_REGISTERED',
            'authorization_item',
            $3::uuid,
            $4::jsonb,
            $5::jsonb,
            $6::uuid,
            $6::uuid,
            'SUCCESS'
          )
        `,
        [
          scope.userId,
          scope.organizationId,
          authorizationItemId,

          JSON.stringify({
            version: currentVersion,
            status: previous?.status ?? 'NOT_RECORDED',
            amountCop: previous?.amount_cop ?? null,
          }),

          JSON.stringify({
            eventId,
            version,
            status: body.status,
            amountCop,
            collectedAt,
          effectiveAt: recordedEffectiveAt,
            relatedEventId,
            reason,
            manualAmount,
            sourceAmountCop,
            differenceCop,
          }),

          scope.correlationId,
        ],
      );

      await client.query(
        `insert into moderator_fee_sheet_sync (event_id, status) values ($1::uuid, $2)`,
        [eventId, 'PENDING'],
      );

      const updatedEvents = await this.history(client, authorizationItemId);

      await client.query('COMMIT');

      await this.retrySheetSync(authorizationItemId, eventId, scope).catch(cause => {
        this.logger.error('Falló la entrega de cuota moderadora a Sheets', cause);
      });

      return this.response(authorization, updatedEvents);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
