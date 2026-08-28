import { CanActivate, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { ApiConfig } from '@authorization/config';
import { API_CONFIG } from '../tokens';
import type { AuthenticatedRequest } from '../types';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {
    this.jwks = createRemoteJWKSet(
      new URL(config.OIDC_JWKS_URL ?? `${config.OIDC_ISSUER}/protocol/openid-connect/certs`),
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.header('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'AUTH_TOKEN_REQUIRED', message: 'Bearer token required' });
    }

    try {
      const { payload } = await jwtVerify(authorization.slice(7), this.jwks, {
        issuer: this.config.OIDC_ISSUER,
        audience: this.config.OIDC_AUDIENCE,
      });
      if (!payload.sub) throw new Error('Token subject missing');
      request.auth = { ...payload, sub: payload.sub };
      return true;
    } catch {
      throw new UnauthorizedException({ code: 'AUTH_TOKEN_INVALID', message: 'Invalid access token' });
    }
  }
}
