import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import type {
  CreatePatientApplicationRequest,
  PatientApplicationListQuery,
  UpdatePatientApplicationRequest,
} from '@authorization/contracts';
import {
  parseAuthorizationExpiration,
  scheduleToday,
} from '@authorization/domain';
import type { Scope } from '../common/request-scope';
import { applyPointScope, lockActivePointGrants } from '../common/point-scope.sql';
import { DATABASE } from '../tokens';
import { evaluatePatientApplicationAuthorization } from './patient-application-authorization';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
type Conn = Tx | Database['db'];

type Schedule = {
  id: string;
  revision: number;
  authorization_item_id: string;
  commercial_code: string;
  dispensing_point_id: string;
  scheduled_date: string;
  quantity: number;
  status: string;
  authorization_number: string;
  patient_document: string | null;
  patient_name: string | null;
  authorization_assignment_on: string | null;
  authorization_expires_on: string | null;
  enablement_status: string;
  coverage_type: string;
  direction_status: string;
};

type Lot = {
  id: string;
  commercial_code: string;
  dispensing_point_id: string;
  dispensing_point_code: string;
  lot_number: string;
  expiration_date: string;
  physical_balance: number;
  usable_balance: number;
};
type ApplicationRow = {
  id: string;
  patient_schedule_id: string;
  schedule_revision: number;
  authorization_item_id: string;
  commercial_code: string;
  dispensing_point_id: string;
  scheduled_date: string;
  application_date: string;
  status: string;
  version: number;
  authorization_number: string;
  patient_document: string | null;
  patient_name: string | null;
  authorization_expires_on: string | null;
  dispensing_point_code: string;
  dispensing_point_name: string;
  scheduled_quantity: number;
  created_by: string;
  confirmed_by: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
};
type ApplicationLineRow = {
  id: string;
  inventory_lot_id: string;
  commercial_code: string;
  dispensing_point_id: string;
  dispensing_point_code: string;
  lot_number: string;
  expiration_date: string;
  quantity: number;
  fefo_override: boolean;
  fefo_override_reason: string | null;
};

@Injectable()
export class PatientApplicationRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async create(body: CreatePatientApplicationRequest, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      const schedule = await this.lockSchedule(tx, body.patientScheduleId);
      await lockActivePointGrants(tx, scope, [schedule.dispensing_point_id]);
      this.assertSchedule(schedule, body.scheduleRevision);
      this.assertAuthorization(schedule, body.applicationDate);
      const id = (
        await tx.execute<{ id: string }>(sql`insert into patient_applications
          (patient_schedule_id,schedule_revision,authorization_item_id,commercial_code,dispensing_point_id,scheduled_date,application_date,created_by)
          values (${schedule.id},${schedule.revision},${schedule.authorization_item_id},${schedule.commercial_code},${schedule.dispensing_point_id},${schedule.scheduled_date},${body.applicationDate},${scope.userId}) returning id`)
      ).rows[0]!.id;
      await this.replaceLines(tx, id, schedule, body.lines);
      await this.audit(tx, scope, 'PATIENT_APPLICATION_CREATED', id, {
        scheduleId: schedule.id,
        lineCount: body.lines.length,
      });
      return this.findOn(tx, id, scope);
    });
  }

  async update(id: string, body: UpdatePatientApplicationRequest, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      const application = await this.lockApplication(tx, id);
      if (!application) return { outcome: 'not_found' as const };
      await lockActivePointGrants(tx, scope, [application.dispensing_point_id]);
      if (application.status !== 'DRAFT') throw new Error('PATIENT_APPLICATION_FROZEN');
      if (application.version !== body.expectedVersion)
        return { outcome: 'version_conflict' as const, currentVersion: application.version };
      const applicationDate = body.applicationDate ?? application.application_date;
      {
        const schedule = await this.lockSchedule(tx, application.patient_schedule_id);
        this.assertSchedule(schedule, application.schedule_revision);
        this.assertAuthorization(schedule, applicationDate);
        if (body.lines !== undefined) {
          await this.replaceLines(tx, id, schedule, body.lines);
        }
      }
      await tx.execute(sql`update patient_applications set
        application_date=${applicationDate}, version=version+1, updated_at=now() where id=${id}`);
      await this.audit(tx, scope, 'PATIENT_APPLICATION_UPDATED', id, {
        lineCount: body.lines?.length,
      });
      return this.findOn(tx, id, scope);
    });
  }

  async confirm(id: string, expectedVersion: number, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      const application = await this.lockApplication(tx, id);
      if (!application) return { outcome: 'not_found' as const };
      await lockActivePointGrants(tx, scope, [application.dispensing_point_id]);
      if (application.status === 'CONFIRMED') return this.findOn(tx, id, scope);
      if (application.status === 'CANCELLED') throw new Error('PATIENT_APPLICATION_CANCELLED');
      if (application.version !== expectedVersion)
        return { outcome: 'version_conflict' as const, currentVersion: application.version };

      const schedule = await this.lockSchedule(tx, application.patient_schedule_id);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('patient-schedule-terminal:' || ${schedule.id}::text || ':' || ${schedule.revision}::text))`,
      );
      const outcome = (
        await tx.execute<{ id: string }>(sql`select id from patient_schedule_outcomes
          where patient_schedule_id=${schedule.id} and schedule_revision=${schedule.revision}`)
      ).rows[0];
      if (outcome) throw new Error('PATIENT_SCHEDULE_ALREADY_NOT_APPLIED');
      this.assertSchedule(schedule, application.schedule_revision, application.application_date);
      this.assertAuthorization(schedule, application.application_date);
      if (schedule.commercial_code !== application.commercial_code)
        throw new Error('PATIENT_APPLICATION_PRODUCT_MISMATCH');
      if (schedule.dispensing_point_id !== application.dispensing_point_id)
        throw new Error('PATIENT_APPLICATION_POINT_MISMATCH');
      if (schedule.scheduled_date !== application.application_date)
        throw new Error('PATIENT_APPLICATION_DATE_MISMATCH');

      const lines = (
        await tx.execute<{
          id: string;
          inventory_lot_id: string;
          quantity: number;
          commercial_code: string;
          dispensing_point_id: string;
          fefo_override: boolean;
          fefo_override_reason: string | null;
        }>(sql`select id,inventory_lot_id,quantity,commercial_code,dispensing_point_id,fefo_override,fefo_override_reason
          from patient_application_lines where patient_application_id=${id} order by inventory_lot_id,id for update`)
      ).rows;
      const total = lines.reduce((sum, line) => sum + line.quantity, 0);
      if (total !== schedule.quantity) throw new Error('PATIENT_APPLICATION_QUANTITY_MISMATCH');
      if (!lines.length) throw new Error('PATIENT_APPLICATION_LINES_REQUIRED');
      const lotIds = [...new Set(lines.map((line) => line.inventory_lot_id))].sort();
      const locked = (
        await tx.execute<Lot>(sql`select l.id,l.commercial_code,l.dispensing_point_id,dp.code dispensing_point_code,l.lot_number,l.expiration_date::text,
          0::int physical_balance,0::int usable_balance
          from inventory_lots l join dispensing_points dp on dp.id=l.dispensing_point_id
          where l.id in (${sql.join(
            lotIds.map((value) => sql`${value}`),
            sql`, `,
          )})
          order by l.id for update`)
      ).rows;
      if (locked.length !== lotIds.length) throw new Error('PATIENT_APPLICATION_LOT_NOT_FOUND');
      const lotMap = new Map(locked.map((lot) => [lot.id, lot]));
      const today = scheduleToday();
      for (const line of lines) {
        const lot = lotMap.get(line.inventory_lot_id)!;
        if (
          line.commercial_code !== application.commercial_code ||
          lot.commercial_code !== application.commercial_code
        )
          throw new Error('PATIENT_APPLICATION_PRODUCT_MISMATCH');
        if (
          line.dispensing_point_id !== application.dispensing_point_id ||
          lot.dispensing_point_id !== application.dispensing_point_id
        )
          throw new Error('PATIENT_APPLICATION_POINT_MISMATCH');
        if (lot.expiration_date < today) throw new Error('PATIENT_APPLICATION_EXPIRED_STOCK');
      }
      const balances = await this.balances(tx, lotIds);
      for (const line of lines) {
        const balance = balances.get(line.inventory_lot_id) ?? 0;
        if (line.quantity > balance) throw new Error('PATIENT_APPLICATION_INSUFFICIENT_BALANCE');
      }
      const recommendation = await this.recommendation(
        tx,
        application.commercial_code,
        application.dispensing_point_id,
        schedule.quantity,
      );
      const selected = new Map<string, number>();
      for (const line of lines)
        selected.set(
          line.inventory_lot_id,
          (selected.get(line.inventory_lot_id) ?? 0) + line.quantity,
        );
      const deviates =
        recommendation.some((lot) => (selected.get(lot.id) ?? 0) !== lot.recommendedQuantity) ||
        lines.some((line) => !recommendation.some((lot) => lot.id === line.inventory_lot_id));
      if (deviates) {
        const override = lines.find((line) => line.fefo_override);
        if (!override || !override.fefo_override_reason?.trim())
          throw new Error('PATIENT_APPLICATION_FEFO_OVERRIDE_REQUIRED');
      }
      await this.consumeInventoryAllocations(
        tx,
        application.authorization_item_id,
        application.commercial_code,
        application.dispensing_point_id,
        total,
      );

      for (const line of lines) {
        await tx.execute(sql`insert into inventory_movements
          (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by,metadata)
          values (${line.inventory_lot_id},'APPLICATION',${-line.quantity},'APPLICATION_LINE',${line.id},now(),${scope.userId},${JSON.stringify({ patientApplicationId: id })}::jsonb)
          on conflict (movement_type,source_type,source_id) do nothing`);
      }
      await tx.execute(
        sql`update patient_applications set status='CONFIRMED',confirmed_by=${scope.userId},confirmed_at=now(),version=version+1,updated_at=now() where id=${id}`,
      );
      await this.audit(tx, scope, 'PATIENT_APPLICATION_CONFIRMED', id, {
        lineCount: lines.length,
        quantity: total,
      });
      if (deviates)
        await this.audit(tx, scope, 'APPLICATION_FEFO_OVERRIDE', id, {
          reason: lines.find((line) => line.fefo_override)?.fefo_override_reason,
        });
      return this.findOn(tx, id, scope);
    });
  }

  async cancel(id: string, expectedVersion: number, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      const application = await this.lockApplication(tx, id);
      if (!application) return { outcome: 'not_found' as const };
      await lockActivePointGrants(tx, scope, [application.dispensing_point_id]);
      if (application.version !== expectedVersion)
        return { outcome: 'version_conflict' as const, currentVersion: application.version };
      if (application.status !== 'DRAFT') throw new Error('PATIENT_APPLICATION_CANCEL_NOT_ALLOWED');
      await tx.execute(
        sql`update patient_applications set status='CANCELLED',version=version+1,updated_at=now() where id=${id}`,
      );
      await this.audit(tx, scope, 'PATIENT_APPLICATION_CANCELLED', id, null);
      return this.findOn(tx, id, scope);
    });
  }

  list(query: PatientApplicationListQuery, scope: Scope) {
    const conditions = [sql`true`];
    if (query.status) conditions.push(sql`pa.status=${query.status}`);
    if (query.patientScheduleId)
      conditions.push(sql`pa.patient_schedule_id=${query.patientScheduleId}`);
    if (query.patientDocument)
      conditions.push(
        sql`coalesce(ai.source_data->>'IDENTIFICACION_PACIENTE', ai.source_data->>'NUM_DOCUMENTO', '') ilike ${`%${query.patientDocument}%`}`,
      );
    if (query.authorization)
      conditions.push(sql`ai.numero_autorizacion ilike ${`%${query.authorization}%`}`);
    if (query.commercialCode) conditions.push(sql`pa.commercial_code=${query.commercialCode}`);
    if (query.dispensingPointId)
      conditions.push(sql`pa.dispensing_point_id=${query.dispensingPointId}`);
    if (query.applicationDateFrom)
      conditions.push(sql`pa.application_date >= ${query.applicationDateFrom}::date`);
    if (query.applicationDateTo)
      conditions.push(sql`pa.application_date <= ${query.applicationDateTo}::date`);
    if (!['MTD', 'MEDICARTE'].includes(scope.organizationCode))
      conditions.push(sql`dp.organization_id=${scope.organizationId}`);
    conditions.push(applyPointScope(sql`pa.dispensing_point_id`, scope));
    return this.database.db
      .execute<{
        id: string;
      }>(
        sql`select pa.id from patient_applications pa join patient_schedules ps on ps.id=pa.patient_schedule_id join authorization_items ai on ai.id=pa.authorization_item_id join dispensing_points dp on dp.id=pa.dispensing_point_id where ${sql.join(conditions, sql` and `)} order by pa.created_at desc,pa.id desc limit ${query.limit}`,
      )
      .then((result) => Promise.all(result.rows.map((row) => this.find(row.id, scope))));
  }

  async find(id: string, scope: Scope) {
    return this.findOn(this.database.db, id, scope);
  }

  async existsIgnoringPoint(id: string, scope: Scope): Promise<boolean> {
    const org = ['MTD', 'MEDICARTE'].includes(scope.organizationCode)
      ? sql`true`
      : sql`dp.organization_id=${scope.organizationId}`;
    const result = await this.database.db.execute<{ id: string }>(
      sql`select pa.id from patient_applications pa join dispensing_points dp on dp.id=pa.dispensing_point_id where pa.id=${id} and ${org} limit 1`,
    );
    return Boolean(result.rows[0]);
  }

  async eligibleSchedules(scope: Scope) {
    const rows = await this.database.db
      .execute<Schedule>(sql`select ps.id,ps.revision,ps.authorization_item_id,ps.commercial_code,ps.dispensing_point_id,ps.scheduled_date::text,ps.quantity,ps.status,
      ai.numero_autorizacion authorization_number,coalesce(ai.source_data->>'IDENTIFICACION_PACIENTE',ai.source_data->>'NUM_DOCUMENTO') patient_document,ai.source_data->>'NOMBRE_PACIENTE' patient_name,
      ai.source_data->>'FECHA_ASIGNACION' authorization_assignment_on,ai.source_data->>'FECHA_FINAL_VIGENCIA' authorization_expires_on,ai.enablement_status,ai.coverage_type,ai.direction_status
      from patient_schedules ps join authorization_items ai on ai.id=ps.authorization_item_id join dispensing_points dp on dp.id=ps.dispensing_point_id
      where ps.status in ('SCHEDULED','RESCHEDULED') and not exists (select 1 from patient_applications pa where pa.patient_schedule_id=ps.id and pa.status in ('DRAFT','CONFIRMED'))
      and (${['MTD', 'MEDICARTE'].includes(scope.organizationCode)} or dp.organization_id=${scope.organizationId})
      and ${applyPointScope(sql`ps.dispensing_point_id`, scope)} order by ps.scheduled_date,ps.id limit 500`);
    const todayBogota = scheduleToday();

    return rows.rows
      .filter((row) => {
        const result = evaluatePatientApplicationAuthorization({
          enablementStatus: row.enablement_status,
          coverageType: row.coverage_type,
          directionStatus: row.direction_status,
          assignmentDate: row.authorization_assignment_on,
          expirationDate: row.authorization_expires_on,
          todayBogota,
        });

        return result.eligible;
      })
      .map((row) => ({
        id: row.id,
        revision: row.revision,
        authorizationItemId: row.authorization_item_id,
        authorizationNumber: row.authorization_number,
        patientDocument: row.patient_document,
        patientName: row.patient_name,
        commercialCode: row.commercial_code,
        dispensingPointId: row.dispensing_point_id,
        scheduledDate: row.scheduled_date,
        quantity: row.quantity,
      }));
  }

  private async lockApplication(tx: Tx, id: string) {
    return (
      await tx.execute<{
        id: string;
        patient_schedule_id: string;
        schedule_revision: number;
        authorization_item_id: string;
        commercial_code: string;
        dispensing_point_id: string;
        scheduled_date: string;
        application_date: string;
        status: string;
        version: number;
      }>(
        sql`select id,patient_schedule_id,schedule_revision,authorization_item_id,commercial_code,dispensing_point_id,scheduled_date::text,application_date::text,status,version from patient_applications where id=${id} for update`,
      )
    ).rows[0];
  }

  private async lockSchedule(tx: Tx, id: string): Promise<Schedule> {
    const row = (
      await tx.execute<Schedule>(sql`select ps.id,ps.revision,ps.authorization_item_id,ps.commercial_code,ps.dispensing_point_id,ps.scheduled_date::text,ps.quantity,ps.status,
      ai.numero_autorizacion authorization_number,coalesce(ai.source_data->>'IDENTIFICACION_PACIENTE',ai.source_data->>'NUM_DOCUMENTO') patient_document,ai.source_data->>'NOMBRE_PACIENTE' patient_name,ai.source_data->>'FECHA_ASIGNACION' authorization_assignment_on,ai.source_data->>'FECHA_FINAL_VIGENCIA' authorization_expires_on,ai.enablement_status,ai.coverage_type,ai.direction_status
      from patient_schedules ps join authorization_items ai on ai.id=ps.authorization_item_id where ps.id=${id} for update`)
    ).rows[0];
    if (!row) throw new Error('PATIENT_SCHEDULE_NOT_FOUND');
    await tx.execute(
      sql`select id from authorization_items where id=${row.authorization_item_id} for update`,
    );
    return row;
  }

  private assertSchedule(schedule: Schedule, revision: number, applicationDate?: string) {
    if (!['SCHEDULED', 'RESCHEDULED'].includes(schedule.status))
      throw new Error('PATIENT_APPLICATION_SCHEDULE_NOT_ELIGIBLE');
    if (schedule.revision !== revision)
      throw new Error('PATIENT_APPLICATION_SCHEDULE_REVISION_CONFLICT');
    if (applicationDate !== undefined && schedule.scheduled_date !== applicationDate)
      throw new Error('PATIENT_APPLICATION_DATE_MISMATCH');
  }

  private assertAuthorization(schedule: Schedule, applicationDate?: string) {
    const eligibility = evaluatePatientApplicationAuthorization({
      enablementStatus: schedule.enablement_status,
      coverageType: schedule.coverage_type,
      directionStatus: schedule.direction_status,
      assignmentDate: schedule.authorization_assignment_on,
      expirationDate: schedule.authorization_expires_on,
      todayBogota: scheduleToday(),
      applicationDate,
    });

    if (!eligibility.eligible) throw new Error(eligibility.code);
  }

  private async replaceLines(
    tx: Tx,
    applicationId: string,
    schedule: Schedule,
    lines: CreatePatientApplicationRequest['lines'],
  ) {
    const seen = new Set<string>();
    await tx.execute(
      sql`delete from patient_application_lines where patient_application_id=${applicationId}`,
    );
    for (const line of lines) {
      if (seen.has(line.inventoryLotId)) throw new Error('PATIENT_APPLICATION_DUPLICATE_LOT');
      seen.add(line.inventoryLotId);
      const lot = (
        await tx.execute<{
          commercial_code: string;
          dispensing_point_id: string;
          dispensing_point_code: string;
          lot_number: string;
          expiration_date: string;
        }>(
          sql`select l.commercial_code,l.dispensing_point_id,dp.code dispensing_point_code,l.lot_number,l.expiration_date::text from inventory_lots l join dispensing_points dp on dp.id=l.dispensing_point_id where l.id=${line.inventoryLotId}`,
        )
      ).rows[0];
      if (!lot) throw new Error('PATIENT_APPLICATION_LOT_NOT_FOUND');
      if (lot.commercial_code !== schedule.commercial_code)
        throw new Error('PATIENT_APPLICATION_PRODUCT_MISMATCH');
      if (lot.dispensing_point_id !== schedule.dispensing_point_id)
        throw new Error('PATIENT_APPLICATION_POINT_MISMATCH');
      await tx.execute(
        sql`insert into patient_application_lines (patient_application_id,inventory_lot_id,commercial_code,dispensing_point_id,lot_number,expiration_date,quantity,fefo_override,fefo_override_reason) values (${applicationId},${line.inventoryLotId},${lot.commercial_code},${lot.dispensing_point_id},${lot.lot_number},${lot.expiration_date},${line.quantity},${line.fefoOverride ?? false},${line.fefoOverrideReason ?? null})`,
      );
    }
  }

  private async balances(tx: Tx, lotIds: string[]) {
    const rows = await tx.execute<{ id: string; balance: number }>(
      sql`select l.id,coalesce(sum(m.quantity_delta),0)::int balance from inventory_lots l left join inventory_movements m on m.inventory_lot_id=l.id where l.id in (${sql.join(
        lotIds.map((value) => sql`${value}`),
        sql`, `,
      )}) group by l.id`,
    );
    return new Map(rows.rows.map((row) => [row.id, row.balance]));
  }

  private async recommendation(tx: Tx, commercialCode: string, pointId: string, quantity: number) {
    const rows = await tx.execute<Lot>(
      sql`select l.id,l.commercial_code,l.dispensing_point_id,dp.code dispensing_point_code,l.lot_number,l.expiration_date::text,coalesce(sum(m.quantity_delta),0)::int physical_balance from inventory_lots l join dispensing_points dp on dp.id=l.dispensing_point_id left join inventory_movements m on m.inventory_lot_id=l.id where l.commercial_code=${commercialCode} and l.dispensing_point_id=${pointId} and l.expiration_date >= timezone('America/Bogota',now())::date group by l.id,dp.id having coalesce(sum(m.quantity_delta),0)>0 order by l.expiration_date,l.lot_number,l.id`,
    );
    let remaining = quantity;
    return rows.rows
      .map((lot) => {
        const recommendedQuantity = Math.min(remaining, lot.physical_balance);
        remaining -= recommendedQuantity;
        return { ...lot, recommendedQuantity };
      })
      .filter((lot) => lot.recommendedQuantity > 0);
  }

  private async findOn(conn: Conn, id: string, scope: Scope) {
    const app = (
      await conn.execute<ApplicationRow>(
        sql`select pa.*,ps.quantity scheduled_quantity,ai.numero_autorizacion authorization_number,coalesce(ai.source_data->>'IDENTIFICACION_PACIENTE',ai.source_data->>'NUM_DOCUMENTO') patient_document,ai.source_data->>'NOMBRE_PACIENTE' patient_name,ai.source_data->>'FECHA_FINAL_VIGENCIA' authorization_expires_on,dp.code dispensing_point_code,dp.name dispensing_point_name from patient_applications pa join patient_schedules ps on ps.id=pa.patient_schedule_id join authorization_items ai on ai.id=pa.authorization_item_id join dispensing_points dp on dp.id=pa.dispensing_point_id where pa.id=${id} and ${['MTD', 'MEDICARTE'].includes(scope.organizationCode) ? sql`true` : sql`dp.organization_id=${scope.organizationId}`} and ${applyPointScope(sql`pa.dispensing_point_id`, scope)}`,
      )
    ).rows[0];
    if (!app) return null;
    const lines = (
      await conn.execute<ApplicationLineRow>(
        sql`select pal.id,pal.inventory_lot_id,pal.commercial_code,pal.dispensing_point_id,dp.code dispensing_point_code,pal.lot_number,pal.expiration_date::text,pal.quantity,pal.fefo_override,pal.fefo_override_reason from patient_application_lines pal join dispensing_points dp on dp.id=pal.dispensing_point_id where pal.patient_application_id=${id} order by pal.id`,
      )
    ).rows;
    const available = await conn.execute<Lot>(
      sql`select l.id,l.commercial_code,l.dispensing_point_id,dp.code dispensing_point_code,l.lot_number,l.expiration_date::text,coalesce(sum(m.quantity_delta),0)::int physical_balance,case when l.expiration_date < timezone('America/Bogota',now())::date then 0 else coalesce(sum(m.quantity_delta),0)::int end usable_balance from inventory_lots l join dispensing_points dp on dp.id=l.dispensing_point_id left join inventory_movements m on m.inventory_lot_id=l.id where l.commercial_code=${app.commercial_code} and l.dispensing_point_id=${app.dispensing_point_id} group by l.id,dp.id order by l.expiration_date,l.lot_number,l.id`,
    );
    let remaining = app.scheduled_quantity;
    const lots = available.rows.map((lot) => {
      const recommendedQuantity = Math.min(Math.max(lot.usable_balance, 0), remaining);
      remaining -= recommendedQuantity;
      return {
        id: lot.id,
        commercialCode: lot.commercial_code,
        dispensingPointId: lot.dispensing_point_id,
        dispensingPointCode: lot.dispensing_point_code,
        lotNumber: lot.lot_number,
        expirationDate: lot.expiration_date,
        physicalBalance: lot.physical_balance,
        usableBalance: lot.usable_balance,
        recommendedQuantity,
      };
    });
    return {
      id: app.id,
      patientScheduleId: app.patient_schedule_id,
      scheduleRevision: app.schedule_revision,
      authorizationItemId: app.authorization_item_id,
      authorizationNumber: app.authorization_number,
      patientDocument: app.patient_document,
      patientName: app.patient_name,
      commercialCode: app.commercial_code,
      dispensingPointId: app.dispensing_point_id,
      dispensingPointCode: app.dispensing_point_code,
      dispensingPointName: app.dispensing_point_name,
      scheduledDate: app.scheduled_date,
      applicationDate: app.application_date,
      authorizationExpiresOn: parseAuthorizationExpiration(app.authorization_expires_on),
      scheduledQuantity: app.scheduled_quantity,
      selectedQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
      status: app.status,
      version: app.version,
      createdBy: app.created_by,
      confirmedBy: app.confirmed_by,
      createdAt: app.created_at,
      updatedAt: app.updated_at,
      confirmedAt: app.confirmed_at,
      lines: lines.map((line) => ({
        id: line.id,
        inventoryLotId: line.inventory_lot_id,
        commercialCode: line.commercial_code,
        dispensingPointId: line.dispensing_point_id,
        dispensingPointCode: line.dispensing_point_code,
        lotNumber: line.lot_number,
        expirationDate: line.expiration_date,
        quantity: line.quantity,
        fefoOverride: line.fefo_override,
        fefoOverrideReason: line.fefo_override_reason,
      })),
      availableLots: lots,
    };
  }

  private async consumeInventoryAllocations(
    tx: Tx,
    authorizationItemId: string,
    commercialCode: string,
    dispensingPointId: string,
    quantity: number,
  ) {
    await tx.execute(sql`
      select
        pg_advisory_xact_lock(
          hashtextextended(
            ${`${commercialCode}:${dispensingPointId}`},
            0::bigint
          )
        )
    `);

    const allocations = await tx.execute<{
      id: string;
      allocated_quantity: number;
      consumed_quantity: number;
      released_quantity: number;
    }>(sql`
        select
          id,
          allocated_quantity,
          consumed_quantity,
          released_quantity

        from
          inventory_authorization_allocations

        where
          authorization_item_id =
            ${authorizationItemId}

          and commercial_code =
            ${commercialCode}

          and dispensing_point_id =
            ${dispensingPointId}

          and status in (
            'ALLOCATED',
            'PARTIALLY_CONSUMED'
          )

        order by
          created_at,
          id

        for update
      `);

    if (allocations.rows.length === 0) {
      // Compatibilidad transicional:
      // aplicaciones históricas sin asignación
      // siguen operando. Una vez existe
      // asignación para la AUTO, sí se exige
      // cobertura lógica suficiente.
      return;
    }

    const available = allocations.rows.reduce(
      (sum, allocation) =>
        sum +
        Math.max(
          allocation.allocated_quantity -
            allocation.consumed_quantity -
            allocation.released_quantity,
          0,
        ),
      0,
    );

    if (available < quantity) {
      throw new Error('PATIENT_APPLICATION_INVENTORY_ALLOCATION_INSUFFICIENT');
    }

    let remaining = quantity;

    for (const allocation of allocations.rows) {
      if (remaining <= 0) {
        break;
      }

      const outstanding = Math.max(
        allocation.allocated_quantity - allocation.consumed_quantity - allocation.released_quantity,
        0,
      );

      if (outstanding === 0) {
        continue;
      }

      const consumed = Math.min(outstanding, remaining);

      await tx.execute(sql`
        update
          inventory_authorization_allocations

        set
          consumed_quantity =
            consumed_quantity
            +
            ${consumed},

          status =
            case
              when
                consumed_quantity
                +
                ${consumed}
                +
                released_quantity
                >=
                allocated_quantity

              then 'CONSUMED'

              else
                'PARTIALLY_CONSUMED'
            end,

          updated_at =
            now()

        where
          id =
            ${allocation.id}
      `);

      remaining -= consumed;
    }
  }

  private async audit(tx: Tx, scope: Scope, action: string, id: string, after: unknown) {
    await tx.execute(
      sql`insert into audit_events (actor_type,actor_id,organization_id,action,resource_type,resource_id,after,correlation_id,request_id,result) values ('USER',${scope.userId},${scope.organizationId},${action},'patient_application',${id},${after ? JSON.stringify(after) : null}::jsonb,${scope.correlationId},${scope.correlationId},'SUCCESS')`,
    );
  }
}
