import { describe, expect, it, vi } from 'vitest';
import type { createDatabase } from '@authorization/database';
import { MtdomPatientLookupProcessor } from './mtdom-patient-lookup.processor';
import type { MtdomBasicPatient, MtdomPatientsReadClient } from './mtdom-patients-read.client';

const database = {} as ReturnType<typeof createDatabase>;

describe('MTDOM live patient lookup', () => {
  it('sends the canonical known type and accepts the matching numeric alias in the response', async () => {
    const patient = {
      tipo_identificacion: '1',
      identificacion: 'TEST-000123',
    } as MtdomBasicPatient;
    const lookup = vi.fn().mockResolvedValue({ kind: 'FOUND', patient });
    const client = {
      lookup,
    } as unknown as MtdomPatientsReadClient;
    const processor = new MtdomPatientLookupProcessor(database, client);

    const result = await processor.lookupLiveWithResponse({
      documentType: '1',
      documentValue: 'TEST-000123',
    });

    expect(lookup).toHaveBeenCalledWith({
      documentType: 'CC',
      documentValue: 'TEST-000123',
    });
    expect(result).toEqual({ status: 'FOUND', basicProfile: patient });
  });

  it('rejects a response whose document value does not match the requested identity', async () => {
    const client = {
      lookup: vi.fn().mockResolvedValue({
        kind: 'FOUND',
        patient: {
          tipo_identificacion: 'CC',
          identificacion: 'OTHER-ID',
        } as MtdomBasicPatient,
      }),
    } as unknown as MtdomPatientsReadClient;
    const processor = new MtdomPatientLookupProcessor(database, client);

    await expect(
      processor.lookupLiveWithResponse({ documentType: '1', documentValue: 'TEST-000123' }),
    ).resolves.toEqual({ status: 'IDENTITY_MISMATCH' });
  });
});
