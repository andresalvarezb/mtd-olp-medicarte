import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  PatientMasterDetail,
  PatientMasterSearchRequest,
  PatientMasterSearchResponse,
  PatientReconciliationCase,
} from '@authorization/contracts';
import type { PatientMasterScope } from './patient-master.access-policy';
import { PatientMasterRepository } from './patient-master.repository';

@Injectable()
export class PatientMasterService {
  constructor(private readonly repository: PatientMasterRepository) {}

  async search(
    scope: PatientMasterScope,
    input: PatientMasterSearchRequest,
  ): Promise<PatientMasterSearchResponse> {
    return this.repository.search(scope, input);
  }

  async detail(scope: PatientMasterScope, patientId: string): Promise<PatientMasterDetail> {
    const result = await this.repository.detail(scope, patientId);
    if (!result) {
      throw new NotFoundException({ code: 'PATIENT_MASTER_RECORD_UNAVAILABLE' });
    }
    return result;
  }

  reconciliationCases(limit: number): Promise<PatientReconciliationCase[]> {
    return this.repository.reconciliationCases(limit);
  }
}
