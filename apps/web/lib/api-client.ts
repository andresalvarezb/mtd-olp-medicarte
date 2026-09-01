import { SESSION_EXPIRED_EVENT, clearSession, getAccessToken } from './auth';
import { API_BASE_URL } from './config';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId: string | null;
  readonly fields: Record<string, string[]> | null;

  constructor(status: number, code: string, message: string, correlationId: string | null, fields: Record<string, string[]> | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.fields = fields;
  }
}

interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | undefined;
  organizationId?: string | undefined;
  body?: BodyInit | undefined;
  idempotencyKey?: string | undefined;
  signal?: AbortSignal | undefined;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.organizationId) headers['X-Organization-Id'] = options.organizationId;
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: options.body } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'No fue posible contactar la API. Verifica que la plataforma esté levantada.', null, null);
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiError(response.status, `HTTP_${response.status}`, response.statusText || 'Error inesperado de la API', null, null);
    }
    return (await response.blob()) as T;
  }

  const payload = (await response.json().catch(() => null)) as
    | (T & { code?: string; message?: string; correlationId?: string; fields?: Record<string, string[]> })
    | null;

  if (!response.ok) {
    const code = payload?.code ?? `HTTP_${response.status}`;
    // ADR-026: un 401 de la API (token inválido, usuario deshabilitado o
    // eliminado tras emitir el token) cierra la sesión local y reenvía al login.
    if (response.status === 401) {
      clearSession();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      }
    }
    throw new ApiError(
      response.status,
      code,
      payload?.message ?? (response.statusText || 'Error inesperado de la API'),
      payload?.correlationId ?? null,
      payload?.fields ?? null,
    );
  }

  return payload as T;
}
