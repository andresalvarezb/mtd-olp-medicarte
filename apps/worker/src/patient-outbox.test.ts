import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FOUNDATION_QUEUE,
  PATIENT_LOOKUP_JOB_NAME,
  PATIENT_LOOKUP_OUTBOX_EVENT_TYPE,
  REALTIME_OUTBOX_EVENT_TYPE,
  REALTIME_REDIS_CHANNEL,
} from '@authorization/contracts';
import type { PatientIdentityNormalizationPolicy } from '@authorization/domain';
import { WorkerService } from './worker.service';
import {
  PatientLookupRetryableError,
  PatientLookupTerminalError,
} from './patient-lookup-processing';
import { MtdomPatientLookupProcessor } from './mtdom-patient-lookup.processor';
import { MtdomPatientsReadClient } from './mtdom-patients-read.client';

const transport = vi.hoisted(() => ({
  addCalls: [] as Array<{ name: string; data: unknown; options: Record<string, unknown> }>,
  jobs: new Map<
    string,
    {
      data: unknown;
      name: string;
      attemptsMade: number;
      opts: { attempts?: number };
      failedReason: string;
      getState: () => Promise<string>;
    }
  >(),
  publishCalls: [] as Array<{ channel: string; message: string }>,
  queueNames: [] as string[],
  processor: undefined as unknown,
  failedHandler: undefined as unknown,
  workerSettings: undefined as unknown,
}));

vi.mock('bullmq', () => {
  class QueueMock {
    constructor(queueName: string) {
      transport.queueNames.push(queueName);
    }
    async add(name: string, data: unknown, options: Record<string, unknown>) {
      await Promise.resolve();
      transport.addCalls.push({ name, data, options });
      const jobId = String(options.jobId);
      transport.jobs.set(jobId, {
        name,
        data,
        attemptsMade: 0,
        opts: { attempts: Number(options.attempts) },
        failedReason: '',
        getState: async () => {
          await Promise.resolve();
          return 'waiting';
        },
      });
      return {};
    }
    async getJob(jobId: string) {
      await Promise.resolve();
      return transport.jobs.get(jobId) ?? null;
    }
    async close() {}
  }
  class QueueEventsMock {
    on(event: string, handler: unknown) {
      if (event === 'failed') transport.failedHandler = handler;
      return this;
    }
    async close() {}
  }
  class WorkerMock {
    constructor(_queue: string, processor: unknown, options?: { settings?: unknown }) {
      transport.processor = processor;
      transport.workerSettings = options?.settings;
    }
    on() {
      return this;
    }
    async close() {}
  }
  return { Queue: QueueMock, QueueEvents: QueueEventsMock, Worker: WorkerMock };
});

vi.mock('ioredis', () => ({
  default: class RedisMock {
    duplicate() {
      return new RedisMock();
    }
    async publish(channel: string, message: string) {
      await Promise.resolve();
      transport.publishCalls.push({ channel, message });
      return 1;
    }
    async quit() {
      await Promise.resolve();
      return 'OK';
    }
  },
}));

type MemoryEvent = {
  id: string;
  event_type: string;
  version: number;
  payload: unknown;
  correlation_id: string;
  organization_id: string | null;
  idempotency_key: string;
  created_at: Date;
  status: string;
  attempts: number;
  processing_attempts: number;
  availableAt: number;
  dispatchedAt: number;
  processedAt?: Date;
  lastError?: string | null;
};

const patientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const eventId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const correlationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const organizationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const exactSyntheticPolicy: PatientIdentityNormalizationPolicy = {
  version: 'SYNTHETIC_EXACT_TEST_V1',
  normalizeDocumentType: (value) => value,
  normalizeDocumentValue: (value) => value,
};
function patientEvent(overrides: Partial<MemoryEvent> = {}): MemoryEvent {
  return {
    id: eventId,
    event_type: PATIENT_LOOKUP_OUTBOX_EVENT_TYPE,
    version: 1,
    payload: { patientId },
    correlation_id: correlationId,
    organization_id: organizationId,
    idempotency_key: `patient.lookup.v1:${patientId}`,
    created_at: new Date(),
    status: 'PENDING',
    attempts: 0,
    processing_attempts: 0,
    availableAt: Date.now() - 1,
    dispatchedAt: 0,
    ...overrides,
  };
}

function createHarness(
  events: MemoryEvent[],
  processor?: { execute: (input: { patientId: string }) => Promise<unknown> },
) {
  transport.addCalls.length = 0;
  transport.jobs.clear();
  transport.publishCalls.length = 0;
  transport.queueNames.length = 0;
  transport.processor = undefined;
  transport.failedHandler = undefined;
  transport.workerSettings = undefined;
  const results = new Map<string, unknown>();
  const databaseUpdates: Array<Record<string, unknown>> = [];
  const patientUpdates: Array<{ patientId: string; status: string; errorCode: string | null }> = [];
  const profileUpdates: Array<{ patientId: string; profile: Record<string, unknown> }> = [];
  const client = {
    query: async (statement: string, params: unknown[] = []) => {
      await Promise.resolve();
      const query = statement.trim().replace(/\s+/g, ' ').toLowerCase();
      if (query === 'begin' || query === 'commit' || query === 'rollback')
        return { rows: [], rowCount: 0 };
      if (query.startsWith('select id, event_type')) {
        const row = events.find(
          (item) => item.status === 'PENDING' && item.availableAt <= Date.now(),
        );
        return { rows: row ? [{ ...row, created_at: row.created_at }] : [], rowCount: row ? 1 : 0 };
      }
      if (query.startsWith('select status, processing_attempts')) {
        const row = events.find((item) => item.id === params[0]);
        return {
          rows: row ? [{ status: row.status, processing_attempts: row.processing_attempts }] : [],
          rowCount: row ? 1 : 0,
        };
      }
      if (query.startsWith('select identification_type_raw')) {
        return {
          rows: [{ identification_type_raw: 'CC', identification_value_raw: 'SYNTHETIC-0001' }],
          rowCount: 1,
        };
      }
      if (query.startsWith('update patients')) {
        if (query.includes('mtdom_basic_profile')) {
          const incoming = JSON.parse(String(params[1])) as Record<string, unknown>;
          profileUpdates.push({
            patientId: String(params[0]),
            profile: Object.fromEntries(
              Object.entries(incoming).filter(([, value]) => value !== null),
            ),
          });
          return { rows: [], rowCount: 1 };
        }
        patientUpdates.push({
          patientId: String(params[0]),
          status: String(params[1]),
          errorCode: typeof params[2] === 'string' ? params[2] : null,
        });
        return { rows: [], rowCount: 1 };
      }
      if (query.startsWith('select 1 from job_results')) {
        const exists = results.has(String(params[1]));
        return { rows: exists ? [{ '?column?': 1 }] : [], rowCount: exists ? 1 : 0 };
      }
      if (query.startsWith('update outbox_events')) {
        const row = events.find((item) => item.id === params[0]);
        if (!row) return { rows: [], rowCount: 0 };
        if (query.includes("last_error = 'patient_lookup_invalid_event'"))
          row.lastError = 'PATIENT_LOOKUP_INVALID_EVENT';
        if (query.includes("last_error = 'unsupported legacy event; no active processor'"))
          row.lastError = 'Unsupported legacy event; no active processor';
        for (const code of [
          'PATIENT_LOOKUP_INVALID_EVENT',
          'PATIENT_LOOKUP_PROCESSOR_UNAVAILABLE',
        ]) {
          if (query.includes(`last_error = '${code.toLowerCase()}'`)) row.lastError = code;
        }
        if (query.includes("set status = 'dispatched'")) {
          row.status = 'DISPATCHED';
          row.attempts += 1;
          row.dispatchedAt = Date.now();
        } else if (query.includes('processing_attempts = processing_attempts + 1')) {
          row.processing_attempts += 1;
          return { rows: [{ processing_attempts: row.processing_attempts }], rowCount: 1 };
        } else if (query.includes("set status = case when $2 then 'failed'")) {
          if (params[1] === true) row.status = 'FAILED';
          else row.availableAt = Date.now() + Number(params[2]);
          row.lastError = String(params[3]);
        } else if (query.includes("set status = 'processed'")) {
          row.status = 'PROCESSED';
          row.processedAt = new Date();
          row.lastError = null;
        } else if (query.includes("set status = 'failed'")) {
          row.status = 'FAILED';
          if (typeof params[1] === 'string') row.lastError = params[1];
        }
        return { rows: [], rowCount: 1 };
      }
      if (query.startsWith('insert into job_results')) {
        results.set(String(params[2]), JSON.parse(String(params[3])));
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected synthetic SQL: ${query}`);
    },
    release: () => undefined,
  };
  const database = {
    pool: {
      query: client.query,
      connect: async () => {
        await Promise.resolve();
        return client;
      },
      end: async () => {
        await Promise.resolve();
      },
    },
    db: {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: async () => {
            await Promise.resolve();
          },
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            await Promise.resolve();
            databaseUpdates.push(values);
          },
        }),
      }),
    },
  };
  const config = { LOG_LEVEL: 'silent', REDIS_URL: 'redis://synthetic', SCHEDULER_ENABLED: false };
  const service = new WorkerService(config as never, database as never, processor as never);
  return {
    service,
    events,
    results,
    databaseUpdates,
    patientUpdates,
    profileUpdates,
    database,
    client,
  };
}

function dispatch(service: WorkerService): Promise<void> {
  return (service as unknown as { dispatchOutbox(): Promise<void> }).dispatchOutbox();
}

function runWorker(data: unknown, attemptsMade = 0) {
  const processor = transport.processor as ((job: unknown) => Promise<unknown>) | undefined;
  if (!processor) throw new Error('synthetic worker processor was not registered');
  return processor({ data, attemptsMade, opts: { attempts: 3 } });
}

function syntheticMtdomPatient(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('patient event outbox on synthetic transport', () => {
  it('runs outbox → worker → MTDOM client → identity validation and persists only the basic allowlist outside job results', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: syntheticMtdomPatient(),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const harness = createHarness([patientEvent()]);
    const processor = new MtdomPatientLookupProcessor(
      harness.database as never,
      new MtdomPatientsReadClient({
        token: 'mtdpat_synthetic-only',
        timeoutMs: 500,
        fetchImpl,
      }),
      exactSyntheticPolicy,
    );
    const service = new WorkerService(
      { LOG_LEVEL: 'silent', REDIS_URL: 'redis://synthetic', SCHEDULER_ENABLED: false } as never,
      harness.database as never,
      processor,
    );

    await dispatch(service);
    await runWorker(transport.addCalls[0]?.data);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const requestBody = fetchImpl.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    expect(JSON.parse(requestBody as string)).toEqual({
      tipo_identificacion: 'CC',
      identificacion: 'SYNTHETIC-0001',
      profile: 'basic',
    });
    expect(harness.events[0]?.status).toBe('PROCESSED');
    expect([...harness.results.values()]).toEqual([{ outcome: 'MATCHED_PENDING_APPROVAL' }]);
    expect(harness.patientUpdates).toEqual([
      {
        patientId,
        status: 'MATCHED_PENDING_APPROVAL',
        errorCode: null,
      },
    ]);
    expect(harness.profileUpdates).toHaveLength(1);
    expect(harness.profileUpdates[0]?.profile).toMatchObject({
      tipo_identificacion: 'CC',
      identificacion: 'SYNTHETIC-0001',
      primer_nombre: 'PACIENTE',
    });
    expect(harness.profileUpdates[0]?.profile).not.toHaveProperty('fecha_nacimiento');
    expect(harness.profileUpdates[0]?.profile).not.toHaveProperty('segundo_nombre');
    const persisted = JSON.stringify({
      results: [...harness.results.values()],
      updates: harness.patientUpdates,
    });
    expect(persisted).not.toContain('SYNTHETIC-0001');
    expect(persisted).not.toContain('PACIENTE');
  });

  it('records a conflict and never applies a profile with a discordant identity', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: syntheticMtdomPatient({ identificacion: 'OTHER-SYNTHETIC' }),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const harness = createHarness([patientEvent()]);
    const processor = new MtdomPatientLookupProcessor(
      harness.database as never,
      new MtdomPatientsReadClient({ token: 'mtdpat_synthetic-only', timeoutMs: 500, fetchImpl }),
      exactSyntheticPolicy,
    );
    const service = new WorkerService(
      { LOG_LEVEL: 'silent', REDIS_URL: 'redis://synthetic', SCHEDULER_ENABLED: false } as never,
      harness.database as never,
      processor,
    );

    await dispatch(service);
    await runWorker(transport.addCalls[0]?.data);

    expect(harness.events[0]?.status).toBe('PROCESSED');
    expect([...harness.results.values()]).toEqual([{ outcome: 'IDENTITY_MISMATCH' }]);
    expect(harness.patientUpdates).toEqual([
      {
        patientId,
        status: 'IDENTITY_MISMATCH',
        errorCode: 'PATIENT_IDENTITY_MISMATCH',
      },
    ]);
    expect(harness.profileUpdates).toEqual([]);
  });

  it.each([
    { status: 404, code: 'PATIENT_NOT_FOUND', outcome: 'NOT_FOUND', patientStatus: 'NOT_FOUND' },
    {
      status: 409,
      code: 'AMBIGUOUS_PATIENT_IDENTITY',
      outcome: 'AMBIGUOUS',
      patientStatus: 'AMBIGUOUS',
    },
  ] as const)(
    'persists the non-retryable MTDOM $status domain outcome',
    async ({ status, code, outcome, patientStatus }) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error: code,
            message: 'synthetic domain message',
          }),
          { status, headers: { 'content-type': 'application/json' } },
        ),
      );
      const harness = createHarness([patientEvent()]);
      const processor = new MtdomPatientLookupProcessor(
        harness.database as never,
        new MtdomPatientsReadClient({ token: 'mtdpat_synthetic-only', timeoutMs: 500, fetchImpl }),
        exactSyntheticPolicy,
      );
      const service = new WorkerService(
        { LOG_LEVEL: 'silent', REDIS_URL: 'redis://synthetic', SCHEDULER_ENABLED: false } as never,
        harness.database as never,
        processor,
      );

      await dispatch(service);
      await runWorker(transport.addCalls[0]?.data);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(harness.events[0]?.status).toBe('PROCESSED');
      expect([...harness.results.values()]).toEqual([{ outcome }]);
      expect(harness.patientUpdates[0]).toMatchObject({ patientId, status: patientStatus });
    },
  );

  it('blocks automatic retries on MTDOM 401/403 and records only a safe technical code', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: 'UNAUTHORIZED',
          message: 'secret synthetic credential detail',
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    );
    const harness = createHarness([patientEvent()]);
    const processor = new MtdomPatientLookupProcessor(
      harness.database as never,
      new MtdomPatientsReadClient({ token: 'mtdpat_synthetic-only', timeoutMs: 500, fetchImpl }),
      exactSyntheticPolicy,
    );
    const service = new WorkerService(
      { LOG_LEVEL: 'silent', REDIS_URL: 'redis://synthetic', SCHEDULER_ENABLED: false } as never,
      harness.database as never,
      processor,
    );

    await dispatch(service);
    await runWorker(transport.addCalls[0]?.data);

    expect(harness.events[0]?.status).toBe('FAILED');
    expect(harness.events[0]?.lastError).toBe('PATIENT_LOOKUP_AUTH_BLOCKED');
    expect(harness.patientUpdates).toEqual([
      {
        patientId,
        status: 'AUTH_BLOCKED',
        errorCode: 'PATIENT_LOOKUP_AUTH_BLOCKED',
      },
    ]);
    expect(harness.results.size).toBe(0);
  });

  it('honors MTDOM Retry-After in the durable schedule and BullMQ backoff strategy', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: 'RATE_LIMITED', message: 'synthetic' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '4' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: syntheticMtdomPatient() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const harness = createHarness([patientEvent()]);
    const processor = new MtdomPatientLookupProcessor(
      harness.database as never,
      new MtdomPatientsReadClient({ token: 'mtdpat_synthetic-only', timeoutMs: 500, fetchImpl }),
      exactSyntheticPolicy,
    );
    const service = new WorkerService(
      { LOG_LEVEL: 'silent', REDIS_URL: 'redis://synthetic', SCHEDULER_ENABLED: false } as never,
      harness.database as never,
      processor,
    );

    await dispatch(service);
    const queued = transport.addCalls[0]?.data;
    await expect(runWorker(queued)).rejects.toMatchObject({
      message: 'PATIENT_LOOKUP_RETRYABLE_FAILURE',
    });
    expect(harness.events[0]?.availableAt).toBeGreaterThan(Date.now() + 3000);
    expect(harness.events[0]?.lastError).toBe('PATIENT_LOOKUP_RETRYABLE_FAILURE');
    const settings = transport.workerSettings as {
      backoffStrategy: (attemptsMade: number, type: string, error: Error) => number;
    };
    const bullDelay = settings.backoffStrategy(
      1,
      'patient-lookup',
      new PatientLookupRetryableError(4000),
    );
    expect(bullDelay).toBeGreaterThanOrEqual(4000);

    await runWorker(queued);
    expect(harness.events[0]?.status).toBe('PROCESSED');
    expect([...harness.results.values()]).toEqual([{ outcome: 'MATCHED_PENDING_APPROVAL' }]);
  });

  it('dispatches into the existing foundation queue and records success only after processing', async () => {
    let processorCalls = 0;
    const harness = createHarness([patientEvent()], {
      execute: async (input) => {
        await Promise.resolve();
        processorCalls += 1;
        expect(input).toEqual({ patientId });
        return { outcome: 'SIMULATED_MATCH' };
      },
    });

    await dispatch(harness.service);
    expect(transport.queueNames).toContain(FOUNDATION_QUEUE);
    expect(transport.queueNames).not.toContain('patient.lookup');
    expect(transport.addCalls).toHaveLength(1);
    expect(transport.addCalls[0]?.name).toBe(PATIENT_LOOKUP_JOB_NAME);
    expect(transport.addCalls[0]?.options.attempts).toBe(3);
    expect(harness.events[0]?.status).toBe('DISPATCHED');
    expect(harness.results.size).toBe(0);

    await runWorker(transport.addCalls[0]?.data);
    expect(processorCalls).toBe(1);
    expect(harness.events[0]?.status).toBe('PROCESSED');
    expect(harness.events[0]?.processing_attempts).toBe(1);
    expect([...harness.results.values()]).toEqual([{ outcome: 'SIMULATED_MATCH' }]);
    expect(JSON.stringify([...harness.results.values()])).not.toContain(patientId);

    await runWorker(transport.addCalls[0]?.data);
    expect(processorCalls).toBe(1);
    expect(harness.results.size).toBe(1);
  });

  it('retries transient errors with deferred availability and persists only a safe code', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('sensitive synthetic document leaked by client'))
      .mockResolvedValueOnce({ outcome: 'SIMULATED_MATCH' });
    const harness = createHarness([patientEvent()], { execute });
    await dispatch(harness.service);
    const queued = transport.addCalls[0]!.data;

    await expect(runWorker(queued)).rejects.toMatchObject({
      message: 'PATIENT_LOOKUP_RETRYABLE_FAILURE',
    });
    expect(harness.events[0]?.processing_attempts).toBe(1);
    expect(harness.events[0]?.status).toBe('DISPATCHED');
    expect(harness.events[0]?.lastError).toBe('PATIENT_LOOKUP_RETRYABLE_FAILURE');
    expect(harness.events[0]!.availableAt).toBeGreaterThan(Date.now());
    expect(harness.results.size).toBe(0);
    expect(harness.events[0]?.lastError).not.toContain('sensitive');

    await runWorker(queued);
    expect(harness.events[0]?.status).toBe('PROCESSED');
    expect(harness.events[0]?.processing_attempts).toBe(2);
  });

  it('coalesces concurrent duplicate deliveries in one worker process', async () => {
    let processorCalls = 0;
    let releaseProcessor!: () => void;
    const processorGate = new Promise<void>((resolve) => {
      releaseProcessor = resolve;
    });
    const harness = createHarness([patientEvent()], {
      execute: async () => {
        processorCalls += 1;
        await processorGate;
        return { outcome: 'SIMULATED_MATCH' };
      },
    });
    await dispatch(harness.service);
    const queued = transport.addCalls[0]?.data;
    const first = runWorker(queued);
    const second = runWorker(queued);
    releaseProcessor();
    await Promise.all([first, second]);
    expect(processorCalls).toBe(1);
    expect(harness.events[0]?.processing_attempts).toBe(1);
    expect(harness.results.size).toBe(1);
  });

  it('discards a stale lookup response after a newer processing attempt takes ownership', async () => {
    const events = [patientEvent()];
    const harness = createHarness(events, {
      execute: () => {
        // Model another worker taking ownership while this request is outside
        // the database transaction and incrementing the durable fencing token.
        events[0]!.processing_attempts += 1;
        return Promise.resolve({ outcome: 'NOT_FOUND' });
      },
    });
    await dispatch(harness.service);
    await runWorker(transport.addCalls[0]?.data);

    expect(harness.events[0]?.status).toBe('DISPATCHED');
    expect(harness.patientUpdates).toHaveLength(0);
    expect(harness.results.size).toBe(0);
  });

  it('marks the event terminal without a result when no processor is configured', async () => {
    const harness = createHarness([patientEvent()]);
    await dispatch(harness.service);
    await runWorker(transport.addCalls[0]?.data);
    expect(harness.events[0]?.status).toBe('FAILED');
    expect(harness.events[0]?.lastError).toBe('PATIENT_LOOKUP_PROCESSOR_UNAVAILABLE');
    expect(harness.results.size).toBe(0);
  });

  it('stops on terminal processor errors without retrying or storing a result', async () => {
    const harness = createHarness([patientEvent()], {
      execute: async () => {
        await Promise.resolve();
        throw new PatientLookupTerminalError();
      },
    });
    await dispatch(harness.service);
    await runWorker(transport.addCalls[0]?.data);
    expect(harness.events[0]?.status).toBe('FAILED');
    expect(harness.events[0]?.lastError).toBe('PATIENT_LOOKUP_TERMINAL_FAILURE');
    expect(harness.events[0]?.processing_attempts).toBe(1);
    expect(harness.results.size).toBe(0);
  });

  it('enforces the attempt cap and removes the patient id from the dead-letter payload', async () => {
    const harness = createHarness([patientEvent()], {
      execute: async () => {
        await Promise.resolve();
        throw new Error('sensitive synthetic error');
      },
    });
    await dispatch(harness.service);
    const queued = transport.addCalls[0]!;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(runWorker(queued.data, attempt)).rejects.toThrow(
        'PATIENT_LOOKUP_RETRYABLE_FAILURE',
      );
    }
    expect(harness.events[0]?.processing_attempts).toBe(3);
    expect(harness.events[0]?.status).toBe('FAILED');
    const jobId = String(queued.options.jobId);
    const job = transport.jobs.get(jobId)!;
    job.attemptsMade = 3;
    await (
      harness.service as unknown as {
        moveToDeadLetter(id: string, reason: string): Promise<void>;
      }
    ).moveToDeadLetter(jobId, 'raw sensitive reason');
    expect(harness.databaseUpdates.at(-1)).toMatchObject({
      status: 'FAILED',
      lastError: 'PATIENT_LOOKUP_RETRYABLE_FAILURE',
    });
    const deadLetter = transport.addCalls.at(-1);
    expect(deadLetter?.name).toBe('dead-letter.v1');
    expect(JSON.stringify(deadLetter?.data)).not.toContain(patientId);
    expect(JSON.stringify(deadLetter?.data)).not.toContain('sensitive');
  });

  it('retains realtime and foundation dispatch behavior and isolates unknown events', async () => {
    const foundation = {
      ...patientEvent({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }),
      event_type: 'foundation.event',
      payload: {
        eventId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        message: 'synthetic',
        correlationId,
        idempotencyKey: 'foundation:test',
      },
      idempotency_key: 'foundation:test',
    };
    const realtime = {
      ...patientEvent({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
      event_type: REALTIME_OUTBOX_EVENT_TYPE,
      payload: { topics: ['AUTHORIZATIONS'], resource: null },
    };
    const unknown = {
      ...patientEvent({ id: '99999999-9999-4999-8999-999999999999' }),
      event_type: 'unknown.event',
      payload: {},
    };
    const harness = createHarness([unknown, foundation, realtime]);

    await dispatch(harness.service);

    expect(harness.events[0]?.status).toBe('FAILED');
    expect(harness.events[1]?.status).toBe('DISPATCHED');
    expect(harness.events[2]?.status).toBe('PROCESSED');
    expect(transport.addCalls.some((call) => call.name === 'foundation.event.v1')).toBe(true);
    expect(transport.publishCalls[0]?.channel).toBe(REALTIME_REDIS_CHANNEL);
  });

  it('rejects patient outbox payloads containing identity fields before queueing', async () => {
    const harness = createHarness([
      patientEvent({ payload: { patientId, document: 'synthetic-document' } }),
    ]);
    await dispatch(harness.service);
    expect(harness.events[0]?.status).toBe('FAILED');
    expect(harness.events[0]?.lastError).toBe('PATIENT_LOOKUP_INVALID_EVENT');
    expect(transport.addCalls).toHaveLength(0);
  });
});
