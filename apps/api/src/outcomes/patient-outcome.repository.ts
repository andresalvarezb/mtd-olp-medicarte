import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import type { MarkPatientNotAppliedRequest } from '@authorization/contracts';
import {
  calculateAuthorizationPriority,
  parseAuthorizationExpiration,
  scheduleToday,
} from '@authorization/domain';
import type { Scope } from '../common/request-scope';
import { applyPointScope, lockActivePointGrants } from '../common/point-scope.sql';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
type Outcome = {
  id: string;
  patient_schedule_id: string;
  schedule_revision: number;
  authorization_item_id: string;
  outcome: 'NOT_APPLIED';
  novelty_code: string;
  occurred_on: string;
  observation: string | null;
  prepared_product_disposition: string;
  created_by: string;
  created_at: string;
};

@Injectable()
export class PatientOutcomeRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async markNotApplied(scheduleId: string, body: MarkPatientNotAppliedRequest, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      const schedule = (
        await tx.execute<{
          id: string;
          revision: number;
          authorization_item_id: string;
          commercial_code: string;
          dispensing_point_id: string;
          quantity: number;
          status: string;
        }>(sql`select id,revision,authorization_item_id,commercial_code,dispensing_point_id,quantity,status
          from patient_schedules where id=${scheduleId} for update`)
      ).rows[0];
      if (!schedule) throw new Error('PATIENT_SCHEDULE_NOT_FOUND');
      await lockActivePointGrants(tx, scope, [schedule.dispensing_point_id]);
      if (schedule.revision !== body.expectedScheduleRevision)
        throw new Error('PATIENT_SCHEDULE_REVISION_CONFLICT');

      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('patient-schedule-terminal:' || ${schedule.id}::text || ':' || ${schedule.revision}::text))`,
      );
      const existing = (
        await tx.execute<Outcome>(sql`select * from patient_schedule_outcomes
          where patient_schedule_id=${schedule.id} and schedule_revision=${schedule.revision}`)
      ).rows[0];
      if (existing) return this.findOn(tx, existing.id, scope);
      const confirmed = (
        await tx.execute<{ id: string }>(sql`select id from patient_applications
          where patient_schedule_id=${schedule.id} and schedule_revision=${schedule.revision} and status='CONFIRMED'`)
      ).rows[0];
      if (confirmed) throw new Error('PATIENT_SCHEDULE_ALREADY_APPLIED');
      if (schedule.status === 'CANCELLED') throw new Error('PATIENT_SCHEDULE_CANCELLED');
      if (body.noveltyCode === 'OTHER' && !body.observation?.trim())
        throw new Error('PATIENT_OUTCOME_OBSERVATION_REQUIRED');

      const lines = body.nonReusableLines;
      if (body.preparedProductDisposition !== 'NON_REUSABLE' && lines.length)
        throw new Error('PATIENT_OUTCOME_LINES_NOT_ALLOWED');
      if (lines.reduce((sum, line) => sum + line.quantity, 0) > schedule.quantity)
        throw new Error('PATIENT_OUTCOME_QUANTITY_EXCEEDED');
      const lotIds = [...new Set(lines.map((line) => line.inventoryLotId))].sort();
      const lots = lotIds.length
        ? (
            await tx.execute<{
              id: string;
              commercial_code: string;
              dispensing_point_id: string;
              lot_number: string;
              expiration_date: string;
            }>(sql`select l.id,l.commercial_code,l.dispensing_point_id,l.lot_number,l.expiration_date::text
              from inventory_lots l where l.id in (${sql.join(
                lotIds.map((id) => sql`${id}`),
                sql`, `,
              )})
              order by l.id for update`)
          ).rows
        : [];
      if (lots.length !== lotIds.length) throw new Error('PATIENT_OUTCOME_LOT_NOT_FOUND');
      const lotMap = new Map(lots.map((lot) => [lot.id, lot]));
      for (const line of lines) {
        const lot = lotMap.get(line.inventoryLotId)!;
        if (lot.commercial_code !== schedule.commercial_code)
          throw new Error('PATIENT_OUTCOME_PRODUCT_MISMATCH');
        if (lot.dispensing_point_id !== schedule.dispensing_point_id)
          throw new Error('PATIENT_OUTCOME_POINT_MISMATCH');
        if (lot.expiration_date < new Date().toISOString().slice(0, 10))
          throw new Error('PATIENT_OUTCOME_EXPIRED_STOCK');
        const balance = (
          await tx.execute<{
            balance: number;
          }>(sql`select coalesce(sum(quantity_delta),0)::int balance
            from inventory_movements where inventory_lot_id=${lot.id}`)
        ).rows[0]!.balance;
        if (line.quantity > balance) throw new Error('PATIENT_OUTCOME_INSUFFICIENT_BALANCE');
      }

      const outcome = (
        await tx.execute<{ id: string }>(sql`insert into patient_schedule_outcomes
          (patient_schedule_id,schedule_revision,authorization_item_id,outcome,novelty_code,occurred_on,observation,prepared_product_disposition,created_by)
          values (${schedule.id},${schedule.revision},${schedule.authorization_item_id},'NOT_APPLIED',${body.noveltyCode},${body.occurredOn},${body.observation ?? null},${body.preparedProductDisposition},${scope.userId}) returning id`)
      ).rows[0]!;
      for (const line of lines) {
        const lot = lotMap.get(line.inventoryLotId)!;
        const outcomeLine = (
          await tx.execute<{ id: string }>(sql`insert into patient_schedule_outcome_lines
            (outcome_id,inventory_lot_id,commercial_code,dispensing_point_id,lot_number,expiration_date,quantity)
            values (${outcome.id},${lot.id},${lot.commercial_code},${lot.dispensing_point_id},${lot.lot_number},${lot.expiration_date},${line.quantity}) returning id`)
        ).rows[0]!;
        await tx.execute(sql`insert into inventory_movements
          (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by,metadata)
          values (${lot.id},'NON_REUSABLE',${-line.quantity},'OUTCOME_LINE',${outcomeLine.id},now(),${scope.userId},${JSON.stringify({ outcomeId: outcome.id })}::jsonb)`);
      }
      await this.audit(tx, scope, 'PATIENT_OUTCOME_NOT_APPLIED', outcome.id, {
        scheduleId: schedule.id,
        scheduleRevision: schedule.revision,
        noveltyCode: body.noveltyCode,
        disposition: body.preparedProductDisposition,
      });
      if (lines.length)
        await this.audit(tx, scope, 'PATIENT_OUTCOME_NON_REUSABLE_PRODUCT', outcome.id, {
          scheduleId: schedule.id,
          scheduleRevision: schedule.revision,
          quantities: lines.map((line) => line.quantity),
          lotIds,
        });
      return this.findOn(tx, outcome.id, scope);
    });
  }

  async find(id: string, scope: Scope) {
    return this.findOn(this.database.db, id, scope);
  }

  async existsIgnoringPoint(id: string, scope: Scope): Promise<boolean> {
    const org = ['MTD', 'MEDICARTE'].includes(scope.organizationCode)
      ? sql`true`
      : sql`dp.organization_id=${scope.organizationId}`;
    const result = await this.database.db.execute<{ id: string }>(
      sql`select o.id from patient_schedule_outcomes o join patient_schedules ps on ps.id=o.patient_schedule_id join dispensing_points dp on dp.id=ps.dispensing_point_id where o.id=${id} and ${org} limit 1`,
    );
    return Boolean(result.rows[0]);
  }

  async scheduleExistsIgnoringPoint(scheduleId: string, scope: Scope): Promise<boolean> {
    const org = ['MTD', 'MEDICARTE'].includes(scope.organizationCode)
      ? sql`true`
      : sql`dp.organization_id=${scope.organizationId}`;
    const result = await this.database.db.execute<{ id: string }>(
      sql`select ps.id from patient_schedules ps join dispensing_points dp on dp.id=ps.dispensing_point_id where ps.id=${scheduleId} and ${org} limit 1`,
    );
    return Boolean(result.rows[0]);
  }

  async list(scope: Scope) {
    const rows = await this.database.db.execute<{ id: string }>(sql`select pso.id
      from patient_schedule_outcomes pso join patient_schedules ps on ps.id=pso.patient_schedule_id
      join dispensing_points dp on dp.id=ps.dispensing_point_id
      where ${this.visibility(scope)}
      order by pso.occurred_on desc,pso.created_at desc limit 500`);
    return Promise.all(rows.rows.map((row) => this.find(row.id, scope)));
  }

  async operationalStatus(scheduleId: string, scope: Scope) {
    const row = (
      await this.database.db.execute<{
        patient_schedule_id: string;
        schedule_revision: number;
        authorization_item_id: string;
        authorization_number: string;
        patient_document: string | null;
        patient_name: string | null;
        commercial_code: string;
        dispensing_point_id: string;
        dispensing_point_code: string;
        scheduled_date: string;
        quantity: number;
        planning_status: string;
        authorization_expires_on: string | null;
        outcome_id: string | null;
        novelty_code: string | null;
        disposition: string | null;
        occurred_on: string | null;
        application_id: string | null;
      }>(sql`select ps.id patient_schedule_id,ps.revision schedule_revision,ps.authorization_item_id,ai.numero_autorizacion authorization_number,
        coalesce(ai.source_data->>'IDENTIFICACION_PACIENTE',ai.source_data->>'NUM_DOCUMENTO') patient_document,ai.source_data->>'NOMBRE_PACIENTE' patient_name,
        ps.commercial_code,ps.dispensing_point_id,dp.code dispensing_point_code,ps.scheduled_date::text,ps.quantity,ps.status planning_status,
        ai.source_data->>'FECHA_FINAL_VIGENCIA' authorization_expires_on,o.id outcome_id,o.novelty_code,o.prepared_product_disposition disposition,o.occurred_on::text,
        a.id application_id from patient_schedules ps join authorization_items ai on ai.id=ps.authorization_item_id
        join dispensing_points dp on dp.id=ps.dispensing_point_id left join patient_schedule_outcomes o on o.patient_schedule_id=ps.id and o.schedule_revision=ps.revision
        left join patient_applications a on a.patient_schedule_id=ps.id and a.schedule_revision=ps.revision and a.status='CONFIRMED'
        where ps.id=${scheduleId} and ${this.visibility(scope)}`)
    ).rows[0];
    if (!row) return null;
    const priority = calculateAuthorizationPriority(
      parseAuthorizationExpiration(row.authorization_expires_on),
      scheduleToday(),
    );
    return {
      patientScheduleId: row.patient_schedule_id,
      scheduleRevision: row.schedule_revision,
      authorizationItemId: row.authorization_item_id,
      authorizationNumber: row.authorization_number,
      patientDocument: row.patient_document,
      patientName: row.patient_name,
      commercialCode: row.commercial_code,
      dispensingPointId: row.dispensing_point_id,
      dispensingPointCode: row.dispensing_point_code,
      scheduledDate: row.scheduled_date,
      quantity: row.quantity,
      planningStatus: row.planning_status,
      operationalStatus: row.application_id
        ? 'APPLIED'
        : row.outcome_id
          ? 'NOT_APPLIED'
          : row.planning_status === 'CANCELLED'
            ? 'CANCELLED'
            : 'SCHEDULED',
      noveltyCode: row.novelty_code,
      disposition: row.disposition,
      occurredOn: row.occurred_on,
      authorizationExpiresOn: row.authorization_expires_on,
      daysUntilExpiration: priority.daysUntilExpiration,
      priorityLevel: priority.priorityLevel,
      outcomeId: row.outcome_id,
      applicationId: row.application_id,
    };
  }

  async operationalStatuses(scope: Scope) {
    const rows = await this.database.db.execute<{ id: string }>(
      sql`select ps.id from patient_schedules ps join dispensing_points dp on dp.id=ps.dispensing_point_id where ${this.visibility(scope)} order by ps.scheduled_date,ps.id limit 500`,
    );
    return Promise.all(rows.rows.map((row) => this.operationalStatus(row.id, scope)));
  }

  private async findOn(conn: Tx | Database['db'], id: string, scope: Scope) {
    const outcome = (
      await conn.execute<Outcome>(
        sql`select o.* from patient_schedule_outcomes o join patient_schedules ps on ps.id=o.patient_schedule_id join dispensing_points dp on dp.id=ps.dispensing_point_id where o.id=${id} and ${this.visibility(scope)}`,
      )
    ).rows[0];
    if (!outcome) return null;
    const lines = (
      await conn.execute(
        sql`select id,inventory_lot_id,commercial_code,dispensing_point_id,lot_number,expiration_date::text,quantity from patient_schedule_outcome_lines where outcome_id=${id} order by id`,
      )
    ).rows;
    return {
      id: outcome.id,
      patientScheduleId: outcome.patient_schedule_id,
      scheduleRevision: outcome.schedule_revision,
      authorizationItemId: outcome.authorization_item_id,
      outcome: outcome.outcome,
      noveltyCode: outcome.novelty_code,
      occurredOn: outcome.occurred_on,
      observation: outcome.observation,
      preparedProductDisposition: outcome.prepared_product_disposition,
      createdBy: outcome.created_by,
      createdAt: outcome.created_at,
      lines: lines.map((line) => ({
        id: line.id,
        inventoryLotId: line.inventory_lot_id,
        commercialCode: line.commercial_code,
        dispensingPointId: line.dispensing_point_id,
        lotNumber: line.lot_number,
        expirationDate: line.expiration_date,
        quantity: line.quantity,
      })),
    };
  }

  private visibility(scope: Scope) {
    const org = ['MTD', 'MEDICARTE'].includes(scope.organizationCode)
      ? sql`true`
      : sql`dp.organization_id=${scope.organizationId}`;
    return sql`${org} and ${applyPointScope(sql`ps.dispensing_point_id`, scope)}`;
  }

  private async audit(tx: Tx, scope: Scope, action: string, id: string, after: unknown) {
    await tx.execute(
      sql`insert into audit_events (actor_type,actor_id,organization_id,action,resource_type,resource_id,after,correlation_id,request_id,result) values ('USER',${scope.userId},${scope.organizationId},${action},'patient_schedule_outcome',${id},${JSON.stringify(after)}::jsonb,${scope.correlationId},${scope.correlationId},'SUCCESS')`,
    );
  }
}
