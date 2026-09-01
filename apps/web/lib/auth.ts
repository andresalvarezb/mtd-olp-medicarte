import { API_BASE_URL } from './config';

/**
 * ADR-026: sesión local. La Web autentica contra `POST /auth/login` de la API
 * propia y conserva el JWT resultante en sessionStorage (sesión de pestaña,
 * no localStorage). No hay refresh token: al expirar, la app vuelve a login.
 */
export interface ApiSession {
  accessToken: string;
  /** Expiración en epoch ms; null si el token no trae exp legible. */
  expiresAt: number | null;
}

export interface LoginUser {
  id: string;
  username: string;
  displayName: string;
}

export interface LoginResult {
  user: LoginUser;
  mustChangePassword: boolean;
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Credenciales inválidas. Verifica tu usuario y contraseña.');
    this.name = 'InvalidCredentialsError';
  }
}

export class AuthApiUnavailableError extends Error {
  constructor() {
    super('No fue posible contactar la API. Verifica que la plataforma esté levantada.');
    this.name = 'AuthApiUnavailableError';
  }
}

export const SESSION_KEY = 'authz-api-session';
export const SESSION_EXPIRED_EVENT = 'authz:session-expired';

let memorySession: ApiSession | null = null;

function readStoredSession(): ApiSession | null {
  if (memorySession) return memorySession;
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    memorySession = JSON.parse(raw) as ApiSession;
  } catch {
    memorySession = null;
  }
  return memorySession;
}

function writeSession(session: ApiSession | null): void {
  memorySession = session;
  if (typeof window === 'undefined') return;
  if (session) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else window.sessionStorage.removeItem(SESSION_KEY);
}

export function getSession(): ApiSession | null {
  return readStoredSession();
}

export function clearSession(): void {
  writeSession(null);
}

function notifyExpired(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}

interface LoginResponsePayload {
  accessToken?: string;
  expiresAt?: string;
  mustChangePassword?: boolean;
  user?: LoginUser;
}

/** Intenta iniciar sesión. Lanza InvalidCredentialsError o AuthApiUnavailableError. */
export async function authenticate(username: string, password: string): Promise<LoginResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new AuthApiUnavailableError();
  }
  const payload = (await response.json().catch(() => ({}))) as LoginResponsePayload;
  if (!response.ok || !payload.accessToken || !payload.user) {
    throw new InvalidCredentialsError();
  }
  const expiresAtMs = payload.expiresAt ? Date.parse(payload.expiresAt) : Number.NaN;
  writeSession({
    accessToken: payload.accessToken,
    expiresAt: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
  });
  return { user: payload.user, mustChangePassword: payload.mustChangePassword ?? false };
}

/**
 * Token vigente o null. Devuelve null cuando no hay sesión o el token venció;
 * en el segundo caso notifica la expiración para que la app cierre sesión.
 */
export function getAccessToken(): string | null {
  const session = readStoredSession();
  if (!session?.accessToken) return null;
  if (session.expiresAt && session.expiresAt <= Date.now() + 5_000) {
    clearSession();
    notifyExpired();
    return null;
  }
  return session.accessToken;
}
