import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import {
  createDatabase,
} from '@authorization/database';

import type {
  Scope,
} from '../../apps/api/src/common/request-scope';

import type {
  AuthorizationBillingAuditDriveService,
} from '../../apps/api/src/audits/authorization-billing-audit-drive.service';

import {
  AuthorizationBillingAuditRepository,
} from '../../apps/api/src/audits/authorization-billing-audit.repository';

import {
  AuthorizationBillingAuditService,
} from '../../apps/api/src/audits/authorization-billing-audit.service';

import {
  ORGANIZATION_IDS,
  adminLogin,
} from './helpers/auth';


const databaseUrl =
  process.env.DATABASE_URL
  ??
  'postgresql://authorization:authorization@localhost:25432/authorization_test_integration';

const apiUrl =
  process.env.API_URL
  ??
  `http://localhost:${process.env.API_HOST_PORT ?? '3003'}`;

const database =
  new Client({
    connectionString:
      databaseUrl,
  });

const applicationDatabase =
  createDatabase(
    databaseUrl,
  );

const suffix =
  randomUUID()
    .slice(
      0,
      8,
    );

const authorizationNumber =
  `BILL-AUD-${suffix}`;

const commercialCode =
  `BA-${suffix}`;

let adminToken =
  '';

let foundationUserId =
  '';

let batchId =
  '';

let authorizationItemId =
  '';

let billingAuditId =
  '';


type BillingAuditResponse =
  Readonly<{
    id:
      string;

    authorizationItemId:
      string;

    authorizationNumber:
      string;

    status:
      'PENDING'
      | 'REVIEWED';

    result:
      'COMPLIES'
      | 'DOES_NOT_COMPLY'
      | null;

    observation:
      string
      | null;

    auditedBy:
      string
      | null;

    auditedAt:
      string
      | null;

    evidence:
      readonly Readonly<{
        driveFileId:
          string;

        fileName:
          string;
      }>[];
  }>;


async function api(
  method:
    string,

  path:
    string,

  body?:
    unknown,
) {
  return fetch(
    `${apiUrl}/api/v1${path}`,
    {
      method,

      headers: {
        authorization:
          `Bearer ${adminToken}`,

        'content-type':
          'application/json',

        'x-organization-id':
          ORGANIZATION_IDS.MTD,
      },

      ...(
        body ===
          undefined
          ? {}
          : {
              body:
                JSON.stringify(
                  body,
                ),
            }
      ),
    },
  );
}


async function json<T>(
  response:
    Response,
): Promise<T> {
  return await response.json() as T;
}


beforeAll(
  async () => {
    await database.connect();

    adminToken =
      await adminLogin();

    foundationUserId =
      (
        await database.query<{
          id:
            string;
        }>(
          `
            select id
            from users
            where username =
              'foundation-admin'
            limit 1
          `,
        )
      ).rows[0]!.id;


    batchId =
      (
        await database.query<{
          id:
            string;
        }>(
          `
            insert into import_batches (
              organization_id,
              created_by,
              original_filename,
              mime_type,
              size_bytes,
              sha256,
              processor_version,
              status,
              total_rows,
              confirmed_rows,
              completed_at,
              confirmed_at
            )
            values (
              $1,
              $2,
              $3,
              'application/json',
              1,
              $4,
              1,
              'COMPLETED',
              1,
              1,
              now(),
              now()
            )
            returning id
          `,
          [
            ORGANIZATION_IDS.MTD,
            foundationUserId,
            `billing-audit-${suffix}.json`,
            suffix
              .padEnd(
                64,
                'a',
              )
              .slice(
                0,
                64,
              ),
          ],
        )
      ).rows[0]!.id;


    authorizationItemId =
      (
        await database.query<{
          id:
            string;
        }>(
          `
            insert into authorization_items (
              numero_autorizacion,
              codigo_medicamento,
              authorization_key,
              source_data,
              source_status_normalized,
              source_prescripcion_normalized,
              no_prescripcion,
              enablement_status,
              coverage_type,
              direction_status,
              coverage_rule_version,
              created_from_batch_id
            )
            values (
              $1,
              $2,
              $3,
              $4::jsonb,
              'VIGENTE',
              '',
              '',
              'ENABLED',
              'PBS',
              'NOT_APPLICABLE',
              'BILLING_AUDIT_INTEGRATION',
              $5
            )
            returning id
          `,
          [
            authorizationNumber,
            commercialCode,
            `${authorizationNumber}:${commercialCode}`,
            JSON.stringify({
              IDENTIFICACION_PACIENTE:
                `DOC-${suffix}`,

              NOMBRE_PACIENTE:
                'Paciente auditoría facturación',

              TIPO_DOCUMENTO:
                'CC',

              CANTIDAD:
                '10',
            }),
            batchId,
          ],
        )
      ).rows[0]!.id;


    await database.query(
      `
        insert into authorization_item_organizations (
          authorization_item_id,
          organization_id
        )
        values (
          $1,
          $2
        )
      `,
      [
        authorizationItemId,
        ORGANIZATION_IDS.MTD,
      ],
    );
  },
);


afterAll(
  async () => {
    /*
     * REVIEWED es inmutable por diseño.
     * Para limpiar exclusivamente el fixture
     * de la DB dedicada de integración se
     * desactiva temporalmente el trigger.
     */
    await database.query(
      `
        alter table
          authorization_billing_audits
        disable trigger
          authorization_billing_audits_terminal_immutable
      `,
    );

    try {
      if (
        billingAuditId
      ) {
        await database.query(
          `
            delete from
              authorization_billing_audit_evidence
            where billing_audit_id =
              $1
          `,
          [
            billingAuditId,
          ],
        );


      }


      if (
        authorizationItemId
      ) {
        await database.query(
          `
            delete from
              authorization_billing_audits
            where authorization_item_id =
              $1
          `,
          [
            authorizationItemId,
          ],
        );


        await database.query(
          `
            delete from
              authorization_fulfillments
            where authorization_item_id =
              $1
          `,
          [
            authorizationItemId,
          ],
        );

        await database.query(
          `
            delete from
              authorization_item_organizations
            where authorization_item_id =
              $1
          `,
          [
            authorizationItemId,
          ],
        );


        await database.query(
          `
            delete from
              authorization_items
            where id =
              $1
          `,
          [
            authorizationItemId,
          ],
        );
      }


      if (
        batchId
      ) {
        await database.query(
          `
            delete from
              import_batches
            where id =
              $1
          `,
          [
            batchId,
          ],
        );
      }
    } finally {
      await database.query(
        `
          alter table
            authorization_billing_audits
          enable trigger
            authorization_billing_audits_terminal_immutable
        `,
      );

      await applicationDatabase.pool.end();

      await database.end();
    }
  },
);


describe(
  'Auditoría de facturación — flujo integrado',
  () => {
    it(
      'inicia, registra evidencia, decide, audita y bloquea mutaciones terminales',
      async () => {
        /*
         * 1. SIN ATENCION REGISTRADA: BLOQUEO 409.
         * Una reserva o el mero registro de la AUTO no
         * habilitan la auditoria de facturacion.
         */
        const ineligibleStart =
          await api(
            'POST',
            `/authorization-billing-audits/authorization/${authorizationItemId}/start`,
          );

        expect(ineligibleStart.status).toBe(409);
        expect(await json<{ code: string }>(ineligibleStart)).toMatchObject({
          code: 'AUTHORIZATION_BILLING_AUDIT_NOT_ELIGIBLE',
        });

        /*
         * 2. CUMPLIMIENTO PARCIAL: 4 DE 10 UNIDADES.
         * La evidencia se crea solo en la base aislada
         * de integracion; no requiere reserva completa.
         */
        await database.query(
          `
            insert into authorization_fulfillments (
              organization_id,
              authorization_item_id,
              fulfillment_type,
              effective_date,
              quantity,
              source,
              confirmed_by
            ) values ($1, $2, 'APPLICATION', '2026-10-09', 4, 'UI', $3)
          `,
          [ORGANIZATION_IDS.MTD, authorizationItemId, foundationUserId],
        );

        /*
         * 3. INICIAR: PARTIAL debe admitir auditoria.
         */
        const startResponse =
          await api(
            'POST',

            `/authorization-billing-audits/authorization/${authorizationItemId}/start`,
          );

        expect(
          startResponse.status,
        ).toBe(
          201,
        );

        const started =
          await json<BillingAuditResponse>(
            startResponse,
          );

        billingAuditId =
          started.id;

        expect(
          started,
        ).toMatchObject({
          authorizationItemId,

          authorizationNumber,

          status:
            'PENDING',

          result:
            null,

          observation:
            null,
        });

        expect(
          started.evidence,
        ).toHaveLength(
          0,
        );


        /*
         * 2. CONSULTAR
         */
        const detailResponse =
          await api(
            'GET',

            `/authorization-billing-audits/authorization/${authorizationItemId}`,
          );

        expect(
          detailResponse.status,
        ).toBe(
          200,
        );

        const pending =
          await json<BillingAuditResponse>(
            detailResponse,
          );

        expect(
          pending.status,
        ).toBe(
          'PENDING',
        );


        /*
         * 3. SIN EVIDENCIA NO SE PUEDE
         * DECIDIR SIN OBSERVACIÓN.
         */
        const noEvidenceDecision =
          await api(
            'POST',

            `/authorization-billing-audits/${billingAuditId}/decision`,

            {
              result:
                'COMPLIES',
            },
          );

        expect(
          noEvidenceDecision.status,
        ).toBe(
          400,
        );

        expect(
          await json<{
            code:
              string;
          }>(
            noEvidenceDecision,
          ),
        ).toMatchObject({
          code:
            'AUTHORIZATION_BILLING_AUDIT_OBSERVATION_REQUIRED_WITHOUT_EVIDENCE',
        });


        /*
         * 4. SIMULAR BOUNDARY GOOGLE DRIVE.
         *
         * La API real de Google no forma parte de
         * esta prueba determinista. Se integra el
         * service + repository + PostgreSQL usando
         * una respuesta Drive controlada.
         */
        let searchedAuthorization =
          '';

        const drive = {
          findEvidence:
            async (
              value:
                string,
            ) => {
              await Promise.resolve();
              searchedAuthorization =
                value;

              return [
                {
                  driveFileId:
                    `drive-${suffix}`,

                  fileName:
                    `${authorizationNumber}.pdf`,

                  mimeType:
                    'application/pdf',

                  webViewLink:
                    `https://drive.google.com/file/d/drive-${suffix}/view`,

                  sizeBytes:
                    2048,

                  md5Checksum:
                    null,

                  driveModifiedAt:
                    '2026-10-07T12:00:00.000Z',
                },
              ];
            },
        };


        const repository =
          new AuthorizationBillingAuditRepository(
            applicationDatabase,
          );

        const service =
          new AuthorizationBillingAuditService(
            repository,

            drive as unknown as
              AuthorizationBillingAuditDriveService,
          );


        const scope:
          Scope =
          {
            organizationId:
              ORGANIZATION_IDS.MTD,

            organizationCode:
              'MTD',

            userId:
              foundationUserId,

            correlationId:
              randomUUID(),

            readSensitive:
              true,

            isFoundationAdmin:
              true,

            canCrossOrganizationOperationalExport:
              true,

            pointAccessKind:
              'global',
          };


        const withEvidence =
          await service.searchDriveEvidence(
            billingAuditId,
            scope,
          );

        expect(
          searchedAuthorization,
        ).toBe(
          authorizationNumber,
        );

        expect(
          withEvidence.evidence,
        ).toHaveLength(
          1,
        );

        expect(
          withEvidence.evidence[0],
        ).toMatchObject({
          driveFileId:
            `drive-${suffix}`,

          fileName:
            `${authorizationNumber}.pdf`,
        });


        const evidenceCount =
          await database.query<{
            count:
              number;
          }>(
            `
              select
                count(*)::int
                  as count
              from
                authorization_billing_audit_evidence
              where billing_audit_id =
                $1
            `,
            [
              billingAuditId,
            ],
          );

        expect(
          evidenceCount.rows[0]?.count,
        ).toBe(
          1,
        );


        /*
         * 5. NO CUMPLE SIEMPRE EXIGE
         * OBSERVACIÓN.
         */
        const missingObservation =
          await api(
            'POST',

            `/authorization-billing-audits/${billingAuditId}/decision`,

            {
              result:
                'DOES_NOT_COMPLY',
            },
          );

        expect(
          missingObservation.status,
        ).toBe(
          400,
        );

        expect(
          await json<{
            code:
              string;
          }>(
            missingObservation,
          ),
        ).toMatchObject({
          code:
            'VALIDATION_ERROR',
        });


        /*
         * 6. DECISIÓN TERMINAL
         */
        const decisionResponse =
          await api(
            'POST',

            `/authorization-billing-audits/${billingAuditId}/decision`,

            {
              result:
                'DOES_NOT_COMPLY',

              observation:
                'Soporte revisado; se registra inconsistencia para prueba integrada.',
            },
          );

        expect(
          decisionResponse.status,
        ).toBe(
          201,
        );

        const reviewed =
          await json<BillingAuditResponse>(
            decisionResponse,
          );

        expect(
          reviewed,
        ).toMatchObject({
          status:
            'REVIEWED',

          result:
            'DOES_NOT_COMPLY',

          auditedBy:
            foundationUserId,
        });

        expect(
          reviewed.auditedAt,
        ).not.toBeNull();

        expect(
          reviewed.evidence,
        ).toHaveLength(
          1,
        );


        /*
         * 7. TRAZABILIDAD
         */
        const events =
          await database.query<{
            action:
              string;
          }>(
            `
              select
                action
              from
                audit_events
              where resource_type =
                  'authorization_billing_audit'
                and resource_id =
                  $1
              order by
                occurred_at,
                id
            `,
            [
              billingAuditId,
            ],
          );

        expect(
          events.rows.map(
            (
              row,
            ) =>
              row.action,
          ),
        ).toEqual([
          'AUTHORIZATION_BILLING_AUDIT_STARTED',
          'AUTHORIZATION_BILLING_AUDIT_REVIEWED',
        ]);


        /*
         * 8. SEGUNDA DECISIÓN BLOQUEADA
         */
        const secondDecision =
          await api(
            'POST',

            `/authorization-billing-audits/${billingAuditId}/decision`,

            {
              result:
                'COMPLIES',
            },
          );

        expect(
          secondDecision.status,
        ).toBe(
          409,
        );

        expect(
          await json<{
            code:
              string;
          }>(
            secondDecision,
          ),
        ).toMatchObject({
          code:
            'AUTHORIZATION_BILLING_AUDIT_ALREADY_REVIEWED',
        });


        /*
         * 9. INMUTABILIDAD TAMBIÉN A NIVEL DB
         */
        let databaseMutationErrorCode =
          '';

        try {
          await database.query(
            `
              update
                authorization_billing_audits
              set observation =
                'MUTATION_NOT_ALLOWED'
              where id =
                $1
            `,
            [
              billingAuditId,
            ],
          );
        } catch (
          error
        ) {
          databaseMutationErrorCode =
            (
              error as {
                code?:
                  string;
              }
            ).code
            ??
            '';
        }

        expect(
          databaseMutationErrorCode,
        ).toBe(
          'P0001',
        );
      },
    );
  },
);
