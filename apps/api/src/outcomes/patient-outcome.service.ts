import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MarkPatientNotAppliedRequest } from '@authorization/contracts';
import type { Scope } from '../common/request-scope';
import { PatientOutcomeRepository } from './patient-outcome.repository';

@Injectable()
export class PatientOutcomeService {
  constructor(private readonly repository: PatientOutcomeRepository) {}

  list(scope: Scope) {
    return this.repository.list(scope);
  }
  async detail(id: string, scope: Scope) {
    const result = await this.repository.find(id, scope);
    if (!result)
      throw new NotFoundException({
        code: 'PATIENT_OUTCOME_NOT_FOUND',
        message: 'Patient outcome not found',
      });
    return result;
  }
  async statuses(scope: Scope) {
    return (await this.repository.operationalStatuses(scope)).filter(Boolean);
  }
  async status(scheduleId: string, scope: Scope) {
    const result = await this.repository.operationalStatus(scheduleId, scope);
    if (!result)
      throw new NotFoundException({
        code: 'PATIENT_SCHEDULE_NOT_FOUND',
        message: 'Patient schedule not found',
      });
    return result;
  }
  async markNotApplied(scheduleId: string, body: MarkPatientNotAppliedRequest, scope: Scope) {
    try {
      return await this.repository.markNotApplied(scheduleId, body, scope);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'INVALID_PATIENT_OUTCOME';
      if (['PATIENT_SCHEDULE_NOT_FOUND'].includes(code))
        throw new NotFoundException({ code, message: code });
      if (
        [
          'PATIENT_SCHEDULE_REVISION_CONFLICT',
          'PATIENT_SCHEDULE_ALREADY_APPLIED',
          'PATIENT_SCHEDULE_CANCELLED',
          'PATIENT_OUTCOME_INSUFFICIENT_BALANCE',
        ].includes(code)
      )
        throw new ConflictException({ code, message: code });
      throw new BadRequestException({ code, message: code });
    }
  }
}
