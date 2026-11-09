import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  PatientMasterDetail,
  PatientMasterPersonalResponse,
  PatientMasterSearchRequest,
  PatientMasterSearchResponse,
  PatientReconciliationCase,
  PatientMasterLiveLookupRequest,
  PatientMasterLiveLookupResponse,
} from '@authorization/contracts';
import type { PatientMasterScope } from './patient-master.access-policy';
import { PatientMasterRepository } from './patient-master.repository';

const unavailableLiveLookup = {
  lookup() {
    return Promise.resolve({ status: 'NOT_FOUND' as const });
  },
};

@Injectable()
export class PatientMasterService {
  constructor(
    private readonly repository: PatientMasterRepository,
    private readonly liveLookup: {
      lookup(identity: PatientMasterLiveLookupRequest): Promise<PatientMasterLiveLookupResponse>;
    } = unavailableLiveLookup,
  ) {}

  async search(
    scope: PatientMasterScope,
    input: PatientMasterSearchRequest,
  ): Promise<PatientMasterSearchResponse> {
    return this.repository.search(scope, input);
  }

  isAuthorizedLiveLookup(
    scope: PatientMasterScope,
    identity: PatientMasterLiveLookupRequest,
  ): Promise<boolean> {
    return this.repository.isAuthorizedLiveLookup(scope, identity);
  }

  lookupLive(identity: PatientMasterLiveLookupRequest): Promise<PatientMasterLiveLookupResponse> {
    return this.liveLookup.lookup(identity);
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

  reconciliationCases(
    scope: PatientMasterScope,
    limit: number,
  ): Promise<PatientReconciliationCase[]> {
    return this.repository.reconciliationCases(scope, limit);
  }
}
