import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import 'reflect-metadata';
import type { Server } from 'node:http';
import { ForbiddenException, Module, NotFoundException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  patientMasterSearchResponseSchema,
  patientReconciliationCasesResponseSchema,
} from '@authorization/contracts';
import { createDatabase } from '@authorization/database';
import supertest from 'supertest';
import { AuthGuard } from '../common/auth.guard';
import { AccessService } from '../identity/access.service';
import { signAccessToken } from '../identity/jwt';
import { PatientMasterController } from './patient-master.controller';
import { PatientMasterRepository } from './patient-master.repository';
import { PatientMasterService } from './patient-master.service';
import { API_CONFIG, DATABASE } from '../tokens';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://mtd_test@127.0.0.1:55439/mtd_olp_medicarte_test';
const parsedDatabaseUrl = new URL(databaseUrl);
if (
  parsedDatabaseUrl.hostname !== '127.0.0.1' ||
  parsedDatabaseUrl.port !== '55439' ||
  parsedDatabaseUrl.pathname !== '/mtd_olp_medicarte_test'
) {
  throw new Error('Refusing RF-PAC-001 API integration test outside the isolated test database');
}

const database = createDatabase(databaseUrl);
const query = database.pool;
const access = new AccessService(database);
const service = new PatientMasterService(new PatientMasterRepository(database));
const controller = new PatientMasterController(service, access, {
  PATIENT_MASTER_ACCESS_ENABLED: true,
} as never);
const apiConfig = {
  PATIENT_MASTER_ACCESS_ENABLED: true,
  AUTH_JWT_SECRET: 'synthetic-only-patient-master-integration-secret-32',
  AUTH_JWT_TTL_SECONDS: 3600,
};

// The shared Vitest config is rooted in apps/web and does not emit Nest's
// constructor metadata for API sources; mirror the API's tsc metadata here.
Reflect.defineMetadata('design:paramtypes', [PatientMasterRepository], PatientMasterService);
Reflect.defineMetadata(
  'design:paramtypes',
  [PatientMasterService, AccessService, Object],
  PatientMasterController,
);

class PatientMasterHttpIntegrationModule {}
Module({
  controllers: [PatientMasterController],
  providers: [
    AuthGuard,
    AccessService,
    PatientMasterRepository,
    PatientMasterService,
    { provide: DATABASE, useValue: database },
    { provide: API_CONFIG, useValue: apiConfig },
  ],
})(PatientMasterHttpIntegrationModule);
const fixture = {
  authorizationIds: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
  patientIds: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
  pageAuthorizationIds: Array.from({ length: 26 }, () => randomUUID()),
  pagePatientIds: Array.from({ length: 26 }, () => randomUUID()),
  scheduleIds: [randomUUID(), randomUUID()],
  reconciliationBatchIds: [randomUUID(), randomUUID()],
  reconciliationItemIds: [randomUUID(), randomUUID()],
  planningPeriodId: randomUUID(),
  outOfScopePointId: randomUUID(),
  identitySuffix: randomUUID(),
  mtdOrganizationId: '',
  compensarOrganizationId: '',
  medicarteOrganizationId: '',
  olpOrganizationId: '',
  medicarteUserId: 'a0000000-0000-4000-8000-000000000003',
  mtdUserId: 'a0000000-0000-4000-8000-000000000001',
  olpUserId: 'a0000000-0000-4000-8000-000000000002',
  pointId: 'b0000000-0000-4000-8000-000000000001',
  batchId: 'd0000000-0000-4000-8000-000000000001',
};

function request(userId: string) {
  return { auth: { sub: userId } } as never;
}

function getHttpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

async function insertAuthorization(input: {
  id: string;
  patientId: string;
  number: string;
  product: string;
  organizations: string[];
  pointId?: string;
  scheduleId?: string;
  personSuffix: string;
}) {
  const patient = await query.query<{ identification_type_raw: string; identification_value_raw: string }>(
    `select identification_type_raw, identification_value_raw from patients where id = $1::uuid`,
    [input.patientId],
  );
  if (!patient.rows[0]) throw new Error('Synthetic patient identity fixture is missing');
  await query.query(
    `insert into authorization_items (
       id, patient_id, numero_autorizacion, codigo_medicamento, authorization_key,
       source_data, source_status_normalized, enablement_status, coverage_type,
       direction_status, coverage_rule_version, created_from_batch_id
     ) values ($1, $2, $3, $4, $5, $6::jsonb, 'AUTHORIZED', 'ENABLED', 'NO_PBS',
               'CONFIRMED', 'TEST-RULE-1', $7)`,
    [
      input.id,
      input.patientId,
      input.number,
      input.product,
      `${input.number}|${input.product}`,
      JSON.stringify({
        TIPO_IDENTIFICACION: patient.rows[0].identification_type_raw,
        IDENTIFICACION_PACIENTE: patient.rows[0].identification_value_raw,
      }),
      fixture.batchId,
    ],
  );
  for (const organizationId of input.organizations) {
    await query.query(
      `insert into authorization_item_organizations (authorization_item_id, organization_id)
       values ($1, $2)`,
      [input.id, organizationId],
    );
  }
  if (input.pointId && input.scheduleId) {
    await query.query(
      `insert into patient_schedules (
         id, authorization_item_id, planning_period_id, dispensing_point_id,
         commercial_code, scheduled_date, quantity, created_by, updated_by
       ) values ($1, $2, $3, $4, $5, current_date, 1, $6, $6)`,
      [
        input.scheduleId,
        input.id,
        fixture.planningPeriodId,
        input.pointId,
        input.product,
        fixture.mtdUserId,
      ],
    );
  }
}

describe.skipIf(!process.env.DATABASE_URL)(
  'RF-PAC-001 patient master API against isolated PostgreSQL',
  () => {
    let httpApp: INestApplication;

    beforeAll(async () => {
      const organizations = await query.query<{ id: string; code: string }>(
        `select id, code from organizations where code in ('MTD', 'COMPENSAR', 'MEDICARTE', 'OLP')`,
      );
      const organizationByCode = new Map(organizations.rows.map((row) => [row.code, row.id]));
      fixture.mtdOrganizationId = organizationByCode.get('MTD') ?? '';
      fixture.compensarOrganizationId = organizationByCode.get('COMPENSAR') ?? '';
      fixture.medicarteOrganizationId = organizationByCode.get('MEDICARTE') ?? '';
      fixture.olpOrganizationId = organizationByCode.get('OLP') ?? '';
      if (
        !fixture.mtdOrganizationId ||
        !fixture.compensarOrganizationId ||
        !fixture.medicarteOrganizationId ||
        !fixture.olpOrganizationId
      ) {
        throw new Error('Synthetic organization fixtures are missing');
      }

      await query.query(
        `insert into dispensing_points (id, organization_id, code, name, created_by)
       values ($1, $2, $3, 'Synthetic point outside current grant', $4)`,
        [
          fixture.outOfScopePointId,
          fixture.medicarteOrganizationId,
          `TEST-PAC-OUT-${fixture.identitySuffix.slice(0, 8)}`,
          fixture.mtdUserId,
        ],
      );
      await query.query(
        `insert into planning_periods (
         id, start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
         expected_delivery_date, created_by, updated_by
       ) values ($1, current_date, current_date + 30, now(), now() + interval '1 day',
                 current_date + 2, $2, $2)`,
        [fixture.planningPeriodId, fixture.mtdUserId],
      );
      for (let index = 0; index < fixture.patientIds.length; index += 1) {
        await query.query(
          `insert into patients (id, source_organization_id, identification_type_raw, identification_value_raw)
         values ($1, $2, 'TEST', $3)`,
          [fixture.patientIds[index], fixture.compensarOrganizationId,
            `TEST-PAC-${fixture.identitySuffix}-${index}`],
        );
      }
      await query.query(
        `update patients
            set mtdom_basic_profile = $2::jsonb,
                mtdom_basic_profile_source = 'MTDOM',
                mtdom_basic_profile_fetched_at = now(),
                mtdom_basic_profile_source_updated_at = now(),
                mtdom_personal_profile = $3::jsonb,
                mtdom_personal_profile_source = 'MTDOM',
                mtdom_personal_profile_fetched_at = now()
          where id = $1::uuid`,
        [
          fixture.patientIds[0],
          JSON.stringify({
            tipo_identificacion: 'TEST',
            identificacion: `SYN-${fixture.identitySuffix.slice(0, 12)}-0`,
            primer_nombre: 'FICTICIO',
            segundo_nombre: null,
            primer_apellido: 'PRUEBA',
            segundo_apellido: null,
            sexo: 'SINTETICO',
            ciudad: 'CIUDAD-FICTICIA',
            codigo_ciudad: '00001',
            departamento: 'DEPARTAMENTO-FICTICIO',
            codigo_departamento: '00',
            eps: 'EPS-FICTICIA',
            codigo_eps: 'EPS-00',
            plan: 'PLAN-SINTETICO',
            codigo_plan: 'PL-00',
            tipo: 'TIPO-SINTETICO',
            codigo_tipo: 'T-00',
            condicion: null,
            activo: true,
            paciente_vivo: true,
            fecha_fallecimiento: null,
            presente_en_fuente_actual: true,
            registraduria_estado: null,
            fecha_ultima_validacion_registraduria: null,
            actualizado_en: '2026-11-08T00:00:00.000Z',
          }),
          JSON.stringify({
            fecha_nacimiento: '2000-01-01',
            direccion: 'DIRECCION-FICTICIA-001',
            barrio: 'BARRIO-SINTETICO',
            zona: 'URBANA-SINTETICA',
            latitud: 1.1,
            longitud: -70.2,
            telefono1: '0000000000',
            telefono2: null,
            email: 'synthetic@example.invalid',
            email_validado: false,
          }),
        ],
      );

      const [sharedId, mtdOnlyId, outOfScopeId] = fixture.patientIds;
      const [sharedAuthId, sharedMtdAuthId, outOfScopeAuthId] = fixture.authorizationIds;
      if (
        !sharedId ||
        !mtdOnlyId ||
        !outOfScopeId ||
        !sharedAuthId ||
        !sharedMtdAuthId ||
        !outOfScopeAuthId
      ) {
        throw new Error('Synthetic patient fixture IDs are incomplete');
      }
      await insertAuthorization({
        id: sharedAuthId,
        patientId: sharedId,
        number: `TEST-PAC-SHARED-${fixture.identitySuffix}`,
        product: `TEST-PAC-PRODUCT-1-${fixture.identitySuffix}`,
        organizations: [fixture.mtdOrganizationId, fixture.medicarteOrganizationId],
        pointId: fixture.pointId,
        scheduleId: fixture.scheduleIds[0]!,
        personSuffix: 'SHARED',
      });
      await insertAuthorization({
        id: sharedMtdAuthId,
        patientId: sharedId,
        number: `TEST-PAC-MTD-${fixture.identitySuffix}`,
        product: `TEST-PAC-PRODUCT-2-${fixture.identitySuffix}`,
        organizations: [fixture.mtdOrganizationId, fixture.medicarteOrganizationId],
        personSuffix: 'SHARED',
      });
      await insertAuthorization({
        id: outOfScopeAuthId,
        patientId: outOfScopeId,
        number: `TEST-PAC-POINT-${fixture.identitySuffix}`,
        product: `TEST-PAC-PRODUCT-3-${fixture.identitySuffix}`,
        organizations: [fixture.mtdOrganizationId, fixture.medicarteOrganizationId],
        pointId: fixture.outOfScopePointId,
        scheduleId: fixture.scheduleIds[1]!,
        personSuffix: 'POINT',
      });
      const medicarteOnlyPatientId = fixture.patientIds[3];
      const medicarteOnlyAuthorizationId = fixture.authorizationIds[3];
      if (!medicarteOnlyPatientId || !medicarteOnlyAuthorizationId) {
        throw new Error('Synthetic cross-organization fixture IDs are incomplete');
      }
      await insertAuthorization({
        id: medicarteOnlyAuthorizationId,
        patientId: medicarteOnlyPatientId,
        number: `TEST-PAC-MED-ONLY-${fixture.identitySuffix}`,
        product: `TEST-PAC-PRODUCT-MED-${fixture.identitySuffix}`,
        organizations: [fixture.medicarteOrganizationId],
        pointId: fixture.pointId,
        scheduleId: randomUUID(),
        personSuffix: 'MED-ONLY',
      });
      const reconciliationCases = [
        {
          batchId: fixture.reconciliationBatchIds[0]!,
          itemId: fixture.reconciliationItemIds[0]!,
          organizationId: fixture.mtdOrganizationId,
          authorizationItemId: sharedAuthId,
        },
        {
          batchId: fixture.reconciliationBatchIds[1]!,
          itemId: fixture.reconciliationItemIds[1]!,
          organizationId: fixture.medicarteOrganizationId,
          authorizationItemId: medicarteOnlyAuthorizationId,
        },
      ];
      for (const item of reconciliationCases) {
        await query.query(
          `insert into patient_backfill_batches (
             id, organization_id, policy_version, batch_size
           ) values ($1, $2, 'SYNTHETIC_SCOPE_TEST_V1', 1)`,
          [item.batchId, item.organizationId],
        );
        await query.query(
          `insert into patient_backfill_items (
             id, batch_id, authorization_item_id, status, reason_code
           ) values ($1, $2, $3, 'NEEDS_RECONCILIATION', 'SYNTHETIC_SCOPE_TEST')`,
          [item.itemId, item.batchId, item.authorizationItemId],
        );
      }
      // Keep the second patient explicitly MTD-only for cross-organization access tests.
      await insertAuthorization({
        id: randomUUID(),
        patientId: mtdOnlyId,
        number: `TEST-PAC-MTD-ONLY-${fixture.identitySuffix}`,
        product: `TEST-PAC-PRODUCT-4-${fixture.identitySuffix}`,
        organizations: [fixture.mtdOrganizationId],
        personSuffix: 'MTD-ONLY',
      });
      for (let index = 0; index < fixture.pagePatientIds.length; index += 1) {
        const patientId = fixture.pagePatientIds[index]!;
        const authorizationId = fixture.pageAuthorizationIds[index]!;
        await query.query(
          `insert into patients (id, source_organization_id, identification_type_raw, identification_value_raw)
         values ($1, $2, 'TEST', $3)`,
          [patientId, fixture.compensarOrganizationId,
            `TEST-PAC-PAGE-${fixture.identitySuffix}-${index}`],
        );
        await insertAuthorization({
          id: authorizationId,
          patientId,
          number: `TEST-PAC-PAGE-${index}-${fixture.identitySuffix}`,
          product: `TEST-PAC-PAGE-PRODUCT-${index}-${fixture.identitySuffix}`,
          organizations: [fixture.medicarteOrganizationId],
          personSuffix: `PAGE-${index}-${fixture.identitySuffix}`,
        });
      }
      httpApp = await NestFactory.create(PatientMasterHttpIntegrationModule, { logger: false });
      httpApp.setGlobalPrefix('api/v1');
      await httpApp.init();
      await httpApp.listen(0, '127.0.0.1');
    });

    afterAll(async () => {
      await httpApp?.close();
      await query.query('delete from patient_backfill_items where batch_id = any($1::uuid[])', [
        fixture.reconciliationBatchIds,
      ]);
      await query.query('delete from patient_backfill_batches where id = any($1::uuid[])', [
        fixture.reconciliationBatchIds,
      ]);
      const authorizationIds = await query.query<{ id: string }>(
        `select id from authorization_items where numero_autorizacion like $1`,
        [`TEST-PAC-%-${fixture.identitySuffix}`],
      );
      const ids = authorizationIds.rows.map((row) => row.id);
      if (ids.length) {
        await query.query(
          'delete from patient_schedules where authorization_item_id = any($1::uuid[])',
          [ids],
        );
        await query.query(
          'delete from authorization_item_organizations where authorization_item_id = any($1::uuid[])',
          [ids],
        );
        await query.query('delete from authorization_items where id = any($1::uuid[])', [ids]);
      }
      await query.query('delete from patients where id = any($1::uuid[])', [
        [...fixture.patientIds, ...fixture.pagePatientIds],
      ]);
      await query.query('delete from planning_periods where id = $1', [fixture.planningPeriodId]);
      await query.query('delete from dispensing_points where id = $1', [fixture.outOfScopePointId]);
      await database.pool.end();
    });

    it('returns positive linked evidence, empty results, detail and stable pagination', async () => {
      const mtdInput = { page: 1, limit: 1 };
      const firstPage = await controller.search(
        mtdInput,
        fixture.mtdOrganizationId,
        request(fixture.mtdUserId),
      );
      const secondPage = await controller.search(
        { ...mtdInput, page: 2 },
        fixture.mtdOrganizationId,
        request(fixture.mtdUserId),
      );
      expect(firstPage.total).toBe(29);
      expect(firstPage.items).toHaveLength(1);
      expect(secondPage.items).toHaveLength(1);
      expect(firstPage.items[0]?.id).not.toBe(secondPage.items[0]?.id);

      const sharedSearch = await controller.search(
        {
          identificationType: 'TEST',
          identificationValue: `TEST-PAC-${fixture.identitySuffix}-0`,
          page: 1,
          limit: 10,
        },
        fixture.mtdOrganizationId,
        request(fixture.mtdUserId),
      );
      expect(sharedSearch.items).toHaveLength(1);
      expect(sharedSearch.items[0]?.linkedAuthorizationCount).toBe(2);
      expect(JSON.stringify(sharedSearch)).not.toContain(fixture.identitySuffix);

      const detail = await controller.detail(
        fixture.patientIds[0]!,
        undefined,
        fixture.mtdOrganizationId,
        request(fixture.mtdUserId),
      );
      expect(detail.authorizationEvidence).toHaveLength(2);
      expect(detail.authorizationEvidence.map((item) => item.organizationCodes)).toEqual([
        ['MEDICARTE'],
        ['MEDICARTE'],
      ]);
      await expect(
        controller.detail(
          fixture.patientIds[1]!,
          undefined,
          fixture.mtdOrganizationId,
          request(fixture.mtdUserId),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      const empty = await controller.search(
        { identificationType: 'TEST-MISSING', identificationValue: 'NO-MATCH', page: 1, limit: 10 },
        fixture.mtdOrganizationId,
        request(fixture.mtdUserId),
      );
      expect(empty).toMatchObject({ items: [], total: 0 });
    });

    it('denies MEDICARTE and OLP while MTD point scope excludes unrelated evidence', async () => {
      await expect(controller.search(
        { page: 1, limit: 20, dispensingPointId: fixture.pointId },
        fixture.medicarteOrganizationId,
        request(fixture.medicarteUserId),
      )).rejects.toBeInstanceOf(ForbiddenException);
      await expect(controller.detail(
        fixture.patientIds[0]!, fixture.pointId,
        fixture.medicarteOrganizationId, request(fixture.medicarteUserId),
      )).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        controller.search(
          { page: 1, limit: 20 },
          fixture.olpOrganizationId,
          request(fixture.olpUserId),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        controller.search(
          { page: 1, limit: 20, dispensingPointId: fixture.outOfScopePointId },
          fixture.medicarteOrganizationId,
          request(fixture.medicarteUserId),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        controller.detail(
          fixture.patientIds[2]!,
          fixture.pointId,
          fixture.medicarteOrganizationId,
          request(fixture.medicarteUserId),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        controller.detail(
          fixture.patientIds[0]!,
          fixture.outOfScopePointId,
          fixture.medicarteOrganizationId,
          request(fixture.medicarteUserId),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('serves authenticated loopback HTTP with PostgreSQL-backed roles, organization and point scope', async () => {
      const tokenFor = (sub: string, username: string) =>
        signAccessToken(apiConfig as never, { sub, username });
      const [mtdToken, medicarteToken, olpToken] = await Promise.all([
        tokenFor(fixture.mtdUserId, 'test-mtd-admin'),
        tokenFor(fixture.medicarteUserId, 'test-medicarte-operator'),
        tokenFor(fixture.olpUserId, 'test-olp-operator'),
      ]);
      const server = getHttpServer(httpApp);
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Nest HTTP server has no port');
      const baseUrl = `http://127.0.0.1:${address.port}/api/v1/patient-master`;

      const unauthenticated = await fetch(`${baseUrl}/search`, { method: 'POST' });
      expect(unauthenticated.status).toBe(401);
      const invalidToken = await supertest(server)
        .post('/api/v1/patient-master/search')
        .set('Authorization', 'Bearer synthetic-invalid-token')
        .set('X-Organization-Id', fixture.mtdOrganizationId)
        .send({ page: 1, limit: 10 });
      expect(invalidToken.status).toBe(401);
      expect(JSON.stringify(invalidToken.body as unknown)).not.toContain('synthetic-invalid-token');

      const mtdSearch = await supertest(server)
        .post('/api/v1/patient-master/search')
        .set('Authorization', `Bearer ${mtdToken.token}`)
        .set('X-Organization-Id', fixture.mtdOrganizationId)
        .send({ page: 1, limit: 1 });
      expect(mtdSearch.status).toBe(201);
      const mtdBody = patientMasterSearchResponseSchema.parse(mtdSearch.body as unknown);
      expect(mtdBody.total).toBe(29);
      const mtdPageTwo = await supertest(server)
        .post('/api/v1/patient-master/search')
        .set('Authorization', `Bearer ${mtdToken.token}`)
        .set('X-Organization-Id', fixture.mtdOrganizationId)
        .send({ page: 2, limit: 1 });
      expect(mtdPageTwo.status).toBe(201);
      const mtdPageTwoBody = patientMasterSearchResponseSchema.parse(mtdPageTwo.body as unknown);
      expect(mtdPageTwoBody.items[0]?.id).not.toBe(mtdBody.items[0]?.id);

      const sharedSearch = await supertest(server)
        .post('/api/v1/patient-master/search')
        .set('Authorization', `Bearer ${mtdToken.token}`)
        .set('X-Organization-Id', fixture.mtdOrganizationId)
        .send({
          identificationType: 'TEST',
          identificationValue: `TEST-PAC-${fixture.identitySuffix}-0`,
          page: 1,
          limit: 10,
        });
      expect(sharedSearch.status).toBe(201);
      const sharedBody = patientMasterSearchResponseSchema.parse(sharedSearch.body as unknown);
      expect(sharedBody.items[0]?.linkedAuthorizationCount).toBe(2);
      expect(JSON.stringify(sharedBody)).not.toContain(fixture.identitySuffix);

      const reconciliationCases = await supertest(server)
        .get('/api/v1/patient-master/reconciliation-cases')
        .query({ limit: 10 })
        .set('Authorization', `Bearer ${mtdToken.token}`)
        .set('X-Organization-Id', fixture.mtdOrganizationId);
      expect(reconciliationCases.status).toBe(200);
      const scopedCases = patientReconciliationCasesResponseSchema.parse(
        reconciliationCases.body as unknown,
      );
      expect(scopedCases.items).toHaveLength(1);
      expect(scopedCases.items[0]?.authorizationItemId).toBe(fixture.authorizationIds[0]);
      expect(JSON.stringify(scopedCases)).not.toContain(fixture.authorizationIds[3]);

      const pointDetail = await supertest(server)
        .get(`/api/v1/patient-master/${fixture.patientIds[0]}`)
        .query({ dispensingPointId: fixture.pointId })
        .set('Authorization', `Bearer ${medicarteToken.token}`)
        .set('X-Organization-Id', fixture.medicarteOrganizationId);
      expect(pointDetail.status).toBe(403);

      const personalDenied = await supertest(server)
        .get(`/api/v1/patient-master/${fixture.patientIds[0]}/personal`)
        .query({ dispensingPointId: fixture.pointId })
        .set('Authorization', `Bearer ${medicarteToken.token}`)
        .set('X-Organization-Id', fixture.medicarteOrganizationId);
      expect(personalDenied.status).toBe(403);
      expect(JSON.stringify(personalDenied.body as unknown)).not.toContain('DIRECCION-FICTICIA');

      const outOfScopePoint = await supertest(server)
        .post('/api/v1/patient-master/search')
        .set('Authorization', `Bearer ${medicarteToken.token}`)
        .set('X-Organization-Id', fixture.medicarteOrganizationId)
        .send({ page: 1, limit: 10, dispensingPointId: fixture.outOfScopePointId });
      expect(outOfScopePoint.status).toBe(403);
      expect(JSON.stringify(outOfScopePoint.body as unknown)).not.toContain(
        fixture.outOfScopePointId,
      );

      const olp = await supertest(server)
        .post('/api/v1/patient-master/search')
        .set('Authorization', `Bearer ${olpToken.token}`)
        .set('X-Organization-Id', fixture.olpOrganizationId)
        .send({ page: 1, limit: 10 });
      expect(olp.status).toBe(403);
      expect(JSON.stringify(olp.body as unknown)).not.toContain(fixture.olpUserId);

      const idor = await supertest(server)
        .get(`/api/v1/patient-master/${fixture.patientIds[2]}`)
        .query({ dispensingPointId: fixture.pointId })
        .set('Authorization', `Bearer ${medicarteToken.token}`)
        .set('X-Organization-Id', fixture.medicarteOrganizationId);
      expect(idor.status).toBe(403);
      expect(JSON.stringify(idor.body as unknown)).not.toContain(fixture.patientIds[2]);

      const otherOrganization = await supertest(server)
        .post('/api/v1/patient-master/search')
        .set('Authorization', `Bearer ${medicarteToken.token}`)
        .set('X-Organization-Id', fixture.mtdOrganizationId)
        .send({ page: 1, limit: 10 });
      expect(otherOrganization.status).toBe(403);
    });

    it('maps only the allowlisted synthetic profile objects under repository scope', async () => {
      const repository = new PatientMasterRepository(database);
      const scope = {
        organizationId: fixture.mtdOrganizationId,
        organizationCode: 'MTD' as const,
        userId: fixture.mtdUserId,
        pointAccessKind: 'global' as const,
        accessiblePointIds: [],
        dispensingPointId: null,
      };
      const detail = await repository.detail(scope, fixture.patientIds[0]!, true);
      expect(detail?.basicProfile?.primer_nombre).toBe('FICTICIO');
      expect(detail?.basicProfileMetadata).toMatchObject({ source: 'MTDOM' });
      expect(detail?.basicProfile?.identificacion).toMatch(/^SYN-/);
      expect(JSON.stringify(detail)).not.toContain('DIRECCION-FICTICIA');
      const personal = await repository.personalProfile(scope, fixture.patientIds[0]!);
      expect(personal?.personalProfile?.direccion).toBe('DIRECCION-FICTICIA-001');
      expect(personal?.personalProfileMetadata).toMatchObject({ source: 'MTDOM' });
      const outOfScope = await repository.personalProfile(
        { ...scope, organizationId: fixture.olpOrganizationId },
        fixture.patientIds[2]!,
      );
      expect(outOfScope).toBeNull();
      const forbiddenKey = await query
        .query(
          `update patients
            set mtdom_basic_profile = mtdom_basic_profile || '{"unapproved_field":"synthetic"}'::jsonb
          where id = $1::uuid`,
          [fixture.patientIds[0]],
        )
        .catch((error: unknown) => error as { code?: string });
      expect((forbiddenKey as { code?: string }).code).toBe('23514');
    });
  },
);
