import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  LateHandling,
  PatientScheduleChangeType,
  PatientScheduleHistoryEntry,
  PatientScheduleListQuery,
  PatientScheduleResponse,
  PatientScheduleStatus,
  ScheduleTiming,
} from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';
import {
  calculateAuthorizationPriority,
  classifyScheduleTiming,
  evaluateScheduleAuthorizationEligibility,
  parseAuthorizationExpiration,
  scheduleToday,
} from '@authorization/domain';
import { SCHEDULING_EXPIRATION_COLUMN } from '../clinical/clinical-authorization.repository';
import { applyPointScope, lockActivePointGrants } from '../common/point-scope.sql';
import { DATABASE } from '../tokens';
import type { PointAccessKind } from '@authorization/contracts';

type Database = ReturnType<typeof createDatabase>;
export type PatientScheduleTransaction = Parameters<
  Parameters<Database['db']['transaction']>[0]
>[0];
type Transaction = PatientScheduleTransaction;

export type PatientScheduleActor = Readonly<{
  userId: string;
  organizationId: string;
  correlationId: string;
  pointAccessKind: PointAccessKind;
}>;

export type PatientScheduleScope = Readonly<{
  organizationId: string;
  userId: string;
  bypassOrganizationScope: boolean;
  pointAccessKind: PointAccessKind;
}>;

export type PlanningPeriodContext = Readonly<{
  id: string;
  startDate: string;
  endDate: string;
  schedulingCutoffAt: string;
}>;

export type DispensingPointOption = Readonly<{
  id: string;
  code: string;
  name: string;
  active: boolean;
}>;

export type PatientScheduleWriteValues = Readonly<{
  authorizationItemId: string;
  commercialCode: string;
  planningPeriodId: string;
  dispensingPointId: string;
  scheduledDate: string;
  quantity: number;
  status: PatientScheduleStatus;
  scheduleTiming: ScheduleTiming;
  lateHandling: LateHandling | null;
  deferredPlanningPeriodId: string | null;
}>;

/**
 * ESP-003 hardening: cada mutación material toma lock sobre la fila de
 * patient_schedules y sobre authorization_item/producto dentro de LA MISMA
 * transacción, re-evalúa la elegibilidad clínica después de adquirir los
 * locks y solo entonces persiste schedule + history + audit. El resultado
 * nunca depende únicamente de los FK.
 */
export type PatientScheduleRequestedChange = Readonly<{
  scheduledDate?: string;
  dispensingPointId?: string;
  quantity?: number;
  /** undefined = conservar el manejo actual; null = limpiar. */
  requestedHandling?: LateHandling | null;
}>;

export type PatientScheduleCreateInput = Readonly<{
  authorizationItemId: string;
  /** Código comercial canónico ya resuelto contra el item por el servicio. */
  commercialCode: string;
  dispensingPointId: string;
  scheduledDate: string;
  quantity: number;
  requestedLateHandling: LateHandling | null;
}>;

export type PatientSchedulePersistenceOutcome =
  | { outcome: 'created'; schedule: PatientScheduleResponse }
  | { outcome: 'updated'; schedule: PatientScheduleResponse }
  | { outcome: 'unchanged'; schedule: PatientScheduleResponse }
  | { outcome: 'not_found' }
  | { outcome: 'version_conflict'; current: PatientScheduleResponse }
  | { outcome: 'authorization_not_found' }
  | { outcome: 'commercial_code_mismatch' }
  | { outcome: 'authorization_conflict'; code: string; message: string }
  | { outcome: 'period_not_found' }
  | { outcome: 'duplicate_schedule' }
  | { outcome: 'late_handling_required'; timing: ScheduleTiming }
  | { outcome: 'invalid_late_handling'; timing: ScheduleTiming }
  | { outcome: 'next_period_not_found' };

export type StagedImportRowInsert = Readonly<{
  rowNumber: number;
  rawData: unknown;
  normalizedData: unknown;
  stagingStatus: 'VALID' | 'INVALID' | 'DUPLICATE' | 'CONFLICT';
  resultCode: string;
  resultMessage: string | null;
  patientDocument: string | null;
  authorizationNumber: string | null;
  commercialCode: string | null;
  quantity: number | null;
  dispensingPointCode: string | null;
  scheduledDate: string | null;
  authorizationItemId: string | null;
  planningPeriodId: string | null;
  dispensingPointId: string | null;
  scheduleTiming: ScheduleTiming | null;
  lateHandling: LateHandling | null;
  deferredPlanningPeriodId: string | null;
  confirmable: boolean;
}>;

export type PatientScheduleImportRowRecord = Readonly<{
  id: string;
  rowNumber: number;
  stagingStatus: 'VALID' | 'INVALID' | 'DUPLICATE' | 'CONFLICT';
  resultCode: string;
  resultMessage: string | null;
  confirmable: boolean;
  patientDocument: string | null;
  authorizationNumber: string | null;
  commercialCode: string | null;
  dispensingPointCode: string | null;
  quantity: number | null;
  authorizationItemId: string | null;
  planningPeriodId: string | null;
  dispensingPointId: string | null;
  scheduledDate: string | null;
  scheduleTiming: ScheduleTiming | null;
  lateHandling: LateHandling | null;
  deferredPlanningPeriodId: string | null;
}>;

type PatientScheduleJoinedRow = {
  id: string;
  authorization_item_id: string;
  authorization_number: string;
  planning_period_id: string;
  planning_period_start_date: string;
  planning_period_end_date: string;
  scheduling_cutoff_at: string;
  dispensing_point_id: string;
  dispensing_point_code: string;
  dispensing_point_name: string;
  commercial_code: string;
  patient_document: string | null;
  patient_name: string | null;
  scheduled_date: string;
  quantity: number;
  status: PatientScheduleStatus;
  schedule_timing: ScheduleTiming;
  late_handling: LateHandling | null;
  deferred_planning_period_id: string | null;
  revision: number;
  authorization_expires_on: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

type PatientScheduleCurrentRow = {
  id: string;
  authorization_item_id: string;
  planning_period_id: string;
  dispensing_point_id: string;
  commercial_code: string;
  scheduled_date: string;
  quantity: number;
  status: PatientScheduleStatus;
  schedule_timing: ScheduleTiming;
  late_handling: LateHandling | null;
  deferred_planning_period_id: string | null;
  revision: number;
};

type PatientScheduleHistoryRow = {
  patient_schedule_id: string;
  revision: number;
  change_type: PatientScheduleChangeType;
  authorization_item_id: string;
  planning_period_id: string;
  dispensing_point_id: string;
  commercial_code: string;
  scheduled_date: string;
  quantity: number;
  status: PatientScheduleStatus;
  schedule_timing: ScheduleTiming;
  late_handling: LateHandling | null;
  deferred_planning_period_id: string | null;
  changed_by: string;
  correlation_id: string;
  changed_at: string;
};

export type PatientScheduleImportBatchRecord = Readonly<{
  id: string;
  status: 'UPLOADED' | 'VALIDATING' | 'READY_TO_CONFIRM' | 'CONFIRMING' | 'COMPLETED' | 'FAILED';
  organizationId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  conflictRows: number;
  confirmedRows: number;
  lastErrorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  confirmedAt: string | null;
}>;

type ImportBatchRow = {
  id: string;
  status: PatientScheduleImportBatchRecord['status'];
  organization_id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  conflict_rows: number;
  confirmed_rows: number;
  last_error_code: string | null;
  created_at: string;
  completed_at: string | null;
  confirmed_at: string | null;
};

/**
 * ESP-003: acceso a patient_schedules/patient_schedule_history. Toda mutación
 * material corre en una transacción que bloquea la fila, valida la revisión
 * esperada (concurrencia optimista), inserta el snapshot append-only y el
 * audit_event. Nunca toca authorization_items.
 */
@Injectable()
export class PatientScheduleRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async findById(id: string, scope: PatientScheduleScope): Promise<PatientScheduleResponse | null> {
    const scopeFilter = this.orgScopeFilter(scope);
    const result = await this.database.db.execute<PatientScheduleJoinedRow>(sql`
      select ${SCHEDULE_COLUMNS}
      from patient_schedules ps
      join authorization_items ai on ai.id = ps.authorization_item_id
      join planning_periods pp on pp.id = ps.planning_period_id
      join dispensing_points dp on dp.id = ps.dispensing_point_id
      where ps.id = ${id}
        and ${scopeFilter}
    `);
    const row = result.rows[0];
    return row ? toPatientScheduleResponse(row) : null;
  }

  async list(
    query: PatientScheduleListQuery,
    scope: PatientScheduleScope,
  ): Promise<PatientScheduleResponse[]> {
    const filters: SQL[] = [this.scopeFilter(scope)];
    if (query.authorization !== undefined) {
      filters.push(sql`(position(upper(${query.authorization}) in upper(ai.numero_autorizacion)) > 0
        or position(upper(${query.authorization}) in upper(ai.authorization_key)) > 0)`);
    }
    if (query.patientDocument !== undefined) {
      filters.push(
        sql`position(upper(${query.patientDocument}) in upper(coalesce(ai.source_data->>'IDENTIFICACION_PACIENTE', ai.source_data->>'NUM_DOCUMENTO', ''))) > 0`,
      );
    }
    if (query.planningPeriodId !== undefined) {
      filters.push(sql`ps.planning_period_id = ${query.planningPeriodId}`);
    }
    if (query.dispensingPointId !== undefined) {
      filters.push(sql`ps.dispensing_point_id = ${query.dispensingPointId}`);
    }
    if (query.status !== undefined) {
      filters.push(sql`ps.status = ${query.status}`);
    }
    if (query.commercialCode !== undefined) {
      filters.push(sql`ps.commercial_code = ${query.commercialCode}`);
    }
    const result = await this.database.db.execute<PatientScheduleJoinedRow>(sql`
      select ${SCHEDULE_COLUMNS}
      from patient_schedules ps
      join authorization_items ai on ai.id = ps.authorization_item_id
      join planning_periods pp on pp.id = ps.planning_period_id
      join dispensing_points dp on dp.id = ps.dispensing_point_id
      where ${sql.join(filters, sql` and `)}
      order by ps.created_at desc, ps.id desc
      limit ${query.limit}
    `);
    return result.rows.map(toPatientScheduleResponse);
  }

  async findByAuthorization(
    authorizationItemId: string,
    scope: PatientScheduleScope,
  ): Promise<PatientScheduleResponse[]> {
    const scopeFilter = this.scopeFilter(scope);
    const result = await this.database.db.execute<PatientScheduleJoinedRow>(sql`
      select ${SCHEDULE_COLUMNS}
      from patient_schedules ps
      join authorization_items ai on ai.id = ps.authorization_item_id
      join planning_periods pp on pp.id = ps.planning_period_id
      join dispensing_points dp on dp.id = ps.dispensing_point_id
      where ps.authorization_item_id = ${authorizationItemId}
        and ${scopeFilter}
      order by ps.created_at desc, ps.id desc
    `);
    return result.rows.map(toPatientScheduleResponse);
  }

  async findByPatient(
    patientDocument: string,
    scope: PatientScheduleScope,
  ): Promise<PatientScheduleResponse[]> {
    const scopeFilter = this.scopeFilter(scope);
    const result = await this.database.db.execute<PatientScheduleJoinedRow>(sql`
      select ${SCHEDULE_COLUMNS}
      from patient_schedules ps
      join authorization_items ai on ai.id = ps.authorization_item_id
      join planning_periods pp on pp.id = ps.planning_period_id
      join dispensing_points dp on dp.id = ps.dispensing_point_id
      where position(upper(${patientDocument}) in upper(coalesce(ai.source_data->>'IDENTIFICACION_PACIENTE', ai.source_data->>'NUM_DOCUMENTO', ''))) > 0
        and ${scopeFilter}
      order by ps.created_at desc, ps.id desc
    `);
    return result.rows.map(toPatientScheduleResponse);
  }

  async listByPeriod(
    planningPeriodId: string,
    scope: PatientScheduleScope,
  ): Promise<PatientScheduleResponse[]> {
    return this.list({ planningPeriodId, limit: 500 }, scope);
  }

  async listByPoint(
    dispensingPointId: string,
    scope: PatientScheduleScope,
  ): Promise<PatientScheduleResponse[]> {
    return this.list({ dispensingPointId, limit: 500 }, scope);
  }

  async listHistory(
    id: string,
    scope: PatientScheduleScope,
  ): Promise<PatientScheduleHistoryEntry[]> {
    const scopeFilter = this.scopeFilter(scope);
    const result = await this.database.db.execute<PatientScheduleHistoryRow>(sql`
      select
        h.patient_schedule_id,
        h.revision,
        h.change_type,
        h.authorization_item_id,
        h.planning_period_id,
        h.dispensing_point_id,
        h.commercial_code,
        to_char(h.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
        h.quantity,
        h.status,
        h.schedule_timing,
        h.late_handling,
        h.deferred_planning_period_id,
        h.changed_by,
        h.correlation_id,
        to_char(h.changed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as changed_at
      from patient_schedule_history h
      join patient_schedules ps on ps.id = h.patient_schedule_id
      where h.patient_schedule_id = ${id}
        and ${scopeFilter}
      order by h.revision asc
    `);
    return result.rows.map(toHistoryEntry);
  }

  async findPeriodForDate(scheduledDate: string): Promise<PlanningPeriodContext | null> {
    const result = await this.database.db.execute<{
      id: string;
      start_date: string;
      end_date: string;
      scheduling_cutoff_at: string;
    }>(sql`
      select id,
             to_char(start_date, 'YYYY-MM-DD') as start_date,
             to_char(end_date, 'YYYY-MM-DD') as end_date,
             to_char(scheduling_cutoff_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as scheduling_cutoff_at
      from planning_periods
      where start_date <= ${scheduledDate} and end_date >= ${scheduledDate}
      order by start_date
      limit 1
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      startDate: row.start_date,
      endDate: row.end_date,
      schedulingCutoffAt: row.scheduling_cutoff_at,
    };
  }

  async findNextPeriod(periodEndDate: string): Promise<PlanningPeriodContext | null> {
    const result = await this.database.db.execute<{
      id: string;
      start_date: string;
      end_date: string;
      scheduling_cutoff_at: string;
    }>(sql`
      select id,
             to_char(start_date, 'YYYY-MM-DD') as start_date,
             to_char(end_date, 'YYYY-MM-DD') as end_date,
             to_char(scheduling_cutoff_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as scheduling_cutoff_at
      from planning_periods
      where start_date > ${periodEndDate}
      order by start_date
      limit 1
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      startDate: row.start_date,
      endDate: row.end_date,
      schedulingCutoffAt: row.scheduling_cutoff_at,
    };
  }

  async findDispensingPointById(id: string): Promise<DispensingPointOption | null> {
    const result = await this.database.db.execute<{
      id: string;
      code: string;
      name: string;
      active: boolean;
    }>(sql`select id, code, name, active from dispensing_points where id = ${id}`);
    return result.rows[0] ?? null;
  }

  async listDispensingPoints(scope: PatientScheduleScope): Promise<DispensingPointOption[]> {
    const result = await this.database.db.execute<{
      id: string;
      code: string;
      name: string;
      active: boolean;
    }>(sql`
      select id, code, name, active
      from dispensing_points
      where active = true
        and ${applyPointScope(sql`id`, scope)}
      order by name, code
    `);
    return result.rows;
  }

  async hasActiveGrant(userId: string, pointId: string): Promise<boolean> {
    const result = await this.database.db.execute<{ id: string }>(sql`
      select id from user_point_scopes
      where user_id = ${userId}::uuid
        and dispensing_point_id = ${pointId}::uuid
        and revoked_at is null
    `);
    return Boolean(result.rows[0]);
  }

  async findDispensingPointsByCodes(codes: readonly string[]): Promise<DispensingPointOption[]> {
    if (codes.length === 0) return [];
    const placeholders = codes.map((code) => sql`upper(${code})`);
    const result = await this.database.db.execute<{
      id: string;
      code: string;
      name: string;
      active: boolean;
    }>(sql`
      select id, code, name, active
      from dispensing_points
      where upper(code) in (${sql.join(placeholders, sql`, `)})
    `);
    return result.rows;
  }

  /**
   * Creación con consistencia transaccional: dentro de la transacción se
   * bloquea authorization_item/producto, se re-evalúa la elegibilidad y se
   * re-resuelve período/timing/late_handling antes de persistir.
   */
  async create(input: {
    request: PatientScheduleCreateInput;
    actor: PatientScheduleActor;
  }): Promise<PatientSchedulePersistenceOutcome> {
    return this.withDuplicateGuard(() =>
      this.database.db.transaction(async (tx) => this.createInTx(tx, input)),
    );
  }

  /**
   * Same ESP-003 create path, using a caller-supplied transaction.
   * Nested callers must let unique-identity errors propagate so the outer
   * transaction rolls back; they must not catch-and-commit.
   */
  async createInTx(
    tx: Transaction,
    input: {
      request: PatientScheduleCreateInput;
      actor: PatientScheduleActor;
    },
  ): Promise<PatientSchedulePersistenceOutcome> {
    await lockActivePointGrants(tx, input.actor, [input.request.dispensingPointId]);
    const item = await lockAuthorizableItem(tx, input.request.authorizationItemId);
    if (!item) return { outcome: 'authorization_not_found' as const };
    if (item.codigo_medicamento !== input.request.commercialCode) {
      return { outcome: 'commercial_code_mismatch' as const };
    }
    const eligibility = eligibilityOf(item);
    if (!eligibility.eligible) {
      return {
        outcome: 'authorization_conflict' as const,
        code: eligibility.code ?? 'PATIENT_SCHEDULE_AUTHORIZATION_NOT_SCHEDULABLE',
        message: eligibility.message ?? 'The authorization is not schedulable',
      };
    }

    const period = await lockPeriodForDate(tx, input.request.scheduledDate);
    if (!period) return { outcome: 'period_not_found' as const };
    const timing = classifyScheduleTiming(period, new Date());

    const handling = resolveHandling(timing, input.request.requestedLateHandling);
    if (!handling.ok) {
      return {
        outcome:
          handling.reason === 'not_allowed' ? 'invalid_late_handling' : 'late_handling_required',
        timing: handling.timing,
      };
    }

    const deferredPlanningPeriodId = await resolveDeferredPeriod(tx, period, handling.value);
    if (handling.value === 'NEXT_PERIOD' && deferredPlanningPeriodId === null) {
      return { outcome: 'next_period_not_found' as const };
    }

    const values: PatientScheduleWriteValues = {
      authorizationItemId: item.id,
      commercialCode: item.codigo_medicamento,
      planningPeriodId: period.id,
      dispensingPointId: input.request.dispensingPointId,
      scheduledDate: input.request.scheduledDate,
      quantity: input.request.quantity,
      status: 'SCHEDULED',
      scheduleTiming: timing,
      lateHandling: handling.value,
      deferredPlanningPeriodId,
    };
    return persistNewScheduleIsolated(tx, values, input.actor);
  }

  /**
   * Mutación material con locks en transacción: patient_schedules (revision)
   * y authorization_item. La elegibilidad clínica se re-evalúa DESPUÉS de
   * adquirir el lock; un cambio concurrente en la autorización impide
   * escribir una programación basada en estado obsoleto.
   */
  async applyMutation(input: {
    id: string;
    expectedRevision: number;
    changeType: PatientScheduleChangeType;
    requested?: PatientScheduleRequestedChange;
    actor: PatientScheduleActor;
  }): Promise<PatientSchedulePersistenceOutcome> {
    const requested: PatientScheduleRequestedChange =
      input.changeType === 'CANCELLED' ? {} : (input.requested ?? {});
    return this.withDuplicateGuard(() =>
      this.database.db.transaction(async (tx) => {
        const current = await lockCurrent(tx, input.id);
        if (!current) return { outcome: 'not_found' as const };
        await lockActivePointGrants(tx, input.actor, [
          current.dispensing_point_id,
          requested.dispensingPointId ?? current.dispensing_point_id,
        ]);
        if (current.revision !== input.expectedRevision) {
          const schedule = await selectJoined(tx, input.id);
          if (!schedule) return { outcome: 'not_found' as const };
          return { outcome: 'version_conflict' as const, current: schedule };
        }

        if (input.changeType === 'CANCELLED') {
          const values: PatientScheduleWriteValues = {
            authorizationItemId: current.authorization_item_id,
            commercialCode: current.commercial_code,
            planningPeriodId: current.planning_period_id,
            dispensingPointId: current.dispensing_point_id,
            scheduledDate: current.scheduled_date,
            quantity: current.quantity,
            status: 'CANCELLED',
            scheduleTiming: current.schedule_timing,
            lateHandling: current.late_handling,
            deferredPlanningPeriodId: current.deferred_planning_period_id,
          };
          const schedule = await persistMutation(tx, input.id, current, values, input);
          return { outcome: 'updated' as const, schedule };
        }

        const item = await lockAuthorizableItem(tx, current.authorization_item_id);
        if (!item) return { outcome: 'authorization_not_found' as const };
        if (item.codigo_medicamento !== current.commercial_code) {
          return { outcome: 'commercial_code_mismatch' as const };
        }
        const eligibility = eligibilityOf(item);
        if (!eligibility.eligible) {
          return {
            outcome: 'authorization_conflict' as const,
            code: eligibility.code ?? 'PATIENT_SCHEDULE_AUTHORIZATION_NOT_SCHEDULABLE',
            message: eligibility.message ?? 'The authorization is not schedulable',
          };
        }

        const scheduledDate = requested.scheduledDate ?? current.scheduled_date;
        const period = await lockPeriodForDate(tx, scheduledDate);
        if (!period) return { outcome: 'period_not_found' as const };
        const timing = classifyScheduleTiming(period, new Date());
        const requestedHandling =
          requested.requestedHandling === undefined
            ? current.late_handling
            : requested.requestedHandling;
        const handling = resolveHandling(timing, requestedHandling);
        if (!handling.ok) {
          return {
            outcome:
              handling.reason === 'not_allowed'
                ? 'invalid_late_handling'
                : 'late_handling_required',
            timing: handling.timing,
          };
        }
        const deferredPlanningPeriodId = await resolveDeferredPeriod(tx, period, handling.value);
        if (handling.value === 'NEXT_PERIOD' && deferredPlanningPeriodId === null) {
          return { outcome: 'next_period_not_found' as const };
        }

        const values: PatientScheduleWriteValues = {
          authorizationItemId: current.authorization_item_id,
          commercialCode: current.commercial_code,
          planningPeriodId: period.id,
          dispensingPointId: requested.dispensingPointId ?? current.dispensing_point_id,
          scheduledDate,
          quantity: requested.quantity ?? current.quantity,
          status:
            scheduledDate !== current.scheduled_date
              ? 'RESCHEDULED'
              : (current.status as 'SCHEDULED' | 'RESCHEDULED'),
          scheduleTiming: timing,
          lateHandling: handling.value,
          deferredPlanningPeriodId,
        };
        if (isSameState(current, values)) {
          const schedule = await selectJoined(tx, input.id);
          if (!schedule) return { outcome: 'not_found' as const };
          return { outcome: 'unchanged' as const, schedule };
        }

        const schedule = await persistMutation(tx, input.id, current, values, input);
        return { outcome: 'updated' as const, schedule };
      }),
    );
  }

  /** Traduce la violación de la identidad canónica a un outcome estructurado. */
  private withDuplicateGuard(
    transaction: () => Promise<PatientSchedulePersistenceOutcome>,
  ): Promise<PatientSchedulePersistenceOutcome> {
    return transaction().catch((error: unknown) => {
      if (isScheduleDuplicateError(error)) return { outcome: 'duplicate_schedule' as const };
      throw error;
    });
  }

  private orgScopeFilter(scope: PatientScheduleScope): SQL {
    if (scope.bypassOrganizationScope) return sql`true`;
    return sql`exists (
      select 1 from authorization_item_organizations aio
      where aio.authorization_item_id = ps.authorization_item_id
        and aio.organization_id = ${scope.organizationId}
    )`;
  }

  private scopeFilter(scope: PatientScheduleScope): SQL {
    return sql`${this.orgScopeFilter(scope)} and ${applyPointScope(sql`ps.dispensing_point_id`, scope)}`;
  }

  async loadActiveSchedulesForItems(
    itemIds: readonly string[],
  ): Promise<
    Array<{ authorizationItemId: string; dispensingPointId: string; scheduledDate: string }>
  > {
    if (itemIds.length === 0) return [];
    const placeholders = itemIds.map((id) => sql`${id}::uuid`);
    const result = await this.database.db.execute<{
      authorization_item_id: string;
      dispensing_point_id: string;
      scheduled_date: string;
    }>(sql`
      select authorization_item_id, dispensing_point_id,
             to_char(scheduled_date, 'YYYY-MM-DD') as scheduled_date
      from patient_schedules
      where authorization_item_id in (${sql.join(placeholders, sql`, `)})
        and status in ('SCHEDULED', 'RESCHEDULED')
    `);
    return result.rows.map((row) => ({
      authorizationItemId: row.authorization_item_id,
      dispensingPointId: row.dispensing_point_id,
      scheduledDate: row.scheduled_date,
    }));
  }

  async loadPeriodsCovering(minDate: string, maxDate: string): Promise<PlanningPeriodContext[]> {
    const result = await this.database.db.execute<{
      id: string;
      start_date: string;
      end_date: string;
      scheduling_cutoff_at: string;
    }>(sql`
      select id,
             to_char(start_date, 'YYYY-MM-DD') as start_date,
             to_char(end_date, 'YYYY-MM-DD') as end_date,
             to_char(scheduling_cutoff_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as scheduling_cutoff_at
      from planning_periods
      where start_date <= ${maxDate} and end_date >= ${minDate}
      order by start_date
    `);
    return result.rows.map((row) => ({
      id: row.id,
      startDate: row.start_date,
      endDate: row.end_date,
      schedulingCutoffAt: row.scheduling_cutoff_at,
    }));
  }

  async createImportBatch(input: {
    actor: PatientScheduleActor;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    content: Buffer;
    rows: readonly StagedImportRowInsert[];
  }): Promise<PatientScheduleImportBatchRecord> {
    const validRows = input.rows.filter((row) => row.stagingStatus === 'VALID').length;
    const invalidRows = input.rows.filter((row) => row.stagingStatus === 'INVALID').length;
    const duplicateRows = input.rows.filter((row) => row.stagingStatus === 'DUPLICATE').length;
    const conflictRows = input.rows.filter((row) => row.stagingStatus === 'CONFLICT').length;
    return this.database.db.transaction(async (tx) => {
      const inserted = await tx.execute<ImportBatchRow>(sql`
        insert into patient_schedule_imports
          (organization_id, created_by, original_filename, mime_type, size_bytes, sha256,
           status, total_rows, valid_rows, invalid_rows, duplicate_rows, conflict_rows,
           correlation_id, completed_at)
        values (
          ${input.actor.organizationId},
          ${input.actor.userId},
          ${input.originalFilename},
          ${input.mimeType},
          ${input.sizeBytes},
          ${input.sha256},
          'READY_TO_CONFIRM',
          ${input.rows.length},
          ${validRows},
          ${invalidRows},
          ${duplicateRows},
          ${conflictRows},
          ${input.actor.correlationId},
          now()
        )
        returning ${IMPORT_BATCH_COLUMNS}
      `);
      const batch = inserted.rows[0];
      if (!batch) throw new Error('Patient schedule import insert returned no row');
      await tx.execute(sql`
        insert into patient_schedule_import_source_files
          (import_id, original_filename, mime_type, size_bytes, sha256, content, processed_at)
        values (
          ${batch.id},
          ${input.originalFilename},
          ${input.mimeType},
          ${input.sizeBytes},
          ${input.sha256},
          ${input.content},
          now()
        )
      `);
      // Política PHI: el archivo fuente no permanece almacenado tras normalizar.
      await tx.execute(sql`
        update patient_schedule_import_source_files
        set content = null
        where import_id = ${batch.id}
      `);
      for (const row of input.rows) {
        await tx.execute(sql`
          insert into patient_schedule_import_rows
            (import_id, row_number, raw_data, normalized_data, staging_status, result_code,
             result_message, patient_document, authorization_number, commercial_code, quantity,
             dispensing_point_code, scheduled_date, authorization_item_id, planning_period_id,
             dispensing_point_id, schedule_timing, late_handling, deferred_planning_period_id,
             confirmable)
          values (
            ${batch.id},
            ${row.rowNumber},
            ${JSON.stringify(row.rawData)}::jsonb,
            ${row.normalizedData === null ? null : JSON.stringify(row.normalizedData)}::jsonb,
            ${row.stagingStatus},
            ${row.resultCode},
            ${row.resultMessage},
            ${row.patientDocument},
            ${row.authorizationNumber},
            ${row.commercialCode},
            ${row.quantity},
            ${row.dispensingPointCode},
            ${row.scheduledDate},
            ${row.authorizationItemId},
            ${row.planningPeriodId},
            ${row.dispensingPointId},
            ${row.scheduleTiming},
            ${row.lateHandling},
            ${row.deferredPlanningPeriodId},
            ${row.confirmable}
          )
        `);
      }
      await insertImportAuditEvent(tx, {
        actor: input.actor,
        action: 'PATIENT_SCHEDULE_IMPORT_CREATED',
        importId: batch.id,
        metadata: { totalRows: input.rows.length, validRows },
      });
      return toImportBatch(batch);
    });
  }

  async listImportBatches(
    scope: PatientScheduleScope,
    limit: number,
  ): Promise<PatientScheduleImportBatchRecord[]> {
    const orgFilter = scope.bypassOrganizationScope
      ? sql`true`
      : sql`organization_id = ${scope.organizationId}`;
    const result = await this.database.db.execute<ImportBatchRow>(sql`
      select ${IMPORT_BATCH_COLUMNS}
      from patient_schedule_imports
      where ${orgFilter}
      order by created_at desc
      limit ${limit}
    `);
    return result.rows.map(toImportBatch);
  }

  async findImportById(
    id: string,
    scope: PatientScheduleScope,
  ): Promise<PatientScheduleImportBatchRecord | null> {
    const orgFilter = scope.bypassOrganizationScope
      ? sql`true`
      : sql`organization_id = ${scope.organizationId}`;
    const result = await this.database.db.execute<ImportBatchRow>(sql`
      select ${IMPORT_BATCH_COLUMNS}
      from patient_schedule_imports
      where id = ${id} and ${orgFilter}
    `);
    const row = result.rows[0];
    return row ? toImportBatch(row) : null;
  }

  async listImportRows(importId: string): Promise<
    Array<
      PatientScheduleImportRowRecord & {
        rawData: unknown;
        patientScheduleId: string | null;
        confirmedAt: string | null;
      }
    >
  > {
    const result = await this.database.db.execute<{
      id: string;
      row_number: number;
      staging_status: PatientScheduleImportRowRecord['stagingStatus'];
      result_code: string;
      result_message: string | null;
      confirmable: boolean;
      patient_document: string | null;
      authorization_number: string | null;
      commercial_code: string | null;
      quantity: number | null;
      dispensing_point_code: string | null;
      authorization_item_id: string | null;
      planning_period_id: string | null;
      dispensing_point_id: string | null;
      scheduled_date: string | null;
      schedule_timing: ScheduleTiming | null;
      late_handling: LateHandling | null;
      deferred_planning_period_id: string | null;
      raw_data: unknown;
      patient_schedule_id: string | null;
      confirmed_at: string | null;
    }>(sql`
      select id, row_number, staging_status, result_code, result_message, confirmable,
             patient_document, authorization_number, commercial_code, quantity,
             dispensing_point_code,
             authorization_item_id, planning_period_id, dispensing_point_id,
             to_char(scheduled_date, 'YYYY-MM-DD') as scheduled_date, schedule_timing,
             late_handling, deferred_planning_period_id, raw_data, patient_schedule_id,
             to_char(confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as confirmed_at
      from patient_schedule_import_rows
      where import_id = ${importId}
      order by row_number
    `);
    return result.rows.map((row) => ({
      id: row.id,
      rowNumber: row.row_number,
      stagingStatus: row.staging_status,
      resultCode: row.result_code,
      resultMessage: row.result_message,
      confirmable: row.confirmable,
      patientDocument: row.patient_document,
      authorizationNumber: row.authorization_number,
      commercialCode: row.commercial_code,
      quantity: row.quantity,
      dispensingPointCode: row.dispensing_point_code,
      authorizationItemId: row.authorization_item_id,
      planningPeriodId: row.planning_period_id,
      dispensingPointId: row.dispensing_point_id,
      scheduledDate: row.scheduled_date,
      scheduleTiming: row.schedule_timing,
      lateHandling: row.late_handling,
      deferredPlanningPeriodId: row.deferred_planning_period_id,
      rawData: row.raw_data,
      patientScheduleId: row.patient_schedule_id,
      confirmedAt: row.confirmed_at,
    }));
  }

  async listConfirmableRows(importId: string): Promise<PatientScheduleImportRowRecord[]> {
    const rows = await this.listImportRows(importId);
    return rows.filter((row) => row.confirmable && row.stagingStatus === 'VALID');
  }

  async beginConfirmation(importId: string): Promise<boolean> {
    return this.database.db.transaction(async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        update patient_schedule_imports
        set status = 'CONFIRMING'
        where id = ${importId} and status = 'READY_TO_CONFIRM'
        returning id
      `);
      return Boolean(result.rows[0]);
    });
  }

  async confirmImportRow(input: {
    rowId: string;
    actor: PatientScheduleActor;
  }): Promise<
    | { outcome: 'confirmed'; scheduleId: string }
    | { outcome: 'skipped' }
    | { outcome: 'conflict'; message: string; code?: string }
  > {
    return this.database.db.transaction(async (tx) => {
      const claimed = await tx.execute<PatientScheduleImportRowRecord & { importId: string }>(sql`
        update patient_schedule_import_rows
        set confirmable = false
        where id = ${input.rowId} and confirmable = true and staging_status = 'VALID'
        returning id,
                  import_id as "importId",
                  row_number as "rowNumber",
                  staging_status as "stagingStatus",
                  result_code as "resultCode",
                  result_message as "resultMessage",
                  confirmable,
                  patient_document as "patientDocument",
                  authorization_number as "authorizationNumber",
                  commercial_code as "commercialCode",
                  dispensing_point_code as "dispensingPointCode",
                  quantity,
                  authorization_item_id as "authorizationItemId",
                  planning_period_id as "planningPeriodId",
                  dispensing_point_id as "dispensingPointId",
                  to_char(scheduled_date, 'YYYY-MM-DD') as "scheduledDate",
                  schedule_timing as "scheduleTiming",
                  late_handling as "lateHandling",
                  deferred_planning_period_id as "deferredPlanningPeriodId"
      `);
      const row = claimed.rows[0];
      if (!row) return { outcome: 'skipped' as const };
      await lockActivePointGrants(tx, input.actor, [row.dispensingPointId as string]);

      // Revalidación in-tx: lock de la autorización y nueva evaluación clínica
      // antes de escribir schedule/history/audit.
      const item = await lockAuthorizableItem(tx, row.authorizationItemId as string);
      if (!item) {
        return {
          outcome: 'conflict' as const,
          message: 'The authorization item was removed after staging',
        };
      }
      if (item.codigo_medicamento !== row.commercialCode) {
        return {
          outcome: 'conflict' as const,
          message: 'The authorization item changed after staging',
        };
      }
      const eligibility = eligibilityOf(item);
      if (!eligibility.eligible) {
        return {
          outcome: 'conflict' as const,
          message: eligibility.message ?? 'The authorization is no longer schedulable',
        };
      }

      const values: PatientScheduleWriteValues = {
        authorizationItemId: item.id,
        commercialCode: item.codigo_medicamento,
        planningPeriodId: row.planningPeriodId as string,
        dispensingPointId: row.dispensingPointId as string,
        scheduledDate: row.scheduledDate as string,
        quantity: row.quantity as number,
        status: 'SCHEDULED',
        scheduleTiming: row.scheduleTiming as ScheduleTiming,
        lateHandling: row.lateHandling,
        deferredPlanningPeriodId: row.deferredPlanningPeriodId,
      };
      let schedule: PatientScheduleResponse;
      try {
        schedule = await persistNewSchedule(tx, values, input.actor);
      } catch (error) {
        // Otro lote independiente confirmó la misma identidad concurrently.
        if (isScheduleDuplicateError(error)) {
          return {
            outcome: 'conflict' as const,
            code: 'DUPLICATE_EXISTING_SCHEDULE',
            message: 'An active schedule already exists for the same authorization, point and date',
          };
        }
        throw error;
      }
      await tx.execute(sql`
        update patient_schedule_import_rows
        set patient_schedule_id = ${schedule.id}, confirmed_at = now()
        where id = ${row.id}
      `);
      return { outcome: 'confirmed' as const, scheduleId: schedule.id };
    });
  }

  async markImportRowConflict(
    rowId: string,
    message: string,
    resultCode = 'CONFIRMATION_CONFLICT',
  ): Promise<void> {
    await this.database.db.execute(sql`
      update patient_schedule_import_rows
      set staging_status = 'CONFLICT',
          result_code = ${resultCode},
          result_message = ${message},
          confirmable = false
      where id = ${rowId}
    `);
  }

  async finalizeImport(input: {
    importId: string;
    actor: PatientScheduleActor;
  }): Promise<PatientScheduleImportBatchRecord | null> {
    return this.database.db.transaction(async (tx) => {
      const result = await tx.execute<ImportBatchRow>(sql`
        update patient_schedule_imports
        set status = 'COMPLETED',
            confirmed_rows = (
              select count(*)::int from patient_schedule_import_rows
              where import_id = ${input.importId} and patient_schedule_id is not null
            ),
            confirmed_at = now(),
            completed_at = now()
        where id = ${input.importId}
        returning ${IMPORT_BATCH_COLUMNS}
      `);
      const batch = result.rows[0];
      if (!batch) return null;
      await insertImportAuditEvent(tx, {
        actor: input.actor,
        action: 'PATIENT_SCHEDULE_IMPORT_CONFIRMED',
        importId: batch.id,
        metadata: { confirmedRows: batch.confirmed_rows },
      });
      return toImportBatch(batch);
    });
  }
}

type AuthorizableItemRow = {
  id: string;
  codigo_medicamento: string;
  enablement_status: string;
  coverage_type: string;
  direction_status: string;
  expiration_raw: string | null;
};

/**
 * Único punto que conoce el campo fuente de vencimiento dentro del read model
 * clínico (`SCHEDULING_EXPIRATION_COLUMN`); el dominio nunca lo ve.
 */
function eligibilityOf(item: AuthorizableItemRow) {
  return evaluateScheduleAuthorizationEligibility({
    enablementStatus: item.enablement_status,
    coverageType: item.coverage_type,
    directionStatus: item.direction_status,
    expirationDate: parseAuthorizationExpiration(item.expiration_raw),
    todayBogota: scheduleToday(),
  });
}

/**
 * Lock pesimistas sobre la autorización/producto: `FOR UPDATE` serializa la
 * creación/edición frente a cualquier transacción que mute la fila clínica y
 * garantiza que la revalidación lea el estado comprometido más reciente.
 */
async function lockAuthorizableItem(
  tx: Transaction,
  authorizationItemId: string,
): Promise<AuthorizableItemRow | null> {
  const result = await tx.execute<AuthorizableItemRow>(sql`
    select ai.id,
           ai.codigo_medicamento,
           ai.enablement_status,
           ai.coverage_type,
           ai.direction_status,
           ${sql.raw(SCHEDULING_EXPIRATION_COLUMN)} as expiration_raw
    from authorization_items ai
    where ai.id = ${authorizationItemId}
    for update
  `);
  return result.rows[0] ?? null;
}

async function lockPeriodForDate(
  tx: Transaction,
  scheduledDate: string,
): Promise<PlanningPeriodContext | null> {
  const result = await tx.execute<{
    id: string;
    start_date: string;
    end_date: string;
    scheduling_cutoff_at: string;
  }>(sql`
    select id,
           to_char(start_date, 'YYYY-MM-DD') as start_date,
           to_char(end_date, 'YYYY-MM-DD') as end_date,
           to_char(scheduling_cutoff_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as scheduling_cutoff_at
    from planning_periods
    where start_date <= ${scheduledDate} and end_date >= ${scheduledDate}
    order by start_date
    limit 1
    for update
  `);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    schedulingCutoffAt: row.scheduling_cutoff_at,
  };
}

function resolveHandling(
  timing: ScheduleTiming,
  requested: LateHandling | null | undefined,
):
  | { ok: true; value: LateHandling | null; timing: ScheduleTiming }
  | { ok: false; reason: 'required' | 'not_allowed'; timing: ScheduleTiming } {
  const present = requested !== null && requested !== undefined;
  if (timing === 'LATE' && !present) {
    return { ok: false, reason: 'required', timing };
  }
  if (timing === 'ON_TIME' && present) {
    return { ok: false, reason: 'not_allowed', timing };
  }
  return { ok: true, value: timing === 'LATE' && present ? requested : null, timing };
}

async function resolveDeferredPeriod(
  tx: Transaction,
  period: PlanningPeriodContext,
  lateHandling: LateHandling | null,
): Promise<string | null> {
  if (lateHandling !== 'NEXT_PERIOD') return null;
  const next = await findNextPeriodWithinTransaction(tx, period.endDate);
  return next?.id ?? null;
}

async function findNextPeriodWithinTransaction(
  tx: Transaction,
  periodEndDate: string,
): Promise<PlanningPeriodContext | null> {
  const result = await tx.execute<{
    id: string;
    start_date: string;
    end_date: string;
    scheduling_cutoff_at: string;
  }>(sql`
    select id,
           to_char(start_date, 'YYYY-MM-DD') as start_date,
           to_char(end_date, 'YYYY-MM-DD') as end_date,
           to_char(scheduling_cutoff_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as scheduling_cutoff_at
    from planning_periods
    where start_date > ${periodEndDate}
    order by start_date
    limit 1
  `);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    schedulingCutoffAt: row.scheduling_cutoff_at,
  };
}

/**
 * Unique-identity violations abort the PostgreSQL transaction. A savepoint
 * keeps a caller-supplied outer transaction (bulk row execution) usable so
 * the duplicate can surface as a domain outcome instead of 25P02.
 */
async function persistNewScheduleIsolated(
  tx: Transaction,
  values: PatientScheduleWriteValues,
  actor: PatientScheduleActor,
): Promise<PatientSchedulePersistenceOutcome> {
  await tx.execute(sql`savepoint esp003_persist_schedule`);
  try {
    const schedule = await persistNewSchedule(tx, values, actor);
    await tx.execute(sql`release savepoint esp003_persist_schedule`);
    return { outcome: 'created' as const, schedule };
  } catch (error) {
    try {
      await tx.execute(sql`rollback to savepoint esp003_persist_schedule`);
    } catch {
      // 25P02: the driver already aborted past the savepoint; propagate original.
    }
    if (isScheduleDuplicateError(error)) return { outcome: 'duplicate_schedule' as const };
    throw error;
  }
}

async function persistNewSchedule(
  tx: Transaction,
  values: PatientScheduleWriteValues,
  actor: PatientScheduleActor,
): Promise<PatientScheduleResponse> {
  const inserted = await tx.execute<{ id: string }>(sql`
    insert into patient_schedules
      (authorization_item_id, planning_period_id, dispensing_point_id, commercial_code,
       scheduled_date, quantity, status, schedule_timing, late_handling,
       deferred_planning_period_id, revision, created_by, updated_by)
    values (
      ${values.authorizationItemId},
      ${values.planningPeriodId},
      ${values.dispensingPointId},
      ${values.commercialCode},
      ${values.scheduledDate},
      ${values.quantity},
      ${values.status},
      ${values.scheduleTiming},
      ${values.lateHandling},
      ${values.deferredPlanningPeriodId},
      1,
      ${actor.userId},
      ${actor.userId}
    )
    returning id
  `);
  const scheduleId = inserted.rows[0]?.id;
  if (!scheduleId) throw new Error('Patient schedule insert returned no row');
  await insertHistory(tx, { scheduleId, revision: 1, values, changeType: 'CREATED', actor });
  await insertAuditEvent(tx, {
    actor,
    action: 'PATIENT_SCHEDULE_CREATED',
    scheduleId,
    before: null,
    after: { ...values, revision: 1 },
  });
  const schedule = await selectJoined(tx, scheduleId);
  if (!schedule) throw new Error('Patient schedule was not readable after insert');
  return schedule;
}

async function persistMutation(
  tx: Transaction,
  scheduleId: string,
  current: PatientScheduleCurrentRow,
  values: PatientScheduleWriteValues,
  input: {
    changeType: PatientScheduleChangeType;
    actor: PatientScheduleActor;
  },
): Promise<PatientScheduleResponse> {
  const nextRevision = current.revision + 1;
  const updated = await tx.execute<{ id: string }>(sql`
    update patient_schedules
    set planning_period_id = ${values.planningPeriodId},
        dispensing_point_id = ${values.dispensingPointId},
        scheduled_date = ${values.scheduledDate},
        quantity = ${values.quantity},
        status = ${values.status},
        schedule_timing = ${values.scheduleTiming},
        late_handling = ${values.lateHandling},
        deferred_planning_period_id = ${values.deferredPlanningPeriodId},
        revision = ${nextRevision},
        updated_at = now(),
        updated_by = ${input.actor.userId}
    where id = ${scheduleId}
    returning id
  `);
  if (!updated.rows[0]) throw new Error('Patient schedule update returned no row');
  await insertHistory(tx, {
    scheduleId,
    revision: nextRevision,
    values,
    changeType: input.changeType,
    actor: input.actor,
  });
  await insertAuditEvent(tx, {
    actor: input.actor,
    action: auditActionFor(input.changeType),
    scheduleId,
    before: toSnapshot(current),
    after: { ...values, revision: nextRevision },
  });
  const schedule = await selectJoined(tx, scheduleId);
  if (!schedule) throw new Error('Patient schedule was not readable after update');
  return schedule;
}

/**
 * Detección de la violación de la identidad canónica de programación
 * (`patient_schedules_active_identity_idx`, migración 0034). Recorre la
 * cadena de causas porque Drizzle envuelve los errores del driver.
 */
export function isScheduleDuplicateError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current === 'string') {
      return current.includes('patient_schedules_active_identity_idx');
    }
    if (typeof current !== 'object' || current === null) return false;
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
      message?: unknown;
    };
    const constraint = candidate.constraint;
    const message = typeof candidate.message === 'string' ? candidate.message : '';
    if (
      candidate.code === '23505' &&
      (constraint === 'patient_schedules_active_identity_idx' ||
        (typeof constraint === 'string' &&
          constraint.includes('patient_schedules_active_identity')) ||
        message.includes('patient_schedules_active_identity_idx'))
    ) {
      return true;
    }
    current = candidate.cause ?? (message || undefined);
  }
  return false;
}

async function lockCurrent(tx: Transaction, id: string): Promise<PatientScheduleCurrentRow | null> {
  const result = await tx.execute<PatientScheduleCurrentRow>(sql`
    select id, authorization_item_id, planning_period_id, dispensing_point_id, commercial_code,
           to_char(scheduled_date, 'YYYY-MM-DD') as scheduled_date, quantity, status,
           schedule_timing, late_handling, deferred_planning_period_id, revision
    from patient_schedules
    where id = ${id}
    for update
  `);
  return result.rows[0] ?? null;
}

async function selectJoined(tx: Transaction, id: string): Promise<PatientScheduleResponse | null> {
  const result = await tx.execute<PatientScheduleJoinedRow>(sql`
    select ${SCHEDULE_COLUMNS}
    from patient_schedules ps
    join authorization_items ai on ai.id = ps.authorization_item_id
    join planning_periods pp on pp.id = ps.planning_period_id
    join dispensing_points dp on dp.id = ps.dispensing_point_id
    where ps.id = ${id}
  `);
  const row = result.rows[0];
  return row ? toPatientScheduleResponse(row) : null;
}

function isSameState(
  current: PatientScheduleCurrentRow,
  next: PatientScheduleWriteValues,
): boolean {
  return (
    current.planning_period_id === next.planningPeriodId &&
    current.dispensing_point_id === next.dispensingPointId &&
    current.scheduled_date === next.scheduledDate &&
    current.quantity === next.quantity &&
    current.status === next.status &&
    current.schedule_timing === next.scheduleTiming &&
    current.late_handling === next.lateHandling &&
    current.deferred_planning_period_id === next.deferredPlanningPeriodId
  );
}

function toSnapshot(current: PatientScheduleCurrentRow) {
  return {
    authorizationItemId: current.authorization_item_id,
    planningPeriodId: current.planning_period_id,
    dispensingPointId: current.dispensing_point_id,
    commercialCode: current.commercial_code,
    scheduledDate: current.scheduled_date,
    quantity: current.quantity,
    status: current.status,
    scheduleTiming: current.schedule_timing,
    lateHandling: current.late_handling,
    deferredPlanningPeriodId: current.deferred_planning_period_id,
    revision: current.revision,
  };
}

function auditActionFor(changeType: PatientScheduleChangeType): string {
  switch (changeType) {
    case 'RESCHEDULED':
      return 'PATIENT_SCHEDULE_RESCHEDULED';
    case 'CANCELLED':
      return 'PATIENT_SCHEDULE_CANCELLED';
    default:
      return 'PATIENT_SCHEDULE_UPDATED';
  }
}

async function insertHistory(
  tx: Transaction,
  input: {
    scheduleId: string;
    revision: number;
    values: PatientScheduleWriteValues;
    changeType: PatientScheduleChangeType;
    actor: PatientScheduleActor;
  },
): Promise<void> {
  await tx.execute(sql`
    insert into patient_schedule_history
      (patient_schedule_id, revision, authorization_item_id, planning_period_id,
       dispensing_point_id, commercial_code, scheduled_date, quantity, status,
       schedule_timing, late_handling, deferred_planning_period_id,
       change_type, changed_by, correlation_id)
    values (
      ${input.scheduleId},
      ${input.revision},
      ${input.values.authorizationItemId},
      ${input.values.planningPeriodId},
      ${input.values.dispensingPointId},
      ${input.values.commercialCode},
      ${input.values.scheduledDate},
      ${input.values.quantity},
      ${input.values.status},
      ${input.values.scheduleTiming},
      ${input.values.lateHandling},
      ${input.values.deferredPlanningPeriodId},
      ${input.changeType},
      ${input.actor.userId},
      ${input.actor.correlationId}
    )
  `);
}

async function insertAuditEvent(
  tx: Transaction,
  input: {
    actor: PatientScheduleActor;
    action: string;
    scheduleId: string;
    before: unknown;
    after: unknown;
  },
): Promise<void> {
  await tx.execute(sql`
    insert into audit_events
      (actor_type, actor_id, organization_id, action, resource_type, resource_id,
       before, after, correlation_id, request_id, result)
    values (
      'USER',
      ${input.actor.userId},
      ${input.actor.organizationId},
      ${input.action},
      'patient_schedule',
      ${input.scheduleId},
      ${JSON.stringify(input.before)}::jsonb,
      ${JSON.stringify(input.after)}::jsonb,
      ${input.actor.correlationId},
      ${input.actor.correlationId},
      'SUCCESS'
    )
  `);
}

async function insertImportAuditEvent(
  tx: Transaction,
  input: {
    actor: PatientScheduleActor;
    action: string;
    importId: string;
    metadata: unknown;
  },
): Promise<void> {
  await tx.execute(sql`
    insert into audit_events
      (actor_type, actor_id, organization_id, action, resource_type, resource_id,
       before, after, correlation_id, request_id, result)
    values (
      'USER',
      ${input.actor.userId},
      ${input.actor.organizationId},
      ${input.action},
      'patient_schedule_import',
      ${input.importId},
      null,
      ${JSON.stringify(input.metadata)}::jsonb,
      ${input.actor.correlationId},
      ${input.actor.correlationId},
      'SUCCESS'
    )
  `);
}

const SCHEDULE_COLUMNS = sql`
  ps.id,
  ps.authorization_item_id,
  ai.numero_autorizacion as authorization_number,
  ps.planning_period_id,
  to_char(pp.start_date, 'YYYY-MM-DD') as planning_period_start_date,
  to_char(pp.end_date, 'YYYY-MM-DD') as planning_period_end_date,
  to_char(pp.scheduling_cutoff_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as scheduling_cutoff_at,
  ps.dispensing_point_id,
  dp.code as dispensing_point_code,
  dp.name as dispensing_point_name,
  ps.commercial_code,
  coalesce(ai.source_data->>'IDENTIFICACION_PACIENTE', ai.source_data->>'NUM_DOCUMENTO') as patient_document,
  ai.source_data->>'NOMBRE_PACIENTE' as patient_name,
  to_char(ps.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
  ps.quantity,
  ps.status,
  ps.schedule_timing,
  ps.late_handling,
  ps.deferred_planning_period_id,
  ps.revision,
  ${sql.raw(SCHEDULING_EXPIRATION_COLUMN)} as authorization_expires_on,
  ps.created_by,
  ps.updated_by,
  to_char(ps.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
  to_char(ps.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
`;

const IMPORT_BATCH_COLUMNS = sql`
  id, status, organization_id, original_filename, mime_type, size_bytes, sha256,
  total_rows, valid_rows, invalid_rows, duplicate_rows, conflict_rows, confirmed_rows,
  last_error_code,
  to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
  to_char(completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as completed_at,
  to_char(confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as confirmed_at
`;

export function toPatientScheduleResponse(row: PatientScheduleJoinedRow): PatientScheduleResponse {
  const expirationDate = parseAuthorizationExpiration(row.authorization_expires_on);
  const { daysUntilExpiration, priorityLevel } = calculateAuthorizationPriority(
    expirationDate,
    scheduleToday(),
  );
  return {
    id: row.id,
    authorizationItemId: row.authorization_item_id,
    authorizationNumber: row.authorization_number,
    planningPeriodId: row.planning_period_id,
    planningPeriodStartDate: row.planning_period_start_date,
    planningPeriodEndDate: row.planning_period_end_date,
    schedulingCutoffAt: row.scheduling_cutoff_at,
    dispensingPointId: row.dispensing_point_id,
    dispensingPointCode: row.dispensing_point_code,
    dispensingPointName: row.dispensing_point_name,
    commercialCode: row.commercial_code,
    patientDocument: row.patient_document,
    patientName: row.patient_name,
    scheduledDate: row.scheduled_date,
    quantity: row.quantity,
    status: row.status,
    scheduleTiming: row.schedule_timing,
    lateHandling: row.late_handling,
    deferredPlanningPeriodId: row.deferred_planning_period_id,
    revision: row.revision,
    authorizationExpiresOn: expirationDate,
    daysUntilExpiration,
    priorityLevel,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toHistoryEntry(row: PatientScheduleHistoryRow): PatientScheduleHistoryEntry {
  return {
    patientScheduleId: row.patient_schedule_id,
    revision: row.revision,
    changeType: row.change_type,
    authorizationItemId: row.authorization_item_id,
    planningPeriodId: row.planning_period_id,
    dispensingPointId: row.dispensing_point_id,
    commercialCode: row.commercial_code,
    scheduledDate: row.scheduled_date,
    quantity: row.quantity,
    status: row.status,
    scheduleTiming: row.schedule_timing,
    lateHandling: row.late_handling,
    deferredPlanningPeriodId: row.deferred_planning_period_id,
    changedBy: row.changed_by,
    correlationId: row.correlation_id,
    changedAt: row.changed_at,
  };
}

function toImportBatch(row: ImportBatchRow): PatientScheduleImportBatchRecord {
  return {
    id: row.id,
    status: row.status,
    organizationId: row.organization_id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    totalRows: row.total_rows,
    validRows: row.valid_rows,
    invalidRows: row.invalid_rows,
    duplicateRows: row.duplicate_rows,
    conflictRows: row.conflict_rows,
    confirmedRows: row.confirmed_rows,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    confirmedAt: row.confirmed_at,
  };
}
