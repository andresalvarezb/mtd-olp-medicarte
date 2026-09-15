import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  OperationalPointGrant,
  OperationalPointScopeResponse,
  ReplaceOperationalPointScopeRequest,
} from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';
import {
  POINT_ACCESS_DENIED,
  PointAccessDeniedError,
  isPointScopeEligibleTarget,
} from '@authorization/domain';
import type { Scope } from '../common/request-scope';
import { lockActivePointGrants } from '../common/point-scope.sql';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];

const MEDICARTE_ORG_ID = '10000000-0000-4000-8000-000000000004';

@Injectable()
export class OperationalAccessScopeService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  isGlobalPointScope(actor: Scope): boolean {
    return actor.pointAccessKind === 'global';
  }

  async getAccessiblePointIds(actor: Scope): Promise<string[]> {
    if (actor.pointAccessKind !== 'explicit') return [];
    const result = await this.database.db.execute<{ dispensing_point_id: string }>(sql`
      select dispensing_point_id
      from user_point_scopes
      where user_id = ${actor.userId}::uuid and revoked_at is null
      order by granted_at, id
    `);
    return result.rows.map((row) => row.dispensing_point_id);
  }

  async canAccessPoint(actor: Scope, pointId: string): Promise<boolean> {
    try {
      await this.assertCanAccessPoint(actor, pointId);
      return true;
    } catch (error) {
      if (error instanceof PointAccessDeniedError || error instanceof ForbiddenException) {
        return false;
      }
      throw error;
    }
  }

  async assertCanAccessPoint(actor: Scope, pointId: string): Promise<void> {
    if (actor.pointAccessKind !== 'explicit') return;
    const result = await this.database.db.execute<{ id: string }>(sql`
      select id
      from user_point_scopes
      where user_id = ${actor.userId}::uuid
        and dispensing_point_id = ${pointId}::uuid
        and revoked_at is null
    `);
    if (!result.rows[0]) {
      throw new PointAccessDeniedError();
    }
  }

  async lockPointAccess(tx: Tx, actor: Scope, pointIds: readonly string[]): Promise<void> {
    await lockActivePointGrants(tx, actor, pointIds);
  }

  async listAssignablePoints(): Promise<
    Array<{ id: string; code: string; name: string; active: boolean }>
  > {
    const result = await this.database.db.execute<{
      id: string;
      code: string;
      name: string;
      active: boolean;
    }>(sql`
      select id, code, name, active
      from dispensing_points
      where organization_id = ${MEDICARTE_ORG_ID}::uuid and active = true
      order by name, code
    `);
    return result.rows;
  }

  async getUserPointScope(userId: string): Promise<OperationalPointScopeResponse> {
    const target = await this.loadEligibleUser(userId);
    const grants = await this.listActiveGrants(userId);
    return { ...target, grants };
  }

  async replaceUserPointScope(
    userId: string,
    body: ReplaceOperationalPointScopeRequest,
    actor: Scope,
  ): Promise<OperationalPointScopeResponse> {
    const desired = [...new Set(body.pointIds)].sort();
    return this.database.db.transaction(async (tx) => {
      const target = await this.loadEligibleUserOn(tx, userId);
      if (!target.eligible) {
        throw new BadRequestException({
          code: 'POINT_SCOPE_TARGET_NOT_ELIGIBLE',
          message: 'Point scope can only be assigned to MEDICARTE_OPERATOR',
        });
      }
      const current = await tx.execute<{
        id: string;
        dispensing_point_id: string;
      }>(sql`
        select id, dispensing_point_id
        from user_point_scopes
        where user_id = ${userId}::uuid and revoked_at is null
        order by dispensing_point_id
        for update
      `);
      const currentIds = current.rows.map((row) => row.dispensing_point_id);
      const currentSet = new Set(currentIds);
      const desiredSet = new Set(desired);
      const toRevoke = current.rows.filter((row) => !desiredSet.has(row.dispensing_point_id));
      const toGrant = desired.filter((id) => !currentSet.has(id));

      if (toGrant.length > 0) {
        await this.assertGrantablePoints(tx, toGrant);
      }

      for (const row of toRevoke) {
        await tx.execute(sql`
          update user_point_scopes
          set revoked_at = now(), revoked_by = ${actor.userId}::uuid
          where id = ${row.id}::uuid and revoked_at is null
        `);
      }
      for (const pointId of toGrant) {
        await tx.execute(sql`
          insert into user_point_scopes (user_id, dispensing_point_id, granted_by)
          values (${userId}::uuid, ${pointId}::uuid, ${actor.userId}::uuid)
        `);
      }

      await this.audit(tx, actor, 'OPERATIONAL_POINT_SCOPE_REPLACED', userId, {
        targetUserId: userId,
        pointIds: desired,
        grantedPointIds: toGrant,
        revokedPointIds: toRevoke.map((row) => row.dispensing_point_id),
      });
      for (const pointId of toGrant) {
        await this.audit(tx, actor, 'OPERATIONAL_POINT_SCOPE_GRANTED', pointId, {
          targetUserId: userId,
          pointId,
        });
      }
      for (const row of toRevoke) {
        await this.audit(tx, actor, 'OPERATIONAL_POINT_SCOPE_REVOKED', row.dispensing_point_id, {
          targetUserId: userId,
          pointId: row.dispensing_point_id,
        });
      }

      const grants = await this.listActiveGrantsOn(tx, userId);
      return { ...target, grants };
    });
  }

  private async loadEligibleUser(
    userId: string,
  ): Promise<Omit<OperationalPointScopeResponse, 'grants'>> {
    return this.loadEligibleUserOn(this.database.db, userId);
  }

  private async loadEligibleUserOn(
    conn: Tx | Database['db'],
    userId: string,
  ): Promise<Omit<OperationalPointScopeResponse, 'grants'>> {
    const user = (
      await conn.execute<{
        id: string;
        username: string;
        display_name: string;
        active: boolean;
      }>(sql`select id, username, display_name, active from users where id = ${userId}::uuid`)
    ).rows[0];
    if (!user || !user.active) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User was not found' });
    }
    const membership = await conn.execute<{
      organization_id: string;
      organization_code: string;
      role_code: string;
    }>(sql`
      select o.id as organization_id, o.code as organization_code, r.code as role_code
      from user_organization_roles uor
      join organizations o on o.id = uor.organization_id
      join roles r on r.id = uor.role_id
      where uor.user_id = ${userId}::uuid and uor.active = true
      order by o.code, r.code
    `);
    const roles = membership.rows.map((row) => row.role_code);
    const medicarte = membership.rows.find((row) => row.organization_code === 'MEDICARTE');
    return {
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      organizationId: medicarte?.organization_id ?? membership.rows[0]?.organization_id ?? '',
      organizationCode: medicarte?.organization_code ?? membership.rows[0]?.organization_code ?? '',
      roles,
      eligible: isPointScopeEligibleTarget(roles),
    };
  }

  private async listActiveGrants(userId: string): Promise<OperationalPointGrant[]> {
    return this.listActiveGrantsOn(this.database.db, userId);
  }

  private async listActiveGrantsOn(
    conn: Tx | Database['db'],
    userId: string,
  ): Promise<OperationalPointGrant[]> {
    const result = await conn.execute<{
      id: string;
      dispensing_point_id: string;
      code: string;
      name: string;
      active: boolean;
      granted_at: Date | string;
      granted_by: string;
    }>(sql`
      select ups.id, ups.dispensing_point_id, dp.code, dp.name, dp.active, ups.granted_at, ups.granted_by
      from user_point_scopes ups
      join dispensing_points dp on dp.id = ups.dispensing_point_id
      where ups.user_id = ${userId}::uuid and ups.revoked_at is null
      order by dp.name, dp.code
    `);
    return result.rows.map((row) => ({
      id: row.id,
      dispensingPointId: row.dispensing_point_id,
      dispensingPointCode: row.code,
      dispensingPointName: row.name,
      active: row.active,
      grantedAt:
        row.granted_at instanceof Date ? row.granted_at.toISOString() : String(row.granted_at),
      grantedBy: row.granted_by,
    }));
  }

  private async assertGrantablePoints(tx: Tx, pointIds: readonly string[]): Promise<void> {
    const placeholders = pointIds.map((id) => sql`${id}::uuid`);
    const result = await tx.execute<{
      id: string;
      organization_id: string;
      active: boolean;
    }>(sql`
      select id, organization_id, active
      from dispensing_points
      where id in (${sql.join(placeholders, sql`, `)})
    `);
    if (result.rows.length !== pointIds.length) {
      throw new BadRequestException({
        code: 'DISPENSING_POINT_NOT_FOUND',
        message: 'One or more dispensing points do not exist',
      });
    }
    for (const row of result.rows) {
      if (row.organization_id !== MEDICARTE_ORG_ID) {
        throw new BadRequestException({
          code: 'POINT_SCOPE_ORGANIZATION_MISMATCH',
          message: 'Point grants are limited to Medicarte dispensing points',
        });
      }
      if (!row.active) {
        throw new BadRequestException({
          code: 'POINT_SCOPE_INACTIVE_POINT',
          message: 'Inactive dispensing points cannot receive new grants',
        });
      }
    }
  }

  private async audit(
    tx: Tx,
    actor: Scope,
    action: string,
    resourceId: string,
    after: unknown,
  ): Promise<void> {
    await tx.execute(sql`
      insert into audit_events
        (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
      values (
        'USER', ${actor.userId}, ${actor.organizationId}, ${action}, 'user_point_scope', ${resourceId},
        ${JSON.stringify(after)}::jsonb, ${actor.correlationId}::uuid, ${actor.correlationId}, 'SUCCESS'
      )
    `);
  }
}

export function pointAccessDeniedHttp(): ForbiddenException {
  return new ForbiddenException({
    code: POINT_ACCESS_DENIED,
    message: 'The dispensing point is outside the actor data scope',
  });
}
