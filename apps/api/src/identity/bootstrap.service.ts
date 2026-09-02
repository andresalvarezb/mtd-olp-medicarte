import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ApiConfig } from '@authorization/config';
import type { createDatabase } from '@authorization/database';
import { API_CONFIG, DATABASE } from '../tokens';
import { hashPassword } from './password';

type Database = ReturnType<typeof createDatabase>;

type BootstrapTarget = {
  username: string;
  password: string | undefined;
  displayName: string;
  organizationCode: string;
  roleCode: string;
};

/** Creates the initial local accounts without replacing existing credentials. */
@Injectable()
export class BootstrapAdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapAdminService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const targets: BootstrapTarget[] = [
      {
        username: this.config.AUTH_BOOTSTRAP_ADMIN_USERNAME,
        password: this.config.AUTH_BOOTSTRAP_ADMIN_PASSWORD,
        displayName: 'Foundation Admin',
        organizationCode: 'MTD',
        roleCode: 'MTD_ADMIN',
      },
      {
        username: 'mtd-general',
        password: this.config.AUTH_BOOTSTRAP_MTD_GENERAL_PASSWORD,
        displayName: 'MTD General',
        organizationCode: 'MTD',
        roleCode: 'MTD_GENERAL',
      },
      {
        username: 'mtd-auditoria',
        password: this.config.AUTH_BOOTSTRAP_MTD_AUDITORIA_PASSWORD,
        displayName: 'MTD Auditoria',
        organizationCode: 'MTD',
        roleCode: 'MTD_AUDITORIA',
      },
    ].filter((target) => target.password);

    if (!targets.length) return;

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
      const hasAdmin = Number(admins.rows[0]?.count ?? 0) > 0;

      for (const target of targets) {
        if (target.roleCode === 'MTD_ADMIN' && hasAdmin) continue;

        const username = target.username.toLowerCase();
        const existing = await client.query<{ id: string; password_hash: string | null }>(
          'select id, password_hash from users where lower(username) = $1',
          [username],
        );
        const row = existing.rows[0];
        if (row?.password_hash) continue;

        const password = target.password;
        if (!password) continue;
        const hash = await hashPassword(password);

        if (row) {
          await client.query(
            `update users
                set password_hash = $2, password_changed_at = now(), active = true, updated_at = now()
              where id = $1`,
            [row.id, hash],
          );
          await client.query(
            `insert into user_organization_roles (user_id, organization_id, role_id, active)
             select $1, o.id, r.id, true
               from organizations o, roles r
              where o.code = $2 and r.code = $3
             on conflict (user_id, organization_id, role_id) do update set active = true`,
            [row.id, target.organizationCode, target.roleCode],
          );
          this.logger.log(`bootstrap user "${username}" recovered local credentials`);
          continue;
        }

        const inserted = await client.query<{ id: string }>(
          `insert into users (username, display_name, password_hash, password_changed_at, active)
           values ($1, $2, $3, now(), true)
           returning id`,
          [username, target.displayName, hash],
        );
        const userId = inserted.rows[0]?.id;
        if (!userId) throw new Error(`bootstrap user insert returned no row for ${username}`);
        await client.query(
          `insert into user_organization_roles (user_id, organization_id, role_id, active)
           select $1, o.id, r.id, true
             from organizations o, roles r
            where o.code = $2 and r.code = $3`,
          [userId, target.organizationCode, target.roleCode],
        );
        this.logger.log(`bootstrap user "${username}" created`);
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
