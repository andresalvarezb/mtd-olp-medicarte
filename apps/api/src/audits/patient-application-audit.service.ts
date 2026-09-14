import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ApplicationAuditListQuery,
  ApproveApplicationAuditRequest,
  RejectApplicationAuditRequest,
} from '@authorization/contracts';
import type { Scope } from '../common/request-scope';
import { PatientApplicationAuditRepository } from './patient-application-audit.repository';

@Injectable()
export class PatientApplicationAuditService {
  constructor(private readonly repository: PatientApplicationAuditRepository) {}

  list(query: ApplicationAuditListQuery, scope: Scope) {
    return this.repository.list(query, scope);
  }

  async detail(id: string, scope: Scope) {
    const result = await this.repository.findByAuditId(id, scope);
    if (!result)
      throw new NotFoundException({
        code: 'APPLICATION_AUDIT_NOT_FOUND',
        message: 'Application audit not found',
      });
    return result;
  }

  async start(applicationId: string, scope: Scope) {
    const result = await this.run(() => this.repository.start(applicationId, scope));
    return result && typeof result === 'object' && 'outcome' in result
      ? (result as { audit: unknown }).audit
      : result;
  }

  async approve(id: string, body: ApproveApplicationAuditRequest, scope: Scope) {
    const result = await this.run(() => this.repository.approve(id, body, scope));
    return result && typeof result === 'object' && 'outcome' in result
      ? (result as { audit: unknown }).audit
      : result;
  }

  async reject(id: string, body: RejectApplicationAuditRequest, scope: Scope) {
    const result = await this.run(() => this.repository.reject(id, body, scope));
    return result && typeof result === 'object' && 'outcome' in result
      ? (result as { audit: unknown }).audit
      : result;
  }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      const result = await action();
      if (result && typeof result === 'object' && 'outcome' in result) {
        const outcome = result as {
          outcome: string;
          currentVersion?: number;
          auditId?: string;
        };
        if (outcome.outcome === 'not_found') throw this.notFound();
        if (outcome.outcome === 'already_exists') {
          throw new ConflictException({
            code: 'APPLICATION_AUDIT_ALREADY_EXISTS',
            message: 'The application already has an audit',
            fields: outcome.auditId ? { auditId: [outcome.auditId] } : undefined,
          });
        }
        if (outcome.outcome === 'version_conflict') {
          throw new ConflictException({
            code: 'APPLICATION_AUDIT_VERSION_CONFLICT',
            message: 'Application audit changed during the operation',
            fields: { currentVersion: [String(outcome.currentVersion)] },
          });
        }
      }
      return result;
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
      const code = error instanceof Error ? error.message : 'INVALID_APPLICATION_AUDIT';
      const conflicts = [
        'PATIENT_APPLICATION_AUDIT_NOT_ELIGIBLE',
        'PATIENT_APPLICATION_AUDIT_TERMINAL',
        'PATIENT_APPLICATION_AUDIT_LINEAGE_CONFLICT',
        'PATIENT_APPLICATION_AUDIT_CONCURRENT_DECISION',
      ];
      if (conflicts.includes(code)) throw new ConflictException({ code, message: code });
      throw new BadRequestException({ code, message: code });
    }
  }

  private notFound() {
    return new NotFoundException({
      code: 'APPLICATION_AUDIT_NOT_FOUND',
      message: 'Application audit not found',
    });
  }
}
