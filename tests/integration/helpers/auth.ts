/**
 * Helpers de autenticación local para los gates de integración (ADR-026).
 * La API es la autoridad: login por usuario/contraseña y JWT propio.
 */
export const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

/** Credenciales del administrador de desarrollo (bootstrap vía compose/CI). */
export const DEV_ADMIN_USERNAME = process.env.AUTH_DEV_ADMIN_USERNAME ?? 'foundation-admin';
export const DEV_ADMIN_PASSWORD = process.env.AUTH_DEV_ADMIN_PASSWORD ?? 'foundation-admin';

export const ORGANIZATION_IDS = {
  MTD: '10000000-0000-4000-8000-000000000001',
  COMPENSAR: '10000000-0000-4000-8000-000000000002',
  OLP: '10000000-0000-4000-8000-000000000003',
  MEDICARTE: '10000000-0000-4000-8000-000000000004',
} as const;

export class LoginError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`login failed (${status} ${code})`);
    this.name = 'LoginError';
  }
}

export interface LoginAttempt {
  ok: boolean;
  status: number;
  code: string | null;
  token: string | null;
}

export async function loginAttempt(username: string, password: string): Promise<LoginAttempt> {
  const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    accessToken?: string;
    code?: string;
  };
  return {
    ok: response.ok && Boolean(payload.accessToken),
    status: response.status,
    code: payload.code ?? null,
    token: payload.accessToken ?? null,
  };
}

export async function login(username: string, password: string): Promise<string> {
  const attempt = await loginAttempt(username, password);
  if (!attempt.token) throw new LoginError(attempt.status, attempt.code ?? 'UNKNOWN');
  return attempt.token;
}

export function adminLogin(): Promise<string> {
  return login(DEV_ADMIN_USERNAME, DEV_ADMIN_PASSWORD);
}

/** Crea o recupera un usuario administrativo con contraseña y devuelve su token. */
export async function ensureUser(input: {
  adminToken: string;
  username: string;
  displayName: string;
  password: string;
  organizationId: string;
  roleCode: string;
}): Promise<string> {
  const response = await fetch(`${apiUrl}/api/v1/users`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.adminToken}`,
      'content-type': 'application/json',
      'x-organization-id': ORGANIZATION_IDS.MTD,
    },
    body: JSON.stringify({
      username: input.username,
      displayName: input.displayName,
      password: input.password,
      organizationId: input.organizationId,
      roleCode: input.roleCode,
    }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { code?: string };
    if (response.status !== 409 || payload.code !== 'USERNAME_TAKEN') {
      throw new Error(
        `ensureUser ${input.username} failed: ${response.status} ${payload.code ?? ''}`,
      );
    }
    // Usuario existente (p. ej. sembrado por la migración sin contraseña):
    // se le asigna la contraseña de prueba mediante reset administrativo.
    const list = await fetch(`${apiUrl}/api/v1/users`, {
      headers: {
        authorization: `Bearer ${input.adminToken}`,
        'x-organization-id': ORGANIZATION_IDS.MTD,
      },
    });
    const { items } = (await list.json()) as { items: Array<{ id: string; username: string }> };
    const existing = items.find((user) => user.username === input.username);
    if (!existing) {
      throw new Error(`ensureUser ${input.username}: 409 pero el usuario no aparece en el listado`);
    }
    const reset = await fetch(`${apiUrl}/api/v1/users/${existing.id}/reset-password`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.adminToken}`,
        'content-type': 'application/json',
        'x-organization-id': ORGANIZATION_IDS.MTD,
      },
      body: JSON.stringify({ password: input.password, mustChangePassword: false }),
    });
    if (!reset.ok) {
      throw new Error(`ensureUser ${input.username}: reset-password falló (${reset.status})`);
    }
  }
  return login(input.username, input.password);
}

/** Token de OLP_OPERATOR y MEDICARTE_OPERATOR de desarrollo, idempotente. */
export async function ensureOperatorTokens(): Promise<{ olpToken: string; medicarteToken: string }> {
  const admin = await adminLogin();
  const password = `${DEV_ADMIN_USERNAME}-ops`;
  const olpToken = await ensureUser({
    adminToken: admin,
    username: 'olp-operator',
    displayName: 'OLP Operator',
    password,
    organizationId: ORGANIZATION_IDS.OLP,
    roleCode: 'OLP_OPERATOR',
  });
  const medicarteToken = await ensureUser({
    adminToken: admin,
    username: 'medicarte-operator',
    displayName: 'Medicarte Operator',
    password,
    organizationId: ORGANIZATION_IDS.MEDICARTE,
    roleCode: 'MEDICARTE_OPERATOR',
  });
  return { olpToken, medicarteToken };
}

/** Usuarios de desarrollo conocidos y su asignación al autoaprovisionarse. */
const DEV_OPERATORS: Record<string, { organizationId: string; roleCode: string; displayName: string }> = {
  'olp-operator': {
    organizationId: ORGANIZATION_IDS.OLP,
    roleCode: 'OLP_OPERATOR',
    displayName: 'OLP Operator',
  },
  'medicarte-operator': {
    organizationId: ORGANIZATION_IDS.MEDICARTE,
    roleCode: 'MEDICARTE_OPERATOR',
    displayName: 'Medicarte Operator',
  },
};

/**
 * Login de desarrollo: intenta `/auth/login`; si el usuario es un operador
 * conocido aún sin cuenta local, la crea vía API administrativa y reintenta.
 * `foundation-admin` debe existir por el bootstrap de arranque de la API.
 */
export async function loginDev(username: string, password: string): Promise<string> {
  const attempt = await loginAttempt(username, password);
  if (attempt.ok && attempt.token) return attempt.token;
  const operator = DEV_OPERATORS[username];
  if (operator && attempt.code === 'INVALID_CREDENTIALS') {
    const admin = await adminLogin();
    return ensureUser({
      adminToken: admin,
      username,
      displayName: operator.displayName,
      password,
      organizationId: operator.organizationId,
      roleCode: operator.roleCode,
    });
  }
  throw new LoginError(attempt.status, attempt.code ?? 'UNKNOWN');
}
