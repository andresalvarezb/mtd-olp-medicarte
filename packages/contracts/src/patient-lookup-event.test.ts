import { describe, expect, it } from 'vitest';
import {
  PATIENT_LOOKUP_JOB_OPTIONS,
  PATIENT_LOOKUP_JOB_NAME,
  patientLookupJobSchema,
  patientLookupOutboxPayloadSchema,
  patientLookupResultSchema,
} from './index';

const validJob = {
  name: 'patient.lookup',
  version: 1,
  payload: {
    eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    patientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  },
  correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  idempotencyKey: 'patient.lookup.v1:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

describe('patient lookup event contract', () => {
  it('uses a versioned job on the existing foundation queue with bounded custom retries', () => {
    expect(PATIENT_LOOKUP_JOB_NAME).toBe('patient.lookup.v1');
    expect(PATIENT_LOOKUP_JOB_OPTIONS).toMatchObject({
      attempts: 3,
      backoff: { type: 'patient-lookup', delay: 500 },
      removeOnFail: false,
    });
    expect(patientLookupJobSchema.parse(validJob)).toEqual(validJob);
  });

  it('accepts only the patient UUID in the outbox payload and rejects identity data', () => {
    expect(
      patientLookupOutboxPayloadSchema.safeParse({ patientId: validJob.payload.patientId }).success,
    ).toBe(true);
    expect(
      patientLookupOutboxPayloadSchema.safeParse({
        patientId: validJob.payload.patientId,
        document: 'synthetic-document',
      }).success,
    ).toBe(false);
    expect(
      patientLookupJobSchema.safeParse({
        ...validJob,
        payload: { ...validJob.payload, document: 'synthetic-document' },
      }).success,
    ).toBe(false);
  });

  it('uses minimal terminal outcomes and rejects remote profile data', () => {
    expect(patientLookupResultSchema.parse({ outcome: 'SIMULATED_MATCH' })).toEqual({
      outcome: 'SIMULATED_MATCH',
    });
    expect(patientLookupResultSchema.safeParse({ outcome: 'MATCHED' }).success).toBe(false);
    expect(
      patientLookupResultSchema.safeParse({
        outcome: 'SIMULATED_MATCH',
        response: { document: 'synthetic-document' },
      }).success,
    ).toBe(false);
  });
});
