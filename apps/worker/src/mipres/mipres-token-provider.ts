import type { WorkerConfig } from '@authorization/config';
import type {
  MipresPort as MipresPortContract,
  MipresQueryResult as MipresQueryResultContract,
} from '@authorization/domain';

/**
 * Obtiene y renueva el token operativo de MIPRES (DEC-013). El token vive solo
 * en memoria del worker; nunca se expone al frontend ni se registra completo
 * en logs o evidencia persistida.
 */
export class MipresTokenProvider {
  private cachedToken: string | null = null;

  constructor(
    private readonly config: WorkerConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  hasToken(): boolean {
    return this.cachedToken !== null;
  }

  invalidate(): void {
    this.cachedToken = null;
  }

  async getToken(): Promise<string> {
    if (this.cachedToken) return this.cachedToken;
    const { MIPRES_BASE_URL, MIPRES_NIT, MIPRES_INITIAL_TOKEN, MIPRES_TIMEOUT_MS } = this.config;
    if (!MIPRES_BASE_URL || !MIPRES_NIT || !MIPRES_INITIAL_TOKEN) {
      throw new MipresNotConfiguredError();
    }
    try {
      const response = await this.fetchFn(
        `${MIPRES_BASE_URL}/api/GenerarToken/${encodeURIComponent(MIPRES_NIT)}/${encodeURIComponent(MIPRES_INITIAL_TOKEN)}`,
        { signal: AbortSignal.timeout(MIPRES_TIMEOUT_MS) },
      );
      if (!response.ok) {
        throw new MipresQueryError('TOKEN_ERROR', response.status, 'Token generation failed');
      }
      const body = (await response.text()).trim();
      const token = parseTokenResponse(body);
      if (!token)
        throw new MipresQueryError('TOKEN_ERROR', response.status, 'Empty token response');
      this.cachedToken = token;
      return this.cachedToken;
    } catch (error) {
      if (error instanceof MipresQueryError) throw error;
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new MipresQueryError('TIMEOUT', null, 'MIPRES token request timed out');
      }
      throw new MipresQueryError('NETWORK', null, 'MIPRES token request failed');
    }
  }

  async withValidToken<T>(operation: (token: string) => Promise<T>): Promise<T> {
    try {
      return await operation(await this.getToken());
    } catch (error) {
      const recoverable =
        error instanceof MipresQueryError &&
        error.reason === 'UNAUTHORIZED' &&
        this.cachedToken !== null;
      if (!recoverable) throw error;
      this.invalidate();
      return operation(await this.getToken());
    }
  }
}

export class MipresNotConfiguredError extends Error {
  readonly reason = 'NOT_CONFIGURED' as const;

  constructor() {
    super('MIPRES integration is not configured');
    this.name = 'MipresNotConfiguredError';
  }
}

/**
 * Puerto de reemplazo cuando la integración no está configurada: cualquier
 * consulta falla de forma explícita y visible (SPEC-010/SPEC-003).
 */
export class MipresNotConfiguredPort implements MipresPortContract {
  getDirectionsByPrescription(): Promise<MipresQueryResultContract> {
    throw new MipresNotConfiguredError();
  }
}

export class MipresQueryError extends Error {
  readonly reason:
    | 'UNAUTHORIZED'
    | 'HTTP_ERROR'
    | 'INVALID_RESPONSE'
    | 'NETWORK'
    | 'TIMEOUT'
    | 'CIRCUIT_OPEN'
    | 'TOKEN_ERROR';

  readonly httpStatus: number | null;

  constructor(
    reason:
      | 'UNAUTHORIZED'
      | 'HTTP_ERROR'
      | 'INVALID_RESPONSE'
      | 'NETWORK'
      | 'TIMEOUT'
      | 'CIRCUIT_OPEN'
      | 'TOKEN_ERROR',
    httpStatus: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'MipresQueryError';
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

function parseTokenResponse(body: string): string | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
  } catch {
    // MIPRES may return the operative token as plain text.
  }
  return body;
}
