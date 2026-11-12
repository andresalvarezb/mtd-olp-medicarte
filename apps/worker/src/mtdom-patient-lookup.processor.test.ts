import { describe, expect, it, vi } from 'vitest';
import type { createDatabase } from '@authorization/database';
import { COMPENSAR_PATIENT_IDENTITY_POLICY } from '@authorization/domain';
import { MtdomPatientLookupProcessor } from './mtdom-patient-lookup.processor';
import type { MtdomBasicPatient, MtdomPatientsReadClient } from './mtdom-patients-read.client';

const database = {} as ReturnType<typeof createDatabase>;
const localPatientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

  it('enriches only a locally linked COMPENSAR patient using an approved source type', async () => {
    const query = vi.fn((sql: string, ...params: unknown[]) => {
      void params;
      if (sql.includes('select p.identification_type_raw')) {
        return Promise.resolve({ rows: [{ identification_type_raw: '1', identification_value_raw: '000123', authorized: true }] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const lookup = vi.fn().mockResolvedValue({ kind: 'FOUND', patient: {
      tipo_identificacion: 'CC', identificacion: '000123', actualizado_en: '2026-11-11T00:00:00Z',
    } });
    const processor = new MtdomPatientLookupProcessor(
      { pool: { query } } as never,
      { lookup } as never,
      COMPENSAR_PATIENT_IDENTITY_POLICY,
    );
    await expect(processor.execute({ patientId: localPatientId })).resolves.toEqual({
      outcome: 'MATCHED_PENDING_APPROVAL',
    });
    expect(lookup).toHaveBeenCalledWith({ documentType: 'CC', documentValue: '000123' });
    expect(query.mock.calls[0]?.[0]).toContain("source_org.code = 'COMPENSAR'");
    expect(query.mock.calls[0]?.[0]).toContain("operational_org.code = 'MEDICARTE'");
    expect(query.mock.calls[0]?.[0]).toContain('p.identification_type_raw = any($2::text[])');
    expect(query.mock.calls[0]?.[1]).toEqual([localPatientId, ['1', '3', '4', '7', '14']]);
  });

  it('does not call MTDOM without linked local authorization evidence', async () => {
    const lookup = vi.fn();
    const processor = new MtdomPatientLookupProcessor(
      { pool: { query: () => Promise.resolve({ rows: [{
        identification_type_raw: '1', identification_value_raw: '000123', authorized: false,
      }] }) } } as never,
      { lookup } as never,
      COMPENSAR_PATIENT_IDENTITY_POLICY,
    );
    await expect(processor.execute({ patientId: localPatientId })).rejects.toThrow(
      'PATIENT_LOOKUP_LOCAL_EVIDENCE_MISSING',
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(['2', '5', '6', '8', '9', '10', '11', '12', '13', '15', 'CD', 'PA'])(
    'does not call MTDOM for unapproved type %s', async (documentType) => {
      const lookup = vi.fn();
      const processor = new MtdomPatientLookupProcessor(database, { lookup } as never);
      await expect(processor.lookupLiveWithResponse({ documentType, documentValue: '000123' }))
        .resolves.toEqual({ status: 'NOT_FOUND' });
      expect(lookup).not.toHaveBeenCalled();
    },
  );
});
