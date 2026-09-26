import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type {
  FulfillmentAuditListQuery,
} from '@authorization/contracts';

import type { createDatabase } from '@authorization/database';

import type { Scope } from '../common/request-scope';
import { LegacyCompatibilityProjectionService } from '../legacy/legacy-compatibility-projection.service';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
type Conn = Tx | Database['db'];

type AuditRow = {
  id: string;
  authorization_item_id: string;
  authorization_fulfillment_id: string;
  review_number: number;
  status: 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
  observations: string | null;
  started_by: string;
  decided_by: string | null;
};

type ContextRow = {
  fulfillment_id: string;
  fulfillment_type: 'APPLICATION' | 'DELIVERY';
  authorization_item_id: string;
  authorization_number: string;
  patient_document: string | null;
  patient_name: string | null;
  commercial_code: string;
  effective_date: string;
  quantity: number;
  source: string;
  confirmed_at: string;
  dispensing_point_code: string | null;
  dispensing_point_name: string | null;
  purchase_orders: string | null;
  audit_id: string | null;
  audit_status: AuditRow['status'] | null;
  observations: string | null;
  started_at: string | null;
  started_by: string | null;
  started_by_name: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
};

@Injectable()
export class AuthorizationFulfillmentAuditRepository {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly compatibility: LegacyCompatibilityProjectionService,
  ) {}

  async list(query: FulfillmentAuditListQuery, scope: Scope) {
    void scope;

    const conditions = [sql`true`];

    if (query.status === 'READY_FOR_AUDIT') {
      conditions.push(sql`ar.id is null`);
    } else if (query.status) {
      conditions.push(sql`ar.status = ${query.status}`);
    }

    if (query.effectiveDateFrom) {
      conditions.push(sql`af.effective_date >= ${query.effectiveDateFrom}`);
    }

    if (query.effectiveDateTo) {
      conditions.push(sql`af.effective_date <= ${query.effectiveDateTo}`);
    }

    if (query.patientDocument) {
      conditions.push(sql`
        coalesce(
          ai.source_data->>'IDENTIFICACION_PACIENTE',
          ai.source_data->>'NUM_DOCUMENTO'
        ) = ${query.patientDocument}
      `);
    }

    if (query.authorization) {
      conditions.push(sql`ai.numero_autorizacion = ${query.authorization}`);
    }

    if (query.commercialCode) {
      conditions.push(sql`ai.codigo_medicamento = ${query.commercialCode}`);
    }

    if (query.auditorId) {
      conditions.push(sql`ar.started_by = ${query.auditorId}`);
    }

    const rows = await this.database.db.execute<{ id: string }>(sql`
      select af.id
      from authorization_fulfillments af
      join authorization_items ai
        on ai.id = af.authorization_item_id
      left join audit_reviews ar
        on ar.authorization_fulfillment_id = af.id
      where ${sql.join(conditions, sql` and `)}
      order by af.effective_date desc, af.confirmed_at desc, af.id desc
      limit ${query.limit}
    `);

    const items = await Promise.all(
      rows.rows.map((row) => this.findByFulfillmentId(this.database.db, row.id)),
    );

    return items.filter((item): item is NonNullable<typeof item> => Boolean(item));
  }

  async findByAuditId(id: string) {
    const row = (
      await this.database.db.execute<{ authorization_fulfillment_id: string | null }>(sql`
        select authorization_fulfillment_id
        from audit_reviews
        where id = ${id}
      `)
    ).rows[0];

    if (!row?.authorization_fulfillment_id) {
      return null;
    }

    return this.findByFulfillmentId(
      this.database.db,
      row.authorization_fulfillment_id,
    );
  }

  async start(fulfillmentId: string, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      const fulfillment = (
        await tx.execute<{
          id: string;
          authorization_item_id: string;
        }>(sql`
          select id, authorization_item_id
          from authorization_fulfillments
          where id = ${fulfillmentId}
          for update
        `)
      ).rows[0];

      if (!fulfillment) {
        return { outcome: 'not_found' as const };
      }

      await tx.execute(sql`
        select id
        from authorization_items
        where id = ${fulfillment.authorization_item_id}
        for update
      `);

      const existing = (
        await tx.execute<AuditRow>(sql`
          select
            id,
            authorization_item_id,
            authorization_fulfillment_id,
            review_number,
            status,
            observations,
            started_by,
            decided_by
          from audit_reviews
          where authorization_fulfillment_id = ${fulfillmentId}
        `)
      ).rows[0];

      if (existing) {
        return {
          outcome: 'already_exists' as const,
          auditId: existing.id,
        };
      }

      const nextReview = (
        await tx.execute<{ next_review: number }>(sql`
          select
            coalesce(max(review_number), 0)::int + 1
              as next_review
          from audit_reviews
          where authorization_item_id =
            ${fulfillment.authorization_item_id}
        `)
      ).rows[0]!.next_review;

      const created = (
        await tx.execute<{ id: string }>(sql`
          insert into audit_reviews (
            authorization_item_id,
            authorization_fulfillment_id,
            review_number,
            status,
            started_by,
            correlation_id
          )
          values (
            ${fulfillment.authorization_item_id},
            ${fulfillment.id},
            ${nextReview},
            'IN_REVIEW',
            ${scope.userId},
            ${scope.correlationId}
          )
          returning id
        `)
      ).rows[0]!;

      await this.compatibility.projectFulfillmentAuditDecision(tx, {
        authorizationItemId: fulfillment.authorization_item_id,
        modernStatus: 'IN_REVIEW',
        actorUserId: scope.userId,
      });

      await this.audit(
        tx,
        scope,
        'FULFILLMENT_AUDIT_STARTED',
        created.id,
        {
          fulfillmentId,
          authorizationItemId: fulfillment.authorization_item_id,
          decision: 'IN_REVIEW',
        },
      );

      return {
        outcome: 'started' as const,
        audit: await this.findByFulfillmentId(tx, fulfillmentId),
      };
    });
  }

  async approve(id: string, scope: Scope) {
    return this.decide(id, 'APPROVED', null, scope);
  }

  async reject(id: string, observation: string, scope: Scope) {
    return this.decide(id, 'REJECTED', observation, scope);
  }

  private async decide(
    id: string,
    to: 'APPROVED' | 'REJECTED',
    observation: string | null,
    scope: Scope,
  ) {
    return this.database.db.transaction(async (tx) => {
      const audit = (
        await tx.execute<AuditRow>(sql`
          select
            id,
            authorization_item_id,
            authorization_fulfillment_id,
            review_number,
            status,
            observations,
            started_by,
            decided_by
          from audit_reviews
          where id = ${id}
          for update
        `)
      ).rows[0];

      if (!audit?.authorization_fulfillment_id) {
        return { outcome: 'not_found' as const };
      }

      if (audit.status !== 'IN_REVIEW') {
        throw new Error('FULFILLMENT_AUDIT_TERMINAL');
      }

      await tx.execute(sql`
        select id
        from authorization_items
        where id = ${audit.authorization_item_id}
        for update
      `);

      const updated = (
        await tx.execute<{ id: string }>(sql`
          update audit_reviews
          set status = ${to},
              observations = ${observation},
              decided_by = ${scope.userId},
              decided_at = now()
          where id = ${id}
            and status = 'IN_REVIEW'
            and authorization_fulfillment_id is not null
          returning id
        `)
      ).rows[0];

      if (!updated) {
        throw new Error('FULFILLMENT_AUDIT_CONCURRENT_DECISION');
      }

      await this.compatibility.projectFulfillmentAuditDecision(tx, {
        authorizationItemId: audit.authorization_item_id,
        modernStatus: to,
        actorUserId: scope.userId,
      });

      await this.audit(
        tx,
        scope,
        `FULFILLMENT_AUDIT_${to}`,
        id,
        {
          fulfillmentId: audit.authorization_fulfillment_id,
          authorizationItemId: audit.authorization_item_id,
          decision: to,
          ...(observation ? { observation } : {}),
        },
      );

      return {
        outcome: 'decided' as const,
        audit: await this.findByFulfillmentId(
          tx,
          audit.authorization_fulfillment_id,
        ),
      };
    });
  }

  private async findByFulfillmentId(
    conn: Conn,
    fulfillmentId: string,
  ) {
    const context = (
      await conn.execute<ContextRow>(sql`
        select
          af.id as fulfillment_id,
          af.fulfillment_type,
          af.authorization_item_id,
          ai.numero_autorizacion as authorization_number,
          coalesce(
            ai.source_data->>'IDENTIFICACION_PACIENTE',
            ai.source_data->>'NUM_DOCUMENTO'
          ) as patient_document,
          ai.source_data->>'NOMBRE_PACIENTE' as patient_name,
          ai.codigo_medicamento as commercial_code,
          af.effective_date::text as effective_date,
          af.quantity,
          af.source,
          to_char(
            af.confirmed_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ) as confirmed_at,
          logistics.dispensing_point_code,
          logistics.dispensing_point_name,
          logistics.purchase_orders,
          ar.id as audit_id,
          ar.status as audit_status,
          ar.observations,
          to_char(
            ar.started_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ) as started_at,
          ar.started_by,
          starter.display_name as started_by_name,
          to_char(
            ar.decided_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ) as decided_at,
          ar.decided_by,
          decider.display_name as decided_by_name
        from authorization_fulfillments af
        join authorization_items ai
          on ai.id = af.authorization_item_id
        left join audit_reviews ar
          on ar.authorization_fulfillment_id = af.id
        left join users starter
          on starter.id = ar.started_by
        left join users decider
          on decider.id = ar.decided_by
        left join lateral (
          select
            string_agg(distinct dp.code, ', ') as dispensing_point_code,
            string_agg(distinct dp.name, ', ') as dispensing_point_name,
            string_agg(
              distinct coalesce(po.purchase_order_code, po.id::text),
              ', '
            ) as purchase_orders
          from authorization_fulfillment_lines afl
          join dispensing_points dp
            on dp.id = afl.dispensing_point_id
          join purchase_orders po
            on po.id = afl.purchase_order_id
          where afl.fulfillment_id = af.id
        ) logistics on true
        where af.id = ${fulfillmentId}
      `)
    ).rows[0];

    if (!context) {
      return null;
    }

    return {
      id: context.audit_id,
      status: context.audit_status ?? 'READY_FOR_AUDIT',
      fulfillmentId: context.fulfillment_id,
      fulfillmentType: context.fulfillment_type,
      authorizationItemId: context.authorization_item_id,
      authorizationNumber: context.authorization_number,
      patientDocument: context.patient_document,
      patientName: context.patient_name,
      commercialCode: context.commercial_code,
      effectiveDate: context.effective_date,
      quantity: context.quantity,
      source: context.source,
      confirmedAt: context.confirmed_at,
      dispensingPointCode: context.dispensing_point_code,
      dispensingPointName: context.dispensing_point_name,
      purchaseOrders:
        context.purchase_orders
          ?.split(',')
          .map((value) => value.trim())
          .filter(Boolean) ?? [],
      startedAt: context.started_at,
      startedBy: context.started_by,
      startedByName: context.started_by_name,
      decidedAt: context.decided_at,
      decidedBy: context.decided_by,
      decidedByName: context.decided_by_name,
      observation: context.observations,
    };
  }

  private async audit(
    tx: Tx,
    scope: Scope,
    action: string,
    id: string,
    after: unknown,
  ) {
    await tx.execute(sql`
      insert into audit_events (
        actor_type,
        actor_id,
        organization_id,
        action,
        resource_type,
        resource_id,
        after,
        correlation_id,
        request_id,
        result
      )
      values (
        'USER',
        ${scope.userId},
        ${scope.organizationId},
        ${action},
        'authorization_fulfillment_audit',
        ${id},
        ${JSON.stringify(after)}::jsonb,
        ${scope.correlationId},
        ${scope.correlationId},
        'SUCCESS'
      )
    `);
  }
}
