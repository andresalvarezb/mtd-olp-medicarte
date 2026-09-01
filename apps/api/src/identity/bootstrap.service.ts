import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ApiConfig } from '@authorization/config';
import type { createDatabase } from '@authorization/database';
import { API_CONFIG, DATABASE } from '../tokens';
import { hashPassword } from './password';

type Database = ReturnType<typeof createDatabase>;

/**
 * Bootstrap seguro del primer administrador local (ADR-026).
 *
 * Reglas:
 * - Sin AUTH_BOOTSTRAP_ADMIN_PASSWORD configurada, no hace nada.
 * - Si ya existe un administrador válido (usuario activo con rol MTD_ADMIN en
 *   la organización MTD y contraseña local), no hace nada: el bootstrap nunca
 *   altera cuentas existentes en cada arranque.
 * - Si el username indicado existe sin password_hash (usuario histórico
 *   migrado desde Keycloak), se le asigna la contraseña de bootstrap.
 * - Si no existe ningún admin válido, crea/actualiza ÚNICAMENTE la cuenta
 *   bootstrap y su asignación MTD_ADMIN@MTD.
 * - Nunca imprime contraseñas; idempotente ante arranques concurrentes por la
 *   restricción única lower(username) + advisory lock.
 */
@Injectable()
export class BootstrapAdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapAdminService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const password = this.config.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
    if (!password) return;
    const username = this.config.AUTH_BOOTSTRAP_ADMIN_USERNAME.toLowerCase();

    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        "select pg_advisory_xact_lock(hashtext('authorization-platform:auth-bootstrap'))",
      );

      const admins = await client.query<{ count: string }>(
        `select count(*)::text as count
           from users u
           join user_organization_roles uor on uor.user_id = u.id and uor.active
           join roles r on r.id = uor.role_id and r.code = 'MTD_ADMIN'
           join organizations o on o.id = uor.organization_id and o.code = 'MTD'
          where u.active = true and u.password_hash is not null`,
      );
      if (Number(admins.rows[0]?.count ?? 0) > 0) {
        await client.query('commit');
        return;
      }

      const existing = await client.query<{ id: string; password_hash: string | null }>(
        'select id, password_hash from users where lower(username) = $1',
        [username],
      );
      const row = existing.rows[0];
      const hash = await hashPassword(password);
      if (row) {
        if (row.password_hash) {
          // El usuario ya tiene credencial local: no se sobrescribe.
          await client.query('commit');
          return;
        }
        await client.query(
          `update users
              set password_hash = $2, password_changed_at = now(), updated_at = now()
            where id = $1`,
          [row.id, hash],
        );
        await client.query(
          `insert into user_organization_roles (user_id, organization_id, role_id, active)
           select $1, o.id, r.id, true
             from organizations o, roles r
            where o.code = 'MTD' and r.code = 'MTD_ADMIN'
           on conflict (user_id, organization_id, role_id) do update set active = true`,
          [row.id],
        );
        this.logger.log(`bootstrap administrator "${username}" recovered local credentials`);
      } else {
        const inserted = await client.query<{ id: string }>(
          `insert into users (username, display_name, password_hash, password_changed_at, active)
           values ($1, $1, $2, now(), true)
           returning id`,
          [username, hash],
        );
        const userId = inserted.rows[0]?.id;
        if (!userId) throw new Error('bootstrap admin insert returned no row');
        await client.query(
          `insert into user_organization_roles (user_id, organization_id, role_id, active)
           select $1, o.id, r.id, true
             from organizations o, roles r
            where o.code = 'MTD' and r.code = 'MTD_ADMIN'`,
          [userId],
        );
        this.logger.log(`bootstrap administrator "${username}" created`);
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
