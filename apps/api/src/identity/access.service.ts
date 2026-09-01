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

/**
 * ADR-026: identidad local en PostgreSQL. Los perfiles se resuelven por
 * users.id (sub del JWT propio). Roles y permisos se leen SIEMPRE desde la
 * base en cada request: el JWT no es fuente de autoridad.
 */
@Injectable()
export class AccessService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async getProfile(userId: string): Promise<MeResponse> {
    const rows = await this.database.db
      .select({
        userId: users.id,
        username: users.username,
        displayName: users.displayName,
        mustChangePassword: users.mustChangePassword,
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
      .where(eq(users.id, userId));

    const first = rows[0];
    if (!first || !first.userActive) {
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
      username: first.username,
      displayName: first.displayName,
      mustChangePassword: first.mustChangePassword,
      organizations: [...scopes.values()],
    };
  }

  async requirePermission(
    userId: string,
    organizationId: string | undefined,
    permission: string,
  ): Promise<MeResponse> {
    if (!organizationId) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_REQUIRED',
        message: 'X-Organization-Id is required',
      });
    }
    const profile = await this.getProfile(userId);
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
