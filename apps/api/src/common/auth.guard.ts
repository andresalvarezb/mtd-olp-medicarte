import {
  CanActivate,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ApiConfig } from '@authorization/config';
import type { createDatabase } from '@authorization/database';
import { API_CONFIG, DATABASE } from '../tokens';
import type { AuthenticatedRequest } from '../types';
import { verifyAccessToken } from '../identity/jwt';

type Database = ReturnType<typeof createDatabase>;

/**
 * ADR-026: autentización local. Verifica el JWT HS256 emitido por la API y
 * luego RECARGA el usuario desde PostgreSQL: existencia, active y la resolución
 * de roles/permisos que hace AccessService en cada request. Deshabilitar un
 * usuario o cambiar su rol tiene efecto inmediato sin esperar a que expire el
 * token.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(DATABASE) private readonly database: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.header('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_REQUIRED',
        message: 'Bearer token required',
      });
    }

    let claims;
    try {
      claims = await verifyAccessToken(this.config, authorization.slice(7));
    } catch {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_INVALID',
        message: 'Invalid access token',
      });
    }

    const result = await this.database.pool.query<{ id: string; username: string; active: boolean }>(
      'select id, username, active from users where id = $1',
      [claims.sub],
    );
    const user = result.rows[0];
    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_INVALID',
        message: 'Invalid access token',
      });
    }
    if (!user.active) {
      throw new UnauthorizedException({
        code: 'LOCAL_USER_INACTIVE',
        message: 'Local user is not active',
      });
    }

    request.auth = { sub: user.id, username: user.username };
    return true;
  }
}
