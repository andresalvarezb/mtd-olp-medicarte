import { Inject, Injectable, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { MeResponse } from '@authorization/contracts';
import { and, eq } from 'drizzle-orm';
import {
  organizations,
  permissions,
  rolePermissions,
  roles,
  userOrganizationRoles,
  users,
} from '@authorization/database';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;

@Injectable()
export class AccessService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /**
   * Registra (best effort) la solicitud de acceso cuando un usuario autenticado
   * en Keycloak aún no tiene cuenta local. El admin la gestiona desde /users.
   */
  private async recordPendingRequest(
    subject: string,
    email?: string,
    displayName?: string,
  ): Promise<void> {
    try {
      await this.database.pool.query(
        `insert into pending_user_requests (oidc_subject, email, display_name, status)
         values ($1, $2, $3, 'PENDIENTE')
         on conflict (oidc_subject) do update
           set email = excluded.email,
               display_name = coalesce(excluded.display_name, pending_user_requests.display_name),
               requested_at = now()
         where pending_user_requests.status = 'PENDIENTE'`,
        [subject, email ?? `${subject}@unknown.subject`, displayName ?? null],
      );
    } catch {
      // Nunca bloquea el flujo de autenticación.
    }
  }

  async getProfile(
    subject: string,
    identity?: { email?: string; displayName?: string },
  ): Promise<MeResponse> {
    const rows = await this.database.db
      .select({
        userId: users.id,
        subject: users.oidcSubject,
        email: users.email,
        displayName: users.displayName,
        userActive: users.active,
        organizationId: organizations.id,
        organizationCode: organizations.code,
        organizationName: organizations.name,
        organizationActive: organizations.active,
        roleCode: roles.code,
        permissionCode: permissions.code,
      })
      .from(users)
      .innerJoin(
        userOrganizationRoles,
        and(eq(userOrganizationRoles.userId, users.id), eq(userOrganizationRoles.active, true)),
      )
      .innerJoin(organizations, eq(organizations.id, userOrganizationRoles.organizationId))
      .innerJoin(roles, eq(roles.id, userOrganizationRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(users.oidcSubject, subject));

    const first = rows[0];
    if (!first) {
      await this.recordPendingRequest(subject, identity?.email, identity?.displayName);
      throw new UnauthorizedException({
        code: 'LOCAL_USER_INACTIVE',
        message: 'Local user is not active',
      });
    }
    if (!first.userActive) {
      throw new UnauthorizedException({
        code: 'LOCAL_USER_INACTIVE',
        message: 'Local user is not active',
      });
    }

    const scopes = new Map<string, MeResponse['organizations'][number]>();
    for (const row of rows) {
      if (!row.organizationActive) continue;
      const scope = scopes.get(row.organizationId) ?? {
        id: row.organizationId,
        code: row.organizationCode,
        name: row.organizationName,
        roles: [],
        permissions: [],
      };
      if (!scope.roles.includes(row.roleCode)) scope.roles.push(row.roleCode);
      if (row.permissionCode && !scope.permissions.includes(row.permissionCode))
        scope.permissions.push(row.permissionCode);
      scopes.set(row.organizationId, scope);
    }

    return {
      id: first.userId,
      subject: first.subject,
      email: first.email,
      displayName: first.displayName,
      organizations: [...scopes.values()],
    };
  }

  async requirePermission(
    subject: string,
    organizationId: string | undefined,
    permission: string,
  ): Promise<MeResponse> {
    if (!organizationId) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_REQUIRED',
        message: 'X-Organization-Id is required',
      });
    }
    const profile = await this.getProfile(subject);
    const scope = profile.organizations.find((organization) => organization.id === organizationId);
    if (!scope?.permissions.includes(permission)) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'Permission denied for organization',
      });
    }
    return profile;
  }
}
