import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  acceptReconciliationIssueRiskRequestSchema,
  acknowledgeReconciliationIssueRequestSchema,
  assignReconciliationIssueRequestSchema,
  createReconciliationIssueCommentRequestSchema,
  createReconciliationRunRequestSchema,
  reopenReconciliationIssueRequestSchema,
  reconciliationFindingListQuerySchema,
  reconciliationIssueListQuerySchema,
  resolveReconciliationIssueRequestSchema,
  unassignReconciliationIssueRequestSchema,
} from '@authorization/contracts';
import { AuthGuard } from '../common/auth.guard';
import { scopeFromProfile } from '../common/request-scope';
import { AccessService } from '../identity/access.service';
import type { AuthenticatedRequest } from '../types';
import { ReconciliationIssuesService } from './reconciliation-issues.service';
import { ReconciliationService } from './reconciliation.service';

type ReconciliationPermission =
  | 'reconciliation.read'
  | 'reconciliation.run'
  | 'reconciliation_issues.read'
  | 'reconciliation_issues.triage'
  | 'reconciliation_issues.comment';

@ApiTags('reconciliation')
@ApiBearerAuth()
@Controller('reconciliation')
@UseGuards(AuthGuard)
export class ReconciliationController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly issues: ReconciliationIssuesService,
    private readonly access: AccessService,
  ) {}

  private async mtdScope(
    raw: string | undefined,
    request: AuthenticatedRequest,
    permission: ReconciliationPermission,
  ) {
    const organizationId = z.string().uuid().parse(raw);
    const profile = await this.access.requirePermission(
      request.auth.sub,
      organizationId,
      permission,
    );
    const scope = scopeFromProfile(profile, organizationId, request);
    if (scope.organizationCode !== 'MTD') {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'Operational reconciliation is MTD-only',
      });
    }
    return scope;
  }

  @Post('runs')
  async start(
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation.run');
    return this.reconciliation.start(
      scope.organizationId,
      scope.userId,
      createReconciliationRunRequestSchema.parse(rawBody ?? {}),
    );
  }

  @Get('runs')
  async list(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation.read');
    return this.reconciliation.list(scope.organizationId);
  }

  @Get('runs/:id')
  async detail(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation.read');
    return this.reconciliation.get(scope.organizationId, z.string().uuid().parse(rawId));
  }

  @Get('runs/:id/findings')
  async findings(
    @Param('id') rawId: string,
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation.read');
    return this.reconciliation.findings(
      scope.organizationId,
      z.string().uuid().parse(rawId),
      reconciliationFindingListQuerySchema.parse(raw ?? {}),
    );
  }

  @Get('rules')
  async rules(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.mtdScope(organizationId, request, 'reconciliation.read');
    return { items: this.reconciliation.listRules() };
  }

  @Get('issues/assignees')
  async issueAssignees(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation_issues.triage');
    return this.issues.assignees(scope.organizationId);
  }

  @Get('issues')
  async listIssues(
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation_issues.read');
    return this.issues.list(
      scope.organizationId,
      reconciliationIssueListQuerySchema.parse(raw ?? {}),
    );
  }

  @Get('issues/:id')
  async issueDetail(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation_issues.read');
    return this.issues.get(scope.organizationId, z.string().uuid().parse(rawId));
  }

  @Get('issues/:id/findings')
  async issueFindings(
    @Param('id') rawId: string,
    @Query() raw: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation_issues.read');
    return this.issues.findings(
      scope.organizationId,
      z.string().uuid().parse(rawId),
      reconciliationFindingListQuerySchema.parse(raw ?? {}),
    );
  }

  @Get('issues/:id/events')
  async issueEvents(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation_issues.read');
    return this.issues.events(scope.organizationId, z.string().uuid().parse(rawId));
  }

  @Get('issues/:id/comments')
  async issueComments(
    @Param('id') rawId: string,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation_issues.read');
    return this.issues.comments(scope.organizationId, z.string().uuid().parse(rawId));
  }

  @Post('issues/:id/acknowledge')
  @HttpCode(200)
  async acknowledge(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation_issues.triage');
    const body = acknowledgeReconciliationIssueRequestSchema.parse(rawBody ?? {});
    return this.issues.acknowledge(
      scope.organizationId,
      z.string().uuid().parse(rawId),
      scope.userId,
      scope.correlationId,
      body.expectedVersion,
    );
  }

  @Post('issues/:id/assign')
  @HttpCode(200)
  async assign(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation_issues.triage');
    return this.issues.assign(
      scope.organizationId,
      z.string().uuid().parse(rawId),
      scope.userId,
      scope.correlationId,
      assignReconciliationIssueRequestSchema.parse(rawBody ?? {}),
    );
  }

  @Post('issues/:id/unassign')
  @HttpCode(200)
  async unassign(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation_issues.triage');
    const body = unassignReconciliationIssueRequestSchema.parse(rawBody ?? {});
    return this.issues.unassign(
      scope.organizationId,
      z.string().uuid().parse(rawId),
      scope.userId,
      scope.correlationId,
      body.expectedVersion,
    );
  }

  @Post('issues/:id/resolve')
  @HttpCode(200)
  async resolve(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation_issues.triage');
    return this.issues.resolve(
      scope.organizationId,
      z.string().uuid().parse(rawId),
      scope.userId,
      scope.correlationId,
      resolveReconciliationIssueRequestSchema.parse(rawBody ?? {}),
    );
  }

  @Post('issues/:id/accept-risk')
  @HttpCode(200)
  async acceptRisk(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation_issues.triage');
    return this.issues.acceptRisk(
      scope.organizationId,
      z.string().uuid().parse(rawId),
      scope.userId,
      scope.correlationId,
      acceptReconciliationIssueRiskRequestSchema.parse(rawBody ?? {}),
    );
  }

  @Post('issues/:id/reopen')
  @HttpCode(200)
  async reopen(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation_issues.triage');
    const body = reopenReconciliationIssueRequestSchema.parse(rawBody ?? {});
    return this.issues.reopen(
      scope.organizationId,
      z.string().uuid().parse(rawId),
      scope.userId,
      scope.correlationId,
      body.expectedVersion,
    );
  }

  @Post('issues/:id/comments')
  async createComment(
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const scope = await this.mtdScope(organizationId, request, 'reconciliation_issues.comment');
    return this.issues.comment(
      scope.organizationId,
      z.string().uuid().parse(rawId),
      scope.userId,
      scope.correlationId,
      createReconciliationIssueCommentRequestSchema.parse(rawBody ?? {}),
    );
  }
}
