import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import type { Scope } from '../common/request-scope';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;
export type InventoryTx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
function lotView(row: Record<string, unknown>) {
  return {
    id: row.id,
    commercialCode: row.commercial_code,
    dispensingPointId: row.dispensing_point_id,
    dispensingPointCode: row.dispensing_point_code,
    dispensingPointName: row.dispensing_point_name,
    lotNumber: row.lot_number,
    expirationDate: row.expiration_date,
    physicalBalance: row.physical_balance,
    usableBalance: row.usable_balance,
    expired: row.expired,
  };
}

@Injectable()
export class InventoryRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async recordConfirmedReceipt(tx: InventoryTx, receiptId: string, scope: Scope): Promise<void> {
    const lines = await tx.execute<{
      id: string;
      accepted_quantity: number;
      received_lot_number: string;
      received_expiration_date: string;
      commercial_code: string;
      dispensing_point_id: string;
    }>(sql`select rl.id,rl.accepted_quantity,rl.received_lot_number,rl.received_expiration_date::text,
      dl.commercial_code,dl.dispensing_point_id
      from receipt_lines rl join delivery_lines dl on dl.id=rl.delivery_line_id
      where rl.receipt_id=${receiptId} and rl.accepted_quantity > 0 for update`);

    for (const line of lines.rows) {
      await tx.execute(sql`insert into inventory_lots
        (commercial_code,dispensing_point_id,lot_number,expiration_date)
        values (${line.commercial_code},${line.dispensing_point_id},${line.received_lot_number},${line.received_expiration_date})
        on conflict (commercial_code,dispensing_point_id,lot_number,expiration_date) do nothing`);
      const lot = await tx.execute<{ id: string }>(sql`select id from inventory_lots
        where commercial_code=${line.commercial_code} and dispensing_point_id=${line.dispensing_point_id}
          and lot_number=${line.received_lot_number} and expiration_date=${line.received_expiration_date}`);
      if (!lot.rows[0]) throw new Error('INVENTORY_LOT_NOT_CREATED');
      const movement = await tx.execute<{ id: string }>(sql`insert into inventory_movements
        (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by,metadata)
        values (${lot.rows[0].id},'RECEIPT',${line.accepted_quantity},'RECEIPT_LINE',${line.id},now(),${scope.userId},${JSON.stringify({ receiptId, acceptedQuantity: line.accepted_quantity })}::jsonb)
        on conflict (movement_type,source_type,source_id) do nothing returning id`);
      if (movement.rows[0])
        await tx.execute(sql`insert into audit_events
          (actor_type,actor_id,organization_id,action,resource_type,resource_id,after,correlation_id,request_id,result)
          values ('USER',${scope.userId},${scope.organizationId},'INVENTORY_MOVEMENT_CREATED','inventory_movement',${movement.rows[0].id},${JSON.stringify({ receiptId, receiptLineId: line.id, quantityDelta: line.accepted_quantity })}::jsonb,${scope.correlationId},${scope.correlationId},'SUCCESS')`);
    }
  }

  async list(
    scope: Scope,
    filters: {
      commercialCode?: string | undefined;
      dispensingPointId?: string | undefined;
      lotNumber?: string | undefined;
      expiration?: string | undefined;
      usable?: boolean | undefined;
    },
  ) {
    const conditions = [sql`true`];
    if (!['OLP', 'MEDICARTE', 'MTD'].includes(scope.organizationCode))
      conditions.push(sql`dp.organization_id=${scope.organizationId}`);
    if (filters.commercialCode) conditions.push(sql`l.commercial_code=${filters.commercialCode}`);
    if (filters.dispensingPointId)
      conditions.push(sql`l.dispensing_point_id=${filters.dispensingPointId}`);
    if (filters.lotNumber) conditions.push(sql`l.lot_number=${filters.lotNumber}`);
    if (filters.expiration === 'expired') conditions.push(sql`l.expiration_date < current_date`);
    if (filters.expiration === 'upcoming')
      conditions.push(
        sql`l.expiration_date >= current_date AND l.expiration_date <= current_date + 30`,
      );
    if (filters.expiration === 'current') conditions.push(sql`l.expiration_date >= current_date`);
    if (filters.usable !== undefined)
      conditions.push(
        filters.usable
          ? sql`l.expiration_date >= current_date`
          : sql`l.expiration_date < current_date`,
      );
    const result = await this.database.db
      .execute(sql`select l.id,l.commercial_code,l.dispensing_point_id,dp.code dispensing_point_code,dp.name dispensing_point_name,l.lot_number,l.expiration_date::text,
      coalesce(sum(m.quantity_delta),0)::int physical_balance,
      case when l.expiration_date < current_date then 0 else coalesce(sum(m.quantity_delta),0)::int end usable_balance,
      l.expiration_date < current_date expired
      from inventory_lots l join dispensing_points dp on dp.id=l.dispensing_point_id left join inventory_movements m on m.inventory_lot_id=l.id
      where ${sql.join(conditions, sql` and `)} group by l.id,dp.id
      order by l.commercial_code,l.expiration_date,l.lot_number`);
    return result.rows.map((row) => lotView(row));
  }

  async detail(id: string, scope: Scope) {
    const visible = ['OLP', 'MEDICARTE', 'MTD'].includes(scope.organizationCode)
      ? sql`true`
      : sql`dp.organization_id=${scope.organizationId}`;
    const result = await this.database.db
      .execute(sql`select l.id,l.commercial_code,l.dispensing_point_id,dp.code dispensing_point_code,dp.name dispensing_point_name,l.lot_number,l.expiration_date::text,
      coalesce(sum(m.quantity_delta),0)::int physical_balance,
      case when l.expiration_date < current_date then 0 else coalesce(sum(m.quantity_delta),0)::int end usable_balance,
      l.expiration_date < current_date expired
      from inventory_lots l join dispensing_points dp on dp.id=l.dispensing_point_id left join inventory_movements m on m.inventory_lot_id=l.id
      where l.id=${id} and ${visible} group by l.id,dp.id`);
    return result.rows[0] ? lotView(result.rows[0]) : null;
  }

  movements(id: string) {
    return this.database.db
      .execute(
        sql`select m.id,m.inventory_lot_id,m.movement_type,m.quantity_delta,m.source_type,m.source_id,m.occurred_at,m.created_by,m.metadata,m.created_at
      from inventory_movements m where m.inventory_lot_id=${id} order by m.occurred_at,m.created_at,m.id`,
      )
      .then((result) => result.rows.map((row) => ({
        id: row.id,
        inventoryLotId: row.inventory_lot_id,
        movementType: row.movement_type,
        quantityDelta: row.quantity_delta,
        sourceType: row.source_type,
        sourceId: row.source_id,
        occurredAt: row.occurred_at,
        createdBy: row.created_by,
        metadata: row.metadata,
        createdAt: row.created_at,
      })));
  }

  async fefo(scope: Scope, commercialCode: string, dispensingPointId: string) {
    const lots = await this.list(scope, { commercialCode, dispensingPointId, usable: true });
    return lots[0] ?? null;
  }
}
