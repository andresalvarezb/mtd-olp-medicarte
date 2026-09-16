import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  ACCESS_MODULE_REGISTRY,
  ACCESS_PERMISSION_REGISTRY,
  type CreateRoleRequest,
  type RoleAccessModule,
  type RoleAccessResponse,
  type RoleSummary,
  type RolesResponse,
  type UpdateRoleRequest,
  type UpdateRoleAccessRequest,
} from '@authorization/contracts';
import {
  ORGANIZATION_ROLE_MATRIX,
  isPredefinedRole,
  isCustomRole,
  isPermissionAllowedForActor,
  isProtectedRole,
} from '@authorization/domain';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';

type Database = ReturnType<typeof createDatabase>;

type RoleRow = {
  id: string;
  code: string;
  name: string;
  is_system_admin: boolean;
  is_system_managed: boolean;
  active: boolean;
  user_count: string;
  permission_count: string;
};

type RoleScopeRow = {
  role_id: string;
  organization_code: string;
};

const ROLE_LABELS: Readonly<Record<string, string>> = {
  MTD_ADMIN: 'Administrador',
  MTD_OPERATOR: 'Operador MTD',
  MTD_GENERAL: 'MTD General',
  MTD_AUDITORIA: 'Auditoría MTD',
  READ_ONLY: 'Solo lectura',
  MEDICARTE_OPERATOR: 'Operador Medicarte',
  OLP_OPERATOR: 'Operador OLP',
  COMPENSAR_VIEWER: 'Consulta Compensar',
};

function fingerprint(permissionCodes: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([...permissionCodes].sort()))
    .digest('hex');
}

function toRoleSummary(row: RoleRow, allowedOrganizationCodes: readonly string[]): RoleSummary {
  return {
    code: row.code,
    name: row.name,
    label: ROLE_LABELS[row.code] ?? row.name,
    active: row.active,
    isCustom: isCustomRole(row.code),
    isSystemAdmin: row.is_system_admin,
    isSystemManaged: row.is_system_managed,
    isProtected: isProtectedRole(row.code),
    allowedOrganizationCodes: [...allowedOrganizationCodes],
    userCount: Number(row.user_count),
    permissionCount: Number(row.permission_count),
  };
}

@Injectable()
export class RoleAccessService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private async loadOrganizationCodes(roleIds: readonly string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (!roleIds.length) return result;
    const rows = await this.database.pool.query<RoleScopeRow>(
      `select ros.role_id, o.code as organization_code
         from role_organization_scopes ros
         join organizations o on o.id = ros.organization_id
        where ros.role_id = any($1::uuid[])
        order by o.code`,
      [roleIds],
    );
    for (const row of rows.rows) {
      const codes = result.get(row.role_id) ?? [];
      codes.push(row.organization_code);
      result.set(row.role_id, codes);
    }
    return result;
  }

  private async organizationIds(codes: readonly string[]): Promise<string[]> {
    const result = await this.database.pool.query<{ id: string; code: string }>(
      `select id, code from organizations where code = any($1::text[]) and active = true`,
      [codes],
    );
    if (result.rows.length !== codes.length) {
      throw new BadRequestException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'One or more organizations are not found or inactive',
      });
    }
    return result.rows.map((row) => row.id);
  }

  async list(): Promise<RolesResponse> {
    const result = await this.database.pool.query<RoleRow>(
      `select r.id, r.code, r.name, r.is_system_admin, r.is_system_managed, r.active,
              count(distinct uor.user_id) filter (where uor.active)::text as user_count,
              count(distinct rp.permission_id)::text as permission_count
         from roles r
         left join user_organization_roles uor on uor.role_id = r.id
         left join role_permissions rp on rp.role_id = r.id
        group by r.id
        order by r.code`,
    );
    const scopes = await this.loadOrganizationCodes(result.rows.map((row) => row.id));
    return {
      items: result.rows.map((row) => toRoleSummary(row, scopes.get(row.id) ?? [])),
    };
  }

  private async getRole(code: string): Promise<RoleRow> {
    const result = await this.database.pool.query<RoleRow>(
      `select r.id, r.code, r.name, r.is_system_admin, r.is_system_managed, r.active,
              count(distinct uor.user_id) filter (where uor.active)::text as user_count,
              count(distinct rp.permission_id)::text as permission_count
         from roles r
         left join user_organization_roles uor on uor.role_id = r.id
         left join role_permissions rp on rp.role_id = r.id
        where r.code = $1
        group by r.id`,
      [code],
    );
    const role = result.rows[0];
    if (!role) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Role not found' });
    }
    if (!isPredefinedRole(role.code) && !isCustomRole(role.code)) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Role not found' });
    }
    return role;
  }

  private isEditablePermission(
    roleCode: string,
    permissionCode: string,
    organizationCodes: readonly string[],
  ): boolean {
    const definition = ACCESS_PERMISSION_REGISTRY.find(
      (permission) => permission.permissionCode === permissionCode,
    );
    if (
      !definition ||
      definition.lifecycle !== 'ACTIVE' ||
      !definition.configurable ||
      !definition.systemAllowed ||
      definition.structural ||
      isProtectedRole(roleCode)
    ) {
      return false;
    }

    const organizations = isCustomRole(roleCode)
      ? organizationCodes
      : Object.keys(ORGANIZATION_ROLE_MATRIX).filter((organizationCode) =>
          (ORGANIZATION_ROLE_MATRIX as Readonly<Record<string, readonly string[]>>)[
            organizationCode
          ]?.includes(roleCode),
        );
    return (
      organizations.length > 0 &&
      organizations.every((organizationCode) =>
        isPermissionAllowedForActor(organizationCode, roleCode, permissionCode),
      )
    );
  }

  private async currentPermissionCodes(roleId: string): Promise<string[]> {
    const result = await this.database.pool.query<{ code: string }>(
      `select p.code
         from role_permissions rp
         join permissions p on p.id = rp.permission_id
        where rp.role_id = $1
        order by p.code`,
      [roleId],
    );
    return result.rows.map((row) => row.code);
  }

  async getAccess(roleCode: string): Promise<RoleAccessResponse> {
    const role = await this.getRole(roleCode);
    const organizationCodes = (await this.loadOrganizationCodes([role.id])).get(role.id) ?? [];
    const enabled = new Set(await this.currentPermissionCodes(role.id));
    const modules: RoleAccessModule[] = ACCESS_MODULE_REGISTRY.map((module) => ({
      ...module,
      actions: module.actions.map((action) => ({
        ...action,
        enabled: enabled.has(action.permissionCode),
        editable:
          role.active &&
          this.isEditablePermission(role.code, action.permissionCode, organizationCodes),
      })),
    }));

    return {
      role: toRoleSummary(role, organizationCodes),
      fingerprint: fingerprint([...enabled]),
      modules,
    };
  }

  async createRole(input: { body: CreateRoleRequest; scope: Scope }): Promise<RoleSummary> {
    const organizationIds = await this.organizationIds(input.body.organizationCodes);
    const slug = input.body.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48);
    const code = `CUSTOM_${slug || 'ROLE'}_${randomUUID().slice(0, 8).toUpperCase()}`;
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query<{ id: string }>(
        `insert into roles (code, name, is_system_admin, is_system_managed, active)
         values ($1, $2, false, false, true)
         returning id`,
        [code, input.body.name.trim()],
      );
      const roleId = inserted.rows[0]?.id;
      if (!roleId) throw new Error('Role insert did not return an id');
      await client.query(
        `insert into role_organization_scopes (role_id, organization_id)
         select $1, unnest($2::uuid[])`,
        [roleId, organizationIds],
      );
      await client.query(
        `insert into audit_events
          (actor_type, actor_id, organization_id, action, resource_type, resource_id,
           after, correlation_id, request_id, result)
         values ('USER', $1, $2, 'ROLE_CREATED', 'role', $3, $4::jsonb,
                 $5::uuid, $5, 'SUCCESS')`,
        [
          input.scope.userId,
          input.scope.organizationId,
          code,
          JSON.stringify({
            name: input.body.name.trim(),
            organizationCodes: input.body.organizationCodes,
          }),
          input.scope.correlationId,
        ],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const role = await this.getRole(code);
    const organizationCodes = (await this.loadOrganizationCodes([role.id])).get(role.id) ?? [];
    return toRoleSummary(role, organizationCodes);
  }

  async updateRole(input: {
    roleCode: string;
    body: UpdateRoleRequest;
    scope: Scope;
  }): Promise<RoleSummary> {
    const role = await this.getRole(input.roleCode);
    if (!isCustomRole(role.code) || isProtectedRole(role.code)) {
      throw new BadRequestException({
        code: 'ROLE_PROTECTED',
        message: 'Predefined and protected roles cannot be renamed or deactivated',
      });
    }
    const organizationIds =
      input.body.organizationCodes !== undefined
        ? await this.organizationIds(input.body.organizationCodes)
        : undefined;
    const originalOrganizationCodes =
      (await this.loadOrganizationCodes([role.id])).get(role.id) ?? [];
    const organizationCodes = input.body.organizationCodes ?? originalOrganizationCodes;
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      await client.query(`select id from roles where id = $1 for update`, [role.id]);
      if (organizationIds) {
        const assignmentsOutsideScope = await client.query<{ count: string }>(
          `select count(*)::text as count
             from user_organization_roles uor
             join organizations o on o.id = uor.organization_id
            where uor.role_id = $1
              and uor.active
              and not (o.code = any($2::text[]))`,
          [role.id, input.body.organizationCodes],
        );
        if (Number(assignmentsOutsideScope.rows[0]?.count ?? 0) > 0) {
          throw new BadRequestException({
            code: 'ROLE_SCOPE_ASSIGNMENTS_CONFLICT',
            message: 'Active assignments exist outside the new role organization scope',
          });
        }
        await client.query(`delete from role_organization_scopes where role_id = $1`, [role.id]);
        await client.query(
          `insert into role_organization_scopes (role_id, organization_id)
           select $1, unnest($2::uuid[])`,
          [role.id, organizationIds],
        );
      }
      await client.query(
        `update roles
            set name = coalesce($2, name),
                active = coalesce($3, active)
          where id = $1`,
        [role.id, input.body.name?.trim() ?? null, input.body.active ?? null],
      );
      if (input.body.active === false) {
        await client.query(
          `update user_organization_roles
              set active = false
            where role_id = $1 and active = true`,
          [role.id],
        );
      }
      await client.query(
        `insert into audit_events
          (actor_type, actor_id, organization_id, action, resource_type, resource_id,
           before, after, correlation_id, request_id, result)
         values ('USER', $1, $2, 'ROLE_UPDATED', 'role', $3, $4::jsonb, $5::jsonb,
                 $6::uuid, $6, 'SUCCESS')`,
        [
          input.scope.userId,
          input.scope.organizationId,
          role.code,
          JSON.stringify({
            name: role.name,
            active: role.active,
            organizationCodes: originalOrganizationCodes,
          }),
          JSON.stringify({
            name: input.body.name?.trim() ?? role.name,
            active: input.body.active ?? role.active,
            organizationCodes,
          }),
          input.scope.correlationId,
        ],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const updated = await this.getRole(role.code);
    const updatedOrganizations =
      (await this.loadOrganizationCodes([updated.id])).get(updated.id) ?? [];
    return toRoleSummary(updated, updatedOrganizations);
  }

  async deleteRole(input: { roleCode: string; scope: Scope }): Promise<{ deleted: true }> {
    const role = await this.getRole(input.roleCode);
    if (!isCustomRole(role.code) || isProtectedRole(role.code)) {
      throw new BadRequestException({
        code: 'ROLE_PROTECTED',
        message: 'Predefined and protected roles cannot be deleted',
      });
    }
    if (role.active) {
      throw new BadRequestException({
        code: 'ROLE_ACTIVE',
        message: 'Deactivate the role before deleting it',
      });
    }
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      await client.query(`select id from roles where id = $1 for update`, [role.id]);
      const assignments = await client.query<{ count: string }>(
        `select count(*)::text as count
           from user_organization_roles
          where role_id = $1 and active = true`,
        [role.id],
      );
      if (Number(assignments.rows[0]?.count ?? 0) > 0) {
        throw new BadRequestException({
          code: 'ROLE_ASSIGNMENTS_EXIST',
          message: 'The role still has active assignments and cannot be deleted',
        });
      }
      await client.query(
        `insert into audit_events
          (actor_type, actor_id, organization_id, action, resource_type, resource_id,
           before, after, correlation_id, request_id, result)
         values ('USER', $1, $2, 'ROLE_DELETED', 'role', $3, $4::jsonb, $5::jsonb,
                 $6::uuid, $6, 'SUCCESS')`,
        [
          input.scope.userId,
          input.scope.organizationId,
          role.code,
          JSON.stringify({ name: role.name, active: role.active }),
          JSON.stringify({ deleted: true }),
          input.scope.correlationId,
        ],
      );
      await client.query(`delete from role_permissions where role_id = $1`, [role.id]);
      await client.query(`delete from role_organization_scopes where role_id = $1`, [role.id]);
      await client.query(`delete from user_organization_roles where role_id = $1`, [role.id]);
      await client.query(`delete from roles where id = $1`, [role.id]);
      await client.query('commit');
      return { deleted: true };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateAccess(input: {
    roleCode: string;
    body: UpdateRoleAccessRequest;
    scope: Scope;
  }): Promise<RoleAccessResponse> {
    const role = await this.getRole(input.roleCode);
    if (role.is_system_managed || isProtectedRole(role.code)) {
      throw new BadRequestException({
        code: 'ROLE_PROTECTED',
        message: 'The administrator role cannot be edited',
      });
    }
    if (!role.active) {
      throw new BadRequestException({
        code: 'ROLE_INACTIVE',
        message: 'An inactive role cannot be edited',
      });
    }
    const organizationCodes = (await this.loadOrganizationCodes([role.id])).get(role.id) ?? [];

    const requested = new Set(input.body.permissionCodes);
    for (const permissionCode of requested) {
      if (!this.isEditablePermission(role.code, permissionCode, organizationCodes)) {
        throw new BadRequestException({
          code: 'ROLE_PERMISSION_NOT_EDITABLE',
          message: `Permission ${permissionCode} cannot be configured for role ${role.code}`,
        });
      }
    }

    const editableCodes = ACCESS_PERMISSION_REGISTRY.filter((permission) =>
      this.isEditablePermission(role.code, permission.permissionCode, organizationCodes),
    ).map((permission) => permission.permissionCode);
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      await client.query(`select id from roles where id = $1 for update`, [role.id]);
      const current = await client.query<{ code: string }>(
        `select p.code
           from role_permissions rp
           join permissions p on p.id = rp.permission_id
          where rp.role_id = $1
          order by p.code
          for update of rp`,
        [role.id],
      );
      const currentCodes = current.rows.map((row) => row.code);
      if (fingerprint(currentCodes) !== input.body.expectedFingerprint) {
        throw new ConflictException({
          code: 'ROLE_ACCESS_CONFLICT',
          message: 'Role access changed since it was loaded',
        });
      }

      await client.query(
        `delete from role_permissions rp
          using permissions p
         where rp.role_id = $1
           and rp.permission_id = p.id
           and p.code = any($2::text[])`,
        [role.id, editableCodes],
      );
      await client.query(
        `insert into role_permissions (role_id, permission_id)
         select $1, p.id
           from permissions p
          where p.code = any($2::text[])
         on conflict do nothing`,
        [role.id, [...requested]],
      );
      await client.query(
        `insert into audit_events
          (actor_type, actor_id, organization_id, action, resource_type, resource_id,
           before, after, correlation_id, request_id, result)
         values ('USER', $1, $2, 'ROLE_ACCESS_CHANGED', 'role', $3, $4::jsonb, $5::jsonb,
                 $6::uuid, $6, 'SUCCESS')`,
        [
          input.scope.userId,
          input.scope.organizationId,
          role.code,
          JSON.stringify({ permissionCodes: currentCodes }),
          JSON.stringify({ permissionCodes: [...requested].sort() }),
          input.scope.correlationId,
        ],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    return this.getAccess(role.code);
  }
}
