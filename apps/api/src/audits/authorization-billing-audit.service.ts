import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

import type { AuthorizationBillingAuditDecisionRequest } from '@authorization/contracts';

import type { Scope } from '../common/request-scope';

import { AuthorizationBillingAuditDriveService } from './authorization-billing-audit-drive.service';

import { AuthorizationBillingAuditRepository } from './authorization-billing-audit.repository';

@Injectable()
export class AuthorizationBillingAuditService {
  constructor(
    private readonly repository: AuthorizationBillingAuditRepository,

    private readonly drive: AuthorizationBillingAuditDriveService,
  ) {}

  async detail(authorizationItemId: string, scope: Scope) {
    this.assertMtd(scope);

    const result = await this.run(() =>
      this.repository.detailByAuthorizationItemId(authorizationItemId),
    );

    if (
      result.outcome ===
        'not_found'
      ||
      !result.audit
    ) {
      /*
       * El contrato HTTP exige una auditoría persistida.
       *
       * Si la AUTO existe pero todavía no existe
       * authorization_billing_audits, respondemos 404.
       *
       * El frontend ya interpreta este código como:
       * "auditoría todavía no iniciada".
       */
      throw this.notFound();
    }

    return result.audit;
  }

  async start(authorizationItemId: string, scope: Scope) {
    this.assertMtd(scope);

    const result = await this.run(() => this.repository.start(authorizationItemId, scope));

    if (result.outcome === 'not_found') {
      throw this.notFound();
    }

    if (result.outcome === 'already_reviewed') {
      throw this.alreadyReviewed();
    }
    if (result.outcome === 'not_eligible') {
      throw this.notEligible();
    }

    return result.audit;
  }

  async decide(auditId: string, body: AuthorizationBillingAuditDecisionRequest, scope: Scope) {
    this.assertMtd(scope);

    const observation = body.observation?.trim() || null;

    if (body.result === 'DOES_NOT_COMPLY' && observation === null) {
      throw new BadRequestException({
        code: 'AUTHORIZATION_BILLING_AUDIT_OBSERVATION_REQUIRED',
        message: 'La observación es obligatoria cuando la AUTO no cumple.',
      });
    }

    const result = await this.run(() =>
      this.repository.decide(auditId, body.result, observation, scope),
    );

    if (
      result.outcome ===
        'observation_required_without_evidence'
    ) {
      throw new BadRequestException({
        code:
          'AUTHORIZATION_BILLING_AUDIT_OBSERVATION_REQUIRED_WITHOUT_EVIDENCE',

        message:
          'La observación es obligatoria cuando la auditoría se registra sin soportes.',
      });
    }


    if (result.outcome === 'not_found') {
      throw this.notFound();
    }

    if (result.outcome === 'already_reviewed') {
      throw this.alreadyReviewed();
    }
    if (result.outcome === 'not_eligible') {
      throw this.notEligible();
    }

    return result.audit;
  }

  async evidenceContent(
    auditId: string,
    evidenceId: string,
    scope: Scope,
  ) {
    this.assertMtd(
      scope,
    );

    const evidence =
      await this.run(
        () =>
          this.repository.findEvidenceForContent(
            auditId,
            evidenceId,
          ),
      );

    if (
      !evidence
    ) {
      throw this.evidenceNotFound();
    }

    const stream =
      await this.drive.downloadEvidence(
        evidence.driveFileId,
      );

    return {
      stream,

      fileName:
        evidence.fileName,

      mimeType:
        evidence.mimeType
        ??
        'application/pdf',
    };
  }


  async searchDriveEvidence(auditId: string, scope: Scope) {
    this.assertMtd(scope);

    const context = await this.repository.findDriveSearchContext(auditId);

    if (!context) {
      throw this.notFound();
    }

    /*
     * REVIEWED hace inmutable la decisión de auditoría,
     * no la consulta documental.
     *
     * Los soportes pueden existir o incorporarse en Drive
     * después de que la decisión haya sido registrada.
     *
     * Buscar evidencia no modifica:
     * - status;
     * - result;
     * - auditor;
     * - reviewedAt;
     * - observation.
     */
    const files = await this.drive.findEvidence(
      context.authorizationNumber,
    );

    return this.repository.upsertDriveEvidence(auditId, context.authorizationItemId, files);
  }

  private assertMtd(scope: Scope) {
    if (scope.organizationCode !== 'MTD') {
      throw new ForbiddenException({
        code: 'AUTHORIZATION_BILLING_AUDIT_MTD_ONLY',
        message: 'Solo MTD puede realizar auditoría de facturación.',
      });
    }
  }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'AUTHORIZATION_BILLING_AUDIT_READBACK_FAILED'
      ) {
        throw new InternalServerErrorException({
          code: 'AUTHORIZATION_BILLING_AUDIT_READBACK_FAILED',
          message: 'No fue posible recuperar la auditoría de facturación persistida.',
        });
      }

      throw error;
    }
  }

  private notFound() {
    return new NotFoundException({
      code: 'AUTHORIZATION_BILLING_AUDIT_NOT_FOUND',
      message: 'No se encontró la AUTO o la auditoría de facturación.',
    });
  }

  private evidenceNotFound() {
    return new NotFoundException({
      code:
        'AUTHORIZATION_BILLING_AUDIT_EVIDENCE_NOT_FOUND',

      message:
        'No se encontró el soporte de auditoría solicitado.',
    });
  }


  private notEligible() {
    return new ConflictException({
      code: 'AUTHORIZATION_BILLING_AUDIT_NOT_ELIGIBLE',
      message: 'Solo se pueden auditar AUTOs con atención parcial registrada (con aplicación pendiente) o cerradas.',
    });
  }

  private alreadyReviewed() {
    return new ConflictException({
      code: 'AUTHORIZATION_BILLING_AUDIT_ALREADY_REVIEWED',
      message: 'La auditoría de facturación ya fue revisada y su decisión está cerrada.',
    });
  }
}
