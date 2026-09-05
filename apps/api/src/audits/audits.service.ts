import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  auditDecisionResponseSchema,
  auditFindingResponseSchema,
  startAuditReviewResponseSchema,
  type AdmissionStatus,
  type ApproveAuditReviewRequest,
  type AuditDecisionResponse,
  type AuditFindingRequest,
  type AuditFindingResponse,
  type AuditReviewResponse,
  type AuditReviewStatus,
  type AuthorizationItemResponse,
  type StartAuditReviewRequest,
  type StartAuditReviewResponse,
} from '@authorization/contracts';
import {
  canDecideAuditReview,
  canApproveAuditReview,
  canStartAuditReview,
  deriveAdmissionStatus,
} from '@authorization/domain';
import {
  insertNoveltyForItemIfAbsent,
  resolveNovelties,
  type createDatabase,
} from '@authorization/database';
import { deriveApplicationSiteStatus } from '@authorization/domain';
import { DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';

type Database = ReturnType<typeof createDatabase>;

type ItemRow = {
  id: string;
  numero_autorizacion: string;
  codigo_medicamento: string;
  authorization_key: string;
  enablement_status: string;
  coverage_type: string;
  direction_status: string;
  operation_status: string | null;
  coverage_rule_version: string;
  lugar_dispensacion: string | null;
  fecha_programada: string | null;
  fecha_dispensacion: string | null;
  fecha_aplicacion: string | null;
  orden_compra: string | null;
  audit_status: AuthorizationItemResponse['auditStatus'];
  admission_status: string;
  operational_version: number;
  version: number;
  created_at: Date;
  updated_at: Date;
  source_data?: unknown;
};

type ReviewRow = {
  id: string;
  authorization_item_id: string;
  review_number: number;
  status: AuditReviewStatus;
  observations: string | null;
  started_by: string;
  started_at: Date;
  decided_by: string | null;
  decided_at: Date | null;
};

type FindingRow = {
  id: string;
  audit_review_id: string;
  code: string;
  description: string;
  created_at: Date;
};

type Client = {
  query: <T>(query: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

function toItemResponse(row: ItemRow): AuthorizationItemResponse {
  return {
    id: row.id,
    numeroAutorizacion: row.numero_autorizacion,
    codigoMedicamento: row.codigo_medicamento,
    authorizationKey: row.authorization_key,
    enablementStatus: row.enablement_status as AuthorizationItemResponse['enablementStatus'],
    coverageType: row.coverage_type as AuthorizationItemResponse['coverageType'],
    directionStatus: row.direction_status as AuthorizationItemResponse['directionStatus'],
    operationStatus: row.operation_status as AuthorizationItemResponse['operationStatus'],
    sourceData: null,
    sourcePrescripcionNormalized: '',
    noPrescripcion: '',
    lugarDispensacion: row.lugar_dispensacion,
    fechaProgramada: row.fecha_programada,
    fechaDispensacion: row.fecha_dispensacion,
    fechaAplicacion: row.fecha_aplicacion,
    ordenCompra: row.orden_compra,
    auditStatus: row.audit_status,
    admissionStatus: row.admission_status as AuthorizationItemResponse['admissionStatus'],
    applicationSiteStatus: deriveApplicationSiteStatus(row.lugar_dispensacion),
    operationalVersion: row.operational_version,
    coverageRuleVersion: row.coverage_rule_version,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toReviewResponse(review: ReviewRow, findings: FindingRow[]): AuditReviewResponse {
  return {
    id: review.id,
    authorizationItemId: review.authorization_item_id,
    reviewNumber: review.review_number,
    status: review.status,
    observations: review.observations,
    decidedBy: review.decided_by,
    decidedAt: review.decided_at?.toISOString() ?? null,
    startedBy: review.started_by,
    startedAt: review.started_at.toISOString(),
    findings: findings.map((finding) => ({
      id: finding.id,
      code: finding.code,
      description: finding.description,
      createdAt: finding.created_at.toISOString(),
    })),
  };
}

const ITEM_SELECT = `select i.id, i.numero_autorizacion, i.codigo_medicamento, i.authorization_key,
        i.enablement_status, i.coverage_type, i.direction_status, i.operation_status,
        i.coverage_rule_version, i.lugar_dispensacion, i.fecha_programada::text, i.fecha_dispensacion::text, i.fecha_aplicacion::text, i.orden_compra,
        i.audit_status, i.admission_status, i.operational_version, i.version, i.source_data, i.created_at, i.updated_at
 from authorization_items i`;

@Injectable()
export class AuditsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async listForItem(itemId: string, scope: Scope): Promise<AuditReviewResponse[]> {
    if (scope.organizationCode !== 'MTD') return [];
    const reviews = await this.database.pool.query<ReviewRow>(
      `select id, authorization_item_id, review_number, status, observations, started_by, started_at,
              decided_by, decided_at
       from audit_reviews where authorization_item_id = $1
       order by review_number asc`,
      [itemId],
    );
    const findings = await this.database.pool.query<FindingRow>(
      `select f.id, f.audit_review_id, f.code, f.description, f.created_at
       from audit_findings f
       inner join audit_reviews r on r.id = f.audit_review_id
       where r.authorization_item_id = $1
       order by f.created_at asc`,
      [itemId],
    );
    return reviews.rows.map((review) =>
      toReviewResponse(
        review,
        findings.rows.filter((finding) => finding.audit_review_id === review.id),
      ),
    );
  }

  async getReview(reviewId: string): Promise<AuditReviewResponse> {
    const review = await this.database.pool.query<ReviewRow>(
      `select id, authorization_item_id, review_number, status, observations, started_by, started_at,
              decided_by, decided_at
       from audit_reviews where id = $1`,
      [reviewId],
    );
    const row = review.rows[0];
    if (!row) {
      throw new NotFoundException({
        code: 'AUDIT_REVIEW_NOT_FOUND',
        message: 'Audit review not found',
      });
    }
    const findings = await this.database.pool.query<FindingRow>(
      `select id, audit_review_id, code, description, created_at
       from audit_findings where audit_review_id = $1 order by created_at asc`,
      [reviewId],
    );
    return toReviewResponse(row, findings.rows);
  }

  async startReview(input: {
    itemId: string;
    body: StartAuditReviewRequest;
    idempotencyKey: string;
    scope: Scope;
  }): Promise<StartAuditReviewResponse> {
    const requestHash = createHash('sha256').update(`${input.body.expectedVersion}`).digest('hex');
    return this.guardedTransaction<StartAuditReviewResponse>({
      scope: input.scope,
      idempotencyKey: input.idempotencyKey,
      idempotencyScope: `audit-reviews.start:${input.scope.organizationId}:${input.itemId}`,
      requestHash,
      permission: 'audit.start',
      action: async (client) => {
        const item = await this.lockItem(client, input.itemId);
        if (item.version !== input.body.expectedVersion) {
          throw new ConflictException({
            code: 'VERSION_CONFLICT',
            message: 'Authorization item version has changed',
          });
        }
        if (!canStartAuditReview(item.audit_status)) {
          throw new ConflictException({
            code: 'INVALID_AUDIT_TRANSITION',
            message: `No es posible iniciar una revisión desde el estado ${item.audit_status}.`,
          });
        }
        const nextNumber = await client.query<{ next: number }>(
          `select coalesce(max(review_number), 0) + 1 as next
           from audit_reviews where authorization_item_id = $1`,
          [item.id],
        );
        const review = await client.query<ReviewRow>(
          `insert into audit_reviews
             (authorization_item_id, review_number, status, started_by, correlation_id)
           values ($1, $2, 'IN_REVIEW', $3, $4)
           returning id, authorization_item_id, review_number, status, observations, started_by,
                     started_at, decided_by, decided_at`,
          [item.id, nextNumber.rows[0]!.next, input.scope.userId, input.scope.correlationId],
        );
        const updatedItem = await this.updateItem(client, item, input.body.expectedVersion, {
          audit_status: 'IN_REVIEW',
        });
        await this.insertAudit(client, input.scope, {
          action: 'AUDIT_REVIEW_STARTED',
          itemId: item.id,
          before: { auditStatus: item.audit_status, version: item.version },
          after: { auditStatus: 'IN_REVIEW', reviewId: review.rows[0]!.id },
        });
        const response = startAuditReviewResponseSchema.parse({
          review: toReviewResponse(review.rows[0]!, []),
          item: toItemResponse(updatedItem),
        });
        return { response, statusCode: 201 };
      },
    });
  }

  async addFinding(input: {
    reviewId: string;
    body: AuditFindingRequest;
    idempotencyKey: string;
    scope: Scope;
  }): Promise<AuditFindingResponse> {
    const requestHash = createHash('sha256')
      .update(`${input.body.code}:${input.body.description}`)
      .digest('hex');
    return this.guardedTransaction<AuditFindingResponse>({
      scope: input.scope,
      idempotencyKey: input.idempotencyKey,
      idempotencyScope: `audit-reviews.finding:${input.scope.organizationId}:${input.reviewId}`,
      requestHash,
      permission: 'audit.start',
      action: async (client) => {
        const review = await this.lockReview(client, input.reviewId);
        if (!canDecideAuditReview(review.status)) {
          throw new ConflictException({
            code: 'INVALID_AUDIT_TRANSITION',
            message: 'Solo una revisión en curso admite hallazgos.',
          });
        }
        const finding = await client.query<FindingRow>(
          `insert into audit_findings (audit_review_id, code, description, created_by, correlation_id)
           values ($1, $2, $3, $4, $5)
           returning id, audit_review_id, code, description, created_at`,
          [
            review.id,
            input.body.code,
            input.body.description,
            input.scope.userId,
            input.scope.correlationId,
          ],
        );
        await this.insertAudit(client, input.scope, {
          action: 'AUDIT_FINDING_RECORDED',
          itemId: review.authorization_item_id,
          before: null,
          after: { reviewId: review.id, findingId: finding.rows[0]!.id, code: input.body.code },
        });
        const response = auditFindingResponseSchema.parse({
          id: finding.rows[0]!.id,
          auditReviewId: review.id,
          code: finding.rows[0]!.code,
          description: finding.rows[0]!.description,
          createdAt: finding.rows[0]!.created_at.toISOString(),
        });
        return { response, statusCode: 201 };
      },
    });
  }

  async rejectReview(input: {
    reviewId: string;
    body: { expectedVersion: number; observations: string };
    idempotencyKey: string;
    scope: Scope;
  }): Promise<AuditDecisionResponse> {
    return this.decide(input, 'audit.reject', 'REJECTED');
  }

  async approveReview(input: {
    reviewId: string;
    body: ApproveAuditReviewRequest;
    idempotencyKey: string;
    scope: Scope;
  }): Promise<AuditDecisionResponse> {
    return this.decide(input, 'audit.approve', 'APPROVED');
  }

  private decide(
    input: {
      reviewId: string;
      body: { expectedVersion: number; observations?: string | undefined };
      idempotencyKey: string;
      scope: Scope;
    },
    permission: 'audit.approve' | 'audit.reject',
    decision: 'APPROVED' | 'REJECTED',
  ): Promise<AuditDecisionResponse> {
    const observations = input.body.observations ?? null;
    const requestHash = createHash('sha256')
      .update(`${decision}:${input.body.expectedVersion}:${observations ?? ''}`)
      .digest('hex');
    return this.guardedTransaction<AuditDecisionResponse>({
      scope: input.scope,
      idempotencyKey: input.idempotencyKey,
      idempotencyScope: `audit-reviews.decision:${input.scope.organizationId}:${input.reviewId}`,
      requestHash,
      permission,
      action: async (client) => {
        const review = await this.lockReview(client, input.reviewId);
        if (!canDecideAuditReview(review.status)) {
          throw new ConflictException({
            code: 'INVALID_AUDIT_TRANSITION',
            message: 'La revisión ya tiene una decisión registrada.',
          });
        }
        const item = await this.lockItem(client, review.authorization_item_id);
        if (item.version !== input.body.expectedVersion) {
          throw new ConflictException({
            code: 'VERSION_CONFLICT',
            message: 'Authorization item version has changed',
          });
        }
        if (decision === 'APPROVED' && !canApproveAuditReview({
          coverageType: item.coverage_type,
          directionStatus: item.direction_status,
        })) {
          throw new ConflictException({
            code: 'MIPRES_HUMAN_DECISION_REQUIRED',
            message: 'La aprobación requiere un direccionamiento MIPRES confirmado.',
          });
        }
        if (decision === 'REJECTED' && !observations) {
          throw new ConflictException({
            code: 'AUDIT_OBSERVATIONS_REQUIRED',
            message: 'El rechazo requiere observaciones del auditor.',
          });
        }
        const decidedReview = await client.query<ReviewRow>(
          `update audit_reviews set status = $2, observations = coalesce($3, observations),
                  decided_by = $4, decided_at = now()
            where id = $1
            returning id, authorization_item_id, review_number, status, observations, started_by,
                      started_at, decided_by, decided_at`,
          [review.id, decision, observations, input.scope.userId],
        );
        const nextAuditStatus: AuthorizationItemResponse['auditStatus'] = decision;
        const itemPatch =
          decision === 'APPROVED'
            ? {
                audit_status: nextAuditStatus,
                operation_status: 'DISPENSED',
                admission_status: deriveAdmissionStatus({
                  auditStatus: 'APPROVED',
                  currentAdmissionStatus: item.admission_status as AdmissionStatus,
                }),
                process_status: 'AUDITORIA_APROBADA',
              }
            : { audit_status: nextAuditStatus, process_status: 'AUDITORIA_RECHAZADA' };
        const updatedItem = await this.updateItem(
          client,
          item,
          input.body.expectedVersion,
          itemPatch,
        );
        if (decision === 'REJECTED') {
          await insertNoveltyForItemIfAbsent(client, {
            authorizationItemId: item.id,
            originalRow: (item.source_data ?? {
              NUMERO_AUTORIZACION: item.numero_autorizacion,
              CODIGO_COMERCIAL: item.codigo_medicamento,
            }) as Record<string, unknown>,
            code: 'AUD_001',
            stage: 'AUDITORIA',
            field: 'observations',
            receivedValue: observations ?? null,
            description: 'La autorización fue rechazada en auditoría.',
            actorId: input.scope.userId,
          });
        } else {
          await resolveNovelties(client, {
            authorizationItemId: item.id,
            codes: ['AUD_001'],
            reason: 'AUDIT_APPROVED',
            actorType: 'USER',
            actorId: input.scope.userId,
            organizationId: input.scope.organizationId,
            correlationId: input.scope.correlationId,
          });
        }
        await this.insertAudit(client, input.scope, {
          action: decision === 'APPROVED' ? 'AUDIT_APPROVED' : 'AUDIT_REJECTED',
          itemId: item.id,
          before: {
            auditStatus: item.audit_status,
            operationStatus: item.operation_status,
            admissionStatus: item.admission_status,
            version: item.version,
          },
          after: {
            auditStatus: updatedItem.audit_status,
            operationStatus: updatedItem.operation_status,
            admissionStatus: updatedItem.admission_status,
            version: updatedItem.version,
            reviewId: review.id,
          },
        });
        const findings = await client.query<FindingRow>(
          `select id, audit_review_id, code, description, created_at
           from audit_findings where audit_review_id = $1 order by created_at asc`,
          [review.id],
        );
        const response = auditDecisionResponseSchema.parse({
          review: toReviewResponse(decidedReview.rows[0]!, findings.rows),
          item: toItemResponse(updatedItem),
        });
        return { response, statusCode: 200 };
      },
    });
  }

  private async guardedTransaction<T>(input: {
    scope: Scope;
    idempotencyKey: string;
    idempotencyScope: string;
    requestHash: string;
    permission: string;
    action: (client: Client) => Promise<{ response: T; statusCode: number }>;
  }): Promise<T> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `${input.idempotencyScope}:${input.idempotencyKey}`,
      ]);
      const access = await client.query<{ organization_code: string; role_id: string }>(
        `select o.code as organization_code, uor.role_id
         from users u
         inner join user_organization_roles uor on uor.user_id = u.id
         inner join organizations o on o.id = uor.organization_id
         where u.id = $1 and u.active = true and uor.organization_id = $2
           and uor.active = true and o.active = true
         for share of u, uor, o`,
        [input.scope.userId, input.scope.organizationId],
      );
      if (access.rows.length === 0) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: 'Permission denied for organization',
        });
      }
      const roles = [...new Set(access.rows.map((row) => row.role_id))];
      const permissions = await client.query<{ code: string }>(
        `select p.code from role_permissions rp
         inner join permissions p on p.id = rp.permission_id
         where rp.role_id = any($1::uuid[]) and p.code = $2
         for share of rp, p`,
        [roles, input.permission],
      );
      if (permissions.rows.length === 0) {
        throw new ForbiddenException({
          code: 'AUDITOR_NOT_ALLOWED',
          message: 'Solo un auditor MTD autorizado puede ejecutar esta acción.',
        });
      }
      if (access.rows[0]!.organization_code !== 'MTD') {
        throw new ForbiddenException({
          code: 'AUDITOR_NOT_ALLOWED',
          message: 'Solo un auditor MTD autorizado puede ejecutar esta acción.',
        });
      }
      await client.query(
        'delete from idempotency_records where scope = $1 and key = $2 and expires_at <= now()',
        [input.idempotencyScope, input.idempotencyKey],
      );
      const existing = await client.query<{ request_hash: string; response: T }>(
        'select request_hash, response from idempotency_records where scope = $1 and key = $2',
        [input.idempotencyScope, input.idempotencyKey],
      );
      const previous = existing.rows[0];
      if (previous) {
        if (previous.request_hash !== input.requestHash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'Idempotency key reused with another payload',
          });
        }
        await client.query('commit');
        return previous.response;
      }
      const result = await input.action(client);
      await client.query(
        `insert into idempotency_records (scope, key, request_hash, status_code, response, expires_at)
         values ($1, $2, $3, $4, $5::jsonb, now() + interval '24 hours')`,
        [
          input.idempotencyScope,
          input.idempotencyKey,
          input.requestHash,
          result.statusCode,
          JSON.stringify(result.response),
        ],
      );
      await client.query('commit');
      return result.response;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockItem(client: Client, itemId: string): Promise<ItemRow> {
    const result = await client.query<ItemRow>(`${ITEM_SELECT} where i.id = $1 for update`, [
      itemId,
    ]);
    const item = result.rows[0];
    if (!item) {
      throw new NotFoundException({
        code: 'AUTHORIZATION_ITEM_NOT_FOUND',
        message: 'Authorization item not found',
      });
    }
    return item;
  }

  private async lockReview(client: Client, reviewId: string): Promise<ReviewRow> {
    const result = await client.query<ReviewRow>(
      `select r.id, r.authorization_item_id, r.review_number, r.status, r.observations, r.started_by,
              r.started_at, r.decided_by, r.decided_at
       from audit_reviews r where r.id = $1 for update`,
      [reviewId],
    );
    const review = result.rows[0];
    if (!review) {
      throw new NotFoundException({
        code: 'AUDIT_REVIEW_NOT_FOUND',
        message: 'Audit review not found',
      });
    }
    await this.lockItem(client, review.authorization_item_id);
    return review;
  }

  private async updateItem(
    client: Client,
    item: ItemRow,
    expectedVersion: number,
    patch: {
      audit_status?: string;
      operation_status?: string;
      admission_status?: string;
      process_status?: string;
    },
  ): Promise<ItemRow> {
    const result = await client.query<ItemRow>(
      `update authorization_items set
         audit_status = coalesce($2, audit_status),
         operation_status = coalesce($3, operation_status),
         admission_status = coalesce($4, admission_status),
         process_status = coalesce($6, process_status),
         version = version + 1, updated_at = now()
       where id = $1 and version = $5` +
        ` returning id, numero_autorizacion, codigo_medicamento, authorization_key,
           enablement_status, coverage_type, direction_status, operation_status,
           coverage_rule_version, lugar_dispensacion, fecha_programada::text, fecha_dispensacion::text, fecha_aplicacion::text, orden_compra,
           audit_status, admission_status, operational_version, version, source_data, created_at, updated_at`,
      [
        item.id,
        patch.audit_status ?? null,
        patch.operation_status ?? null,
        patch.admission_status ?? null,
        expectedVersion,
        patch.process_status ?? null,
      ],
    );
    const updated = result.rows[0];
    if (!updated) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Authorization item version has changed',
      });
    }
    return updated;
  }

  private async insertAudit(
    client: Client,
    scope: Scope,
    input: {
      action: string;
      itemId: string;
      before: unknown;
      after: unknown;
    },
  ): Promise<void> {
    await client.query(
      `insert into audit_events
         (actor_type, actor_id, organization_id, action, resource_type, resource_id, before, after,
          correlation_id, request_id, result)
       values ('USER', $1, $2, $3, 'authorization_item', $4, $5::jsonb, $6::jsonb, $7, $8, 'SUCCESS')`,
      [
        scope.userId,
        scope.organizationId,
        input.action,
        input.itemId,
        JSON.stringify(input.before),
        JSON.stringify(input.after),
        scope.correlationId,
        scope.correlationId,
      ],
    );
  }
}
