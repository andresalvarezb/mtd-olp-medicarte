import { API_BASE_URL, OIDC_CLIENT_ID, OIDC_ISSUER } from './config';

export interface ApiSession {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
}

const SESSION_KEY = 'authz-api-session';

let memorySession: ApiSession | null = null;
let refreshInFlight: Promise<string | null> | null = null;

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
  refreshInFlight = null;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(`${OIDC_ISSUER}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    const error = new Error(
      'No fue posible contactar Keycloak. Verifica que la plataforma esté levantada.',
    );
    error.name = 'KeycloakUnavailableError';
    throw error;
  }
  const payload = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok) {
    const error = new Error(payload.error_description ?? payload.error ?? 'Fallo de autenticación');
    error.name = payload.error === 'invalid_grant' ? 'InvalidCredentialsError' : 'AuthError';
    throw error;
  }
  return payload;
}

export async function authenticate(email: string, password: string): Promise<void> {
  const payload = await tokenRequest(
    new URLSearchParams({
      grant_type: 'password',
      client_id: OIDC_CLIENT_ID,
      scope: 'openid',
      username: email,
      password,
    }),
  );
  if (!payload.access_token) throw new Error('Keycloak no devolvió un token');
  writeSession({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : null,
  });
}

export async function refreshAccessToken(): Promise<string | null> {
  const session = readStoredSession();
  if (!session?.refreshToken) return null;
  if (!refreshInFlight) {
    refreshInFlight = tokenRequest(
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: OIDC_CLIENT_ID,
        refresh_token: session.refreshToken,
      }),
    )
      .then((payload) => {
        if (!payload.access_token) throw new Error('Refresh sin token');
        writeSession({
          accessToken: payload.access_token,
          refreshToken: payload.refresh_token ?? session.refreshToken,
          expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : null,
        });
        return payload.access_token;
      })
      .catch(() => {
        writeSession({ ...session, accessToken: '', refreshToken: null, expiresAt: null });
        return null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/** Token vigente; refresca si está por expirar. Devuelve null si no hay sesión. */
export async function getAccessToken(): Promise<string | null> {
  const session = readStoredSession();
  if (!session) return null;
  if (session.accessToken && (!session.expiresAt || session.expiresAt > Date.now() + 30_000)) {
    return session.accessToken;
  }
  return refreshAccessToken();
}

export { API_BASE_URL };
