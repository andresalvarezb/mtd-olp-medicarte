import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { createDatabase } from '@authorization/database';
import type { ReconciliationIssueListQuery } from '@authorization/contracts';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;

export type IssueRow = {
  id: string;
  tenant_id: string;
  rule_code: string;
  fingerprint: string;
  domain: string;
  category: string;
  status: string;
  current_severity: string;
  max_severity_seen: string;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  occurrence_count: number;
  first_run_id: string;
  last_run_id: string;
  last_finding_id: string;
  first_rule_version: string;
  last_rule_version: string;
  assigned_to_user_id: string | null;
  assignee_username: string | null;
  assignee_display_name: string | null;
  acknowledged_at: Date | string | null;
  acknowledged_by: string | null;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  resolution_code: string | null;
  resolution_note: string | null;
  accepted_risk_at: Date | string | null;
  accepted_risk_by: string | null;
  accepted_risk_reason: string | null;
  accepted_risk_severity: string | null;
  accepted_risk_rule_version: string | null;
  risk_review_at: Date | string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

export type IssueEventRow = {
  id: string;
  issue_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor_user_id: string | null;
  reconciliation_run_id: string | null;
  finding_id: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: Date | string;
};

export type IssueCommentRow = {
  id: string;
  issue_id: string;
  author_user_id: string;
  author_username: string;
  body: string;
  created_at: Date | string;
};

const ISSUE_SELECT = `
  select i.*,
         u.username as assignee_username,
         u.display_name as assignee_display_name
    from reconciliation_issues i
    left join users u on u.id = i.assigned_to_user_id
`;

@Injectable()
export class ReconciliationIssuesRepository {
  constructor(@Inject(DATABASE) private readonly database: Pick<Database, 'pool'>) {}

  async getById(tenantId: string, id: string): Promise<IssueRow | null> {
    const result = await this.database.pool.query<IssueRow>(
      `${ISSUE_SELECT} where i.tenant_id = $1 and i.id = $2`,
      [tenantId, id],
    );
    return result.rows[0] ?? null;
  }

  async list(tenantId: string, query: ReconciliationIssueListQuery): Promise<IssueRow[]> {
    const values: unknown[] = [tenantId];
    const filters = ['i.tenant_id = $1'];
    if (query.status) {
      values.push(query.status);
      filters.push(`i.status = $${values.length}`);
    }
    if (query.severity) {
      values.push(query.severity);
      filters.push(`i.current_severity = $${values.length}`);
    }
    if (query.domain) {
      values.push(query.domain);
      filters.push(`i.domain = $${values.length}`);
    }
    if (query.ruleCode) {
      values.push(query.ruleCode);
      filters.push(`i.rule_code = $${values.length}`);
    }
    if (query.assignedTo) {
      values.push(query.assignedTo);
      filters.push(`i.assigned_to_user_id = $${values.length}`);
    }
    if (query.unassigned) {
      filters.push('i.assigned_to_user_id is null');
    }
    if (query.firstSeenFrom) {
      values.push(query.firstSeenFrom);
      filters.push(`i.first_seen_at >= $${values.length}::timestamptz`);
    }
    if (query.firstSeenTo) {
      values.push(query.firstSeenTo);
      filters.push(`i.first_seen_at <= $${values.length}::timestamptz`);
    }
    if (query.lastSeenFrom) {
      values.push(query.lastSeenFrom);
      filters.push(`i.last_seen_at >= $${values.length}::timestamptz`);
    }
    if (query.lastSeenTo) {
      values.push(query.lastSeenTo);
      filters.push(`i.last_seen_at <= $${values.length}::timestamptz`);
    }
    if (query.riskReviewOverdue) {
      filters.push(
        `i.status = 'ACCEPTED_RISK' and i.risk_review_at is not null and i.risk_review_at < now()`,
      );
    }
    if (query.dispensingPointId) {
      values.push(query.dispensingPointId);
      filters.push(
        `exists (select 1 from reconciliation_findings f where f.id = i.last_finding_id and f.dispensing_point_id = $${values.length})`,
      );
    }
    if (query.planningPeriodId) {
      values.push(query.planningPeriodId);
      filters.push(
        `exists (select 1 from reconciliation_findings f where f.id = i.last_finding_id and f.planning_period_id = $${values.length})`,
      );
    }
    if (query.commercialCode) {
      values.push(query.commercialCode);
      filters.push(
        `exists (select 1 from reconciliation_findings f where f.id = i.last_finding_id and f.commercial_code = $${values.length})`,
      );
    }
    values.push(query.limit);
    const result = await this.database.pool.query<IssueRow>(
      `${ISSUE_SELECT}
        where ${filters.join(' and ')}
        order by
          case i.current_severity when 'CRITICAL' then 0 when 'ERROR' then 1 when 'WARNING' then 2 else 3 end,
          i.last_seen_at desc, i.id
        limit $${values.length}`,
      values,
    );
    return result.rows;
  }

  async listEvents(tenantId: string, issueId: string): Promise<IssueEventRow[]> {
    const result = await this.database.pool.query<IssueEventRow>(
      `select e.id, e.issue_id, e.event_type, e.from_status, e.to_status,
              e.actor_user_id, e.reconciliation_run_id, e.finding_id, e.metadata_json, e.created_at
         from reconciliation_issue_events e
         join reconciliation_issues i on i.id = e.issue_id
        where i.tenant_id = $1 and e.issue_id = $2
        order by e.created_at asc, e.id asc`,
      [tenantId, issueId],
    );
    return result.rows;
  }

  async listComments(tenantId: string, issueId: string): Promise<IssueCommentRow[]> {
    const result = await this.database.pool.query<IssueCommentRow>(
      `select c.id, c.issue_id, c.author_user_id, u.username as author_username, c.body, c.created_at
         from reconciliation_issue_comments c
         join reconciliation_issues i on i.id = c.issue_id
         join users u on u.id = c.author_user_id
        where i.tenant_id = $1 and c.issue_id = $2
        order by c.created_at asc, c.id asc`,
      [tenantId, issueId],
    );
    return result.rows;
  }

  async listAssignees(
    tenantId: string,
  ): Promise<Array<{ id: string; username: string; displayName: string }>> {
    const result = await this.database.pool.query<{
      id: string;
      username: string;
      display_name: string;
    }>(
      `select distinct u.id, u.username, u.display_name
         from users u
         join user_organization_roles uor on uor.user_id = u.id and uor.active = true
         join roles r on r.id = uor.role_id
         join organizations o on o.id = uor.organization_id
        where u.active = true
          and o.id = $1
          and o.code = 'MTD'
          and r.code in ('MTD_ADMIN','MTD_AUDITORIA','MTD_OPERATOR','MTD_GENERAL','READ_ONLY','MTD')
        order by u.display_name, u.username`,
      [tenantId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
    }));
  }

  async loadAssigneeEligibility(
    tenantId: string,
    userId: string,
  ): Promise<{ userActive: boolean; organizationCode: string; roleCode: string } | null> {
    const result = await this.database.pool.query<{
      user_active: boolean;
      organization_code: string;
      role_code: string;
    }>(
      `select u.active as user_active, o.code as organization_code, r.code as role_code
         from users u
         join user_organization_roles uor on uor.user_id = u.id and uor.active = true
         join roles r on r.id = uor.role_id
         join organizations o on o.id = uor.organization_id
        where u.id = $1 and o.id = $2
        order by case r.code
          when 'MTD_ADMIN' then 0 when 'MTD_AUDITORIA' then 1 when 'MTD_OPERATOR' then 2
          else 3 end
        limit 1`,
      [userId, tenantId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      userActive: row.user_active,
      organizationCode: row.organization_code,
      roleCode: row.role_code,
    };
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async lockIssue(client: PoolClient, tenantId: string, id: string): Promise<IssueRow | null> {
    const result = await client.query<IssueRow>(
      `${ISSUE_SELECT} where i.tenant_id = $1 and i.id = $2 for update of i`,
      [tenantId, id],
    );
    return result.rows[0] ?? null;
  }

  async updateLockedIssue(
    client: PoolClient,
    input: {
      id: string;
      tenantId: string;
      expectedVersion: number;
      patchSql: string;
      values: unknown[];
    },
  ): Promise<IssueRow | null> {
    const result = await client.query<IssueRow>(
      `update reconciliation_issues i
          set ${input.patchSql},
              version = version + 1,
              updated_at = now()
        where i.id = $1 and i.tenant_id = $2 and i.version = $3
        returning i.*,
          (select username from users where id = i.assigned_to_user_id) as assignee_username,
          (select display_name from users where id = i.assigned_to_user_id) as assignee_display_name`,
      [input.id, input.tenantId, input.expectedVersion, ...input.values],
    );
    return result.rows[0] ?? null;
  }

  async insertEvent(
    client: PoolClient,
    input: {
      issueId: string;
      tenantId: string;
      eventType: string;
      fromStatus: string | null;
      toStatus: string | null;
      actorUserId: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await client.query(
      `insert into reconciliation_issue_events
         (issue_id, tenant_id, event_type, from_status, to_status, actor_user_id, metadata_json)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        input.issueId,
        input.tenantId,
        input.eventType,
        input.fromStatus,
        input.toStatus,
        input.actorUserId,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async countByStatusSeverity(): Promise<Array<{ status: string; severity: string; n: number }>> {
    const result = await this.database.pool.query<{
      status: string;
      severity: string;
      n: string;
    }>(
      `select status, current_severity as severity, count(*)::text as n
         from reconciliation_issues
        group by status, current_severity`,
    );
    return result.rows.map((row) => ({
      status: row.status,
      severity: row.severity,
      n: Number(row.n),
    }));
  }

  async insertComment(
    client: PoolClient,
    tenantId: string,
    issueId: string,
    authorUserId: string,
    body: string,
  ): Promise<IssueCommentRow> {
    const result = await client.query<IssueCommentRow>(
      `insert into reconciliation_issue_comments (issue_id, tenant_id, author_user_id, body)
       select $1, $2, $3, $4
        where exists (
          select 1 from reconciliation_issues i where i.id = $1 and i.tenant_id = $2
        )
       returning id, issue_id, author_user_id, '' as author_username, body, created_at`,
      [issueId, tenantId, authorUserId, body],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('ISSUE_COMMENT_NOT_INSERTED');
    }
    const author = await client.query<{ username: string }>(
      `select username from users where id = $1`,
      [authorUserId],
    );
    return { ...row, author_username: author.rows[0]?.username ?? '' };
  }

  async insertAudit(
    client: PoolClient,
    input: {
      actorUserId: string;
      tenantId: string;
      action: string;
      issueId: string;
      after: Record<string, unknown>;
      correlationId: string;
    },
  ): Promise<void> {
    await client.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result)
       values ('USER',$1,$2,$3,'reconciliation_issue',$4,$5::jsonb,$6::uuid,$7,'SUCCESS')`,
      [
        input.actorUserId,
        input.tenantId,
        input.action,
        input.issueId,
        JSON.stringify(input.after),
        input.correlationId,
        input.correlationId,
      ],
    );
  }
}
