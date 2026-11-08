import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  PatientMasterDetail,
  PatientMasterPersonalResponse,
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

  async detail(
    scope: PatientMasterScope,
    patientId: string,
    includeBasicProfile = false,
  ): Promise<PatientMasterDetail> {
    const result = await this.repository.detail(scope, patientId, includeBasicProfile);
    if (!result) {
      throw new NotFoundException({ code: 'PATIENT_MASTER_RECORD_UNAVAILABLE' });
    }
    return result;
  }

  async personalProfile(
    scope: PatientMasterScope,
    patientId: string,
  ): Promise<PatientMasterPersonalResponse> {
    const result = await this.repository.personalProfile(scope, patientId);
    if (!result) {
      throw new NotFoundException({ code: 'PATIENT_MASTER_RECORD_UNAVAILABLE' });
    }
    return result;
  }

  reconciliationCases(organizationId: string, limit: number): Promise<PatientReconciliationCase[]> {
    return this.repository.reconciliationCases(organizationId, limit);
  }
}
