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

    if (result.outcome === 'not_found') {
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

    return result.audit;
  }

  async searchDriveEvidence(auditId: string, scope: Scope) {
    this.assertMtd(scope);

    const context = await this.repository.findDriveSearchContext(auditId);

    if (!context) {
      throw this.notFound();
    }

    if (context.status === 'REVIEWED') {
      throw this.alreadyReviewed();
    }

    const files = await this.drive.findEvidence(context.authorizationNumber);

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

  private alreadyReviewed() {
    return new ConflictException({
      code: 'AUTHORIZATION_BILLING_AUDIT_ALREADY_REVIEWED',
      message: 'La auditoría de facturación ya fue revisada y su decisión está cerrada.',
    });
  }
}
