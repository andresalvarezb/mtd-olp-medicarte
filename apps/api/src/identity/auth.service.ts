import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { ApiConfig } from '@authorization/config';
import type { LoginResponse } from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';
import { API_CONFIG, DATABASE } from '../tokens';
import { dummyVerify, hashPassword, verifyPassword } from './password';
import { signAccessToken } from './jwt';

type Database = ReturnType<typeof createDatabase>;

interface LoginUserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string | null;
  active: boolean;
  must_change_password: boolean;
}

/**
 * ADR-026: autenticación local. La API valida la contraseña contra PostgreSQL
 * (hash argon2id) y emite su propio JWT HS256. Las respuestas de error son
 * genéricas (INVALID_CREDENTIALS): no revelan si el usuario existe, si la
 * contraseña falló o si la cuenta está deshabilitada. Las causas reales se
 * registran únicamente en auditoría.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async login(input: {
    username: string;
    password: string;
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<LoginResponse> {
    const result = await this.database.pool.query<LoginUserRow>(
      `select id, username, display_name, password_hash, active, must_change_password
       from users where lower(username) = lower($1)`,
      [input.username],
    );
    const user = result.rows[0];

    if (!user) {
      await this.dummyVerify(input, 'USER_NOT_FOUND');
      throw this.invalidCredentials();
    }
    if (!user.password_hash) {
      await this.dummyVerify(input, 'NO_LOCAL_PASSWORD');
      throw this.invalidCredentials();
    }
    const ok = await verifyPassword(input.password, user.password_hash);
    if (!ok) {
      await this.auditLogin(input, user.id, 'LOGIN_FAILED', 'PASSWORD_MISMATCH');
      throw this.invalidCredentials();
    }
    if (!user.active) {
      await this.auditLogin(input, user.id, 'LOGIN_FAILED', 'ACCOUNT_DISABLED');
      throw this.invalidCredentials();
    }

    await this.database.pool.query(
      'update users set last_login_at = now(), updated_at = updated_at where id = $1',
      [user.id],
    );
    await this.auditLogin(input, user.id, 'LOGIN_SUCCESS', null);

    const signed = await signAccessToken(this.config, { sub: user.id, username: user.username });
    return {
      accessToken: signed.token,
      tokenType: 'Bearer',
      expiresAt: signed.expiresAt,
      mustChangePassword: user.must_change_password,
      user: { id: user.id, username: user.username, displayName: user.display_name },
    };
  }

  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    requestId: string;
  }): Promise<void> {
    const result = await this.database.pool.query<{ password_hash: string | null }>(
      'select password_hash from users where id = $1 and active = true',
      [input.userId],
    );
    const stored = result.rows[0]?.password_hash;
    if (!stored || !(await verifyPassword(input.currentPassword, stored))) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password',
      });
    }
    const hash = await hashPassword(input.newPassword);
    await this.database.pool.query(
      `update users
         set password_hash = $2, password_changed_at = now(), must_change_password = false,
             updated_at = now()
       where id = $1`,
      [input.userId, hash],
    );
    await this.database.pool.query(
      `insert into audit_events
         (actor_type, actor_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
       values ('USER', $1, 'USER_PASSWORD_CHANGED', 'user', $1, '{}'::jsonb, $2::uuid, $2, 'SUCCESS')`,
      [input.userId, input.requestId],
    );
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid username or password',
    });
  }

  private async dummyVerify(
    input: {
      username: string;
      password: string;
      requestId: string;
      ipAddress: string | null;
      userAgent: string | null;
    },
    reason: string,
  ): Promise<void> {
    await dummyVerify(input.password);
    await this.auditLogin(input, null, 'LOGIN_FAILED', reason);
  }

  private async auditLogin(
    input: {
      username: string;
      requestId: string;
      ipAddress: string | null;
      userAgent: string | null;
    },
    actorId: string | null,
    action: 'LOGIN_SUCCESS' | 'LOGIN_FAILED',
    reason: string | null,
  ): Promise<void> {
    try {
      await this.database.pool.query(
        `insert into audit_events
           (actor_type, actor_id, action, resource_type, resource_id, after,
            correlation_id, request_id, ip_address, user_agent, result)
         values ($1, $2, $3, 'auth_session', coalesce($2::text, $4), $5::jsonb,
                 $6::uuid, $6, $7, $8, $9)`,
        [
          actorId ? 'USER' : 'ANONYMOUS',
          actorId,
          action,
          input.username.slice(0, 160),
          JSON.stringify(reason ? { reason } : {}),
          input.requestId,
          input.ipAddress,
          input.userAgent,
          action === 'LOGIN_SUCCESS' ? 'SUCCESS' : 'DENIED',
        ],
      );
    } catch {
      // La auditoría de login nunca bloquea la autenticación.
    }
  }
}
