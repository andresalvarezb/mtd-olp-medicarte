import { Inject, Injectable } from '@nestjs/common';
import type { ClinicalAuthorization, ClinicalAuthorizationReference } from '@authorization/domain';
import { parseAuthorizationExpiration } from '@authorization/domain';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;

/**
 * Único punto que conoce el nombre del campo fuente de vencimiento dentro de
 * `source_data`. El resto del sistema consume la proyección ya normalizada
 * (`SchedulingAuthorization.authorizationExpiresOn`) o este fragmento SQL;
 * ni el dominio ni los servicios de programación acceden directamente a
 * `FECHA_FINAL_VIGENCIA`.
 */
export function schedulingExpirationColumn(tableAlias: 'i' | 'ai'): string {
  return `${tableAlias}.source_data->>'FECHA_FINAL_VIGENCIA'`;
}

/** Fragmento para consultas de programación que usan el alias `ai`. */
export const SCHEDULING_EXPIRATION_COLUMN = schedulingExpirationColumn('ai');

type ClinicalAuthorizationRow = {
  id: string;
  numero_autorizacion: string;
  codigo_medicamento: string;
  authorization_key: string;
  source_status_normalized: string;
  coverage_type: string;
  direction_status: string;
  created_at: Date;
  updated_at: Date;
};

/**
 * ESP-003: proyección clínica mínima para programación. Incluye identidad del
 * paciente y vencimiento porque son necesarios para la búsqueda individual y
 * la alerta visual; no se persisten en patient_schedules.
 */
export type SchedulingAuthorization = Readonly<{
  id: string;
  authorizationNumber: string;
  authorizationKey: string;
  commercialCode: string;
  enablementStatus: string;
  coverageType: string;
  directionStatus: string;
  patientDocument: string | null;
  patientName: string | null;
  authorizedQuantity: number | null;
  /** Fecha ISO YYYY-MM-DD normalizada de FECHA_FINAL_VIGENCIA (fragmento clínico). */
  authorizationExpiresOn: string | null;
}>;

export type SchedulingAuthorizationScope = Readonly<{
  organizationId: string;
  bypassOrganizationScope: boolean;
}>;

export type SchedulingAuthorizationSearchInput = SchedulingAuthorizationScope &
  Readonly<{
    authorization?: string;
    patientDocument?: string;
    commercialCode?: string;
    limit: number;
  }>;

type SchedulingAuthorizationRow = {
  id: string;
  numero_autorizacion: string;
  authorization_key: string;
  codigo_medicamento: string;
  enablement_status: string;
  coverage_type: string;
  direction_status: string;
  patient_document: string | null;
  patient_name: string | null;
  authorized_quantity: string | null;
  expiration_raw: string | null;
};

const SCHEDULING_COLUMNS = `i.id, i.numero_autorizacion, i.authorization_key, i.codigo_medicamento,
        i.enablement_status, i.coverage_type, i.direction_status,
        coalesce(i.source_data->>'IDENTIFICACION_PACIENTE', i.source_data->>'NUM_DOCUMENTO') as patient_document,
        i.source_data->>'NOMBRE_PACIENTE' as patient_name,
        case when (i.source_data->>'CANTIDAD') ~ '^[0-9]+$'
             then (i.source_data->>'CANTIDAD') end as authorized_quantity,
        ${schedulingExpirationColumn('i')} as expiration_raw`;

/** Read model restricted to the clinical and contractual ownership of an item. */
@Injectable()
export class ClinicalAuthorizationRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async findById(id: string): Promise<ClinicalAuthorization | null> {
    const result = await this.database.pool.query<ClinicalAuthorizationRow>(
      `select id, numero_autorizacion, codigo_medicamento, authorization_key,
              source_status_normalized, coverage_type, direction_status,
              created_at, updated_at
         from authorization_items
        where id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? this.toClinicalAuthorization(row) : null;
  }

  async findByReference(
    reference: ClinicalAuthorizationReference,
  ): Promise<ClinicalAuthorization | null> {
    const result = await this.database.pool.query<ClinicalAuthorizationRow>(
      `select id, numero_autorizacion, codigo_medicamento, authorization_key,
              source_status_normalized, coverage_type, direction_status,
              created_at, updated_at
         from authorization_items
        where id = $1 and codigo_medicamento = $2`,
      [reference.authorizationItemId, reference.commercialCode],
    );
    const row = result.rows[0];
    return row ? this.toClinicalAuthorization(row) : null;
  }

  /** Lectura con scope organizacional para resolver una programación puntual. */
  async findForSchedulingById(
    id: string,
    scope: SchedulingAuthorizationScope,
  ): Promise<SchedulingAuthorization | null> {
    const result = await this.database.pool.query<SchedulingAuthorizationRow>(
      `select ${SCHEDULING_COLUMNS}
         from authorization_items i
        where i.id = $1
          and ($2::boolean or exists (
            select 1 from authorization_item_organizations aio
             where aio.authorization_item_id = i.id and aio.organization_id = $3
          ))`,
      [id, scope.bypassOrganizationScope, scope.organizationId],
    );
    const row = result.rows[0];
    return row ? toSchedulingAuthorization(row) : null;
  }

  /**
   * Búsqueda de autorizaciones para programar. Es una proyección acotada del
   * read model clínico existente; no crea un endpoint clínico duplicado.
   */
  async searchForScheduling(
    input: SchedulingAuthorizationSearchInput,
  ): Promise<SchedulingAuthorization[]> {
    const conditions: string[] = [
      `($1::boolean or exists (
        select 1 from authorization_item_organizations aio
         where aio.authorization_item_id = i.id and aio.organization_id = $2
      ))`,
    ];
    const values: unknown[] = [input.bypassOrganizationScope, input.organizationId];
    if (input.authorization !== undefined) {
      values.push(input.authorization);
      const position = values.length;
      conditions.push(
        `(position(upper($${position}) in upper(i.numero_autorizacion)) > 0
          or position(upper($${position}) in upper(i.authorization_key)) > 0)`,
      );
    }
    if (input.patientDocument !== undefined) {
      values.push(input.patientDocument);
      const position = values.length;
      conditions.push(
        `position(upper($${position}) in upper(coalesce(i.source_data->>'IDENTIFICACION_PACIENTE', i.source_data->>'NUM_DOCUMENTO', ''))) > 0`,
      );
    }
    if (input.commercialCode !== undefined) {
      values.push(input.commercialCode);
      const position = values.length;
      conditions.push(`i.codigo_medicamento = $${position}`);
    }
    values.push(input.limit);
    const limitPosition = values.length;
    const result = await this.database.pool.query<SchedulingAuthorizationRow>(
      `select ${SCHEDULING_COLUMNS}
         from authorization_items i
        where ${conditions.join(' and ')}
        order by i.numero_autorizacion, i.codigo_medicamento
        limit $${limitPosition}`,
      values,
    );
    return result.rows.map(toSchedulingAuthorization);
  }

  /** Carga masiva para staging XLSX: resuelve por número de autorización exacto. */
  async loadForImportByNumbers(
    numbers: readonly string[],
    scope: SchedulingAuthorizationScope,
  ): Promise<SchedulingAuthorization[]> {
    if (numbers.length === 0) return [];
    const result = await this.database.pool.query<SchedulingAuthorizationRow>(
      `select ${SCHEDULING_COLUMNS}
         from authorization_items i
        where i.numero_autorizacion = any($1::text[])
          and ($2::boolean or exists (
            select 1 from authorization_item_organizations aio
             where aio.authorization_item_id = i.id and aio.organization_id = $3
          ))`,
      [[...numbers], scope.bypassOrganizationScope, scope.organizationId],
    );
    return result.rows.map(toSchedulingAuthorization);
  }

  private toClinicalAuthorization(row: ClinicalAuthorizationRow): ClinicalAuthorization {
    return {
      id: row.id,
      numeroAutorizacion: row.numero_autorizacion,
      commercialCode: row.codigo_medicamento,
      authorizationKey: row.authorization_key,
      sourceStatusNormalized: row.source_status_normalized,
      coverageType: row.coverage_type,
      directionStatus: row.direction_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function toSchedulingAuthorization(row: SchedulingAuthorizationRow): SchedulingAuthorization {
  return {
    id: row.id,
    authorizationNumber: row.numero_autorizacion,
    authorizationKey: row.authorization_key,
    commercialCode: row.codigo_medicamento,
    enablementStatus: row.enablement_status,
    coverageType: row.coverage_type,
    directionStatus: row.direction_status,
    patientDocument: row.patient_document,
    patientName: row.patient_name,
    authorizedQuantity:
      row.authorized_quantity === null ? null : Number.parseInt(row.authorized_quantity, 10),
    authorizationExpiresOn: parseAuthorizationExpiration(row.expiration_raw),
  };
}
