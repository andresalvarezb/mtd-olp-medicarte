import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AcceptReconciliationIssueRiskRequest,
  AssignReconciliationIssueRequest,
  CreateReconciliationIssueCommentRequest,
  ReconciliationFindingListQuery,
  ReconciliationIssueCommentResponse,
  ReconciliationIssueEventResponse,
  ReconciliationIssueListQuery,
  ReconciliationIssueResponse,
  ResolveReconciliationIssueRequest,
} from '@authorization/contracts';
import {
  reconciliationCategorySchema,
  reconciliationDomainSchema,
  reconciliationIssueEventTypeSchema,
  reconciliationIssueStatusSchema,
  reconciliationResolutionCodeSchema,
  reconciliationSeveritySchema,
} from '@authorization/contracts';
import {
  canManuallyTransition,
  isMtdGovernanceAssignee,
  isRiskReviewOverdue,
  manualIssueTransition,
  RECONCILIATION_RULE_BY_CODE,
  validateAcceptedRiskReason,
  validateResolutionNote,
  type ManualIssueAction,
  type ReconciliationResolutionCode,
} from '@authorization/domain';
import { ReconciliationIssuesRepository, type IssueRow } from './reconciliation-issues.repository';
import type { ReconciliationMetrics } from './reconciliation.metrics';
import { ReconciliationMetricsProvider } from './reconciliation.metrics';
import { ReconciliationService } from './reconciliation.service';

function asIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapIssue(row: IssueRow): ReconciliationIssueResponse {
  const rule = RECONCILIATION_RULE_BY_CODE[row.rule_code];
  const status = reconciliationIssueStatusSchema.parse(row.status);
  const lastSeen = asIso(row.last_seen_at) ?? new Date().toISOString();
  const daysSinceLastSeen = Math.max(
    0,
    Math.floor((Date.now() - new Date(lastSeen).getTime()) / 86_400_000),
  );
  const riskReviewAt = asIso(row.risk_review_at);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ruleCode: row.rule_code,
    fingerprint: row.fingerprint,
    domain: reconciliationDomainSchema.parse(row.domain),
    category: reconciliationCategorySchema.parse(row.category),
    description: rule?.description ?? '',
    recommendedAction: rule?.recommendedAction ?? '',
    status,
    currentSeverity: reconciliationSeveritySchema.parse(row.current_severity),
    maxSeveritySeen: reconciliationSeveritySchema.parse(row.max_severity_seen),
    occurrenceCount: Number(row.occurrence_count),
    firstSeenAt: asIso(row.first_seen_at) ?? lastSeen,
    lastSeenAt: lastSeen,
    firstRunId: row.first_run_id,
    lastRunId: row.last_run_id,
    lastFindingId: row.last_finding_id,
    firstRuleVersion: row.first_rule_version,
    lastRuleVersion: row.last_rule_version,
    assignee: row.assigned_to_user_id
      ? {
          id: row.assigned_to_user_id,
          username: row.assignee_username ?? '',
          displayName: row.assignee_display_name ?? '',
        }
      : null,
    acknowledgedAt: asIso(row.acknowledged_at),
    acknowledgedBy: row.acknowledged_by,
    resolvedAt: asIso(row.resolved_at),
    resolvedBy: row.resolved_by,
    resolutionCode: row.resolution_code
      ? reconciliationResolutionCodeSchema.parse(row.resolution_code)
      : null,
    resolutionNote: row.resolution_note,
    acceptedRiskAt: asIso(row.accepted_risk_at),
    acceptedRiskBy: row.accepted_risk_by,
    acceptedRiskReason: row.accepted_risk_reason,
    acceptedRiskSeverity: row.accepted_risk_severity
      ? reconciliationSeveritySchema.parse(row.accepted_risk_severity)
      : null,
    acceptedRiskRuleVersion: row.accepted_risk_rule_version,
    riskReviewAt,
    riskReviewOverdue: isRiskReviewOverdue(status, riskReviewAt),
    daysSinceLastSeen,
    version: Number(row.version),
    createdAt: asIso(row.created_at) ?? lastSeen,
    updatedAt: asIso(row.updated_at) ?? lastSeen,
  };
}

@Injectable()
export class ReconciliationIssuesService {
  private readonly metrics: ReconciliationMetrics;

  constructor(
    private readonly issues: ReconciliationIssuesRepository,
    private readonly reconciliation: ReconciliationService,
    metrics: ReconciliationMetricsProvider,
  ) {
    this.metrics = metrics.metrics;
  }

  async list(
    tenantId: string,
    query: ReconciliationIssueListQuery,
  ): Promise<{ items: ReconciliationIssueResponse[] }> {
    const rows = await this.issues.list(tenantId, query);
    return { items: rows.map(mapIssue) };
  }

  async get(tenantId: string, id: string): Promise<ReconciliationIssueResponse> {
    const row = await this.issues.getById(tenantId, id);
    if (!row) {
      throw new NotFoundException({
        code: 'RECONCILIATION_ISSUE_NOT_FOUND',
        message: 'Issue not found',
      });
    }
    return mapIssue(row);
  }

  async findings(tenantId: string, id: string, query: ReconciliationFindingListQuery) {
    await this.get(tenantId, id);
    const items = await this.reconciliation.findingsByIssue(tenantId, id, query);
    return { items };
  }

  async events(
    tenantId: string,
    id: string,
  ): Promise<{ items: ReconciliationIssueEventResponse[] }> {
    await this.get(tenantId, id);
    const rows = await this.issues.listEvents(tenantId, id);
    return {
      items: rows.map((row) => ({
        id: row.id,
        issueId: row.issue_id,
        eventType: reconciliationIssueEventTypeSchema.parse(row.event_type),
        fromStatus: row.from_status ? reconciliationIssueStatusSchema.parse(row.from_status) : null,
        toStatus: row.to_status ? reconciliationIssueStatusSchema.parse(row.to_status) : null,
        actorUserId: row.actor_user_id,
        reconciliationRunId: row.reconciliation_run_id,
        findingId: row.finding_id,
        metadata: row.metadata_json ?? {},
        createdAt: asIso(row.created_at) ?? new Date().toISOString(),
      })),
    };
  }

  async comments(
    tenantId: string,
    id: string,
  ): Promise<{ items: ReconciliationIssueCommentResponse[] }> {
    await this.get(tenantId, id);
    const rows = await this.issues.listComments(tenantId, id);
    return {
      items: rows.map((row) => ({
        id: row.id,
        issueId: row.issue_id,
        authorUserId: row.author_user_id,
        authorUsername: row.author_username,
        body: row.body,
        createdAt: asIso(row.created_at) ?? new Date().toISOString(),
      })),
    };
  }

  async assignees(tenantId: string) {
    return { items: await this.issues.listAssignees(tenantId) };
  }

  async acknowledge(
    tenantId: string,
    id: string,
    actorUserId: string,
    correlationId: string,
    expectedVersion: number,
  ) {
    return this.transition(
      tenantId,
      id,
      actorUserId,
      correlationId,
      expectedVersion,
      'acknowledge',
    );
  }

  async resolve(
    tenantId: string,
    id: string,
    actorUserId: string,
    correlationId: string,
    body: ResolveReconciliationIssueRequest,
  ) {
    const noteError = validateResolutionNote(body.resolutionCode, body.resolutionNote);
    if (noteError) {
      throw new BadRequestException({ code: noteError, message: noteError });
    }
    return this.transition(
      tenantId,
      id,
      actorUserId,
      correlationId,
      body.expectedVersion,
      'resolve',
      {
        resolutionCode: body.resolutionCode,
        resolutionNote: body.resolutionNote.trim(),
      },
    );
  }

  async acceptRisk(
    tenantId: string,
    id: string,
    actorUserId: string,
    correlationId: string,
    body: AcceptReconciliationIssueRiskRequest,
  ) {
    const reasonError = validateAcceptedRiskReason(body.acceptedRiskReason);
    if (reasonError) {
      throw new BadRequestException({ code: reasonError, message: reasonError });
    }
    if (body.riskReviewAt && Number.isNaN(new Date(body.riskReviewAt).getTime())) {
      throw new BadRequestException({
        code: 'INVALID_RISK_REVIEW_AT',
        message: 'riskReviewAt is invalid',
      });
    }
    return this.transition(
      tenantId,
      id,
      actorUserId,
      correlationId,
      body.expectedVersion,
      'acceptRisk',
      {
        acceptedRiskReason: body.acceptedRiskReason.trim(),
        riskReviewAt: body.riskReviewAt ?? null,
      },
    );
  }

  async reopen(
    tenantId: string,
    id: string,
    actorUserId: string,
    correlationId: string,
    expectedVersion: number,
  ) {
    return this.transition(tenantId, id, actorUserId, correlationId, expectedVersion, 'reopen');
  }

  async assign(
    tenantId: string,
    id: string,
    actorUserId: string,
    correlationId: string,
    body: AssignReconciliationIssueRequest,
  ) {
    const eligibility = await this.issues.loadAssigneeEligibility(tenantId, body.assignedToUserId);
    if (!eligibility || !isMtdGovernanceAssignee(eligibility)) {
      throw new ForbiddenException({
        code: 'INVALID_ISSUE_ASSIGNEE',
        message: 'Assignee must be an active MTD user in the same tenant',
      });
    }
    return this.mutate(tenantId, id, actorUserId, correlationId, body.expectedVersion, {
      eventType: 'ISSUE_ASSIGNED',
      auditAction: 'RECONCILIATION_ISSUE_ASSIGNED',
      fromStatus: (row) => row.status,
      toStatus: (row) => row.status,
      sql: `assigned_to_user_id = $4`,
      values: [body.assignedToUserId],
      after: { assignedToUserId: body.assignedToUserId },
    });
  }

  async unassign(
    tenantId: string,
    id: string,
    actorUserId: string,
    correlationId: string,
    expectedVersion: number,
  ) {
    return this.mutate(tenantId, id, actorUserId, correlationId, expectedVersion, {
      eventType: 'ISSUE_UNASSIGNED',
      auditAction: 'RECONCILIATION_ISSUE_ASSIGNED',
      fromStatus: (row) => row.status,
      toStatus: (row) => row.status,
      sql: `assigned_to_user_id = null`,
      values: [],
      after: { assignedToUserId: null },
    });
  }

  async comment(
    tenantId: string,
    id: string,
    actorUserId: string,
    correlationId: string,
    body: CreateReconciliationIssueCommentRequest,
  ) {
    await this.get(tenantId, id);
    return this.issues.withTransaction(async (client) => {
      const created = await this.issues.insertComment(client, tenantId, id, actorUserId, body.body);
      await this.issues.insertAudit(client, {
        actorUserId,
        tenantId,
        action: 'RECONCILIATION_ISSUE_COMMENTED',
        issueId: id,
        after: { commentId: created.id },
        correlationId,
      });
      return {
        id: created.id,
        issueId: created.issue_id,
        authorUserId: created.author_user_id,
        authorUsername: created.author_username,
        body: created.body,
        createdAt: asIso(created.created_at) ?? new Date().toISOString(),
      };
    });
  }

  private async transition(
    tenantId: string,
    id: string,
    actorUserId: string,
    correlationId: string,
    expectedVersion: number,
    action: ManualIssueAction,
    extra?: {
      resolutionCode?: ReconciliationResolutionCode;
      resolutionNote?: string;
      acceptedRiskReason?: string;
      riskReviewAt?: string | null;
    },
  ) {
    const current = await this.get(tenantId, id);
    if (!canManuallyTransition(current.status, action)) {
      throw new BadRequestException({
        code: 'INVALID_ISSUE_TRANSITION',
        message: `Cannot ${action} an issue in status ${current.status}`,
      });
    }
    const { toStatus, eventType } = manualIssueTransition(current.status, action);
    const sets: string[] = [`status = $4`];
    const values: unknown[] = [toStatus];
    if (action === 'acknowledge') {
      sets.push('acknowledged_at = now()', 'acknowledged_by = $5');
      values.push(actorUserId);
    }
    if (action === 'resolve') {
      sets.push(
        'resolved_at = now()',
        'resolved_by = $5',
        'resolution_code = $6',
        'resolution_note = $7',
      );
      values.push(actorUserId, extra?.resolutionCode ?? null, extra?.resolutionNote ?? null);
    }
    if (action === 'acceptRisk') {
      sets.push(
        'accepted_risk_at = now()',
        'accepted_risk_by = $5',
        'accepted_risk_reason = $6',
        'accepted_risk_severity = $7',
        'accepted_risk_rule_version = $8',
        'risk_review_at = $9',
      );
      values.push(
        actorUserId,
        extra?.acceptedRiskReason ?? null,
        current.currentSeverity,
        current.lastRuleVersion,
        extra?.riskReviewAt ?? null,
      );
    }
    if (action === 'reopen') {
      sets.push(
        `resolved_at = null, resolved_by = null, resolution_code = null, resolution_note = null,
         accepted_risk_at = null, accepted_risk_by = null, accepted_risk_reason = null,
         accepted_risk_severity = null, accepted_risk_rule_version = null, risk_review_at = null`,
      );
    }
    const auditAction =
      action === 'acknowledge'
        ? 'RECONCILIATION_ISSUE_ACKNOWLEDGED'
        : action === 'resolve'
          ? 'RECONCILIATION_ISSUE_RESOLVED'
          : action === 'acceptRisk'
            ? 'RECONCILIATION_ISSUE_ACCEPTED_RISK'
            : 'RECONCILIATION_ISSUE_REOPENED';
    return this.mutate(tenantId, id, actorUserId, correlationId, expectedVersion, {
      eventType,
      auditAction,
      fromStatus: () => current.status,
      toStatus: () => toStatus,
      sql: sets.join(', '),
      values,
      after: {
        status: toStatus,
        resolutionCode: extra?.resolutionCode ?? null,
      },
    });
  }

  private async mutate(
    tenantId: string,
    id: string,
    actorUserId: string,
    correlationId: string,
    expectedVersion: number,
    spec: {
      eventType: string;
      auditAction: string;
      fromStatus: (row: IssueRow) => string;
      toStatus: (row: IssueRow) => string;
      sql: string;
      values: unknown[];
      after: Record<string, unknown>;
    },
  ) {
    return this.issues.withTransaction(async (client) => {
      const locked = await this.issues.lockIssue(client, tenantId, id);
      if (!locked) {
        throw new NotFoundException({
          code: 'RECONCILIATION_ISSUE_NOT_FOUND',
          message: 'Issue not found',
        });
      }
      const updated = await this.issues.updateLockedIssue(client, {
        id,
        tenantId,
        expectedVersion,
        patchSql: spec.sql,
        values: spec.values,
      });
      if (!updated) {
        throw new ConflictException({
          code: 'VERSION_CONFLICT',
          message: 'Issue version conflict',
        });
      }
      await this.issues.insertEvent(client, {
        issueId: id,
        tenantId,
        eventType: spec.eventType,
        fromStatus: spec.fromStatus(locked),
        toStatus: spec.toStatus(updated),
        actorUserId,
        metadata: spec.after,
      });
      await this.issues.insertAudit(client, {
        actorUserId,
        tenantId,
        action: spec.auditAction,
        issueId: id,
        after: spec.after,
        correlationId,
      });
      this.metrics.issueTransitions.inc({ event_type: spec.eventType });
      await this.refreshOpenIssueMetrics();
      return mapIssue(updated);
    });
  }

  private async refreshOpenIssueMetrics(): Promise<void> {
    this.metrics.setOpenIssueCounts(await this.issues.countByStatusSeverity());
  }
}
