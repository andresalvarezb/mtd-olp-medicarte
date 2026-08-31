import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ApprovePendingUserRequest,
  CreateAssignmentRequest,
  CreateUserRequest,
  PendingUserRequest,
  UpdateUserRequest,
  UserResponse,
} from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';
import { KeycloakAdminService } from './keycloak-admin.service';

type Database = ReturnType<typeof createDatabase>;

interface UserRow {
  id: string;
  oidc_subject: string;
  email: string;
  display_name: string;
  active: boolean;
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

interface PendingRow {
  id: string;
  oidc_subject: string;
  email: string;
  display_name: string | null;
  status: string;
  requested_at: Date;
  resolved_at: Date | null;
}

function toIso(value: Date): string {
  return value.toISOString();
}

function rowToPending(row: PendingRow): PendingUserRequest {
  return {
    id: row.id,
    subject: row.oidc_subject,
    email: row.email,
    displayName: row.display_name,
    status: row.status as PendingUserRequest['status'],
    requestedAt: toIso(row.requested_at),
    resolvedAt: row.resolved_at ? toIso(row.resolved_at) : null,
  };
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly keycloakAdmin: KeycloakAdminService,
  ) {}

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
      `select id, oidc_subject, email, display_name, active, created_at, updated_at
       from users where id = $1`,
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
      subject: row.oidc_subject,
      email: row.email,
      displayName: row.display_name,
      active: row.active,
      assignments,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  async list(active: boolean | undefined): Promise<{ items: UserResponse[] }> {
    const rows = await this.database.pool.query<UserRow>(
      `select id, oidc_subject, email, display_name, active, created_at, updated_at
       from users ${active === undefined ? '' : 'where active = $1'} order by created_at, email`,
      active === undefined ? [] : [active],
    );
    const assignments = await this.loadAssignments(rows.rows.map((row) => row.id));
    return {
      items: rows.rows.map((row) => this.toResponse(row, assignments.get(row.id) ?? [])),
    };
  }

  async create(input: { body: CreateUserRequest; scope: Scope }): Promise<UserResponse> {
    const { body, scope } = input;
    const organization = await this.database.pool.query(
      `select id, code, name from organizations where id = $1 and active = true`,
      [body.organizationId],
    );
    if (!organization.rows[0]) {
      throw new BadRequestException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found or inactive',
      });
    }
    const role = await this.database.pool.query(`select id, code from roles where code = $1`, [
      body.roleCode,
    ]);
    const roleRow = role.rows[0] as { id: string; code: string } | undefined;
    if (!roleRow) {
      throw new BadRequestException({ code: 'ROLE_NOT_FOUND', message: 'Role not found' });
    }

    const subject = await this.keycloakAdmin.createUser({
      email: body.email,
      displayName: body.displayName,
      password: body.password,
    });

    try {
      const inserted = await this.database.pool.query<UserRow>(
        `insert into users (oidc_subject, email, display_name, active)
         values ($1, $2, $3, true)
         returning id, oidc_subject, email, display_name, active, created_at, updated_at`,
        [subject, body.email, body.displayName],
      );
      const user = inserted.rows[0];
      if (!user) {
        throw new Error('User insert did not return a row');
      }
      await this.database.pool.query(
        `insert into user_organization_roles (user_id, organization_id, role_id, active)
         values ($1, $2, $3, true)
         on conflict (user_id, organization_id, role_id) do update set active = true`,
        [user.id, body.organizationId, roleRow.id],
      );
      const assignments = await this.loadAssignments([user.id]);
      const response = this.toResponse(user, assignments.get(user.id) ?? []);
      await this.audit(scope, 'USER_CREATED', user.id, {
        email: body.email,
        roleCode: body.roleCode,
      });
      return response;
    } catch (error) {
      // Compensación: si el alta local falla, deshabilitamos el usuario en Keycloak.
      await this.keycloakAdmin.setUserEnabled(subject, false).catch(() => undefined);
      throw error;
    }
  }

  async update(input: {
    userId: string;
    body: UpdateUserRequest;
    scope: Scope;
  }): Promise<UserResponse> {
    const user = await this.getUserRow(input.userId);
    if (input.body.active === false && user.id === input.scope.userId) {
      throw new BadRequestException({
        code: 'SELF_DEACTIVATION_FORBIDDEN',
        message: 'You cannot deactivate your own account',
      });
    }
    if (input.body.active !== undefined && user.oidc_subject) {
      await this.keycloakAdmin.setUserEnabled(user.oidc_subject, input.body.active);
    }
    const updated = await this.database.pool.query<UserRow>(
      `update users set
         display_name = coalesce($2, display_name),
         active = coalesce($3, active),
         updated_at = now()
       where id = $1
       returning id, oidc_subject, email, display_name, active, created_at, updated_at`,
      [user.id, input.body.displayName ?? null, input.body.active ?? null],
    );
    const updatedRow = updated.rows[0];
    if (!updatedRow) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }
    const assignments = await this.loadAssignments([user.id]);
    const response = this.toResponse(updatedRow, assignments.get(user.id) ?? []);
    await this.audit(
      input.scope,
      input.body.active === false ? 'USER_DEACTIVATED' : 'USER_UPDATED',
      user.id,
      {
        displayName: input.body.displayName,
        active: input.body.active,
      },
    );
    return response;
  }

  async addAssignment(input: {
    userId: string;
    body: CreateAssignmentRequest;
    scope: Scope;
  }): Promise<UserResponse> {
    const user = await this.getUserRow(input.userId);
    const organization = await this.database.pool.query(
      `select id from organizations where id = $1 and active = true`,
      [input.body.organizationId],
    );
    if (!organization.rows[0]) {
      throw new BadRequestException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found or inactive',
      });
    }
    const role = await this.database.pool.query(`select id from roles where code = $1`, [
      input.body.roleCode,
    ]);
    const roleRow = role.rows[0] as { id: string } | undefined;
    if (!roleRow) {
      throw new BadRequestException({ code: 'ROLE_NOT_FOUND', message: 'Role not found' });
    }
    await this.database.pool.query(
      `insert into user_organization_roles (user_id, organization_id, role_id, active)
       values ($1, $2, $3, true)
       on conflict (user_id, organization_id, role_id) do update set active = true`,
      [user.id, input.body.organizationId, roleRow.id],
    );
    const assignments = await this.loadAssignments([user.id]);
    const response = this.toResponse(user, assignments.get(user.id) ?? []);
    await this.audit(input.scope, 'USER_ROLE_ASSIGNED', user.id, {
      organizationId: input.body.organizationId,
      roleCode: input.body.roleCode,
    });
    return response;
  }

  async revokeAssignment(input: {
    userId: string;
    organizationId: string;
    scope: Scope;
  }): Promise<UserResponse> {
    const user = await this.getUserRow(input.userId);
    const result = await this.database.pool.query(
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
    await this.audit(input.scope, 'USER_ROLE_REVOKED', user.id, {
      organizationId: input.organizationId,
    });
    return response;
  }

  async listPendingRequests(): Promise<{ items: PendingUserRequest[] }> {
    const rows = await this.database.pool.query<PendingRow>(
      `select id, oidc_subject, email, display_name, status, requested_at, resolved_at
       from pending_user_requests where status = 'PENDING'
       order by requested_at`,
    );
    return { items: rows.rows.map(rowToPending) };
  }

  async approvePendingRequest(input: {
    requestId: string;
    body: ApprovePendingUserRequest;
    scope: Scope;
  }): Promise<{ userId: string }> {
    const pending = await this.database.pool.query<PendingRow>(
      `select id, oidc_subject, email, display_name, status, requested_at, resolved_at
       from pending_user_requests where id = $1`,
      [input.requestId],
    );
    const request = pending.rows[0];
    if (!request) {
      throw new NotFoundException({
        code: 'PENDING_REQUEST_NOT_FOUND',
        message: 'Pending request not found',
      });
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException({
        code: 'PENDING_REQUEST_ALREADY_RESOLVED',
        message: 'Pending request already resolved',
      });
    }
    const organization = await this.database.pool.query(
      `select id from organizations where id = $1 and active = true`,
      [input.body.organizationId],
    );
    if (!organization.rows[0]) {
      throw new BadRequestException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found or inactive',
      });
    }
    const role = await this.database.pool.query(`select id from roles where code = $1`, [
      input.body.roleCode,
    ]);
    const roleRow = role.rows[0] as { id: string } | undefined;
    if (!roleRow) {
      throw new BadRequestException({ code: 'ROLE_NOT_FOUND', message: 'Role not found' });
    }

    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const existing = await client.query<{ id: string }>(
        `select id from users where oidc_subject = $1`,
        [request.oidc_subject],
      );
      let id = existing.rows[0]?.id ?? null;
      if (!id) {
        const inserted = await client.query<{ id: string }>(
          `insert into users (oidc_subject, email, display_name, active)
           values ($1, $2, $3, true)
           on conflict (oidc_subject) do update set updated_at = now()
           returning id`,
          [request.oidc_subject, request.email, request.display_name ?? request.email],
        );
        id = inserted.rows[0]?.id ?? null;
        if (!id) {
          throw new Error('User insert did not return an id');
        }
      }
      await client.query(
        `insert into user_organization_roles (user_id, organization_id, role_id, active)
         values ($1, $2, $3, true)
         on conflict (user_id, organization_id, role_id) do update set active = true`,
        [id, input.body.organizationId, roleRow.id],
      );
      await client.query(
        `update pending_user_requests
         set status = 'APPROVED', resolved_at = now(), resolved_by = $2
         where id = $1`,
        [request.id, input.scope.userId],
      );
      await client.query(
        `insert into audit_events
           (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
         values ('USER', $1, $2, 'ACCESS_REQUEST_APPROVED', 'user', $3, $4::jsonb, $5::uuid, $6, 'SUCCESS')`,
        [
          input.scope.userId,
          input.scope.organizationId,
          id,
          JSON.stringify({ subject: request.oidc_subject, roleCode: input.body.roleCode }),
          input.scope.correlationId,
          input.scope.correlationId,
        ],
      );
      await client.query('commit');
      return { userId: id };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async rejectPendingRequest(input: { requestId: string; scope: Scope }): Promise<void> {
    const result = await this.database.pool.query(
      `update pending_user_requests
       set status = 'REJECTED', resolved_at = now(), resolved_by = $2
       where id = $1 and status = 'PENDING'`,
      [input.requestId, input.scope.userId],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException({
        code: 'PENDING_REQUEST_NOT_FOUND',
        message: 'Pending request not found or already resolved',
      });
    }
    await this.audit(input.scope, 'ACCESS_REQUEST_REJECTED', input.requestId, {});
  }
}
