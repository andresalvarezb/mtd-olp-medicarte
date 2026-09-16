import { Inject, Injectable, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { MeResponse } from '@authorization/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import {
  organizations,
  permissions,
  rolePermissions,
  roles,
  userOrganizationRoles,
  userPointScopes,
  users,
} from '@authorization/database';
import type { createDatabase } from '@authorization/database';
import { effectivePermissionCodes, isPermissionAllowedForActor } from '@authorization/domain';
import { DATABASE } from '../tokens';
import { pointAccessKindFor } from '../common/request-scope';

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
        roleIsSystemAdmin: roles.isSystemAdmin,
        permissionCode: permissions.code,
      })
      .from(users)
      .innerJoin(
        userOrganizationRoles,
        and(eq(userOrganizationRoles.userId, users.id), eq(userOrganizationRoles.active, true)),
      )
      .innerJoin(organizations, eq(organizations.id, userOrganizationRoles.organizationId))
      .innerJoin(roles, and(eq(roles.id, userOrganizationRoles.roleId), eq(roles.active, true)))
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

    const scopes = new Map<
      string,
      Omit<MeResponse['organizations'][number], 'pointAccess'> & {
        pointAccess?: MeResponse['organizations'][number]['pointAccess'];
        roleSnapshots: Array<{ code: string; isSystemAdmin: boolean }>;
      }
    >();
    for (const row of rows) {
      if (!row.organizationActive) continue;
      const scope = scopes.get(row.organizationId) ?? {
        id: row.organizationId,
        code: row.organizationCode,
        name: row.organizationName,
        roles: [],
        isSystemAdmin: false,
        permissions: [],
        roleSnapshots: [],
      };
      if (!scope.roles.includes(row.roleCode)) scope.roles.push(row.roleCode);
      if (row.permissionCode && !scope.permissions.includes(row.permissionCode))
        scope.permissions.push(row.permissionCode);
      if (!scope.roleSnapshots.some((role) => role.code === row.roleCode)) {
        scope.roleSnapshots.push({
          code: row.roleCode,
          isSystemAdmin: row.roleIsSystemAdmin,
        });
      }
      scopes.set(row.organizationId, scope);
    }

    const grantedPoints = await this.database.db
      .select({ dispensingPointId: userPointScopes.dispensingPointId })
      .from(userPointScopes)
      .where(and(eq(userPointScopes.userId, userId), isNull(userPointScopes.revokedAt)));
    const accessiblePointIds = grantedPoints.map((row) => row.dispensingPointId);

    for (const scope of scopes.values()) {
      scope.permissions = [
        ...effectivePermissionCodes({
          organizationCode: scope.code,
          roles: scope.roleSnapshots,
          grantedPermissionCodes: scope.permissions,
        }),
      ];
    }

    return {
      id: first.userId,
      username: first.username,
      displayName: first.displayName,
      mustChangePassword: first.mustChangePassword,
      organizations: [...scopes.values()].map((organization) => {
        const kind = pointAccessKindFor(organization.code, organization.roles);
        return {
          id: organization.id,
          code: organization.code,
          name: organization.name,
          roles: organization.roles,
          isSystemAdmin: organization.roleSnapshots.some(
            (role) => role.code === 'MTD_ADMIN' && role.isSystemAdmin,
          ),
          permissions: organization.permissions,
          pointAccess: {
            kind,
            accessiblePointIds: kind === 'explicit' ? accessiblePointIds : [],
          },
        };
      }),
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
    const actorCanUsePermission = scope?.roles.some((roleCode) =>
      isPermissionAllowedForActor(scope.code, roleCode, permission),
    );
    if (!scope?.permissions.includes(permission) || !actorCanUsePermission) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'Permission denied for organization',
      });
    }
    return profile;
  }
}
