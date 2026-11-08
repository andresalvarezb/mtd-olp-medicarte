import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  MtdomPatientsReadClient,
  MtdomPatientsReadError,
  type MtdomBasicPatient,
} from './mtdom-patients-read.client';

const identity = { documentType: 'CC', documentValue: 'SYNTHETIC-0001' };
const syntheticPatient: MtdomBasicPatient = {
  tipo_identificacion: 'CC',
  identificacion: 'SYNTHETIC-0001',
  primer_nombre: 'PACIENTE',
  segundo_nombre: null,
  primer_apellido: 'PRUEBA',
  segundo_apellido: null,
  sexo: null,
  ciudad: null,
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
  activo: true,
  paciente_vivo: true,
  fecha_fallecimiento: null,
  presente_en_fuente_actual: true,
  registraduria_estado: null,
  fecha_ultima_validacion_registraduria: null,
  actualizado_en: '2026-11-07T12:00:00Z',
};

function response(status: number, payload: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function client(fetchImpl: typeof fetch, token = 'mtdpat_synthetic-only') {
  return new MtdomPatientsReadClient({ token, timeoutMs: 100, fetchImpl });
}

describe('MTDOM Patients Read v1 lookup client', () => {
  it('runs the HTTP contract against a loopback-only synthetic Patients Read v1 server', async () => {
    const observed: Array<{ authorization: string | undefined; body: unknown }> = [];
    const server = createServer((request, response) => {
      void (async () => {
        const chunks: string[] = [];
        for await (const chunk of request) {
          chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        }
        const body = JSON.parse(chunks.join('')) as Record<string, unknown>;
        observed.push({ authorization: request.headers.authorization, body });
        response.setHeader('content-type', 'application/json');

        if (request.method !== 'POST' || request.url !== '/v1/patients/lookup') {
          response.writeHead(404).end();
          return;
        }
        if (request.headers.authorization !== 'Bearer mtdpat_loopback-synthetic') {
          response.writeHead(401).end(
            JSON.stringify({
              ok: false,
              error: 'UNAUTHORIZED',
              message: 'synthetic auth failure',
            }),
          );
          return;
        }
        if (
          Object.keys(body).sort().join(',') !== 'identificacion,profile,tipo_identificacion' ||
          body.profile !== 'basic'
        ) {
          response.writeHead(400).end(
            JSON.stringify({
              ok: false,
              error: 'INVALID_REQUEST',
              message: 'synthetic request failure',
            }),
          );
          return;
        }

        const value = String(body.identificacion);
        if (value === 'SYNTHETIC-404') {
          response.writeHead(404).end(
            JSON.stringify({
              ok: false,
              error: 'PATIENT_NOT_FOUND',
              message: 'synthetic not found',
            }),
          );
          return;
        }
        if (value === 'SYNTHETIC-409') {
          response.writeHead(409).end(
            JSON.stringify({
              ok: false,
              error: 'AMBIGUOUS_PATIENT_IDENTITY',
              message: 'synthetic ambiguous',
            }),
          );
          return;
        }
        if (value === 'SYNTHETIC-401') {
          response.writeHead(401).end(
            JSON.stringify({
              ok: false,
              error: 'UNAUTHORIZED',
              message: 'synthetic auth failure',
            }),
          );
          return;
        }
        if (value === 'SYNTHETIC-429') {
          response
            .writeHead(429, { 'retry-after': '2' })
            .end(JSON.stringify({ ok: false, error: 'RATE_LIMITED', message: 'synthetic retry' }));
          return;
        }
        if (value === 'SYNTHETIC-503') {
          response.writeHead(503).end(
            JSON.stringify({
              ok: false,
              error: 'UPSTREAM_UNAVAILABLE',
              message: 'synthetic outage',
            }),
          );
          return;
        }
        if (value === 'SYNTHETIC-TIMEOUT') {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }

        const patient = {
          ...syntheticPatient,
          identificacion: value === 'SYNTHETIC-MISMATCH' ? 'SYNTHETIC-DIFFERENT' : value,
        };
        response.writeHead(200).end(JSON.stringify({ ok: true, data: patient }));
      })().catch(() => response.writeHead(500).end());
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Synthetic MTDOM server did not bind');
    const localFetch: typeof fetch = (input, init) => {
      const inputUrl =
        input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      return fetch(`http://127.0.0.1:${address.port}${new URL(inputUrl).pathname}`, init);
    };
    const httpClient = new MtdomPatientsReadClient({
      token: 'mtdpat_loopback-synthetic',
      timeoutMs: 1000,
      fetchImpl: localFetch,
    });

    try {
      await expect(
        httpClient.lookup({ documentType: 'CC', documentValue: 'SYNTHETIC-0001' }),
      ).resolves.toMatchObject({ kind: 'FOUND', patient: syntheticPatient });
      await expect(
        httpClient.lookup({ documentType: 'CC', documentValue: 'SYNTHETIC-404' }),
      ).resolves.toEqual({ kind: 'NOT_FOUND' });
      await expect(
        httpClient.lookup({ documentType: 'CC', documentValue: 'SYNTHETIC-409' }),
      ).resolves.toEqual({ kind: 'AMBIGUOUS' });

      const authFailure = await httpClient
        .lookup({ documentType: 'CC', documentValue: 'SYNTHETIC-401' })
        .catch((error: unknown) => error);
      expect(authFailure).toMatchObject({ code: 'AUTH_BLOCKED', retryable: false });
      expect((authFailure as Error).message).not.toContain('synthetic auth failure');

      const rateLimit = await httpClient
        .lookup({ documentType: 'CC', documentValue: 'SYNTHETIC-429' })
        .catch((error: unknown) => error);
      expect(rateLimit).toMatchObject({
        code: 'RATE_LIMITED',
        retryable: true,
        retryAfterMs: 2000,
      });
      await expect(
        httpClient.lookup({ documentType: 'CC', documentValue: 'SYNTHETIC-503' }),
      ).rejects.toMatchObject({ code: 'REMOTE_SERVER_ERROR', retryable: true });
      await expect(
        new MtdomPatientsReadClient({
          token: 'mtdpat_loopback-synthetic',
          timeoutMs: 100,
          fetchImpl: localFetch,
        }).lookup({ documentType: 'CC', documentValue: 'SYNTHETIC-TIMEOUT' }),
      ).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
      const mismatch = await httpClient.lookup({
        documentType: 'CC',
        documentValue: 'SYNTHETIC-MISMATCH',
      });
      expect(mismatch).toMatchObject({
        kind: 'FOUND',
        patient: { identificacion: 'SYNTHETIC-DIFFERENT' },
      });
      expect(
        observed.every((entry) => entry.authorization === 'Bearer mtdpat_loopback-synthetic'),
      ).toBe(true);
      expect(
        observed.every(
          (entry) =>
            typeof entry.body === 'object' &&
            entry.body !== null &&
            'profile' in entry.body &&
            entry.body.profile === 'basic',
        ),
      ).toBe(true);
      expect(JSON.stringify(observed)).not.toContain('NOMBRE_PACIENTE');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('posts only the composite identity with profile basic and validates the response', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(200, { ok: true, data: syntheticPatient }));
    await expect(client(fetchImpl).lookup(identity)).resolves.toMatchObject({
      kind: 'FOUND',
      patient: syntheticPatient,
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.mtdom.com/v1/patients/lookup');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer mtdpat_synthetic-only',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(init?.body as string)).toEqual({
      tipo_identificacion: 'CC',
      identificacion: 'SYNTHETIC-0001',
      profile: 'basic',
    });
  });

  it.each([
    [404, 'PATIENT_NOT_FOUND', 'NOT_FOUND'],
    [409, 'AMBIGUOUS_PATIENT_IDENTITY', 'AMBIGUOUS'],
  ] as const)('maps %s domain response without retry', async (status, error, kind) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(status, { ok: false, error, message: 'mensaje sintético' }));
    await expect(client(fetchImpl).lookup(identity)).resolves.toEqual({ kind });
  });

  it.each([401, 403])('stops on %s without exposing the body or retrying', async (status) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response(status, { ok: false, error: 'UNAUTHORIZED', message: 'credential detail' }),
      );
    const error = await client(fetchImpl)
      .lookup(identity)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MtdomPatientsReadError);
    expect(error).toMatchObject({ code: 'AUTH_BLOCKED', retryable: false });
    expect((error as Error).message).not.toContain('credential detail');
  });

  it('honors a bounded Retry-After value for a gateway 429', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response(
          429,
          { ok: false, error: 'RATE_LIMITED', message: 'synthetic' },
          { 'retry-after': '2' },
        ),
      );
    const error = await client(fetchImpl)
      .lookup(identity)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'RATE_LIMITED', retryable: true, retryAfterMs: 2000 });
  });

  it('classifies server and timeout failures as transient without retaining raw errors', async () => {
    const serverClient = client(vi.fn<typeof fetch>().mockResolvedValue(response(503, {})));
    const serverError = await serverClient.lookup(identity).catch((caught: unknown) => caught);
    expect(serverError).toMatchObject({ code: 'REMOTE_SERVER_ERROR', retryable: true });

    const fetchTimeout: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('synthetic secret and identity')),
        );
      });
    const timeoutError = await client(fetchTimeout)
      .lookup(identity)
      .catch((caught: unknown) => caught);
    expect(timeoutError).toMatchObject({ code: 'TIMEOUT', retryable: true });
    expect((timeoutError as Error).message).not.toContain('synthetic secret');
  });

  it('rejects malformed, unexpected and misconfigured responses without logging their content', async () => {
    const unexpected = client(
      vi.fn<typeof fetch>().mockResolvedValue(
        response(200, {
          ok: true,
          data: { ...syntheticPatient, extra_personal_field: 'synthetic' },
        }),
      ),
    );
    await expect(unexpected.lookup(identity)).rejects.toMatchObject({
      code: 'INVALID_SUCCESS_RESPONSE',
      retryable: false,
    });

    expect(
      () =>
        new MtdomPatientsReadClient({
          token: 'synthetic',
          timeoutMs: 100,
          baseUrl: 'https://attacker.example',
          fetchImpl: vi.fn<typeof fetch>(),
        }),
    ).toThrow('MTDOM_INVALID_BASE_URL');
  });
});
