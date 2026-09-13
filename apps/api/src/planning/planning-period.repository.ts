import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import type {
  CreatePlanningPeriodRequest,
  PlanningPeriodResponse,
  PlanningPeriodStatus,
} from '@authorization/contracts';
import {
  canTransitionPlanningPeriod,
  isPlanningPeriodStructurallyEditable,
  validatePlanningPeriodDates,
  type PlanningPeriodValidationIssue,
} from '@authorization/domain';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];

export type PlanningPeriodActor = Readonly<{
  userId: string;
  organizationId: string;
  correlationId: string;
}>;

export type PlanningPeriodChanges = Readonly<{
  startDate?: string;
  endDate?: string;
  schedulingCutoffAt?: string;
  purchaseOrderDeadlineAt?: string;
  expectedDeliveryDate?: string;
}>;

export type PlanningPeriodUpdateOutcome =
  | { outcome: 'updated'; period: PlanningPeriodResponse }
  | { outcome: 'not_found' }
  | { outcome: 'version_conflict'; current: PlanningPeriodResponse }
  | { outcome: 'frozen'; fields: readonly string[] }
  | { outcome: 'invalid_dates'; issues: readonly PlanningPeriodValidationIssue[] };

export type PlanningPeriodTransitionOutcome =
  | { outcome: 'transitioned'; period: PlanningPeriodResponse }
  | { outcome: 'not_found' }
  | { outcome: 'version_conflict'; current: PlanningPeriodResponse }
  | { outcome: 'invalid_transition'; from: PlanningPeriodStatus; to: PlanningPeriodStatus };

type PlanningPeriodRow = {
  id: string;
  start_date: string;
  end_date: string;
  scheduling_cutoff_at: string;
  purchase_order_deadline_at: string;
  expected_delivery_date: string;
  status: PlanningPeriodStatus;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

/**
 * Drizzle entrega los tipos crudos de PostgreSQL como texto en `execute`.
 * Los timestamptz se formatean como ISO UTC en la propia consulta para evitar
 * ambigüedad de zona horaria; las fechas calendario se emiten como YYYY-MM-DD.
 */
const PERIOD_COLUMNS = sql`
  id,
  to_char(start_date, 'YYYY-MM-DD') as start_date,
  to_char(end_date, 'YYYY-MM-DD') as end_date,
  to_char(scheduling_cutoff_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as scheduling_cutoff_at,
  to_char(purchase_order_deadline_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as purchase_order_deadline_at,
  to_char(expected_delivery_date, 'YYYY-MM-DD') as expected_delivery_date,
  status,
  version,
  created_by,
  updated_by,
  to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
  to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
`;

@Injectable()
export class PlanningPeriodRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async create(input: {
    values: CreatePlanningPeriodRequest;
    actor: PlanningPeriodActor;
  }): Promise<PlanningPeriodResponse> {
    return this.database.db.transaction(async (tx) => {
      const inserted = await tx.execute<PlanningPeriodRow>(sql`
        insert into planning_periods
          (start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
           expected_delivery_date, created_by, updated_by)
        values (
          ${input.values.startDate},
          ${input.values.endDate},
          ${input.values.schedulingCutoffAt},
          ${input.values.purchaseOrderDeadlineAt},
          ${input.values.expectedDeliveryDate},
          ${input.actor.userId},
          ${input.actor.userId}
        )
        returning ${PERIOD_COLUMNS}
      `);
      const row = inserted.rows[0];
      if (!row) throw new Error('Planning period insert returned no row');
      const period = toPlanningPeriod(row);
      await insertAuditEvent(tx, {
        actor: input.actor,
        action: 'PLANNING_PERIOD_CREATED',
        periodId: period.id,
        before: null,
        after: period,
      });
      return period;
    });
  }

  async list(input: {
    status?: PlanningPeriodStatus;
    limit: number;
  }): Promise<PlanningPeriodResponse[]> {
    const statusFilter = input.status === undefined ? sql`` : sql`where status = ${input.status}`;
    const result = await this.database.db.execute<PlanningPeriodRow>(sql`
      select ${PERIOD_COLUMNS}
      from planning_periods
      ${statusFilter}
      order by start_date desc, created_at desc
      limit ${input.limit}
    `);
    return result.rows.map(toPlanningPeriod);
  }

  async findById(id: string): Promise<PlanningPeriodResponse | null> {
    const result = await this.database.db.execute<PlanningPeriodRow>(sql`
      select ${PERIOD_COLUMNS}
      from planning_periods
      where id = ${id}
    `);
    const row = result.rows[0];
    return row ? toPlanningPeriod(row) : null;
  }

  async update(input: {
    id: string;
    expectedVersion: number;
    changes: PlanningPeriodChanges;
    actor: PlanningPeriodActor;
  }): Promise<PlanningPeriodUpdateOutcome> {
    return this.database.db.transaction(async (tx) => {
      const current = await lockById(tx, input.id);
      if (!current) return { outcome: 'not_found' };
      if (current.version !== input.expectedVersion) {
        return { outcome: 'version_conflict', current: toPlanningPeriod(current) };
      }

      const merged = {
        startDate: input.changes.startDate ?? current.start_date,
        endDate: input.changes.endDate ?? current.end_date,
        schedulingCutoffAt: input.changes.schedulingCutoffAt ?? current.scheduling_cutoff_at,
        purchaseOrderDeadlineAt:
          input.changes.purchaseOrderDeadlineAt ?? current.purchase_order_deadline_at,
        expectedDeliveryDate: input.changes.expectedDeliveryDate ?? current.expected_delivery_date,
      };
      const issues = validatePlanningPeriodDates(merged);
      if (issues.length > 0) return { outcome: 'invalid_dates', issues };

      const structural = structuralChanges(current, input.changes);
      if (structural.length > 0 && !isPlanningPeriodStructurallyEditable(current.status)) {
        return { outcome: 'frozen', fields: structural };
      }

      const assignments: SQL[] = [];
      if (input.changes.startDate !== undefined) {
        assignments.push(sql`start_date = ${input.changes.startDate}`);
      }
      if (input.changes.endDate !== undefined) {
        assignments.push(sql`end_date = ${input.changes.endDate}`);
      }
      if (input.changes.schedulingCutoffAt !== undefined) {
        assignments.push(sql`scheduling_cutoff_at = ${input.changes.schedulingCutoffAt}`);
      }
      if (input.changes.purchaseOrderDeadlineAt !== undefined) {
        assignments.push(
          sql`purchase_order_deadline_at = ${input.changes.purchaseOrderDeadlineAt}`,
        );
      }
      if (input.changes.expectedDeliveryDate !== undefined) {
        assignments.push(sql`expected_delivery_date = ${input.changes.expectedDeliveryDate}`);
      }
      if (assignments.length === 0) {
        return { outcome: 'updated', period: toPlanningPeriod(current) };
      }
      assignments.push(
        sql`version = version + 1`,
        sql`updated_at = now()`,
        sql`updated_by = ${input.actor.userId}`,
      );

      const updated = await tx.execute<PlanningPeriodRow>(sql`
        update planning_periods
        set ${sql.join(assignments, sql`, `)}
        where id = ${input.id}
        returning ${PERIOD_COLUMNS}
      `);
      const row = updated.rows[0];
      if (!row) throw new Error('Planning period update returned no row');
      const period = toPlanningPeriod(row);
      await insertAuditEvent(tx, {
        actor: input.actor,
        action: 'PLANNING_PERIOD_UPDATED',
        periodId: period.id,
        before: toPlanningPeriod(current),
        after: period,
      });
      return { outcome: 'updated', period };
    });
  }

  async transition(input: {
    id: string;
    to: PlanningPeriodStatus;
    expectedVersion: number;
    actor: PlanningPeriodActor;
  }): Promise<PlanningPeriodTransitionOutcome> {
    return this.database.db.transaction(async (tx) => {
      const current = await lockById(tx, input.id);
      if (!current) return { outcome: 'not_found' };
      if (current.version !== input.expectedVersion) {
        return { outcome: 'version_conflict', current: toPlanningPeriod(current) };
      }
      if (!canTransitionPlanningPeriod(current.status, input.to)) {
        return { outcome: 'invalid_transition', from: current.status, to: input.to };
      }

      const updated = await tx.execute<PlanningPeriodRow>(sql`
        update planning_periods
        set status = ${input.to},
            version = version + 1,
            updated_at = now(),
            updated_by = ${input.actor.userId}
        where id = ${input.id}
        returning ${PERIOD_COLUMNS}
      `);
      const row = updated.rows[0];
      if (!row) throw new Error('Planning period transition returned no row');
      const period = toPlanningPeriod(row);
      await insertAuditEvent(tx, {
        actor: input.actor,
        action: 'PLANNING_PERIOD_TRANSITIONED',
        periodId: period.id,
        before: toPlanningPeriod(current),
        after: period,
      });
      return { outcome: 'transitioned', period };
    });
  }
}

async function lockById(tx: Transaction, id: string): Promise<PlanningPeriodRow | null> {
  const result = await tx.execute<PlanningPeriodRow>(sql`
    select ${PERIOD_COLUMNS}
    from planning_periods
    where id = ${id}
    for update
  `);
  return result.rows[0] ?? null;
}

function structuralChanges(
  current: PlanningPeriodRow,
  changes: PlanningPeriodChanges,
): readonly string[] {
  const fields: string[] = [];
  if (changes.startDate !== undefined && changes.startDate !== current.start_date) {
    fields.push('startDate');
  }
  if (changes.endDate !== undefined && changes.endDate !== current.end_date) {
    fields.push('endDate');
  }
  return fields;
}

function toPlanningPeriod(row: PlanningPeriodRow): PlanningPeriodResponse {
  return {
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    schedulingCutoffAt: row.scheduling_cutoff_at,
    purchaseOrderDeadlineAt: row.purchase_order_deadline_at,
    expectedDeliveryDate: row.expected_delivery_date,
    status: row.status,
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function insertAuditEvent(
  tx: Transaction,
  input: {
    actor: PlanningPeriodActor;
    action: string;
    periodId: string;
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
      'planning_period',
      ${input.periodId},
      ${JSON.stringify(input.before)}::jsonb,
      ${JSON.stringify(input.after)}::jsonb,
      ${input.actor.correlationId},
      ${input.actor.correlationId},
      'SUCCESS'
    )
  `);
}
