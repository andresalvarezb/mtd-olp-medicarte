import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreatePatientApplicationRequest,
  PatientApplicationListQuery,
  UpdatePatientApplicationRequest,
} from '@authorization/contracts';
import type { Scope } from '../common/request-scope';
import { PatientApplicationRepository } from './patient-application.repository';

@Injectable()
export class PatientApplicationService {
  constructor(private readonly repository: PatientApplicationRepository) {}

  list(query: PatientApplicationListQuery, scope: Scope) {
    return this.repository.list(query, scope);
  }
  eligibleSchedules(scope: Scope) {
    return this.repository.eligibleSchedules(scope);
  }
  async detail(id: string, scope: Scope) {
    const result = await this.repository.find(id, scope);
    if (!result) throw this.notFound();
    return result;
  }
  create(body: CreatePatientApplicationRequest, scope: Scope) {
    return this.run(() => this.repository.create(body, scope));
  }
  update(id: string, body: UpdatePatientApplicationRequest, scope: Scope) {
    return this.run(() => this.repository.update(id, body, scope));
  }
  confirm(id: string, version: number, scope: Scope) {
    return this.run(() => this.repository.confirm(id, version, scope));
  }
  cancel(id: string, version: number, scope: Scope) {
    return this.run(() => this.repository.cancel(id, version, scope));
  }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      const result = await action();
      if (result && typeof result === 'object' && 'outcome' in result) {
        const outcome = result as { outcome: string; currentVersion?: number };
        if (outcome.outcome === 'not_found') throw this.notFound();
        if (outcome.outcome === 'version_conflict') {
          throw new ConflictException({
            code: 'VERSION_CONFLICT',
            message: 'Patient application changed during the operation',
            fields: { currentVersion: [String(outcome.currentVersion)] },
          });
        }
      }
      return result;
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
      const code = error instanceof Error ? error.message : 'INVALID_PATIENT_APPLICATION';
      const conflicts = [
        'PATIENT_SCHEDULE_NOT_FOUND',
        'PATIENT_APPLICATION_SCHEDULE_NOT_ELIGIBLE',
        'PATIENT_APPLICATION_SCHEDULE_REVISION_CONFLICT',
        'PATIENT_APPLICATION_DATE_MISMATCH',
        'PATIENT_APPLICATION_AUTHORIZATION_NOT_ELIGIBLE',
        'PATIENT_APPLICATION_AUTHORIZATION_EXPIRED',
        'PATIENT_APPLICATION_PRODUCT_MISMATCH',
        'PATIENT_APPLICATION_POINT_MISMATCH',
        'PATIENT_APPLICATION_QUANTITY_MISMATCH',
        'PATIENT_APPLICATION_LINES_REQUIRED',
        'PATIENT_APPLICATION_LOT_NOT_FOUND',
        'PATIENT_APPLICATION_EXPIRED_STOCK',
        'PATIENT_APPLICATION_INSUFFICIENT_BALANCE',
        'PATIENT_APPLICATION_FEFO_OVERRIDE_REQUIRED',
        'PATIENT_APPLICATION_FROZEN',
        'PATIENT_APPLICATION_CANCELLED',
        'PATIENT_APPLICATION_CANCEL_NOT_ALLOWED',
        'PATIENT_APPLICATION_DUPLICATE_LOT',
      ];
      if (conflicts.includes(code)) throw new ConflictException({ code, message: code });
      throw new BadRequestException({ code, message: code });
    }
  }

  private notFound() {
    return new NotFoundException({
      code: 'PATIENT_APPLICATION_NOT_FOUND',
      message: 'Patient application not found',
    });
  }
}
