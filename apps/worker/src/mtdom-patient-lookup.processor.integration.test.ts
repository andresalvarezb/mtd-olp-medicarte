import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import type { PatientIdentityNormalizationPolicy } from '@authorization/domain';
import { createDatabase } from '@authorization/database';
import { MtdomPatientLookupProcessor } from './mtdom-patient-lookup.processor';
import { MtdomPatientsReadClient } from './mtdom-patients-read.client';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://mtd_test@127.0.0.1:55439/mtd_olp_medicarte_test';
const target = new URL(databaseUrl);
const integrationTarget =
  target.hostname === 'localhost' &&
  target.port === (process.env.POSTGRES_HOST_PORT ?? '25432') &&
  target.pathname === '/authorization_test_integration';
const testTarget =
  target.hostname === '127.0.0.1' &&
  target.port === '55439' &&
  target.pathname === '/mtd_olp_medicarte_test';
if (!integrationTarget && !testTarget)
  throw new Error('Refusing patient profile integration test outside isolated PostgreSQL');

const database = createDatabase(databaseUrl);
const patientId = randomUUID();
const documentValue = `SYN-${randomUUID().slice(0, 12)}`;
const identityPolicy: PatientIdentityNormalizationPolicy = {
  version: 'SYNTHETIC_EXACT_INTEGRATION_V1',
  normalizeDocumentType: (value) => value,
  normalizeDocumentValue: (value) => value,
};

const patient = {
  tipo_identificacion: 'TEST',
  identificacion: documentValue,
  primer_nombre: 'NOMBRE-NUEVO-SINTETICO',
  segundo_nombre: null,
  primer_apellido: 'PRUEBA',
  segundo_apellido: null,
  sexo: null,
  ciudad: 'CIUDAD-FICTICIA',
  codigo_ciudad: null,
  departamento: null,
  codigo_departamento: null,
  eps: null,
  codigo_eps: null,
  plan: null,
  codigo_plan: null,
  tipo: null,
  codigo_tipo: null,
  condicion: null,
  activo: false,
  paciente_vivo: null,
  fecha_fallecimiento: null,
  presente_en_fuente_actual: true,
  registraduria_estado: null,
  fecha_ultima_validacion_registraduria: null,
  actualizado_en: '2026-11-08T11:00:00.000Z',
};

describe.skipIf(!process.env.DATABASE_URL)(
  'MTDOM basic profile persistence on isolated PostgreSQL with synthetic loopback HTTP',
  () => {
    let server: Server | undefined;

    afterAll(async () => {
      if (server?.listening) {
        await new Promise<void>((resolve, reject) =>
          server!.close((error) => (error ? reject(error) : resolve())),
        );
      }
      if (database.pool) {
        await database.pool.query('delete from patients where id = $1::uuid', [patientId]);
        await database.pool.end();
      }
    });

    it('persists only allowlisted basic fields, source metadata, and preserves existing values on null', async () => {
      server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
            string,
            unknown
          >;
          if (
            request.method !== 'POST' ||
            request.url !== '/v1/patients/lookup' ||
            input.profile !== 'basic' ||
            input.tipo_identificacion !== 'TEST' ||
            input.identificacion !== documentValue ||
            request.headers.authorization !== 'Bearer mtdpat_synthetic_loopback_only'
          ) {
            response.writeHead(400, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ ok: false, error: 'INVALID_SYNTHETIC_REQUEST' }));
            return;
          }
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ ok: true, data: patient }));
        });
      });
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Synthetic HTTP server unavailable');

      const previousProfile = {
        tipo_identificacion: 'TEST',
        identificacion: documentValue,
        primer_nombre: 'NOMBRE-ANTERIOR-SINTETICO',
        segundo_nombre: 'SEGUNDO-PREEXISTENTE',
      };
      await database.pool.query(
        `insert into patients (
           id, identification_type_raw, identification_value_raw, mtdom_basic_profile,
           mtdom_basic_profile_source, mtdom_basic_profile_fetched_at, updated_at
         ) values ($1::uuid, 'TEST', $2, $3::jsonb, 'MTDOM', now(), '2020-01-01T00:00:00Z')`,
        [patientId, documentValue, JSON.stringify(previousProfile)],
      );

      const fetchLoopback: typeof fetch = (input, init) => {
        const source =
          input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        const sourceUrl = new URL(source);
        if (sourceUrl.origin !== 'https://api.mtdom.com') {
          throw new Error('Unexpected non-contract MTDOM client URL');
        }
        return fetch(`http://127.0.0.1:${address.port}${sourceUrl.pathname}`, init);
      };
      const client = new MtdomPatientsReadClient({
        token: 'mtdpat_synthetic_loopback_only',
        timeoutMs: 1000,
        fetchImpl: fetchLoopback,
      });
      const processor = new MtdomPatientLookupProcessor(database, client, identityPolicy);

      try {
        const outcome = await processor.execute({ patientId });
        expect(outcome).toEqual({ outcome: 'MATCHED_PENDING_APPROVAL' });
        expect(JSON.stringify(outcome)).not.toContain(documentValue);
        expect(JSON.stringify(outcome)).not.toContain('NOMBRE-NUEVO-SINTETICO');

        const stored = await database.pool.query<{
          mtdom_basic_profile: Record<string, unknown>;
          mtdom_basic_profile_source: string;
          mtdom_basic_profile_fetched_at: Date;
          mtdom_basic_profile_source_updated_at: Date;
          mtdom_personal_profile: unknown;
          updated_at: Date;
        }>(
          `select mtdom_basic_profile, mtdom_basic_profile_source,
                  mtdom_basic_profile_fetched_at, mtdom_basic_profile_source_updated_at,
                  mtdom_personal_profile, updated_at
             from patients where id = $1::uuid`,
          [patientId],
        );
        const row = stored.rows[0]!;
        expect(row.mtdom_basic_profile).toMatchObject({
          primer_nombre: 'NOMBRE-NUEVO-SINTETICO',
          segundo_nombre: 'SEGUNDO-PREEXISTENTE',
          activo: false,
        });
        expect(Object.keys(row.mtdom_basic_profile).every((key) => key in patient)).toBe(true);
        expect(row.mtdom_basic_profile).not.toHaveProperty('sexo');
        expect(row.mtdom_basic_profile_source).toBe('MTDOM');
        expect(row.mtdom_basic_profile_fetched_at).toBeInstanceOf(Date);
        expect(row.mtdom_basic_profile_source_updated_at.toISOString()).toBe(
          '2026-11-08T11:00:00.000Z',
        );
        expect(row.mtdom_personal_profile).toBeNull();
        expect(row.updated_at.toISOString()).toBe('2020-01-01T00:00:00.000Z');
      } finally {
        await database.pool.query('delete from patients where id = $1::uuid', [patientId]);
      }
    });

    it('serves ephemeral exact, missing, ambiguous and mismatched basic lookups without persisting profile data', async () => {
      const calls: string[] = [];
      server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
            string,
            unknown
          >;
          const value = String(input.identificacion);
          calls.push(value);
          response.setHeader('content-type', 'application/json');
          if (value.endsWith('MISSING')) {
            response
              .writeHead(404)
              .end(JSON.stringify({ ok: false, error: 'PATIENT_NOT_FOUND', message: 'synthetic' }));
          } else if (value.endsWith('AMBIGUOUS')) {
            response.writeHead(409).end(
              JSON.stringify({
                ok: false,
                error: 'AMBIGUOUS_PATIENT_IDENTITY',
                message: 'synthetic',
              }),
            );
          } else {
            const returned = value.endsWith('MISMATCH')
              ? { ...patient, identificacion: `${value}-X` }
              : value.endsWith('CASE')
                ? { ...patient, tipo_identificacion: 'CC', identificacion: value }
                : { ...patient, identificacion: value };
            response.writeHead(200).end(JSON.stringify({ ok: true, data: returned }));
          }
        });
      });
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Synthetic HTTP server unavailable');
      const fetchLoopback: typeof fetch = (input, init) => {
        const source =
          input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        const sourceUrl = new URL(source);
        return fetch(`http://127.0.0.1:${address.port}${sourceUrl.pathname}`, init);
      };
      const processor = new MtdomPatientLookupProcessor(
        database,
        new MtdomPatientsReadClient({
          token: 'mtdpat_synthetic_loopback_only',
          timeoutMs: 1000,
          fetchImpl: fetchLoopback,
        }),
        identityPolicy,
      );
      const foundId = `${documentValue}-FOUND`;
      const found = await processor.lookupLiveWithResponse({
        documentType: 'TEST',
        documentValue: foundId,
      });
      expect(found).toMatchObject({ status: 'FOUND', basicProfile: { identificacion: foundId } });
      expect(
        await processor.lookupLiveWithResponse({
          documentType: 'TEST',
          documentValue: `${documentValue}-MISSING`,
        }),
      ).toEqual({ status: 'NOT_FOUND' });
      expect(
        await processor.lookupLiveWithResponse({
          documentType: 'TEST',
          documentValue: `${documentValue}-AMBIGUOUS`,
        }),
      ).toEqual({ status: 'AMBIGUOUS' });
      expect(
        await processor.lookupLiveWithResponse({
          documentType: 'TEST',
          documentValue: `${documentValue}-MISMATCH`,
        }),
      ).toEqual({ status: 'IDENTITY_MISMATCH' });
      expect(
        await processor.lookupLiveWithResponse({
          documentType: 'cc',
          documentValue: `${documentValue}-CASE`,
        }),
      ).toEqual({ status: 'IDENTITY_MISMATCH' });
      expect(calls).toHaveLength(5);
      const stored = await database.pool.query(
        `select id from patients where identification_value_raw = any($1::text[])`,
        [
          [
            foundId,
            `${documentValue}-MISSING`,
            `${documentValue}-AMBIGUOUS`,
            `${documentValue}-MISMATCH`,
            `${documentValue}-CASE`,
          ],
        ],
      );
      expect(stored.rowCount).toBe(0);
    });
  },
);
