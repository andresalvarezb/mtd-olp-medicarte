import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateAssignmentRequest,
  CreateUserRequest,
  UpdateUserRequest,
  UserResponse,
} from '@authorization/contracts';
import {
  assertRoleAllowedForOrganization,
  isCustomRole,
  isPredefinedRole,
} from '@authorization/domain';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';
import { hashPassword } from './password';

type Database = ReturnType<typeof createDatabase>;

interface UserRow {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
  active: boolean;
  password_hash: string | null;
  must_change_password: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface AssignmentRow {
  user_id: string;
  organization_id: string;
  role_id: string;
  active: boolean;
  organization_code: string;
  organization_name: string;
  role_code: string;
}

function toIso(value: Date): string {
  return value.toISOString();
}

const USER_COLUMNS = `id, username, email, display_name, active, password_hash,
  must_change_password, last_login_at, created_at, updated_at`;

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private async audit(
    scope: Scope,
    action: string,
    resourceId: string,
    after: unknown,
  ): Promise<void> {
    await this.database.pool.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
       values ('USER', $1, $2, $3, 'user', $4, $5::jsonb, $6::uuid, $7, 'SUCCESS')`,
      [
        scope.userId,
        scope.organizationId,
        action,
        resourceId,
        JSON.stringify(after),
        scope.correlationId,
        scope.correlationId,
      ],
    );
  }

  private async loadAssignments(
    userIds: string[],
  ): Promise<Map<string, UserResponse['assignments']>> {
    const result = new Map<string, UserResponse['assignments']>();
    if (!userIds.length) return result;
    const rows = await this.database.pool.query<AssignmentRow>(
      `select uor.user_id, uor.organization_id, uor.role_id, uor.active,
              o.code as organization_code, o.name as organization_name, r.code as role_code
       from user_organization_roles uor
       inner join organizations o on o.id = uor.organization_id
       inner join roles r on r.id = uor.role_id
       where uor.user_id = any($1::uuid[])
       order by o.code, r.code`,
      [userIds],
    );
    for (const row of rows.rows) {
      const list = result.get(row.user_id) ?? [];
      list.push({
        organizationId: row.organization_id,
        organizationCode: row.organization_code,
        organizationName: row.organization_name,
        roleCode: row.role_code,
        active: row.active,
      });
      result.set(row.user_id, list);
    }
    return result;
  }

  private async getUserRow(userId: string): Promise<UserRow> {
    const result = await this.database.pool.query<UserRow>(
      `select ${USER_COLUMNS} from users where id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }
    return row;
  }

  private toResponse(row: UserRow, assignments: UserResponse['assignments']): UserResponse {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      displayName: row.display_name,
      active: row.active,
      passwordConfigured: row.password_hash !== null,
      mustChangePassword: row.must_change_password,
      assignments,
      lastLoginAt: row.last_login_at ? toIso(row.last_login_at) : null,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  async list(active: boolean | undefined): Promise<{ items: UserResponse[] }> {
    const rows = await this.database.pool.query<UserRow>(
      `select ${USER_COLUMNS} from users
        ${active === undefined ? '' : 'where active = $1'}
        order by created_at, username`,
      active === undefined ? [] : [active],
    );
    const assignments = await this.loadAssignments(rows.rows.map((row) => row.id));
    return {
      items: rows.rows.map((row) => this.toResponse(row, assignments.get(row.id) ?? [])),
    };
  }

  /**
   * Usuarios administrativos que conservan el sistema operativo: activos, con
   * contraseña local y con el rol MTD_ADMIN vigente. La desactivación o cambio
   * de rol del último de ellos está prohibida (FASE 8).
   */
  private async countActiveAdmins(): Promise<number> {
    const result = await this.database.pool.query<{ count: string }>(
      `select count(distinct u.id)::text as count
         from users u
         join user_organization_roles uor on uor.user_id = u.id and uor.active
         join roles r on r.id = uor.role_id and r.code = 'MTD_ADMIN'
        where u.active = true and u.password_hash is not null`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async isAdmin(userId: string): Promise<boolean> {
    const result = await this.database.pool.query<{ count: string }>(
      `select count(*)::text as count
         from users u
         join user_organization_roles uor on uor.user_id = u.id and uor.active
         join roles r on r.id = uor.role_id and r.code = 'MTD_ADMIN'
        where u.id = $1 and u.active = true`,
      [userId],
    );
    return Number(result.rows[0]?.count ?? 0) > 0;
  }

  private async assertRoleAssignable(
    organizationCode: string,
    roleId: string,
    roleCode: string,
    roleActive: boolean,
  ): Promise<void> {
    if (!roleActive) {
      throw new BadRequestException({
        code: 'ROLE_INACTIVE',
        message: 'Role is inactive',
      });
    }
    if (isPredefinedRole(roleCode)) {
      try {
        assertRoleAllowedForOrganization(organizationCode, roleCode);
      } catch (error) {
        throw new BadRequestException({
          code: 'ORGANIZATION_ROLE_NOT_ALLOWED',
          message: error instanceof Error ? error.message : 'Role is not allowed for organization',
        });
      }
      return;
    }
    if (!isCustomRole(roleCode)) {
      throw new BadRequestException({ code: 'ROLE_NOT_FOUND', message: 'Role not found' });
    }
    const scope = await this.database.pool.query(
      `select 1
         from role_organization_scopes ros
         join organizations o on o.id = ros.organization_id
        where ros.role_id = $1 and o.code = $2 and o.active = true`,
      [roleId, organizationCode],
    );
    if (!scope.rowCount) {
      throw new BadRequestException({
        code: 'ORGANIZATION_ROLE_NOT_ALLOWED',
        message: `Role ${roleCode} cannot be assigned to organization ${organizationCode}`,
      });
    }
  }

  async create(input: { body: CreateUserRequest; scope: Scope }): Promise<UserResponse> {
    const { body, scope } = input;
    const role = await this.database.pool.query<{
      id: string;
      code: string;
      active: boolean;
    }>(`select id, code, active from roles where code = $1`, [body.roleCode]);
    const roleRow = role.rows[0];
    if (!roleRow) {
      throw new BadRequestException({ code: 'ROLE_NOT_FOUND', message: 'Role not found' });
    }
    const requestedOrganizationIds = body.organizationIds ?? [
      ...(body.organizationId ? [body.organizationId] : []),
    ];
    const organizations = await this.database.pool.query<{
      id: string;
      code: string;
      name: string;
    }>(
      `select id, code, name
         from organizations
        where id = any($1::uuid[]) and active = true
        order by code`,
      [requestedOrganizationIds],
    );
    if (
      !requestedOrganizationIds.length ||
      organizations.rows.length !== new Set(requestedOrganizationIds).size
    ) {
      throw new BadRequestException({
        code: 'ORGANIZATION_SELECTION_REQUIRED',
        message: 'Select one or more active organizations for the new user',
      });
    }
    for (const organization of organizations.rows) {
      await this.assertRoleAssignable(organization.code, roleRow.id, roleRow.code, roleRow.active);
    }

    const passwordHash = await hashPassword(body.password);
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const taken = await client.query('select 1 from users where lower(username) = lower($1)', [
        body.username,
      ]);
      if (taken.rowCount) {
        throw new ConflictException({
          code: 'USERNAME_TAKEN',
          message: 'A user with that username already exists',
        });
      }
      const inserted = await client.query<UserRow>(
        `insert into users
           (username, email, display_name, password_hash, password_changed_at, active, provenance)
         values ($1, $2, $3, $4, now(), true, 'MANUAL_ADMIN_CREATED')
         returning ${USER_COLUMNS}`,
        [body.username, body.email ?? null, body.displayName, passwordHash],
      );
      const user = inserted.rows[0];
      if (!user) {
        throw new Error('User insert did not return a row');
      }
      await client.query(
        `insert into user_organization_roles (user_id, organization_id, role_id, active)
         select $1, o.id, $2, true
           from organizations o
          where o.id = any($3::uuid[])
         on conflict (user_id, organization_id, role_id) do update set active = true`,
        [user.id, roleRow.id, organizations.rows.map((organization) => organization.id)],
      );
      await client.query('commit');
      const assignments = await this.loadAssignments([user.id]);
      const response = this.toResponse(user, assignments.get(user.id) ?? []);
      await this.audit(scope, 'USER_CREATED', user.id, {
        username: body.username,
        roleCode: body.roleCode,
        organizationCodes: organizations.rows.map((organization) => organization.code),
      });
      return response;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        throw new ConflictException({
          code: 'USERNAME_TAKEN',
          message: 'A user with that username already exists',
        });
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async update(input: {
    userId: string;
    body: UpdateUserRequest;
    scope: Scope;
  }): Promise<UserResponse> {
    const user = await this.getUserRow(input.userId);
    if (input.body.active === false) {
      if (user.id === input.scope.userId) {
        throw new BadRequestException({
          code: 'SELF_DEACTIVATION_FORBIDDEN',
          message: 'You cannot deactivate your own account',
        });
      }
      if ((await this.isAdmin(user.id)) && user.active && (await this.countActiveAdmins()) <= 1) {
        throw new BadRequestException({
          code: 'LAST_ADMIN_PROTECTED',
          message: 'The system cannot be left without an active administrator',
        });
      }
    }
    const updated = await this.database.pool.query<UserRow>(
      `update users set
         display_name = coalesce($2, display_name),
         active = coalesce($3, active),
         updated_at = now()
       where id = $1
       returning ${USER_COLUMNS}`,
      [user.id, input.body.displayName ?? null, input.body.active ?? null],
    );
    const updatedRow = updated.rows[0];
    if (!updatedRow) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }
    const assignments = await this.loadAssignments([user.id]);
    const response = this.toResponse(updatedRow, assignments.get(user.id) ?? []);
    if (input.body.active === false) {
      await this.audit(input.scope, 'USER_DISABLED', user.id, { username: user.username });
    } else if (input.body.active === true) {
      await this.audit(input.scope, 'USER_ENABLED', user.id, { username: user.username });
    } else {
      await this.audit(input.scope, 'USER_UPDATED', user.id, {
        displayName: input.body.displayName,
      });
    }
    return response;
  }

  /** Restablecimiento administrativo: la contraseña es un secreto, nunca se loguea ni se audita. */
  async resetPassword(input: {
    userId: string;
    password: string;
    mustChangePassword: boolean;
    scope: Scope;
  }): Promise<UserResponse> {
    const user = await this.getUserRow(input.userId);
    const hash = await hashPassword(input.password);
    const updated = await this.database.pool.query<UserRow>(
      `update users
         set password_hash = $2, password_changed_at = now(),
             must_change_password = $3, updated_at = now()
       where id = $1
       returning ${USER_COLUMNS}`,
      [user.id, hash, input.mustChangePassword],
    );
    const updatedRow = updated.rows[0];
    if (!updatedRow) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }
    const assignments = await this.loadAssignments([user.id]);
    await this.audit(input.scope, 'USER_PASSWORD_RESET', user.id, { username: user.username });
    return this.toResponse(updatedRow, assignments.get(user.id) ?? []);
  }

  async addAssignment(input: {
    userId: string;
    body: CreateAssignmentRequest;
    scope: Scope;
  }): Promise<UserResponse> {
    const user = await this.getUserRow(input.userId);
    const organization = await this.database.pool.query<{ id: string; code: string }>(
      `select id, code from organizations where id = $1 and active = true`,
      [input.body.organizationId],
    );
    if (!organization.rows[0]) {
      throw new BadRequestException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found or inactive',
      });
    }
    const role = await this.database.pool.query<{ id: string; code: string; active: boolean }>(
      `select id, code, active from roles where code = $1`,
      [input.body.roleCode],
    );
    const roleRow = role.rows[0];
    if (!roleRow) {
      throw new BadRequestException({ code: 'ROLE_NOT_FOUND', message: 'Role not found' });
    }
    await this.assertRoleAssignable(
      organization.rows[0].code,
      roleRow.id,
      roleRow.code,
      roleRow.active,
    );
    await this.database.pool.query(
      `insert into user_organization_roles (user_id, organization_id, role_id, active)
       values ($1, $2, $3, true)
       on conflict (user_id, organization_id, role_id) do update set active = true`,
      [user.id, input.body.organizationId, roleRow.id],
    );
    const assignments = await this.loadAssignments([user.id]);
    const response = this.toResponse(user, assignments.get(user.id) ?? []);
    await this.audit(input.scope, 'USER_ROLE_CHANGED', user.id, {
      organizationId: input.body.organizationId,
      roleCode: input.body.roleCode,
      effect: 'ASSIGNED',
    });
    return response;
  }

  async revokeAssignment(input: {
    userId: string;
    organizationId: string;
    roleCode?: string;
    scope: Scope;
  }): Promise<UserResponse> {
    const user = await this.getUserRow(input.userId);
    const targetRoleCode = input.roleCode
      ? input.roleCode
      : await this.organizationRoleOf(user.id, input.organizationId);
    if (
      (await this.isAdmin(user.id)) &&
      (await this.countActiveAdmins()) <= 1 &&
      targetRoleCode === 'MTD_ADMIN'
    ) {
      throw new BadRequestException({
        code: 'LAST_ADMIN_PROTECTED',
        message: 'The system cannot be left without an active administrator',
      });
    }
    const result = input.roleCode
      ? await this.database.pool.query(
          `update user_organization_roles
              set active = false
            where user_id = $1
              and organization_id = $2
              and role_id = (select id from roles where code = $3)
              and active = true`,
          [user.id, input.organizationId, input.roleCode],
        )
      : await this.database.pool.query(
          `update user_organization_roles set active = false
           where user_id = $1 and organization_id = $2 and active = true`,
          [user.id, input.organizationId],
        );
    if (result.rowCount === 0) {
      throw new NotFoundException({
        code: 'ASSIGNMENT_NOT_FOUND',
        message: 'Active assignment not found',
      });
    }
    const assignments = await this.loadAssignments([user.id]);
    const response = this.toResponse(user, assignments.get(user.id) ?? []);
    await this.audit(input.scope, 'USER_ROLE_CHANGED', user.id, {
      organizationId: input.organizationId,
      roleCode: input.roleCode ?? null,
      effect: 'REVOKED',
    });
    return response;
  }

  private async organizationRoleOf(userId: string, organizationId: string): Promise<string | null> {
    const result = await this.database.pool.query<{ role_code: string }>(
      `select r.code as role_code
         from user_organization_roles uor
         join roles r on r.id = uor.role_id
        where uor.user_id = $1 and uor.organization_id = $2 and uor.active = true
        order by r.code limit 1`,
      [userId, organizationId],
    );
    return result.rows[0]?.role_code ?? null;
  }
}
