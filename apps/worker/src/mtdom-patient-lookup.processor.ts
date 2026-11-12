import type { PatientIdentityNormalizationPolicy } from '@authorization/domain';
import { COMPENSAR_PATIENT_IDENTITY_POLICY } from '@authorization/domain';
import type { createDatabase } from '@authorization/database';
import {
  PatientLookupRetryableError,
  PatientLookupTerminalError,
  type PatientLookupProcessor,
} from './patient-lookup-processing';
import { MtdomPatientsReadError } from './mtdom-patients-read.client';
import type { MtdomPatientsReadClient } from './mtdom-patients-read.client';

type Database = ReturnType<typeof createDatabase>;

function normalize(
  value: string,
  policy: PatientIdentityNormalizationPolicy,
  component: 'type' | 'value',
  normalizedType?: string,
): string | null {
  try {
    const normalized =
      component === 'type'
        ? policy.normalizeDocumentType(value)
        : policy.normalizeDocumentValue(value, normalizedType ?? '');
    return typeof normalized === 'string' && normalized.trim() !== '' ? normalized : null;
  } catch {
    return null;
  }
}

export class MtdomPatientLookupProcessor implements PatientLookupProcessor {
  constructor(
    private readonly database: Database,
    private readonly client: MtdomPatientsReadClient,
    private readonly identityPolicy?: PatientIdentityNormalizationPolicy,
  ) {}

  async lookupLiveWithResponse(
    identity: Readonly<{ documentType: string; documentValue: string }>,
  ) {
    const policy = this.identityPolicy ?? COMPENSAR_PATIENT_IDENTITY_POLICY;
    const canonicalType = policy && normalize(identity.documentType, policy, 'type');
    const documentValue =
      canonicalType && normalize(identity.documentValue, policy, 'value', canonicalType);
    if (!canonicalType || !documentValue || documentValue !== identity.documentValue) {
      return { status: 'NOT_FOUND' as const };
    }
    try {
      const response = await this.client.lookup({ documentType: canonicalType, documentValue });
      if (response.kind === 'NOT_FOUND') return { status: 'NOT_FOUND' as const };
      if (response.kind === 'AMBIGUOUS') return { status: 'AMBIGUOUS' as const };
      if (response.kind !== 'FOUND') return { status: 'UNAVAILABLE' as const };
      if (normalize(response.patient.tipo_identificacion, policy, 'type') !== canonicalType ||
          response.patient.identificacion !== documentValue) {
        return { status: 'IDENTITY_MISMATCH' as const };
      }
      return { status: 'FOUND' as const, basicProfile: response.patient };
    } catch {
      return { status: 'UNAVAILABLE' as const };
    }
  }

  async execute(input: Readonly<{ patientId: string }>) {
    const policy = this.identityPolicy;
    if (!policy || !policy.version.trim()) {
      throw new PatientLookupTerminalError('PATIENT_LOOKUP_IDENTITY_POLICY_REQUIRED');
    }

    const local = await this.database.pool.query<{
      identification_type_raw: string;
      identification_value_raw: string;
      authorized?: boolean;
    }>(
      policy.version === COMPENSAR_PATIENT_IDENTITY_POLICY.version
        ? `select p.identification_type_raw, p.identification_value_raw,
              (source_org.code = 'COMPENSAR' and exists (
                select 1 from authorization_items ai
                join authorization_item_organizations aio on aio.authorization_item_id = ai.id
                join organizations operational_org on operational_org.id = aio.organization_id
                  and operational_org.code = 'MEDICARTE'
                where ai.patient_id = p.id
                  and p.identification_type_raw = '1'
                  and ai.source_data->>'TIPO_IDENTIFICACION' = p.identification_type_raw
                  and coalesce(nullif(ai.source_data->>'IDENTIFICACION_PACIENTE', ''),
                               nullif(ai.source_data->>'NUM_DOCUMENTO', '')) = p.identification_value_raw
                  and (nullif(ai.source_data->>'IDENTIFICACION_PACIENTE', '') is null
                       or nullif(ai.source_data->>'NUM_DOCUMENTO', '') is null
                       or ai.source_data->>'IDENTIFICACION_PACIENTE' = ai.source_data->>'NUM_DOCUMENTO')
              )) as authorized
           from patients p
           left join organizations source_org on source_org.id = p.source_organization_id
          where p.id = $1::uuid`
        : `select identification_type_raw, identification_value_raw
             from patients where id = $1::uuid`,
      [input.patientId],
    );
    const patient = local.rows[0];
    if (!patient) throw new PatientLookupTerminalError('PATIENT_LOOKUP_LOCAL_PATIENT_MISSING');
    if (policy.version === COMPENSAR_PATIENT_IDENTITY_POLICY.version && patient.authorized !== true) {
      throw new PatientLookupTerminalError('PATIENT_LOOKUP_LOCAL_EVIDENCE_MISSING');
    }

    const localType = normalize(patient.identification_type_raw, policy, 'type');
    const localValue = localType && normalize(patient.identification_value_raw, policy, 'value', localType);
    if (!localType || !localValue || localValue !== patient.identification_value_raw) {
      throw new PatientLookupTerminalError('PATIENT_LOOKUP_IDENTITY_REQUIRES_REVIEW');
    }

    let response;
    try {
      response = await this.client.lookup({
        documentType: localType,
        documentValue: localValue,
      });
    } catch (error) {
      if (error instanceof MtdomPatientsReadError) {
        if (error.code === 'AUTH_BLOCKED') {
          throw new PatientLookupTerminalError('PATIENT_LOOKUP_AUTH_BLOCKED', 'AUTH_BLOCKED');
        }
        if (error.retryable) throw new PatientLookupRetryableError(error.retryAfterMs);
        throw new PatientLookupTerminalError('PATIENT_LOOKUP_INVALID_REMOTE_RESPONSE');
      }
      throw new PatientLookupRetryableError();
    }

    if (response.kind === 'NOT_FOUND') return { outcome: 'NOT_FOUND' as const };
    if (response.kind === 'AMBIGUOUS') return { outcome: 'AMBIGUOUS' as const };
    if (response.kind !== 'FOUND') {
      throw new PatientLookupTerminalError('PATIENT_LOOKUP_INVALID_REMOTE_RESPONSE');
    }

    const remoteType = normalize(response.patient.tipo_identificacion, policy, 'type');
    if (!remoteType || localType !== remoteType) {
      return { outcome: 'IDENTITY_MISMATCH' as const };
    }
    const remoteValue = normalize(response.patient.identificacion, policy, 'value', remoteType);
    if (!remoteValue || localValue !== remoteValue) {
      return { outcome: 'IDENTITY_MISMATCH' as const };
    }

    // The processor is only registered by AppModule when DP-07, lookup and the
    // versioned identity policy are explicitly enabled. Store only the client's
    // strict basic-profile contract; nulls preserve prior values until a clearing
    // policy is approved. No payload is returned to BullMQ or job_results.
    const sourceUpdatedAt = new Date(response.patient.actualizado_en);
    const sourceUpdatedAtIso = Number.isNaN(sourceUpdatedAt.getTime())
      ? null
      : sourceUpdatedAt.toISOString();
    await this.database.pool.query(
      `UPDATE patients
          SET mtdom_basic_profile = COALESCE(mtdom_basic_profile, '{}'::jsonb)
                || jsonb_strip_nulls($2::jsonb),
              mtdom_basic_profile_source = 'MTDOM',
              mtdom_basic_profile_fetched_at = now(),
              mtdom_basic_profile_source_updated_at = COALESCE(
                $3::timestamptz,
                mtdom_basic_profile_source_updated_at
              )
        WHERE id = $1::uuid`,
      [input.patientId, JSON.stringify(response.patient), sourceUpdatedAtIso],
    );

    // Patient values are deliberately absent from the outbox result.
    return { outcome: 'MATCHED_PENDING_APPROVAL' as const };
  }
}
