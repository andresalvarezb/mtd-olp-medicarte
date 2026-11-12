import { Inject, Injectable } from '@nestjs/common';
import type {
  PatientMasterDetail,
  PatientMasterListItem,
  PatientMasterLiveLookupRequest,
  PatientMasterPersonalResponse,
  PatientMasterProfileMetadata,
  PatientMasterSearchRequest,
  PatientMasterSearchResponse,
  PatientReconciliationCase,
} from '@authorization/contracts';
import {
  patientMasterBasicProfileSchema,
  patientMasterPersonalProfileSchema,
} from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';
import { compensarDocumentTypeSourceKeys } from '@authorization/domain';
import type { QueryResultRow } from 'pg';
import type { PatientMasterScope } from './patient-master.access-policy';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;
type DateValue = Date | string | null;

function profileMetadata(
  source: string | null,
  fetchedAt: DateValue,
  sourceUpdatedAt: DateValue,
): PatientMasterProfileMetadata | null {
  if (source !== 'MTDOM') return null;
  return {
    source: 'MTDOM',
    fetchedAt: iso(fetchedAt),
    sourceUpdatedAt: iso(sourceUpdatedAt),
  };
}

type VisibleRow = Readonly<{
  patient_id: string;
  mtdom_lookup_status: PatientMasterListItem['mtdomLookupStatus'];
  mtdom_last_checked_at: DateValue;
  mtdom_last_error_code: string | null;
  mtdom_changes_seen_at: DateValue;
  patient_updated_at: DateValue;
  authorization_item_id: string;
  authorization_number: string;
  linkage: 'LINKED' | 'HISTORICAL_EXACT_CANDIDATE';
  organization_codes: string[];
  dispensing_point_id: string | null;
}>;

type Cte = Readonly<{ sql: string; params: unknown[] }>;
type SummaryQueryRow = QueryResultRow &
  Parameters<typeof mapListItem>[0] & {
    total?: number | string;
    patient_updated_at?: DateValue;
  };
type AuthorizationEvidenceRow = QueryResultRow & {
  id: string;
  authorization_number: string;
  linkage: VisibleRow['linkage'];
  organization_codes: string[];
  dispensing_point_id: string | null;
};
type ReconciliationCaseRow = QueryResultRow & {
  id: string;
  authorization_item_id: string;
  status: PatientReconciliationCase['status'];
  reason_code: string;
  processed_at: DateValue;
  resolution_code: string | null;
  decided_at: DateValue;
};

function iso(value: DateValue): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sourceDocumentTypes(value: string, allowUnknown = false): readonly string[] {
  try {
    return compensarDocumentTypeSourceKeys(value);
  } catch {
    return allowUnknown ? [value] : [];
  }
}

function scopedPatientAuthorizationCte(
  scope: PatientMasterScope,
  input: Pick<PatientMasterSearchRequest, 'identificationType' | 'identificationValue'> & {
    patientId?: string;
  },
): Cte {
  const params: unknown[] = [];
  const bind = (value: unknown, cast = '') => {
    params.push(value);
    return `$${params.length}${cast}`;
  };

  const organizationId = bind(scope.organizationId, '::uuid');
  let authorizationScope = `
      EXISTS (SELECT 1 FROM organizations mtd
              WHERE mtd.id = ${organizationId} AND mtd.code = 'MTD' AND mtd.active = true)
      AND
      EXISTS (
        SELECT 1 FROM authorization_item_organizations aio
        JOIN organizations operational_org ON operational_org.id = aio.organization_id
        WHERE aio.authorization_item_id = ai.id
          AND operational_org.code = 'MEDICARTE'
      )`;
  const scopedOrganizationCodes = `
      SELECT o.code
      FROM authorization_item_organizations aio
      JOIN organizations o ON o.id = aio.organization_id
      WHERE aio.authorization_item_id = ai.id
        AND o.code = 'MEDICARTE'`;
  let scopedPointId: string = 'NULL::uuid';
  if (scope.pointAccessKind === 'explicit') {
    const pointIds = bind(scope.accessiblePointIds, '::uuid[]');
    authorizationScope += ` AND EXISTS (
        SELECT 1 FROM patient_schedules ps
        WHERE ps.authorization_item_id = ai.id
          AND ps.dispensing_point_id = ANY(${pointIds})
      )`;
    if (scope.dispensingPointId) {
      const pointId = bind(scope.dispensingPointId, '::uuid');
      authorizationScope += ` AND EXISTS (
        SELECT 1 FROM patient_schedules ps
        WHERE ps.authorization_item_id = ai.id
          AND ps.dispensing_point_id = ${pointId}
      )`;
      scopedPointId = pointId;
    }
  } else if (scope.dispensingPointId) {
    const pointId = bind(scope.dispensingPointId, '::uuid');
    authorizationScope += ` AND EXISTS (
        SELECT 1 FROM patient_schedules ps
        WHERE ps.authorization_item_id = ai.id
          AND ps.dispensing_point_id = ${pointId}
      )`;
    scopedPointId = pointId;
  }

  const patientIdClause = input.patientId ? `AND p.id = ${bind(input.patientId, '::uuid')}` : '';
  const exactSearchClause =
    input.identificationType && input.identificationValue
      ? `AND p.identification_type_raw = ANY(${bind(sourceDocumentTypes(input.identificationType, true), '::text[]')})
       AND p.identification_value_raw = ${bind(input.identificationValue)}`
      : '';

  return {
    sql: `
      WITH visible AS (
        SELECT DISTINCT
          p.id AS patient_id,
          p.mtdom_lookup_status,
          p.mtdom_last_checked_at,
          p.mtdom_last_error_code,
          p.mtdom_changes_seen_at,
          p.updated_at AS patient_updated_at,
          ai.id AS authorization_item_id,
          ai.numero_autorizacion AS authorization_number,
          CASE WHEN ai.patient_id = p.id THEN 'LINKED'
               ELSE 'HISTORICAL_EXACT_CANDIDATE' END AS linkage,
          ARRAY(
            SELECT DISTINCT scoped_org.code
            FROM (${scopedOrganizationCodes}) AS scoped_org
            ORDER BY scoped_org.code
          ) AS organization_codes,
          ${scopedPointId} AS dispensing_point_id
        FROM patients p
        JOIN authorization_items ai ON (
          (ai.patient_id = p.id
            AND p.identification_type_raw = ai.source_data->>'TIPO_IDENTIFICACION'
            AND p.identification_value_raw = COALESCE(
              NULLIF(ai.source_data->>'IDENTIFICACION_PACIENTE', ''),
              NULLIF(ai.source_data->>'NUM_DOCUMENTO', '')
            ))
          OR (
            ai.patient_id IS NULL
            AND p.identification_type_raw = ai.source_data->>'TIPO_IDENTIFICACION'
            AND p.identification_value_raw = COALESCE(
              NULLIF(ai.source_data->>'IDENTIFICACION_PACIENTE', ''),
              NULLIF(ai.source_data->>'NUM_DOCUMENTO', '')
            )
            AND 1 = (
              SELECT count(*) FROM patients same_raw_key
              WHERE same_raw_key.source_organization_id = p.source_organization_id
                AND same_raw_key.identification_type_raw = p.identification_type_raw
                AND same_raw_key.identification_value_raw = p.identification_value_raw
            )
          )
        )
        WHERE p.source_organization_id = (SELECT id FROM organizations WHERE code = 'COMPENSAR')
          AND (
            NULLIF(ai.source_data->>'IDENTIFICACION_PACIENTE', '') IS NULL
            OR NULLIF(ai.source_data->>'NUM_DOCUMENTO', '') IS NULL
            OR ai.source_data->>'IDENTIFICACION_PACIENTE' = ai.source_data->>'NUM_DOCUMENTO'
          )
          AND ${authorizationScope}
          ${patientIdClause}
          ${exactSearchClause}
      )`,
    params,
  };
}

function mapListItem(row: {
  patient_id: string;
  mtdom_lookup_status: PatientMasterListItem['mtdomLookupStatus'];
  mtdom_last_checked_at: DateValue;
  mtdom_last_error_code: string | null;
  mtdom_changes_seen_at: DateValue;
  linked_authorization_count: number | string;
  historical_candidate_authorization_count: number | string;
}): PatientMasterListItem {
  return {
    id: row.patient_id,
    identityStatus: 'LOCAL_KEY_RECORDED',
    mtdomLookupStatus: row.mtdom_lookup_status,
    mtdomLastCheckedAt: iso(row.mtdom_last_checked_at),
    mtdomLastErrorCode: row.mtdom_last_error_code,
    mtdomChangesSeenAt: iso(row.mtdom_changes_seen_at),
    linkedAuthorizationCount: Number(row.linked_authorization_count),
    historicalCandidateAuthorizationCount: Number(row.historical_candidate_authorization_count),
  };
}

@Injectable()
export class PatientMasterRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async isAuthorizedLiveLookup(
    scope: PatientMasterScope,
    identity: PatientMasterLiveLookupRequest,
  ): Promise<boolean> {
    const types = sourceDocumentTypes(identity.identificationType);
    if (types.length === 0) return false;
    const params: unknown[] = [types, identity.identificationValue, scope.organizationId];
    let pointSql = '';
    if (scope.pointAccessKind === 'explicit') {
      params.push(scope.accessiblePointIds);
      pointSql += ` AND EXISTS (
        SELECT 1 FROM patient_schedules ps
        WHERE ps.authorization_item_id = ai.id
          AND ps.dispensing_point_id = ANY($${params.length}::uuid[])
      )`;
    }
    if (scope.dispensingPointId) {
      params.push(scope.dispensingPointId);
      pointSql += ` AND EXISTS (
        SELECT 1 FROM patient_schedules ps
        WHERE ps.authorization_item_id = ai.id
          AND ps.dispensing_point_id = $${params.length}::uuid
      )`;
    }
    const result = await this.database.pool.query<{ visible: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM authorization_items ai
           JOIN patients p ON p.id = ai.patient_id
           JOIN organizations source_org ON source_org.id = p.source_organization_id
             AND source_org.code = 'COMPENSAR'
           JOIN authorization_item_organizations aio ON aio.authorization_item_id = ai.id
           JOIN organizations org ON org.id = aio.organization_id AND org.code = 'MEDICARTE'
          WHERE EXISTS (SELECT 1 FROM organizations mtd
                         WHERE mtd.id = $3::uuid AND mtd.code = 'MTD' AND mtd.active = true)
            AND ai.source_data->>'TIPO_IDENTIFICACION' = ANY($1::text[])
            AND COALESCE(NULLIF(ai.source_data->>'IDENTIFICACION_PACIENTE', ''),
                         NULLIF(ai.source_data->>'NUM_DOCUMENTO', '')) = $2
            AND p.identification_type_raw = ai.source_data->>'TIPO_IDENTIFICACION'
            AND p.identification_type_raw = ANY($1::text[])
            AND p.identification_value_raw = $2
            AND (NULLIF(ai.source_data->>'IDENTIFICACION_PACIENTE', '') IS NULL
                 OR NULLIF(ai.source_data->>'NUM_DOCUMENTO', '') IS NULL
                 OR ai.source_data->>'IDENTIFICACION_PACIENTE' = ai.source_data->>'NUM_DOCUMENTO')
            ${pointSql}
       ) AS visible`,
      params,
    );
    return result.rows[0]?.visible === true;
  }

  async search(
    scope: PatientMasterScope,
    input: PatientMasterSearchRequest,
  ): Promise<PatientMasterSearchResponse> {
    const cte = scopedPatientAuthorizationCte(scope, input);
    const limitParam = `$${cte.params.length + 1}`;
    const offsetParam = `$${cte.params.length + 2}`;
    const result = await this.database.pool.query<SummaryQueryRow>(
      `${cte.sql}, grouped AS (
         SELECT patient_id, max(mtdom_lookup_status) AS mtdom_lookup_status,
                max(mtdom_last_checked_at) AS mtdom_last_checked_at,
                max(mtdom_last_error_code) AS mtdom_last_error_code,
                max(mtdom_changes_seen_at) AS mtdom_changes_seen_at,
                max(patient_updated_at) AS patient_updated_at,
                count(*) FILTER (WHERE linkage = 'LINKED')::int AS linked_authorization_count,
                count(*) FILTER (WHERE linkage = 'HISTORICAL_EXACT_CANDIDATE')::int AS historical_candidate_authorization_count
         FROM visible GROUP BY patient_id
       )
       SELECT grouped.*, count(*) OVER()::int AS total
       FROM grouped
       ORDER BY patient_updated_at DESC, patient_id
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      [...cte.params, input.limit, (input.page - 1) * input.limit],
    );
    return {
      items: result.rows.map(mapListItem),
      page: input.page,
      limit: input.limit,
      total: result.rows.length ? Number(result.rows[0]!.total) : 0,
    };
  }

  async detail(
    scope: PatientMasterScope,
    patientId: string,
    includeBasicProfile = false,
  ): Promise<PatientMasterDetail | null> {
    const cte = scopedPatientAuthorizationCte(scope, { patientId });
    const summary = await this.database.pool.query<SummaryQueryRow>(
      `${cte.sql}, grouped AS (
         SELECT patient_id, max(mtdom_lookup_status) AS mtdom_lookup_status,
                max(mtdom_last_checked_at) AS mtdom_last_checked_at,
                max(mtdom_last_error_code) AS mtdom_last_error_code,
                max(mtdom_changes_seen_at) AS mtdom_changes_seen_at,
                count(*) FILTER (WHERE linkage = 'LINKED')::int AS linked_authorization_count,
                count(*) FILTER (WHERE linkage = 'HISTORICAL_EXACT_CANDIDATE')::int AS historical_candidate_authorization_count
         FROM visible GROUP BY patient_id
       ) SELECT * FROM grouped LIMIT 1`,
      cte.params,
    );
    const summaryRow = summary.rows[0];
    if (!summaryRow) return null;

    const evidence = await this.database.pool.query<AuthorizationEvidenceRow>(
      `${cte.sql}
       SELECT authorization_item_id AS id, authorization_number, linkage,
              organization_codes, dispensing_point_id
       FROM visible
       ORDER BY authorization_number, authorization_item_id
       LIMIT 500`,
      cte.params,
    );
    const profile = includeBasicProfile
      ? await this.database.pool.query<{
          mtdom_basic_profile: unknown;
          mtdom_basic_profile_source: string | null;
          mtdom_basic_profile_fetched_at: DateValue;
          mtdom_basic_profile_source_updated_at: DateValue;
        }>(
          `SELECT p.mtdom_basic_profile, p.mtdom_basic_profile_source,
                  p.mtdom_basic_profile_fetched_at, p.mtdom_basic_profile_source_updated_at
             FROM patients p
            WHERE p.id = $1::uuid`,
          [patientId],
        )
      : null;
    const item = mapListItem(summaryRow);
    return {
      ...item,
      basicProfile:
        profile?.rows[0]?.mtdom_basic_profile == null
          ? null
          : patientMasterBasicProfileSchema.parse(profile.rows[0].mtdom_basic_profile),
      basicProfileMetadata: profile?.rows[0]
        ? profileMetadata(
            profile.rows[0].mtdom_basic_profile_source,
            profile.rows[0].mtdom_basic_profile_fetched_at,
            profile.rows[0].mtdom_basic_profile_source_updated_at,
          )
        : null,
      authorizationEvidence: evidence.rows.map((row) => ({
        id: String(row.id),
        authorizationNumber: String(row.authorization_number),
        linkage: row.linkage,
        organizationCodes: row.organization_codes,
        dispensingPointId: row.dispensing_point_id == null ? null : String(row.dispensing_point_id),
      })),
    };
  }

  async personalProfile(
    scope: PatientMasterScope,
    patientId: string,
  ): Promise<PatientMasterPersonalResponse | null> {
    const cte = scopedPatientAuthorizationCte(scope, { patientId });
    const result = await this.database.pool.query<{
      mtdom_personal_profile: unknown;
      mtdom_personal_profile_source: string | null;
      mtdom_personal_profile_fetched_at: DateValue;
      mtdom_personal_profile_source_updated_at: DateValue;
    }>(
      `${cte.sql}
       SELECT p.mtdom_personal_profile, p.mtdom_personal_profile_source,
              p.mtdom_personal_profile_fetched_at, p.mtdom_personal_profile_source_updated_at
         FROM patients p
        WHERE EXISTS (SELECT 1 FROM visible WHERE visible.patient_id = p.id)
        LIMIT 1`,
      cte.params,
    );
    if (!result.rows[0]) return null;
    return {
      patientId,
      personalProfile:
        result.rows[0].mtdom_personal_profile == null
          ? null
          : patientMasterPersonalProfileSchema.parse(result.rows[0].mtdom_personal_profile),
      personalProfileMetadata: profileMetadata(
        result.rows[0].mtdom_personal_profile_source,
        result.rows[0].mtdom_personal_profile_fetched_at,
        result.rows[0].mtdom_personal_profile_source_updated_at,
      ),
    };
  }

  async reconciliationCases(
    scope: PatientMasterScope,
    limit = 100,
  ): Promise<PatientReconciliationCase[]> {
    const params: unknown[] = [scope.organizationId];
    let pointFilter = '';
    if (scope.pointAccessKind === 'explicit') {
      params.push(scope.accessiblePointIds);
      pointFilter = `AND EXISTS (
           SELECT 1 FROM patient_schedules ps
           WHERE ps.authorization_item_id = ai.id
             AND ps.dispensing_point_id = ANY($2::uuid[])
         )`;
    }
    params.push(limit);
    const limitParam = `$${params.length}`;
    const result = await this.database.pool.query<ReconciliationCaseRow>(
      `SELECT pbi.id, pbi.authorization_item_id, pbi.status, pbi.reason_code,
              pbi.processed_at, pbi.resolution_code, pbi.decided_at
       FROM patient_backfill_items pbi
       JOIN patient_backfill_batches pbb ON pbb.id = pbi.batch_id
       JOIN authorization_items ai ON ai.id = pbi.authorization_item_id
       WHERE pbb.organization_id = $1::uuid
         AND EXISTS (SELECT 1 FROM organizations mtd
                      WHERE mtd.id = $1::uuid AND mtd.code = 'MTD' AND mtd.active = true)
         AND pbi.status IN ('NEEDS_RECONCILIATION', 'CONFLICT', 'RESOLVED', 'REVERT_CONFLICT')
         AND EXISTS (
           SELECT 1 FROM authorization_item_organizations aio
           JOIN organizations operational_org ON operational_org.id = aio.organization_id
           WHERE aio.authorization_item_id = ai.id
             AND operational_org.code = 'MEDICARTE'
         )
         ${pointFilter}
       ORDER BY pbi.processed_at DESC, pbi.id
       LIMIT ${limitParam}`,
      params,
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      authorizationItemId: String(row.authorization_item_id),
      status: row.status,
      reasonCode: String(row.reason_code),
      processedAt: iso(row.processed_at) ?? '',
      resolutionCode: row.resolution_code == null ? null : String(row.resolution_code),
      decidedAt: iso(row.decided_at),
    }));
  }
}
