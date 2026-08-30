import type { WorkerConfig } from '@authorization/config';
import type { MipresDirection, MipresPort, MipresQueryResult } from '@authorization/domain';
import {
  MipresNotConfiguredError,
  MipresQueryError,
  type MipresTokenProvider,
} from './mipres-token-provider';

const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

type CircuitState = {
  failures: number;
  openedAt: number | null;
};

/**
 * Adaptador HTTP de MIPRES (WSSUMMIPRESNOPBS, DEC-013). Implementa MipresPort:
 * el dominio nunca conoce los nombres oficiales del proveedor. Aplica timeout,
 * reintentos solo para errores recuperables con backoff exponencial + jitter y
 * circuit breaker. La evidencia devuelta llega sin tokens.
 */
export class MipresHttpAdapter implements MipresPort {
  private readonly circuit: CircuitState = { failures: 0, openedAt: null };

  constructor(
    private readonly config: WorkerConfig,
    private readonly tokenProvider: MipresTokenProvider,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly sleepFn: (ms: number) => Promise<void> = defaultSleep,
    private readonly nowFn: () => number = () => Date.now(),
  ) {}

  async getDirectionsByPrescription(prescriptionNumber: string): Promise<MipresQueryResult> {
    this.assertCircuitClosed();
    try {
      return await this.tokenProvider.withValidToken((token) =>
        this.fetchDirections(prescriptionNumber, token),
      );
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private assertCircuitClosed(): void {
    const { MIPRES_CIRCUIT_BREAKER_THRESHOLD, MIPRES_CIRCUIT_BREAKER_COOLDOWN_MS } = this.config;
    if (this.circuit.failures < MIPRES_CIRCUIT_BREAKER_THRESHOLD) return;
    const cooldownElapsed =
      this.circuit.openedAt === null ||
      this.nowFn() - this.circuit.openedAt >= MIPRES_CIRCUIT_BREAKER_COOLDOWN_MS;
    if (!cooldownElapsed) {
      throw new MipresQueryError('CIRCUIT_OPEN', null, 'MIPRES circuit breaker is open');
    }
    this.circuit.failures = 0;
    this.circuit.openedAt = null;
  }

  private recordFailure(): void {
    this.circuit.failures += 1;
    if (
      this.circuit.failures >= this.config.MIPRES_CIRCUIT_BREAKER_THRESHOLD &&
      this.circuit.openedAt === null
    ) {
      this.circuit.openedAt = this.nowFn();
    }
  }

  private recordSuccess(): void {
    this.circuit.failures = 0;
    this.circuit.openedAt = null;
  }

  private async fetchDirections(
    prescriptionNumber: string,
    token: string,
  ): Promise<MipresQueryResult> {
    const { MIPRES_BASE_URL, MIPRES_NIT } = this.config;
    if (!MIPRES_BASE_URL || !MIPRES_NIT) throw new MipresNotConfiguredError();
    const url = `${MIPRES_BASE_URL}/api/DireccionamientoXPrescripcion/${encodeURIComponent(MIPRES_NIT)}/${encodeURIComponent(token)}/${encodeURIComponent(prescriptionNumber)}`;
    let lastError: MipresQueryError | null = null;
    for (let attempt = 0; attempt <= this.config.MIPRES_HTTP_RETRIES; attempt += 1) {
      if (attempt > 0) {
        await this.sleepFn(retryDelayMs(attempt));
      }
      try {
        const response = await this.fetchFn(url, {
          signal: AbortSignal.timeout(this.config.MIPRES_TIMEOUT_MS),
        });
        if (response.status === 401) {
          throw new MipresQueryError('UNAUTHORIZED', 401, 'MIPRES rejected the token');
        }
        if (response.status === 204) {
          this.recordSuccess();
          return { directions: [], httpStatus: 204, rawPayload: null };
        }
        if (RETRYABLE_HTTP_STATUSES.has(response.status)) {
          lastError = new MipresQueryError(
            'HTTP_ERROR',
            response.status,
            `MIPRES responded with retryable status ${response.status}`,
          );
          continue;
        }
        if (!response.ok) {
          throw new MipresQueryError(
            'HTTP_ERROR',
            response.status,
            `MIPRES responded with status ${response.status}`,
          );
        }
        const result = await this.parseSuccessResponse(prescriptionNumber, response);
        this.recordSuccess();
        return result;
      } catch (error) {
        if (error instanceof MipresQueryError) {
          if (
            error.reason === 'UNAUTHORIZED' ||
            error.reason === 'CIRCUIT_OPEN' ||
            error.reason === 'INVALID_RESPONSE' ||
            error.reason === 'TOKEN_ERROR'
          )
            throw error;
          if (
            error.reason === 'HTTP_ERROR' &&
            !RETRYABLE_HTTP_STATUSES.has(error.httpStatus ?? Number.NaN)
          )
            throw error;
          lastError = error;
          continue;
        }
        if (error instanceof Error && error.name === 'TimeoutError') {
          lastError = new MipresQueryError('TIMEOUT', null, 'MIPRES request timed out');
          continue;
        }
        lastError = new MipresQueryError('NETWORK', null, 'MIPRES request failed');
      }
    }
    throw lastError ?? new MipresQueryError('NETWORK', null, 'MIPRES request failed');
  }

  private async parseSuccessResponse(
    prescriptionNumber: string,
    response: Response,
  ): Promise<MipresQueryResult> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new MipresQueryError(
        'INVALID_RESPONSE',
        response.status,
        'MIPRES response is not interpretable',
      );
    }
    const directions = normalizeDirections(prescriptionNumber, payload);
    if (directions === null) {
      throw new MipresQueryError(
        'INVALID_RESPONSE',
        response.status,
        'MIPRES response has an unexpected shape',
      );
    }
    return {
      directions,
      httpStatus: response.status,
      rawPayload: redactToken(payload),
    };
  }
}

export function normalizeDirections(
  prescriptionNumber: string,
  payload: unknown,
): MipresDirection[] | null {
  if (payload === null || payload === undefined) return [];
  if (!Array.isArray(payload)) return null;
  const directions: MipresDirection[] = [];
  for (const entry of payload) {
    if (entry === null || typeof entry !== 'object') return null;
    const record = entry as Record<string, unknown>;
    const externalId = text(record['ID']);
    const directionId = text(record['IDDireccionamiento']);
    const responsePrescription = text(record['NoPrescripcion']);
    const technologyType = text(record['TipoTec']);
    const technologyConsecutive = text(record['ConTec']);
    const maximumDeliveryDate = normalizeDate(record['FecMaxEnt']);
    const externalStatus = text(record['EstDireccionamiento']);
    if (
      !externalId ||
      !directionId ||
      !responsePrescription ||
      !technologyType ||
      !technologyConsecutive ||
      !maximumDeliveryDate ||
      !externalStatus
    )
      return null;
    directions.push({
      externalId,
      directionId,
      prescriptionNumber: responsePrescription,
      technologyType,
      technologyConsecutive,
      maximumDeliveryDate,
      externalStatus,
      annulled:
        text(record['FecAnulacion']) !== null ||
        (text(record['EstDireccionamiento']) ?? '').toUpperCase() === 'ANULADO',
    });
  }
  return directions;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return `${value}`;
  return null;
}

/** Acepta DD/MM/YYYY (formato MIPRES) e ISO YYYY-MM-DD; devuelve ISO. */
export function normalizeDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const [, isoYear, isoMonth, isoDay] = iso ?? [];
  if (isoYear && isoMonth && isoDay && isValidDate(isoYear, isoMonth, isoDay)) return raw;
  const local = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const [, localDay, localMonth, localYear] = local ?? [];
  if (localDay && localMonth && localYear && isValidDate(localYear, localMonth, localDay)) {
    const day = localDay;
    const month = localMonth;
    const year = localYear;
    return `${year}-${month}-${day}`;
  }
  return null;
}

function isValidDate(year: string, month: string, day: string): boolean {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

export function redactToken(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.map(redactToken);
  if (payload && typeof payload === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      result[key] = /token/i.test(key) ? '[REDACTED]' : redactToken(value);
    }
    return result;
  }
  return payload;
}

function retryDelayMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** (attempt - 1), 8000);
  return base + Math.floor(Math.random() * 250);
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class MipresFakeAdapter implements MipresPort {
  constructor(
    private readonly responses: Array<{
      prescriptionSuffix: string;
      result: () => MipresQueryResult | Promise<MipresQueryResult>;
    }>,
    private readonly fallback: () => MipresQueryResult = () => ({
      directions: [],
      httpStatus: 200,
      rawPayload: [],
    }),
  ) {}

  async getDirectionsByPrescription(prescriptionNumber: string): Promise<MipresQueryResult> {
    const suffix = prescriptionNumber.slice(-1);
    const match = this.responses.find((entry) => entry.prescriptionSuffix === suffix);
    if (!match) return this.fallback();
    return match.result();
  }
}
