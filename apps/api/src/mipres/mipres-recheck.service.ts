import { createHash } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

import type { ApiConfig } from '@authorization/config';

import type { createDatabase } from '@authorization/database';

import {
  currentBogotaDate,
  evaluateMipresVigencia,
  MIPRES_VIGENCIA_RULE_VERSION,
  type MipresDirection,
} from '@authorization/domain';

import type { Scope } from '../common/request-scope';

import { API_CONFIG, DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;

type ItemRow = Readonly<{
  id: string;

  no_prescripcion: string;

  coverage_type: string;

  enablement_status: string;

  direction_status: string;

  mipres_manual_decision: string;

  mipres_manual_version: number;

  mipres_manual_concept_code: string | null;

  mipres_manual_note: string | null;

  version: number;
}>;

type QueryResult = Readonly<{
  outcome: 'PENDING' | 'CONFIRMED' | 'QUERY_ERROR';

  httpStatus: number | null;

  directions: MipresDirection[];

  rawPayload: unknown;
}>;

export type MipresRecheckResponse = Readonly<{
  itemId: string;

  previousDirectionStatus: string;

  directionStatus: 'PENDING' | 'CONFIRMED' | 'QUERY_ERROR';

  checkId: string;

  queryType: 'MANUAL';

  manualDecision: string;

  manualVersion: number;

  changedEvidence: boolean;
}>;

class MipresHttpError extends Error {
  constructor(
    readonly httpStatus: number | null,

    message: string,
  ) {
    super(message);

    this.name = 'MipresHttpError';
  }
}

function valueText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    return trimmed ? trimmed : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${value}`;
  }

  return null;
}

function validDate(
  year: string,

  month: string,

  day: string,
): boolean {
  const date = new Date(
    Date.UTC(
      Number(year),

      Number(month) - 1,

      Number(day),
    ),
  );

  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

function normalizeDate(value: unknown): string | null {
  const raw = valueText(value);

  if (!raw) {
    return null;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);

  if (iso?.[1] && iso[2] && iso[3] && validDate(iso[1], iso[2], iso[3])) {
    return raw;
  }

  const local = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);

  if (local?.[1] && local[2] && local[3] && validDate(local[3], local[2], local[1])) {
    return `${local[3]}-${local[2]}-${local[1]}`;
  }

  return null;
}

function normalizeDirections(
  prescription: string,

  payload: unknown,
): MipresDirection[] | null {
  if (payload === null || payload === undefined) {
    return [];
  }

  if (!Array.isArray(payload)) {
    return null;
  }

  const result: MipresDirection[] = [];

  for (const entry of payload) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return null;
    }

    const row = entry as Record<string, unknown>;

    const externalId = valueText(row.ID);

    const directionId = valueText(row.IDDireccionamiento);

    const responsePrescription = valueText(row.NoPrescripcion);

    const technologyType = valueText(row.TipoTec);

    const technologyConsecutive = valueText(row.ConTec);

    const maximumDeliveryDate = normalizeDate(row.FecMaxEnt);

    const externalStatus = valueText(row.EstDireccionamiento);

    if (
      !externalId ||
      !directionId ||
      !responsePrescription ||
      !technologyType ||
      !technologyConsecutive ||
      !maximumDeliveryDate ||
      !externalStatus
    ) {
      return null;
    }

    /*
     * La prescripción de la respuesta se conserva
     * como evidencia externa. No modifica la
     * prescripción interna del ítem.
     */
    result.push({
      externalId,

      directionId,

      prescriptionNumber: responsePrescription || prescription,

      technologyType,

      technologyConsecutive,

      maximumDeliveryDate,

      externalStatus,

      annulled: valueText(row.FecAnulacion) !== null || externalStatus.toUpperCase() === 'ANULADO',
    });
  }

  return result;
}

function redactPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactPayload);
  }

  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;

    const target: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(source)) {
      target[key] = /token/i.test(key) ? '[REDACTED]' : redactPayload(entry);
    }

    return target;
  }

  return value;
}

@Injectable()
export class MipresRecheckService {
  constructor(
    @Inject(DATABASE)
    private readonly database: Database,

    @Inject(API_CONFIG)
    private readonly config: ApiConfig,
  ) {}

  async recheck(
    input: Readonly<{
      itemId: string;

      idempotencyKey: string;

      scope: Scope;
    }>,
  ): Promise<MipresRecheckResponse> {
    const idempotencyScope = `mipres.recheck:${input.scope.organizationId}:${input.itemId}`;

    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          itemId: input.itemId,

          organizationId: input.scope.organizationId,
        }),
      )
      .digest('hex');

    const client = await this.database.pool.connect();

    try {
      await client.query('begin');

      await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [
        `${idempotencyScope}:${input.idempotencyKey}`,
      ]);

      await client.query(
        `
          delete from
            idempotency_records

          where
            scope = $1

            and key = $2

            and expires_at <=
              now()
        `,
        [idempotencyScope, input.idempotencyKey],
      );

      const previous = await client.query<{
        request_hash: string;

        response: MipresRecheckResponse;
      }>(
        `
            select
              request_hash,
              response

            from
              idempotency_records

            where
              scope = $1

              and key = $2
          `,
        [idempotencyScope, input.idempotencyKey],
      );

      const previousRow = previous.rows[0];

      if (previousRow) {
        if (previousRow.request_hash !== requestHash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_CONFLICT',

            message: 'Idempotency key reused with another MIPRES recheck request',
          });
        }

        await client.query('commit');

        return previousRow.response;
      }

      const itemResult = await client.query<ItemRow>(
        `
            select
              id,
              no_prescripcion,
              coverage_type,
              enablement_status,
              direction_status,
              mipres_manual_decision,
              mipres_manual_version,
              mipres_manual_concept_code,
              mipres_manual_note,
              version

            from
              authorization_items

            where
              id = $1

            for update
          `,
        [input.itemId],
      );

      const item = itemResult.rows[0];

      if (!item) {
        throw new NotFoundException({
          code: 'MIPRES_ITEM_NOT_FOUND',

          message: 'MIPRES authorization item not found',
        });
      }

      if (item.coverage_type !== 'NO_PBS') {
        throw new ConflictException({
          code: 'MIPRES_RECHECK_NOT_APPLICABLE',

          message: 'MIPRES recheck is only applicable to NO_PBS authorizations',
        });
      }

      if (!item.no_prescripcion || !item.no_prescripcion.trim()) {
        throw new ConflictException({
          code: 'MIPRES_RECHECK_NOT_APPLICABLE',

          message: 'The authorization has no MIPRES prescription number',
        });
      }

      const today = currentBogotaDate();

      const checksToday = await client.query<{
        count: string;
      }>(
        `
            select
              count(*)::text
                as count

            from
              mipres_checks

            where
              authorization_item_id =
                $1

              and query_type =
                'MANUAL'

              and check_date =
                $2
          `,
        [input.itemId, today],
      );

      const count = Number.parseInt(checksToday.rows[0]?.count ?? '0', 10);

      if (count >= this.config.MIPRES_MANUAL_RECHECK_DAILY_LIMIT) {
        throw new HttpException(
          {
            code: 'MIPRES_RECHECK_RATE_LIMITED',

            message: 'Manual MIPRES recheck daily limit reached',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      /*
       * Snapshot explícito de la dimensión MTD.
       *
       * Se usa únicamente como evidencia para auditoría
       * y para demostrar que la reconsulta no la modifica.
       */
      const manualSnapshot = {
        decision: item.mipres_manual_decision,

        version: Number(item.mipres_manual_version),

        conceptCode: item.mipres_manual_concept_code,

        note: item.mipres_manual_note,
      };

      const external = await this.queryMipres(item.no_prescripcion, today);

      const inserted = await client.query<{
        id: string;
      }>(
        `
            insert into
              mipres_checks (
                authorization_item_id,
                prescription_number,
                query_type,
                outcome,
                http_status,
                direction_count,
                has_current_direction,
                rule_version,
                check_date,
                response_payload,
                correlation_id,
                idempotency_key
              )

            values (
              $1,
              $2,
              'MANUAL',
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9::jsonb,
              $10,
              $11
            )

            returning
              id
          `,
        [
          input.itemId,

          item.no_prescripcion,

          external.outcome,

          external.httpStatus,

          external.directions.length,

          external.outcome === 'QUERY_ERROR' ? null : external.outcome === 'CONFIRMED',

          MIPRES_VIGENCIA_RULE_VERSION,

          today,

          JSON.stringify(external.rawPayload),

          input.scope.correlationId,

          input.idempotencyKey,
        ],
      );

      const checkId = inserted.rows[0]?.id;

      if (!checkId) {
        throw new Error('MIPRES_CHECK_NOT_CREATED');
      }

      for (const direction of external.directions) {
        await client.query(
          `
            insert into
              mipres_directions (
                mipres_check_id,
                authorization_item_id,
                external_id,
                direction_id,
                prescription_number,
                technology_type,
                technology_consecutive,
                maximum_delivery_date,
                external_status,
                annulled,
                current
              )

            values (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              $10,
              $11
            )
          `,
          [
            checkId,

            input.itemId,

            direction.externalId,

            direction.directionId,

            direction.prescriptionNumber,

            direction.technologyType,

            direction.technologyConsecutive,

            direction.maximumDeliveryDate,

            direction.externalStatus,

            direction.annulled,

            !direction.annulled && today < direction.maximumDeliveryDate,
          ],
        );
      }

      /*
       * ÚNICA escritura permitida sobre authorization_items:
       * evidencia externa.
       *
       * No se modifica:
       * - mipres_manual_decision
       * - mipres_manual_version
       * - mipres_manual_concept_code
       * - mipres_manual_note
       * - version
       */
      await client.query(
        `
          update
            authorization_items

          set
            direction_status =
              $2,

            updated_at =
              now()

          where
            id = $1
        `,
        [input.itemId, external.outcome],
      );

      const after = await client.query<ItemRow>(
        `
            select
              id,
              no_prescripcion,
              coverage_type,
              enablement_status,
              direction_status,
              mipres_manual_decision,
              mipres_manual_version,
              mipres_manual_concept_code,
              mipres_manual_note,
              version

            from
              authorization_items

            where
              id = $1
          `,
        [input.itemId],
      );

      const afterItem = after.rows[0];

      if (!afterItem) {
        throw new Error('MIPRES_ITEM_DISAPPEARED');
      }

      if (
        afterItem.mipres_manual_decision !== manualSnapshot.decision ||
        Number(afterItem.mipres_manual_version) !== manualSnapshot.version ||
        afterItem.mipres_manual_concept_code !== manualSnapshot.conceptCode ||
        afterItem.mipres_manual_note !== manualSnapshot.note ||
        Number(afterItem.version) !== Number(item.version)
      ) {
        throw new Error('MIPRES_RECHECK_MUTATED_INTERNAL_OPERATIONAL_STATE');
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
              before,
              after,
              correlation_id,
              request_id,
              result
            )

          values (
            'USER',
            $1,
            $2,
            'MIPRES_RECHECK_COMPLETED',
            'authorization_item',
            $3,
            $4::jsonb,
            $5::jsonb,
            $6,
            $7,
            'SUCCESS'
          )
        `,
        [
          input.scope.userId,

          input.scope.organizationId,

          input.itemId,

          JSON.stringify({
            directionStatus: item.direction_status,

            manualDecision: manualSnapshot.decision,

            manualVersion: manualSnapshot.version,
          }),

          JSON.stringify({
            directionStatus: external.outcome,

            manualDecision: afterItem.mipres_manual_decision,

            manualVersion: Number(afterItem.mipres_manual_version),

            checkId,
          }),

          input.scope.correlationId,

          input.scope.correlationId,
        ],
      );

      const response: MipresRecheckResponse = {
        itemId: input.itemId,

        previousDirectionStatus: item.direction_status,

        directionStatus: external.outcome,

        checkId,

        queryType: 'MANUAL',

        manualDecision: afterItem.mipres_manual_decision,

        manualVersion: Number(afterItem.mipres_manual_version),

        changedEvidence: item.direction_status !== external.outcome,
      };

      await client.query(
        `
          insert into
            idempotency_records (
              scope,
              key,
              request_hash,
              status_code,
              response,
              expires_at
            )

          values (
            $1,
            $2,
            $3,
            200,
            $4::jsonb,
            now()
            +
            interval '24 hours'
          )
        `,
        [idempotencyScope, input.idempotencyKey, requestHash, JSON.stringify(response)],
      );

      await client.query('commit');

      return response;
    } catch (error) {
      await client.query('rollback');

      throw error;
    } finally {
      client.release();
    }
  }

  private async queryMipres(
    prescription: string,

    today: string,
  ): Promise<QueryResult> {
    try {
      const token = await this.fetchToken();

      const url =
        `${this.config.MIPRES_BASE_URL}` +
        `/api/DireccionamientoXPrescripcion/` +
        `${encodeURIComponent(this.config.MIPRES_NIT ?? '')}/` +
        `${encodeURIComponent(token)}/` +
        `${encodeURIComponent(prescription)}`;

      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.config.MIPRES_TIMEOUT_MS),
      });

      if (!response.ok) {
        return {
          outcome: 'QUERY_ERROR',

          httpStatus: response.status,

          directions: [],

          rawPayload: null,
        };
      }

      let payload: unknown;

      try {
        payload = await response.json();
      } catch {
        return {
          outcome: 'QUERY_ERROR',

          httpStatus: response.status,

          directions: [],

          rawPayload: null,
        };
      }

      const directions = normalizeDirections(prescription, payload);

      if (directions === null) {
        return {
          outcome: 'QUERY_ERROR',

          httpStatus: response.status,

          directions: [],

          rawPayload: redactPayload(payload),
        };
      }

      const evaluation = evaluateMipresVigencia(directions, today);

      return {
        outcome: evaluation.outcome,

        httpStatus: response.status,

        directions,

        rawPayload: redactPayload(payload),
      };
    } catch (error) {
      if (error instanceof MipresHttpError) {
        return {
          outcome: 'QUERY_ERROR',

          httpStatus: error.httpStatus,

          directions: [],

          rawPayload: null,
        };
      }

      return {
        outcome: 'QUERY_ERROR',

        httpStatus: null,

        directions: [],

        rawPayload: null,
      };
    }
  }

  private async fetchToken(): Promise<string> {
    const baseUrl = this.config.MIPRES_BASE_URL;

    const nit = this.config.MIPRES_NIT;

    const initialToken = this.config.MIPRES_INITIAL_TOKEN;

    if (!baseUrl || !nit || !initialToken) {
      throw new MipresHttpError(
        null,

        'MIPRES integration is not configured',
      );
    }

    const url =
      `${baseUrl}` +
      `/api/GenerarToken/` +
      `${encodeURIComponent(nit)}/` +
      `${encodeURIComponent(initialToken)}`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.config.MIPRES_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new MipresHttpError(
        response.status,

        'MIPRES token generation failed',
      );
    }

    const body = (await response.text()).trim();

    if (!body) {
      throw new MipresHttpError(
        response.status,

        'MIPRES returned an empty token',
      );
    }

    try {
      const parsed: unknown = JSON.parse(body);

      if (typeof parsed === 'string' && parsed.trim()) {
        return parsed.trim();
      }
    } catch {
      // El mock y MIPRES pueden responder token como texto plano.
    }

    return body;
  }
}
