import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface SessionRecord {
  accessToken: string;
  expiresAt: number | null;
}

function makeFakeWindow(): void {
  const store = new Map<string, string>();
  const events = new Map<string, number>();
  const fake = {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    localStorage: {
      removeItem: () => undefined,
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: (event: { type: string }) => {
      events.set(event.type, (events.get(event.type) ?? 0) + 1);
      return true;
    },
    __store: store,
    __events: events,
  };
  (globalThis as unknown as { window: unknown }).window = fake;
}

function storedSession(): SessionRecord | null {
  const fakeWindow = (globalThis as unknown as { window: { __store: Map<string, string> } }).window;
  const raw = fakeWindow.__store.get('authz-api-session');
  return raw ? (JSON.parse(raw) as SessionRecord) : null;
}

describe('auth local (ADR-026)', () => {
  beforeEach(() => {
    vi.resetModules();
    makeFakeWindow();
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    vi.unstubAllGlobals();
  });

  it('login válido guarda el token en sessionStorage (nunca localStorage)', async () => {
    const fetchMock = vi.fn(() =>
      Response.json(
        {
          accessToken: 'jwt-token',
          tokenType: 'Bearer',
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          mustChangePassword: false,
          user: { id: 'u1', username: 'ana', displayName: 'Ana' },
        },
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { authenticate } = await import('./auth');
    const result = await authenticate('ana', 'pass-largo-123456');

    expect(result.user.username).toBe('ana');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/auth\/login$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ username: 'ana', password: 'pass-largo-123456' });
    expect(storedSession()?.accessToken).toBe('jwt-token');
  });

  it('login inválido lanza InvalidCredentialsError y no persiste sesión', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json({ code: 'INVALID_CREDENTIALS', message: 'x' }, { status: 401 })),
    );
    const { authenticate, InvalidCredentialsError } = await import('./auth');
    await expect(authenticate('ana', 'mala-1234567890')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(storedSession()).toBeNull();
  });

  it('API inalcanzable lanza AuthApiUnavailableError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new TypeError('fetch failed');
      }),
    );
    const { authenticate, AuthApiUnavailableError } = await import('./auth');
    await expect(authenticate('ana', 'pass-largo-123456')).rejects.toBeInstanceOf(
      AuthApiUnavailableError,
    );
  });

  it('getAccessToken devuelve null tras expirar y limpia la sesión', async () => {
    // El login devuelve un token ya vencido: getAccessToken debe descartarlo.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Response.json({
          accessToken: 'jwt-token',
          expiresAt: new Date(Date.now() - 1000).toISOString(),
          user: { id: 'u1', username: 'ana', displayName: 'Ana' },
        }),
      ),
    );
    const { authenticate, getAccessToken, getSession } = await import('./auth');
    await authenticate('ana', 'pass-largo-123456');
    expect(getAccessToken()).toBeNull();
    expect(getSession()).toBeNull();
  });

  it('clearSession elimina el token (logout local)', async () => {
    const { clearSession } = await import('./auth');
    (globalThis as unknown as { window: { __store: Map<string, string> } }).window.__store.set(
      'authz-api-session',
      JSON.stringify({ accessToken: 'jwt', expiresAt: null }),
    );
    clearSession();
    expect(storedSession()).toBeNull();
  });

  it('el módulo no referencia Keycloak ni OIDC', async () => {
    const fs = await import('node:fs');
    const text = fs.readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');
    expect(text).not.toMatch(/keycloak|oidc|openid|realm|client_id/i);
  });
});
