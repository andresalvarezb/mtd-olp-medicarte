import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@authorization/config';
import { MipresHttpAdapter, normalizeDirections, redactToken } from './mipres-http-adapter';
import { MipresQueryError, MipresTokenProvider } from './mipres-token-provider';

const baseConfig = {
  MIPRES_BASE_URL: 'http://localhost:0',
  MIPRES_NIT: '900123456',
  MIPRES_INITIAL_TOKEN: 'initial-secret',
  MIPRES_TIMEOUT_MS: 2000,
  MIPRES_HTTP_RETRIES: 1,
  MIPRES_CIRCUIT_BREAKER_THRESHOLD: 5,
  MIPRES_CIRCUIT_BREAKER_COOLDOWN_MS: 30_000,
} as WorkerConfig;

let server: Server;
let serverUrl = 'http://localhost:0';
let requestCount = 0;
let mode: 'ok' | 'unauthorized' | 'server-error' | 'malformed' | 'timeout' = 'ok';

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    requestCount += 1;
    if (url.pathname.startsWith('/api/GenerarToken/')) {
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments[3] === baseConfig.MIPRES_INITIAL_TOKEN) {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('operative-token');
        return;
      }
      response.writeHead(401);
      response.end();
      return;
    }
    if (mode === 'timeout') {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('[]');
      }, 1000);
      return;
    }
    if (mode === 'unauthorized') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ token: 'leak-attempt' }));
      return;
    }
    if (mode === 'server-error') {
      // Falla una vez y se recupera: verifica el reintento con backoff.
      mode = 'ok';
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'boom' }));
      return;
    }
    if (mode === 'malformed') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('not-json{');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify([
        {
          ID: 'ext-1',
          IDDireccionamiento: 'dir-1',
          NoPrescripcion: '20260915123',
          TipoTec: 'M',
          ConTec: '1',
          FecMaxEnt: '31/01/2030',
          EstDireccionamiento: 'ACTIVO',
          FecAnulacion: '',
          tokenGenerado: 'should-be-redacted',
        },
      ]),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address && typeof address === 'object') serverUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function createAdapter(overrides: Partial<WorkerConfig> = {}): MipresHttpAdapter {
  return new MipresHttpAdapter(
    { ...baseConfig, MIPRES_BASE_URL: serverUrl, ...overrides },
    new MipresTokenProvider({ ...baseConfig, MIPRES_BASE_URL: serverUrl, ...overrides }),
  );
}

describe('MipresHttpAdapter', () => {
  it('normalizes official MIPRES fields into the internal model and redacts tokens', async () => {
    const adapter = createAdapter();
    const result = await adapter.getDirectionsByPrescription('20260915123');
    expect(result.httpStatus).toBe(200);
    expect(result.directions).toHaveLength(1);
    const direction = result.directions[0];
    expect(direction).toMatchObject({
      externalId: 'ext-1',
      directionId: 'dir-1',
      prescriptionNumber: '20260915123',
      maximumDeliveryDate: '2030-01-31',
      annulled: false,
    });
    expect(JSON.stringify(result.rawPayload)).not.toContain('should-be-redacted');
    expect(JSON.stringify(result.rawPayload)).toContain('[REDACTED]');
  });

  it('retries retryable server errors and succeeds afterwards', async () => {
    const adapter = createAdapter();
    mode = 'server-error';
    requestCount = 0;
    const result = await adapter.getDirectionsByPrescription('20260915123');
    expect(result.httpStatus).toBe(200);
    expect(result.directions).toHaveLength(1);
    expect(requestCount).toBeGreaterThanOrEqual(2);
    mode = 'ok';
  });

  it('surfaces non-retryable status codes as business query errors', async () => {
    const adapter = createAdapter();
    mode = 'unauthorized';
    await expect(adapter.getDirectionsByPrescription('20260915123')).rejects.toMatchObject({
      name: 'MipresQueryError',
      reason: 'UNAUTHORIZED',
      httpStatus: 401,
    });
    mode = 'ok';
  });

  it('does not retry a non-retryable HTTP status', async () => {
    const fetchFn: typeof fetch = vi.fn((input) => {
      const url = String(input);
      if (url.includes('/api/GenerarToken/'))
        return Promise.resolve(new Response('operative-token', { status: 200 }));
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'bad request' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    const tokenProvider = new MipresTokenProvider(
      {
        ...baseConfig,
        MIPRES_BASE_URL: serverUrl,
      },
      fetchFn,
    );
    const noRetryAdapter = new MipresHttpAdapter(
      { ...baseConfig, MIPRES_BASE_URL: serverUrl },
      tokenProvider,
      fetchFn,
      () => Promise.resolve(),
    );
    await expect(noRetryAdapter.getDirectionsByPrescription('20260915123')).rejects.toMatchObject({
      reason: 'HTTP_ERROR',
      httpStatus: 400,
    });
    // The provider call plus one direction call is the complete request path.
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('maps a non-interpretable response to a query error', async () => {
    const adapter = createAdapter();
    mode = 'malformed';
    await expect(adapter.getDirectionsByPrescription('20260915123')).rejects.toMatchObject({
      reason: 'INVALID_RESPONSE',
      httpStatus: 200,
    });
    mode = 'ok';
  });

  it('maps a request timeout to a query error', async () => {
    const adapter = createAdapter({ MIPRES_TIMEOUT_MS: 100 });
    mode = 'timeout';
    await expect(adapter.getDirectionsByPrescription('20260915123')).rejects.toMatchObject({
      reason: 'TIMEOUT',
      httpStatus: null,
    });
    mode = 'ok';
  });

  it('treats HTTP 204 as a successful empty direction result', async () => {
    const fetchFn: typeof fetch = vi.fn((input) => {
      if (String(input).includes('/api/GenerarToken/'))
        return Promise.resolve(new Response('operative-token', { status: 200 }));
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    const tokenProvider = new MipresTokenProvider(
      { ...baseConfig, MIPRES_BASE_URL: serverUrl },
      fetchFn,
    );
    const adapter = new MipresHttpAdapter(
      { ...baseConfig, MIPRES_BASE_URL: serverUrl },
      tokenProvider,
      fetchFn,
      () => Promise.resolve(),
    );
    await expect(adapter.getDirectionsByPrescription('20260915123')).resolves.toEqual({
      directions: [],
      httpStatus: 204,
      rawPayload: null,
    });
  });

  it('opens the circuit breaker after repeated failures', async () => {
    const adapter = createAdapter({ MIPRES_CIRCUIT_BREAKER_THRESHOLD: 1 });
    mode = 'unauthorized';
    await expect(adapter.getDirectionsByPrescription('1')).rejects.toBeInstanceOf(MipresQueryError);
    await expect(adapter.getDirectionsByPrescription('1')).rejects.toMatchObject({
      reason: 'CIRCUIT_OPEN',
    });
    mode = 'ok';
  });
});

describe('normalizeDirections and redactToken', () => {
  it('treats a FecAnulacion value or ANULADO status as annulled', () => {
    const directions = normalizeDirections('20260915123', [
      {
        ID: 'ext-a',
        IDDireccionamiento: 'a',
        NoPrescripcion: '20260915123',
        TipoTec: 'M',
        ConTec: '1',
        FecMaxEnt: '2030-01-31',
        EstDireccionamiento: 'ACTIVO',
        FecAnulacion: '01/01/2026',
      },
      {
        ID: 'ext-b',
        IDDireccionamiento: 'b',
        NoPrescripcion: '20260915123',
        TipoTec: 'M',
        ConTec: '1',
        FecMaxEnt: '31/01/2030',
        EstDireccionamiento: 'ANULADO',
        FecAnulacion: '',
      },
    ]);
    expect(directions?.map((entry) => entry.annulled)).toEqual([true, true]);
  });

  it('rejects payloads with unexpected shapes or invalid dates', () => {
    expect(normalizeDirections('p', { unexpected: true })).toBeNull();
    expect(
      normalizeDirections('p', [{ IDDireccionamiento: 'a', FecMaxEnt: '31-01-2030' }]),
    ).toBeNull();
  });

  it('redacts token fields inside nested payloads', () => {
    expect(redactToken({ nested: { accessToken: 'secret', ok: 1 } })).toEqual({
      nested: { accessToken: '[REDACTED]', ok: 1 },
    });
  });
});
