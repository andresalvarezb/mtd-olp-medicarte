import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { RECONCILIATION_RULES, type ReconciliationRuleDefinition } from '@authorization/domain';
import type {
  CreateReconciliationRunRequest,
  ReconciliationFindingListQuery,
  ReconciliationFindingResponse,
  ReconciliationRunResponse,
} from '@authorization/contracts';
import {
  reconciliationCategorySchema,
  reconciliationDomainSchema,
  reconciliationSeveritySchema,
} from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';
import { ReconciliationEngine } from './reconciliation.engine';
import { ReconciliationIssuesRepository } from './reconciliation-issues.repository';
import { ReconciliationMetricsProvider } from './reconciliation.metrics';
import { mapRunRow, ReconciliationRepository } from './reconciliation.repository';
import { ReconciliationOperationsRepository } from './reconciliation-operations.repository';
import { ReconciliationOperationsService } from './reconciliation-operations.service';

type Database = ReturnType<typeof createDatabase>;

@Injectable()
export class ReconciliationService {
  private readonly engine: ReconciliationEngine;
  private readonly metrics: ReconciliationMetricsProvider;

  constructor(
    private readonly repository: ReconciliationRepository,
    private readonly issues: ReconciliationIssuesRepository,
    private readonly operationsRepo: ReconciliationOperationsRepository,
    private readonly operationsService: ReconciliationOperationsService,
    metrics: ReconciliationMetricsProvider,
    @Inject(DATABASE) database: Database,
  ) {
    this.engine = new ReconciliationEngine(database.pool, repository, metrics.metrics);
    this.metrics = metrics;
  }

  listRules(): ReconciliationRuleDefinition[] {
    return [...RECONCILIATION_RULES];
  }

  async start(
    tenantId: string,
    startedBy: string,
    body: CreateReconciliationRunRequest,
  ): Promise<ReconciliationRunResponse> {
    const isRunning = await this.operationsRepo.hasActiveExecutionOrRun(tenantId);
    if (isRunning) {
      throw new ConflictException({
        code: 'RECONCILIATION_ALREADY_RUNNING',
        message: 'There is already an active reconciliation running for this tenant',
      });
    }

    const { id } = await this.engine.execute({
      tenantId,
      startedBy,
      ...(body.planningPeriodId ? { planningPeriodId: body.planningPeriodId } : {}),
      ...(body.dispensingPointId ? { dispensingPointId: body.dispensingPointId } : {}),
      ...(body.commercialCode ? { commercialCode: body.commercialCode } : {}),
      ...(body.domains ? { domains: body.domains } : {}),
      ...(body.severities ? { severities: body.severities } : {}),
    });
    this.metrics.metrics.setOpenIssueCounts(await this.issues.countByStatusSeverity());

    const policy = await this.operationsRepo.getPolicy(tenantId);
    if (policy) {
      await this.operationsService.evaluateAlertsForRun(tenantId, null, id, policy);
    }

    return this.get(tenantId, id);
  }

  async executeDirect(input: Parameters<ReconciliationEngine['execute']>[0]) {
    const result = await this.engine.execute(input);
    this.metrics.metrics.setOpenIssueCounts(await this.issues.countByStatusSeverity());
    return result;
  }

  async list(tenantId: string): Promise<{ items: ReconciliationRunResponse[] }> {
    const rows = await this.repository.listRuns(tenantId);
    return { items: rows.map((row) => mapRunRow(row)) };
  }

  async get(tenantId: string, id: string): Promise<ReconciliationRunResponse> {
    const row = await this.repository.getRun(tenantId, id);
    if (!row) {
      throw new NotFoundException({
        code: 'RECONCILIATION_RUN_NOT_FOUND',
        message: 'Run not found',
      });
    }
    return mapRunRow(row) as ReconciliationRunResponse;
  }

  async findings(
    tenantId: string,
    id: string,
    query: ReconciliationFindingListQuery,
  ): Promise<{ items: ReconciliationFindingResponse[] }> {
    await this.get(tenantId, id);
    const rows = await this.repository.listFindings(tenantId, id, query);
    const byCode = new Map(RECONCILIATION_RULES.map((rule) => [rule.ruleCode, rule]));
    return {
      items: rows.map((row) => {
        const rule = byCode.get(row.rule_code);
        return {
          id: row.id,
          reconciliationRunId: row.reconciliation_run_id,
          ruleCode: row.rule_code,
          ruleVersion: row.rule_version,
          category: reconciliationCategorySchema.parse(row.category),
          severity: reconciliationSeveritySchema.parse(row.severity),
          domain: reconciliationDomainSchema.parse(row.domain),
          entityType: row.entity_type,
          entityId: row.entity_id,
          relatedEntityType: row.related_entity_type,
          relatedEntityId: row.related_entity_id,
          dispensingPointId: row.dispensing_point_id,
          planningPeriodId: row.planning_period_id,
          commercialCode: row.commercial_code,
          message: row.message,
          evidence: row.evidence_json ?? {},
          fingerprint: row.fingerprint,
          truncated: row.truncated,
          recommendedAction: rule?.recommendedAction ?? '',
          detectedAt:
            row.detected_at instanceof Date
              ? row.detected_at.toISOString()
              : new Date(row.detected_at).toISOString(),
          issueId: row.issue_id,
        };
      }),
    };
  }

  async findingsByIssue(
    tenantId: string,
    issueId: string,
    query: ReconciliationFindingListQuery,
  ): Promise<ReconciliationFindingResponse[]> {
    const rows = await this.repository.listFindingsByIssue(tenantId, issueId, query);
    const byCode = new Map(RECONCILIATION_RULES.map((rule) => [rule.ruleCode, rule]));
    return rows.map((row) => {
      const rule = byCode.get(row.rule_code);
      return {
        id: row.id,
        reconciliationRunId: row.reconciliation_run_id,
        ruleCode: row.rule_code,
        ruleVersion: row.rule_version,
        category: reconciliationCategorySchema.parse(row.category),
        severity: reconciliationSeveritySchema.parse(row.severity),
        domain: reconciliationDomainSchema.parse(row.domain),
        entityType: row.entity_type,
        entityId: row.entity_id,
        relatedEntityType: row.related_entity_type,
        relatedEntityId: row.related_entity_id,
        dispensingPointId: row.dispensing_point_id,
        planningPeriodId: row.planning_period_id,
        commercialCode: row.commercial_code,
        message: row.message,
        evidence: row.evidence_json ?? {},
        fingerprint: row.fingerprint,
        truncated: row.truncated,
        recommendedAction: rule?.recommendedAction ?? '',
        detectedAt:
          row.detected_at instanceof Date
            ? row.detected_at.toISOString()
            : new Date(row.detected_at).toISOString(),
        issueId: row.issue_id,
      };
    });
  }
}
