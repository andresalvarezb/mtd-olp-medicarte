import { authorizationQueryValidityWindow } from '../clinical/authorization-query-validity';

import {
  normalizeSourceDate,
  parsePositiveInteger,
  resolveMipresReadState,
  resolveOperationalWindow,
} from './mipres-read-model';

import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  mipresManualDecisionResponseSchema,
  type MipresManualDecisionRequest,
  type MipresManualDecisionResponse,
} from '@authorization/contracts';

import type { createDatabase } from '@authorization/database';

import type { Scope } from '../common/request-scope';

import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;

type DecisionState = 'PENDING_MANUAL_ENABLEMENT' | 'MANUALLY_ENABLED' | 'MANUALLY_DISABLED';

type DecisionItemRow = Readonly<{
  id: string;

  coverage_type: string;

  no_prescripcion: string;

  direction_status: string;

  enablement_status: string;

  tariff_membership_status: string;

  quantity: string | null;

  minimum_quantity: number;

  assignment_date: string | null;

  validity_end_date: string | null;

  mipres_manual_decision: DecisionState;

  mipres_manual_version: number;

  mipres_manual_concept_code: string | null;

  mipres_manual_note: string | null;
}>;

type ConceptRow = Readonly<{
  code: string;

  name: string;

  action: 'ENABLE' | 'DISABLE';

  requires_note: boolean;
}>;

function decisionForAction(action: MipresManualDecisionRequest['action']): DecisionState {
  switch (action) {
    case 'ENABLE':
      return 'MANUALLY_ENABLED';

    case 'DISABLE':
      return 'MANUALLY_DISABLED';

    case 'RESET':
      return 'PENDING_MANUAL_ENABLEMENT';
  }
}

function auditAction(action: MipresManualDecisionRequest['action']): string {
  switch (action) {
    case 'ENABLE':
      return 'MIPRES_MANUAL_ENABLED';

    case 'DISABLE':
      return 'MIPRES_MANUAL_DISABLED';

    case 'RESET':
      return 'MIPRES_MANUAL_RESET_TO_PENDING';
  }
}

function requestHash(
  itemId: string,

  request: MipresManualDecisionRequest,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        itemId,

        action: request.action,

        expectedVersion: request.expectedVersion,

        conceptCode: request.conceptCode ?? null,

        observation: request.observation ?? null,
      }),
    )
    .digest('hex');
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error('MIPRES_DECISION_INVALID_TIMESTAMP');
  }

  return date.toISOString();
}

@Injectable()
export class MipresDecisionService {
  constructor(
    @Inject(DATABASE)
    private readonly database: Database,
  ) {}

  async decide(
    input: Readonly<{
      itemId: string;

      body: MipresManualDecisionRequest;

      idempotencyKey: string;

      scope: Scope;
    }>,
  ): Promise<MipresManualDecisionResponse> {
    if (input.scope.organizationCode !== 'MTD') {
      throw new ForbiddenException({
        code: 'MIPRES_DECISION_MTD_ONLY',

        message: 'La decisión operacional MIPRES solo puede administrarse desde MTD.',
      });
    }

    const idempotencyScope = `mipres.decision:${input.scope.organizationId}:${input.itemId}`;

    const hash = requestHash(input.itemId, input.body);

    const client = await this.database.pool.connect();

    try {
      await client.query('begin');

      await client.query(
        `select
           pg_advisory_xact_lock(
             hashtext($1)
           )`,
        [`${idempotencyScope}:${input.idempotencyKey}`],
      );

      /*
       * Revalidación de autoridad dentro de la misma transacción.
       *
       * Conserva SYSTEM_ADMIN_ALLOW_ALL para MTD_ADMIN y también
       * soporta permisos explícitos en roles configurables.
       */
      const authority = await client.query<{
        allowed: boolean;
      }>(
        `select exists (
             select
               1

             from
               user_organization_roles uor

             inner join
               users u
                 on u.id =
                    uor.user_id

             inner join
               organizations o
                 on o.id =
                    uor.organization_id

             inner join
               roles r
                 on r.id =
                    uor.role_id

             where
               uor.user_id =
                 $1

               and

               uor.organization_id =
                 $2

               and

               uor.active =
                 true

               and

               u.active =
                 true

               and

               o.active =
                 true

               and

               o.code =
                 'MTD'

               and

               r.active =
                 true

               and

               (
                 (
                   r.code =
                     'MTD_ADMIN'

                   and

                   r.is_system_admin =
                     true
                 )

                 or

                 exists (
                   select
                     1

                   from
                     role_permissions rp

                   inner join
                     permissions p
                       on p.id =
                          rp.permission_id

                   where
                     rp.role_id =
                       r.id

                     and

                     p.code =
                       'mipres.decision.manage'
                 )
               )
           ) as allowed`,
        [input.scope.userId, input.scope.organizationId],
      );

      if (authority.rows[0]?.allowed !== true) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',

          message: 'Permission denied for organization',
        });
      }

      await client.query(
        `delete from
           idempotency_records

         where
           scope =
             $1

           and

           key =
             $2

           and

           expires_at <=
             now()`,
        [idempotencyScope, input.idempotencyKey],
      );

      const existing = await client.query<{
        request_hash: string;

        response: unknown;
      }>(
        `select
             request_hash,
             response

           from
             idempotency_records

           where
             scope =
               $1

             and

             key =
               $2`,
        [idempotencyScope, input.idempotencyKey],
      );

      const replay = existing.rows[0];

      if (replay) {
        if (replay.request_hash !== hash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_CONFLICT',

            message: 'Idempotency key reused with another MIPRES decision payload.',
          });
        }

        const response = mipresManualDecisionResponseSchema.parse(replay.response);

        await client.query('commit');

        return response;
      }

      const itemResult = await client.query<DecisionItemRow>(
        `select
             id,
             coverage_type,
             no_prescripcion,
             direction_status,
             enablement_status,
             tariff_membership_status,

             source_data ->> 'CANTIDAD'
               as quantity,

             source_data ->> 'FECHA_ASIGNACION'
               as assignment_date,

             source_data ->> 'FECHA_FINAL_VIGENCIA'
               as validity_end_date,

             coalesce(
               (
                 select
                   tap.minimum_quantity

                 from
                   tariff_annex_products tap

                 where
                   tap.codigo_producto =
                     authorization_items.codigo_medicamento

                   and tap.active = true

                 order by
                   tap.updated_at desc,
                   tap.id desc

                 limit 1
               ),
               1
             )::int
               as minimum_quantity,
             mipres_manual_decision,
             mipres_manual_version,
             mipres_manual_concept_code,
             mipres_manual_note

           from
             authorization_items

           where
             id =
               $1

           for update`,
        [input.itemId],
      );

      const item = itemResult.rows[0];

      if (!item) {
        throw new NotFoundException({
          code: 'MIPRES_AUTHORIZATION_NOT_FOUND',

          message: 'La autorización MIPRES no existe.',
        });
      }

      if (item.coverage_type !== 'NO_PBS' || item.no_prescripcion.trim() === '') {
        throw new ConflictException({
          code: 'MIPRES_DECISION_NOT_APPLICABLE',

          message:
            'La decisión manual MIPRES solo aplica a autorizaciones NO PBS con prescripción.',
        });
      }

      if (item.mipres_manual_version !== input.body.expectedVersion) {
        throw new ConflictException({
          code: 'MIPRES_DECISION_VERSION_CONFLICT',

          message: 'La decisión MIPRES cambió desde la última lectura.',

          currentVersion: item.mipres_manual_version,

          currentDecision: item.mipres_manual_decision,
        });
      }

      const targetDecision = decisionForAction(input.body.action);

      /*
       * MIPRES solo levanta su propio gate.
       * No puede convertir una AUTO naturalmente
       * Pendiente/Inhabilitada en Habilitada.
       */
      if (input.body.action === 'ENABLE') {
        const { today, horizon } = authorizationQueryValidityWindow();

        const naturalState = resolveMipresReadState({
          enablementStatus: item.enablement_status,

          tariffMembershipStatus: item.tariff_membership_status,

          coverageType: item.coverage_type,

          directionStatus: item.direction_status,

          /*
           * authorizationState es independiente
           * de manualDecision desde W6A.
           */
          manualDecision: item.mipres_manual_decision,

          quantity: parsePositiveInteger(item.quantity),

          minimumQuantity: Number(item.minimum_quantity),

          operationalWindow: resolveOperationalWindow({
            assignmentDate: normalizeSourceDate(item.assignment_date),

            validityEndDate: normalizeSourceDate(item.validity_end_date),

            today,
            horizon,
          }),
        });

        if (naturalState.authorizationState !== 'ENABLED') {
          throw new ConflictException({
            code: 'MIPRES_ENABLE_REQUIRES_ELIGIBLE_AUTHORIZATION',

            message: 'Solo una AUTO Habilitada puede desbloquear MIPRES.',

            authorizationState: naturalState.authorizationState,
          });
        }
      }

      if (item.mipres_manual_decision === targetDecision) {
        throw new ConflictException({
          code: 'MIPRES_DECISION_NO_CHANGE',

          message: 'La autorización ya se encuentra en la decisión solicitada.',
        });
      }

      const note = input.body.observation?.trim() ?? null;

      let concept: ConceptRow | null = null;

      if (input.body.action === 'RESET') {
        if (input.body.conceptCode !== undefined) {
          throw new BadRequestException({
            code: 'MIPRES_RESET_CONCEPT_NOT_ALLOWED',

            message: 'Restablecer a pendiente no admite concepto de habilitación o inhabilitación.',
          });
        }
      } else {
        if (!input.body.conceptCode) {
          throw new BadRequestException({
            code: 'MIPRES_DECISION_CONCEPT_REQUIRED',

            message: 'Debe seleccionar un concepto para la decisión MIPRES.',
          });
        }

        const conceptResult = await client.query<ConceptRow>(
          `select
               code,
               name,
               action,
               requires_note

             from
               mipres_manual_decision_concepts

             where
               code =
                 $1

               and

               active =
                 true`,
          [input.body.conceptCode],
        );

        concept = conceptResult.rows[0] ?? null;

        if (!concept || concept.action !== input.body.action) {
          throw new BadRequestException({
            code: 'MIPRES_DECISION_CONCEPT_INVALID',

            message: 'El concepto no corresponde a la acción MIPRES solicitada.',
          });
        }

        if (concept.requires_note && !note) {
          throw new BadRequestException({
            code: 'MIPRES_DECISION_NOTE_REQUIRED',

            message: 'El concepto seleccionado requiere observación.',
          });
        }
      }

      const actor = await client.query<{
        display_name: string;
      }>(
        `select
             display_name

           from
             users

           where
             id =
               $1`,
        [input.scope.userId],
      );

      const actorName = actor.rows[0]?.display_name;

      if (!actorName) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',

          message: 'Active decision actor was not found.',
        });
      }

      const newVersion = item.mipres_manual_version + 1;

      const updated = await client.query<{
        mipres_manual_updated_at: Date | string;

        mipres_manual_version: number;
      }>(
        `update
             authorization_items

           set
             mipres_manual_decision =
               $2,

             mipres_manual_version =
               $3,

             mipres_manual_concept_code =
               $4,

             mipres_manual_note =
               $5,

             mipres_manual_updated_at =
               now(),

             mipres_manual_updated_by =
               $6

           where
             id =
               $1

           returning
             mipres_manual_updated_at,
             mipres_manual_version`,
        [input.itemId, targetDecision, newVersion, concept?.code ?? null, note, input.scope.userId],
      );

      const updatedRow = updated.rows[0];

      if (!updatedRow) {
        throw new Error('MIPRES_DECISION_UPDATE_FAILED');
      }

      await client.query(
        `insert into
           authorization_mipres_decision_history
           (
             authorization_item_id,
             previous_decision,
             decision,
             decision_version,
             concept_code,
             note,
             actor_id,
             organization_id,
             correlation_id
           )

         values
           (
             $1,
             $2,
             $3,
             $4,
             $5,
             $6,
             $7,
             $8,
             $9
           )`,
        [
          input.itemId,
          item.mipres_manual_decision,
          targetDecision,
          newVersion,
          concept?.code ?? null,
          note,
          input.scope.userId,
          input.scope.organizationId,
          input.scope.correlationId,
        ],
      );

      const before = {
        decision: item.mipres_manual_decision,

        version: item.mipres_manual_version,

        conceptCode: item.mipres_manual_concept_code,

        note: item.mipres_manual_note,
      };

      const after = {
        decision: targetDecision,

        version: newVersion,

        conceptCode: concept?.code ?? null,

        note,
      };

      await client.query(
        `insert into
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
             $1,
             $2,
             $3,
             'authorization_mipres_decision',
             $4,
             $5::jsonb,
             $6::jsonb,
             $7::uuid,
             $8::text,
             'SUCCESS'
           )`,
        [
          input.scope.userId,
          input.scope.organizationId,
          auditAction(input.body.action),
          input.itemId,
          JSON.stringify(before),
          JSON.stringify(after),
          input.scope.correlationId,
          input.scope.correlationId,
        ],
      );

      /*
       * Solo invalida proyecciones locales.
       *
       * No genera reconsulta MIPRES y no modifica
       * direction_status / mipres_checks / mipres_directions.
       */
      await client.query(
        `insert into
           outbox_events
           (
             event_type,
             version,
             payload,
             correlation_id,
             organization_id,
             idempotency_key
           )

         values
           (
             'realtime.invalidate',
             1,
             $1::jsonb,
             $2,
             $3,
             $4
           )

         on conflict (
           idempotency_key
         )
         do nothing`,
        [
          JSON.stringify({
            topics: ['AUTHORIZATIONS', 'NOVELTIES', 'DASHBOARD'],

            resource: {
              type: 'authorization_item',

              id: input.itemId,

              version: newVersion,
            },
          }),
          input.scope.correlationId,
          input.scope.organizationId,
          `realtime:mipres-decision:${input.itemId}:${newVersion}`,
        ],
      );

      const response: MipresManualDecisionResponse = {
        itemId: input.itemId,

        decision: targetDecision,

        version: updatedRow.mipres_manual_version,

        conceptCode: concept?.code ?? null,

        conceptName: concept?.name ?? null,

        note,

        updatedAt: toIso(updatedRow.mipres_manual_updated_at),

        updatedBy: {
          id: input.scope.userId,

          displayName: actorName,
        },
      };

      const validatedResponse = mipresManualDecisionResponseSchema.parse(response);

      await client.query(
        `insert into
           idempotency_records
           (
             scope,
             key,
             request_hash,
             status_code,
             response,
             expires_at
           )

         values
           (
             $1,
             $2,
             $3,
             200,
             $4::jsonb,
             now()
             +
             interval '24 hours'
           )`,
        [idempotencyScope, input.idempotencyKey, hash, JSON.stringify(validatedResponse)],
      );

      await client.query('commit');

      return validatedResponse;
    } catch (error) {
      await client.query('rollback');

      throw error;
    } finally {
      client.release();
    }
  }
}
