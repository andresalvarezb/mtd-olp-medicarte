import { describe, expect, it, vi } from 'vitest';
import { apiRequest } from './api-client';
import {
  getPatientMasterDetail,
  getPatientMasterPersonalProfile,
  listPatientReconciliationCases,
  lookupPatientMaster,
  searchPatientMaster,
} from './patient-master-api';

vi.mock('./api-client', () => ({
  apiRequest: vi.fn(() => Promise.resolve({})),
}));

describe('patient master API client', () => {
  it('sends exact documentary search values in a POST body rather than the URL', () => {
    const body = {
      identificationType: 'SINTETICO',
      identificationValue: 'TEST-ID-001',
      page: 1,
      limit: 25,
    };
    void searchPatientMaster('organization-id', body);

    expect(apiRequest).toHaveBeenCalledWith('/patient-master/search', {
      method: 'POST',
      organizationId: 'organization-id',
      body: JSON.stringify(body),
      signal: undefined,
    });
  });

  it('sends a live patient lookup as a scoped POST body', () => {
    vi.mocked(apiRequest).mockClear();
    const body = { identificationType: 'CC', identificationValue: 'TEST-ID-001' };
    void lookupPatientMaster('organization-id', body);

    expect(apiRequest).toHaveBeenCalledWith('/patient-master/lookup', {
      method: 'POST',
      organizationId: 'organization-id',
      body: JSON.stringify(body),
      signal: undefined,
    });
  });

  it('includes point scope for a detail request without including identity data in the URL', () => {
    vi.mocked(apiRequest).mockClear();
    void getPatientMasterDetail('organization-id', 'patient-id', 'point-id');

    expect(apiRequest).toHaveBeenCalledWith(
      '/patient-master/patient-id?dispensingPointId=point-id',
      {
        organizationId: 'organization-id',
        signal: undefined,
      },
    );
  });

  it('uses the field-level personal endpoint and preserves organization/point scope', () => {
    vi.mocked(apiRequest).mockClear();
    void getPatientMasterPersonalProfile('organization-id', 'patient-id', 'point-id');
    expect(apiRequest).toHaveBeenCalledWith(
      '/patient-master/patient-id/personal?dispensingPointId=point-id',
      {
        organizationId: 'organization-id',
        signal: undefined,
      },
    );
  });

  it('uses the read-only reconciliation endpoint and keeps its parameter bounded by the contract', () => {
    vi.mocked(apiRequest).mockClear();
    void listPatientReconciliationCases('organization-id', 25);

    expect(apiRequest).toHaveBeenCalledWith('/patient-master/reconciliation-cases?limit=25', {
      organizationId: 'organization-id',
      signal: undefined,
    });
  });
});
