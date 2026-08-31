import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ApiConfig } from '@authorization/config';
import { API_CONFIG } from '../tokens';

export interface KeycloakNewUser {
  email: string;
  displayName: string;
  password: string;
}

interface TokenResponse {
  access_token?: string;
}

interface UserRepresentation {
  id?: string;
  username?: string;
  email?: string;
  enabled?: boolean;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
}

function splitDisplayName(displayName: string): { firstName: string; lastName?: string } {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? displayName };
  return { firstName: parts[0] ?? displayName, lastName: parts.slice(1).join(' ') };
}

@Injectable()
export class KeycloakAdminService {
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  get configured(): boolean {
    return Boolean(this.config.OIDC_ADMIN_CLIENT_SECRET);
  }

  private get issuer(): string {
    return this.config.OIDC_ADMIN_ISSUER ?? this.config.OIDC_ISSUER;
  }

  private get adminBase(): string {
    return this.issuer.replace(/\/realms\//, '/admin/realms/');
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new ServiceUnavailableException({
        code: 'KEYCLOAK_ADMIN_NOT_CONFIGURED',
        message: 'OIDC_ADMIN_CLIENT_SECRET is not configured',
      });
    }
  }

  private async accessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 10_000) {
      return this.cachedToken.value;
    }
    let response: Response;
    try {
      response = await fetch(`${this.issuer}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.config.OIDC_ADMIN_CLIENT_ID,
          client_secret: this.config.OIDC_ADMIN_CLIENT_SECRET ?? '',
        }),
      });
    } catch {
      throw new ServiceUnavailableException({
        code: 'KEYCLOAK_ADMIN_UNAVAILABLE',
        message: 'Keycloak admin API is unreachable',
      });
    }
    if (!response.ok) {
      throw new ServiceUnavailableException({
        code: 'KEYCLOAK_ADMIN_UNAVAILABLE',
        message: `Keycloak admin token request failed (${response.status})`,
      });
    }
    const payload = (await response.json()) as TokenResponse;
    if (!payload.access_token) {
      throw new ServiceUnavailableException({
        code: 'KEYCLOAK_ADMIN_UNAVAILABLE',
        message: 'Keycloak admin token response missing access_token',
      });
    }
    // El token de Keycloak vive 60s por defecto; cacheamos 30s para no decodificar exp.
    this.cachedToken = {
      value: payload.access_token,
      expiresAt: Date.now() + 30_000,
    };
    return this.cachedToken.value;
  }

  private async adminFetch(path: string, init: RequestInit): Promise<Response> {
    const token = await this.accessToken();
    try {
      const response = await fetch(`${this.adminBase}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
      });
      return response;
    } catch {
      throw new ServiceUnavailableException({
        code: 'KEYCLOAK_ADMIN_UNAVAILABLE',
        message: 'Keycloak admin API is unreachable',
      });
    }
  }

  /** Crea el usuario en Keycloak con contraseña temporal. Devuelve el subject (id). */
  async createUser(input: KeycloakNewUser): Promise<string> {
    this.assertConfigured();
    const { firstName, lastName } = splitDisplayName(input.displayName);
    const response = await this.adminFetch('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: input.email,
        email: input.email,
        enabled: true,
        emailVerified: true,
        firstName,
        ...(lastName ? { lastName } : {}),
      } satisfies UserRepresentation),
    });
    if (response.status === 409) {
      throw new ConflictException({
        code: 'USER_ALREADY_EXISTS',
        message: 'A Keycloak user with that email already exists',
      });
    }
    if (!response.ok) {
      throw new ServiceUnavailableException({
        code: 'KEYCLOAK_ADMIN_UNAVAILABLE',
        message: `Keycloak user creation failed (${response.status})`,
      });
    }
    const location = response.headers.get('location');
    const subject = location ? (location.split('/').pop() ?? null) : null;
    if (!subject) {
      throw new ServiceUnavailableException({
        code: 'KEYCLOAK_ADMIN_UNAVAILABLE',
        message: 'Keycloak user creation did not return an id',
      });
    }
    const passwordResponse = await this.adminFetch(`/users/${subject}/reset-password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'password', value: input.password, temporary: false }),
    });
    if (!passwordResponse.ok) {
      throw new ServiceUnavailableException({
        code: 'KEYCLOAK_ADMIN_UNAVAILABLE',
        message: `Keycloak password reset failed (${passwordResponse.status})`,
      });
    }
    return subject;
  }

  async setUserEnabled(subject: string, enabled: boolean): Promise<void> {
    this.assertConfigured();
    const response = await this.adminFetch(`/users/${encodeURIComponent(subject)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled } satisfies UserRepresentation),
    });
    if (!response.ok && response.status !== 404) {
      throw new ServiceUnavailableException({
        code: 'KEYCLOAK_ADMIN_UNAVAILABLE',
        message: `Keycloak user update failed (${response.status})`,
      });
    }
  }
}
