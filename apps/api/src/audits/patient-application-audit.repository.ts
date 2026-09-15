import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  ApplicationAuditListQuery,
  ApproveApplicationAuditRequest,
  RejectApplicationAuditRequest,
} from '@authorization/contracts';
import {
  calculateAuthorizationPriority,
  canTransitionPatientApplicationAudit,
  parseAuthorizationExpiration,
  scheduleToday,
} from '@authorization/domain';
import type { createDatabase } from '@authorization/database';
import type { Scope } from '../common/request-scope';
import { LegacyCompatibilityProjectionService } from '../legacy/legacy-compatibility-projection.service';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
type Conn = Tx | Database['db'];

type AuditRow = {
  id: string;
  patient_application_id: string;
  application_revision: number;
  authorization_item_id: string;
  status: 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
  started_at: string;
  started_by: string;
  decided_at: string | null;
  decided_by: string | null;
  rejection_code: string | null;
  observation: string | null;
  evidence_reference: string | null;
  version: number;
};

type ApplicationContext = {
  patient_application_id: string;
  patient_schedule_id: string;
  application_version: number;
  schedule_revision: number;
  authorization_item_id: string;
  authorization_number: string;
  patient_document: string | null;
  patient_name: string | null;
  commercial_code: string;
  dispensing_point_id: string;
  dispensing_point_code: string;
  dispensing_point_name: string;
  scheduled_date: string;
  application_date: string;
  scheduled_quantity: number;
  admission_status: 'NOT_READY' | 'READY';
  authorization_expires_on: string | null;
  audit_id: string | null;
  audit_application_revision: number | null;
  application_audit_status: AuditRow['status'] | null;
  started_at: string | null;
  started_by: string | null;
  started_by_name: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  rejection_code: string | null;
  observation: string | null;
  evidence_reference: string | null;
  audit_version: number | null;
};

@Injectable()
export class PatientApplicationAuditRepository {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly compatibility: LegacyCompatibilityProjectionService,
  ) {}

  async list(query: ApplicationAuditListQuery, scope: Scope) {
    const conditions = [
      sql`pa.status = 'CONFIRMED'`,
      sql`not exists (
        select 1 from patient_schedule_outcomes pso
        where pso.patient_schedule_id = pa.patient_schedule_id
          and pso.schedule_revision = pa.schedule_revision
      )`,
    ];
    if (query.status === 'READY_FOR_AUDIT') conditions.push(sql`paa.id is null`);
    if (query.status && query.status !== 'READY_FOR_AUDIT')
      conditions.push(sql`paa.status = ${query.status}`);
    if (query.applicationDateFrom)
      conditions.push(sql`pa.application_date >= ${query.applicationDateFrom}`);
    if (query.applicationDateTo)
      conditions.push(sql`pa.application_date <= ${query.applicationDateTo}`);
    if (query.patientDocument)
      conditions.push(
        sql`coalesce(ai.source_data->>'IDENTIFICACION_PACIENTE', ai.source_data->>'NUM_DOCUMENTO') = ${query.patientDocument}`,
      );
    if (query.authorization) conditions.push(sql`ai.numero_autorizacion = ${query.authorization}`);
    if (query.commercialCode) conditions.push(sql`pa.commercial_code = ${query.commercialCode}`);
    if (query.dispensingPointId)
      conditions.push(sql`pa.dispensing_point_id = ${query.dispensingPointId}`);
    if (query.auditorId) conditions.push(sql`paa.started_by = ${query.auditorId}`);
    if (scope.organizationCode !== 'MTD')
      conditions.push(sql`dp.organization_id = ${scope.organizationId}`);

    const rows = await this.database.db.execute<{ id: string }>(sql`
      select pa.id
      from patient_applications pa
      join patient_schedules ps on ps.id = pa.patient_schedule_id
      join authorization_items ai on ai.id = pa.authorization_item_id
      join dispensing_points dp on dp.id = pa.dispensing_point_id
      left join patient_application_audits paa on paa.patient_application_id = pa.id
      where ${sql.join(conditions, sql` and `)}
      order by pa.application_date desc, pa.id desc
      limit ${query.limit}
    `);
    const items = await Promise.all(
      rows.rows.map((row) => this.findByApplicationId(this.database.db, row.id, scope)),
    );
    return items.filter((item): item is NonNullable<typeof item> => {
      if (!item) return false;
      return !query.priorityLevel || item.priorityLevel === query.priorityLevel;
    });
  }

  async findByAuditId(id: string, scope: Scope) {
    const row = (
      await this.database.db.execute<{ patient_application_id: string }>(sql`
        select patient_application_id from patient_application_audits where id = ${id}
      `)
    ).rows[0];
    return this.findByApplicationId(this.database.db, row?.patient_application_id ?? id, scope);
  }

  async start(applicationId: string, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      const application = (
        await tx.execute<{
          id: string;
          version: number;
          status: string;
          authorization_item_id: string;
          schedule_revision: number;
        }>(sql`
          select id, version, status, authorization_item_id, schedule_revision
          from patient_applications where id = ${applicationId} for update
        `)
      ).rows[0];
      if (!application) return { outcome: 'not_found' as const };
      if (application.status !== 'CONFIRMED')
        throw new Error('PATIENT_APPLICATION_AUDIT_NOT_ELIGIBLE');
      const notApplied = (
        await tx.execute(sql`
          select 1 from patient_schedule_outcomes
          where patient_schedule_id = (
            select patient_schedule_id from patient_applications where id = ${applicationId}
          )
            and schedule_revision = ${application.schedule_revision}
        `)
      ).rows[0];
      if (notApplied) throw new Error('PATIENT_APPLICATION_AUDIT_NOT_ELIGIBLE');
      const existing = (
        await tx.execute<AuditRow>(sql`
          select * from patient_application_audits where patient_application_id = ${applicationId}
        `)
      ).rows[0];
      if (existing) return { outcome: 'already_exists' as const, auditId: existing.id };

      const created = (
        await tx.execute<{ id: string }>(sql`
          insert into patient_application_audits
            (patient_application_id, application_revision, authorization_item_id, status, started_by)
          values (
            ${application.id}, ${application.version}, ${application.authorization_item_id},
            'IN_REVIEW', ${scope.userId}
          )
          on conflict (patient_application_id) do nothing
          returning id
        `)
      ).rows[0];
      if (!created) {
        const raced = (
          await tx.execute<AuditRow>(sql`
            select * from patient_application_audits
            where patient_application_id = ${applicationId}
          `)
        ).rows[0];
        return { outcome: 'already_exists' as const, auditId: raced?.id };
      }
      await this.compatibility.projectAuditDecision(tx, {
        authorizationItemId: application.authorization_item_id,
        modernStatus: 'IN_REVIEW',
        actorUserId: scope.userId,
      });
      await this.audit(tx, scope, 'APPLICATION_AUDIT_STARTED', created.id, {
        auditId: created.id,
        applicationId,
        decision: 'IN_REVIEW',
      });
      return {
        outcome: 'started' as const,
        audit: await this.findByApplicationId(tx, applicationId, scope),
      };
    });
  }

  async approve(id: string, body: ApproveApplicationAuditRequest, scope: Scope) {
    return this.decide(id, 'APPROVED', body.expectedVersion, scope, {
      evidenceReference: body.evidenceReference,
    });
  }

  async reject(id: string, body: RejectApplicationAuditRequest, scope: Scope) {
    return this.decide(id, 'REJECTED', body.expectedVersion, scope, {
      rejectionCode: body.rejectionCode,
      observation: body.observation,
      evidenceReference: body.evidenceReference,
    });
  }

  private async decide(
    id: string,
    to: 'APPROVED' | 'REJECTED',
    expectedVersion: number,
    scope: Scope,
    fields: {
      rejectionCode?: string | undefined;
      observation?: string | undefined;
      evidenceReference?: string | undefined;
    },
  ) {
    return this.database.db.transaction(async (tx) => {
      const audit = (
        await tx.execute<AuditRow>(sql`
          select * from patient_application_audits where id = ${id} for update
        `)
      ).rows[0];
      if (!audit) return { outcome: 'not_found' as const };
      if (audit.version !== expectedVersion)
        return { outcome: 'version_conflict' as const, currentVersion: audit.version };
      if (!canTransitionPatientApplicationAudit(audit.status, to))
        throw new Error('PATIENT_APPLICATION_AUDIT_TERMINAL');

      const application = (
        await tx.execute<{
          id: string;
          status: string;
          version: number;
          authorization_item_id: string;
        }>(sql`
          select id, status, version, authorization_item_id
          from patient_applications where id = ${audit.patient_application_id} for update
        `)
      ).rows[0];
      if (!application || application.status !== 'CONFIRMED')
        throw new Error('PATIENT_APPLICATION_AUDIT_NOT_ELIGIBLE');
      if (
        application.authorization_item_id !== audit.authorization_item_id ||
        application.version !== audit.application_revision
      )
        throw new Error('PATIENT_APPLICATION_AUDIT_LINEAGE_CONFLICT');
      await this.assertLineage(tx, audit.patient_application_id);

      await tx.execute(
        sql`select id from authorization_items where id = ${audit.authorization_item_id} for update`,
      );
      const updated = (
        await tx.execute<AuditRow>(sql`
          update patient_application_audits
          set status = ${to},
              decided_at = now(),
              decided_by = ${scope.userId},
              rejection_code = ${fields.rejectionCode ?? null},
              observation = ${fields.observation ?? null},
              evidence_reference = ${fields.evidenceReference ?? null},
              version = version + 1,
              updated_at = now()
          where id = ${id} and status = 'IN_REVIEW' and version = ${expectedVersion}
          returning *
        `)
      ).rows[0];
      if (!updated) throw new Error('PATIENT_APPLICATION_AUDIT_CONCURRENT_DECISION');

      await this.compatibility.projectAuditDecision(tx, {
        authorizationItemId: audit.authorization_item_id,
        modernStatus: to,
        actorUserId: scope.userId,
      });
      await this.audit(tx, scope, `APPLICATION_AUDIT_${to}`, id, {
        auditId: id,
        applicationId: audit.patient_application_id,
        decision: to,
        ...(fields.rejectionCode ? { rejectionCode: fields.rejectionCode } : {}),
      });
      return {
        outcome: 'decided' as const,
        audit: await this.findByApplicationId(tx, audit.patient_application_id, scope),
      };
    });
  }

  private async assertLineage(tx: Tx, applicationId: string) {
    const counts = (
      await tx.execute<{ lines: string; movements: string }>(sql`
        select
          (select count(*) from patient_application_lines
            where patient_application_id = ${applicationId}) as lines,
          (select count(*) from inventory_movements m
            join patient_application_lines pal on pal.id = m.source_id
            where pal.patient_application_id = ${applicationId}
              and m.movement_type = 'APPLICATION'
              and m.source_type = 'APPLICATION_LINE') as movements
      `)
    ).rows[0];
    if (!counts || counts.lines === '0' || counts.lines !== counts.movements)
      throw new Error('PATIENT_APPLICATION_AUDIT_LINEAGE_CONFLICT');
  }

  private async findByApplicationId(conn: Conn, applicationId: string, scope: Scope) {
    const context = (
      await conn.execute<ApplicationContext>(sql`
        select pa.id patient_application_id, pa.patient_schedule_id, pa.version application_version,
          pa.schedule_revision, pa.authorization_item_id, ai.numero_autorizacion authorization_number,
          coalesce(ai.source_data->>'IDENTIFICACION_PACIENTE', ai.source_data->>'NUM_DOCUMENTO') patient_document,
          ai.source_data->>'NOMBRE_PACIENTE' patient_name, pa.commercial_code,
          pa.dispensing_point_id, dp.code dispensing_point_code, dp.name dispensing_point_name,
          ps.scheduled_date::text scheduled_date, pa.application_date::text application_date,
          ps.quantity scheduled_quantity, ai.admission_status,
          ai.source_data->>'FECHA_FINAL_VIGENCIA' authorization_expires_on,
          paa.id audit_id, paa.application_revision audit_application_revision, paa.status application_audit_status,
          to_char(paa.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as started_at,
          paa.started_by, starter.display_name started_by_name,
          to_char(paa.decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as decided_at,
          paa.decided_by, decider.display_name decided_by_name,
          paa.rejection_code, paa.observation, paa.evidence_reference, paa.version audit_version
        from patient_applications pa
        join patient_schedules ps on ps.id = pa.patient_schedule_id
        join authorization_items ai on ai.id = pa.authorization_item_id
        join dispensing_points dp on dp.id = pa.dispensing_point_id
        left join patient_application_audits paa on paa.patient_application_id = pa.id
        left join users starter on starter.id = paa.started_by
        left join users decider on decider.id = paa.decided_by
        where pa.id = ${applicationId}
          and pa.status = 'CONFIRMED'
          and ${scope.organizationCode === 'MTD' ? sql`true` : sql`dp.organization_id = ${scope.organizationId}`}
      `)
    ).rows[0];
    if (!context) return null;
    if (!context.audit_id) {
      const outcome = (
        await conn.execute(sql`
          select 1 from patient_schedule_outcomes
          where patient_schedule_id = ${context.patient_schedule_id}
            and schedule_revision = ${context.schedule_revision}
        `)
      ).rows[0];
      if (outcome) return null;
    }
    const lines = (
      await conn.execute<{
        id: string;
        inventory_lot_id: string;
        commercial_code: string;
        dispensing_point_id: string;
        lot_number: string;
        expiration_date: string;
        quantity: number;
      }>(sql`
        select id, inventory_lot_id, commercial_code, dispensing_point_id, lot_number,
          expiration_date::text, quantity
        from patient_application_lines where patient_application_id = ${applicationId}
        order by id
      `)
    ).rows;
    const movements = (
      await conn.execute<{
        id: string;
        inventory_lot_id: string;
        movement_type: 'APPLICATION';
        quantity_delta: number;
        source_type: 'APPLICATION_LINE';
        source_id: string;
        occurred_at: string;
      }>(sql`
        select m.id, m.inventory_lot_id, m.movement_type, m.quantity_delta, m.source_type,
          m.source_id,
          to_char(m.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as occurred_at
        from inventory_movements m
        join patient_application_lines pal on pal.id = m.source_id
        where pal.patient_application_id = ${applicationId}
          and m.movement_type = 'APPLICATION' and m.source_type = 'APPLICATION_LINE'
        order by m.occurred_at, m.id
      `)
    ).rows;
    const expiration = parseAuthorizationExpiration(context.authorization_expires_on);
    const priority = calculateAuthorizationPriority(expiration, scheduleToday());
    return {
      id: context.audit_id,
      status: context.application_audit_status ?? 'READY_FOR_AUDIT',
      patientApplicationId: context.patient_application_id,
      patientScheduleId: context.patient_schedule_id,
      scheduleRevision: context.schedule_revision,
      applicationRevision: context.audit_application_revision ?? context.application_version,
      applicationVersion: context.application_version,
      authorizationItemId: context.authorization_item_id,
      authorizationNumber: context.authorization_number,
      patientDocument: context.patient_document,
      patientName: context.patient_name,
      commercialCode: context.commercial_code,
      dispensingPointId: context.dispensing_point_id,
      dispensingPointCode: context.dispensing_point_code,
      dispensingPointName: context.dispensing_point_name,
      scheduledDate: context.scheduled_date,
      applicationDate: context.application_date,
      scheduledQuantity: context.scheduled_quantity,
      appliedQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
      operationalStatus: 'APPLIED' as const,
      admissionStatus: context.admission_status,
      authorizationExpiresOn: expiration,
      daysUntilExpiration: priority.daysUntilExpiration,
      priorityLevel: priority.priorityLevel,
      startedAt: context.started_at,
      startedBy: context.started_by,
      startedByName: context.started_by_name,
      decidedAt: context.decided_at,
      decidedBy: context.decided_by,
      decidedByName: context.decided_by_name,
      rejectionCode: context.rejection_code,
      observation: context.observation,
      evidenceReference: context.evidence_reference,
      version: context.audit_version,
      lines: lines.map((line) => ({
        id: line.id,
        inventoryLotId: line.inventory_lot_id,
        commercialCode: line.commercial_code,
        dispensingPointId: line.dispensing_point_id,
        lotNumber: line.lot_number,
        expirationDate: line.expiration_date,
        quantity: line.quantity,
      })),
      movements: movements.map((movement) => ({
        id: movement.id,
        inventoryLotId: movement.inventory_lot_id,
        movementType: movement.movement_type,
        quantityDelta: movement.quantity_delta,
        sourceType: movement.source_type,
        sourceId: movement.source_id,
        occurredAt: movement.occurred_at,
      })),
    };
  }

  private async audit(tx: Tx, scope: Scope, action: string, id: string, after: unknown) {
    await tx.execute(sql`
      insert into audit_events
        (actor_type, actor_id, organization_id, action, resource_type, resource_id,
         after, correlation_id, request_id, result)
      values ('USER', ${scope.userId}, ${scope.organizationId}, ${action},
        'patient_application_audit', ${id}, ${JSON.stringify(after)}::jsonb,
        ${scope.correlationId}, ${scope.correlationId}, 'SUCCESS')
    `);
  }
}
