import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';

type Database = ReturnType<typeof createDatabase>;

@Injectable()
export class SettingsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async getDriveUrl(): Promise<{ url: string | null }> {
    const result = await this.database.pool.query<{ drive_url: string | null }>(
      `select drive_url from organizations where code = 'MTD' and active = true`,
    );
    return { url: result.rows[0]?.drive_url ?? null };
  }

  async setDriveUrl(input: { url: string; scope: Scope }): Promise<{ url: string }> {
    const result = await this.database.pool.query<{ drive_url: string }>(
      `update organizations set drive_url = $1 where code = 'MTD' and active = true returning drive_url`,
      [input.url],
    );
    const url = result.rows[0]?.drive_url;
    if (!url) {
      throw new BadRequestException({
        code: 'MTD_ORGANIZATION_NOT_FOUND',
        message: 'The MTD organization is not available',
      });
    }
    await this.database.pool.query(
      `insert into audit_events
        (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
       select 'USER', $1, o.id, 'DRIVE_URL_UPDATED', 'organization', o.id, $2::jsonb, $3, $4, 'SUCCESS'
       from organizations o where o.code = 'MTD'`,
      [input.scope.userId, JSON.stringify({ configured: true }), input.scope.correlationId, input.scope.correlationId],
    );
    return { url };
  }
}
