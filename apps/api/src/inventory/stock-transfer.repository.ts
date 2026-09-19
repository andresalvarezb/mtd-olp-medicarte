import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import type {
  CreateStockTransferRequest,
  UpdateStockTransferRequest,
} from '@authorization/contracts';
import type { Scope } from '../common/request-scope';
import { applyTransferPointScope, lockActivePointGrants } from '../common/point-scope.sql';
import { PointAccessDeniedError } from '@authorization/domain';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
type TransferViewRow = {
  id: string;
  source_dispensing_point_id: string;
  source_code: string;
  source_name: string;
  destination_dispensing_point_id: string;
  destination_code: string;
  destination_name: string;
  status: string;
  dispatched_at: string | null;
  received_at: string | null;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  line_id: string | null;
  source_inventory_lot_id: string | null;
  commercial_code: string | null;
  lot_number: string | null;
  expiration_date: string | null;
  quantity: number | null;
  source_usable: number | null;
  destination_physical: number | null;
};
type TransferMetrics = { in_transit: number; physical: number };

@Injectable()
export class StockTransferRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private pointScope(scope: Scope) {
    const org = ['MTD', 'MEDICARTE'].includes(scope.organizationCode)
      ? sql`true`
      : sql`dp.organization_id=${scope.organizationId}`;
    return org;
  }

  private transferVisible(scope: Scope) {
    return sql`${this.pointScope(scope)} and ${applyTransferPointScope(
      sql`st.source_dispensing_point_id`,
      sql`st.destination_dispensing_point_id`,
      scope,
    )}`;
  }

  async create(body: CreateStockTransferRequest, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      await this.validatePoints(
        tx,
        body.sourceDispensingPointId,
        body.destinationDispensingPointId,
        scope,
      );
      const id = (
        await tx.execute<{ id: string }>(sql`insert into stock_transfers
        (source_dispensing_point_id,destination_dispensing_point_id,created_by,updated_by)
        values (${body.sourceDispensingPointId},${body.destinationDispensingPointId},${scope.userId},${scope.userId}) returning id`)
      ).rows[0]!.id;
      await this.replaceLines(tx, id, body.sourceDispensingPointId, body.lines);
      await this.audit(tx, scope, 'STOCK_TRANSFER_CREATED', id, { lineCount: body.lines.length });
      return this.findOn(tx, id, scope);
    });
  }

  async update(id: string, body: UpdateStockTransferRequest, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      const row = (
        await tx.execute<{ status: string; version: number }>(
          sql`select status,version from stock_transfers where id=${id} for update`,
        )
      ).rows[0];
      if (!row) return { outcome: 'not_found' as const };
      if (row.version !== body.expectedVersion)
        return { outcome: 'version_conflict' as const, currentVersion: row.version };
      if (row.status !== 'CREATED') throw new Error('STOCK_TRANSFER_FROZEN');
      await this.validatePoints(
        tx,
        body.sourceDispensingPointId,
        body.destinationDispensingPointId,
        scope,
      );
      await this.replaceLines(tx, id, body.sourceDispensingPointId, body.lines);
      await tx.execute(
        sql`update stock_transfers set source_dispensing_point_id=${body.sourceDispensingPointId},destination_dispensing_point_id=${body.destinationDispensingPointId},version=version+1,updated_by=${scope.userId},updated_at=now() where id=${id}`,
      );
      await this.audit(tx, scope, 'STOCK_TRANSFER_UPDATED', id, { lineCount: body.lines.length });
      return this.findOn(tx, id, scope);
    });
  }

  async dispatch(id: string, expectedVersion: number, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      const transfer = (
        await tx.execute<{
          source_dispensing_point_id: string;
          destination_dispensing_point_id: string;
          status: string;
          version: number;
        }>(
          sql`select source_dispensing_point_id,destination_dispensing_point_id,status,version from stock_transfers where id=${id} for update`,
        )
      ).rows[0];
      if (!transfer) return { outcome: 'not_found' as const };
      await this.lockTransferPoints(
        tx,
        transfer.source_dispensing_point_id,
        transfer.destination_dispensing_point_id,
        scope,
      );
      if (transfer.status === 'DISPATCHED' || transfer.status === 'RECEIVED')
        return this.findOn(tx, id, scope);
      if (transfer.version !== expectedVersion)
        return { outcome: 'version_conflict' as const, currentVersion: transfer.version };
      if (transfer.status !== 'CREATED') throw new Error('STOCK_TRANSFER_INVALID_STATUS');
      const lines = (
        await tx.execute<{
          id: string;
          source_inventory_lot_id: string;
          quantity: number;
          expiration_date: string;
        }>(
          sql`select id,source_inventory_lot_id,quantity,expiration_date::text from stock_transfer_lines where stock_transfer_id=${id} order by source_inventory_lot_id,id`,
        )
      ).rows;
      if (!lines.length) throw new Error('STOCK_TRANSFER_LINES_REQUIRED');
      const lotIds = [...new Set(lines.map((line) => line.source_inventory_lot_id))].sort();
      const lockedLots = await tx.execute<{ id: string }>(
        sql`select id from inventory_lots where id in (${sql.join(
          lotIds.map((value) => sql`${value}`),
          sql`, `,
        )}) and dispensing_point_id=${transfer.source_dispensing_point_id} order by id for update`,
      );
      if (lockedLots.rows.length !== lotIds.length)
        throw new Error('STOCK_TRANSFER_LINE_OUT_OF_SCOPE');
      const balances = await tx.execute<{ id: string; balance: number; expiration_date: string }>(
        sql`select l.id,coalesce(sum(m.quantity_delta),0)::int balance,l.expiration_date::text from inventory_lots l left join inventory_movements m on m.inventory_lot_id=l.id where l.id in (${sql.join(
          lotIds.map((value) => sql`${value}`),
          sql`, `,
        )}) and l.dispensing_point_id=${transfer.source_dispensing_point_id} group by l.id order by l.id`,
      );
      const remaining = new Map(balances.rows.map((row) => [row.id, row.balance]));
      if (balances.rows.length !== lotIds.length)
        throw new Error('STOCK_TRANSFER_LINE_OUT_OF_SCOPE');
      for (const line of lines) {
        const balance = remaining.get(line.source_inventory_lot_id) ?? 0;
        const expiration = balances.rows.find(
          (item) => item.id === line.source_inventory_lot_id,
        )!.expiration_date;
        if (expiration < new Date().toISOString().slice(0, 10))
          throw new Error('STOCK_TRANSFER_EXPIRED_STOCK');
        if (line.quantity > balance) throw new Error('STOCK_TRANSFER_INSUFFICIENT_BALANCE');
        remaining.set(line.source_inventory_lot_id, balance - line.quantity);
      }
      for (const line of lines)
        await tx.execute(
          sql`insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by,metadata) values (${line.source_inventory_lot_id},'TRANSFER_OUT',${-line.quantity},'TRANSFER_LINE',${line.id},now(),${scope.userId},${JSON.stringify({ stockTransferId: id })}::jsonb) on conflict (movement_type,source_type,source_id) do nothing`,
        );
      await tx.execute(
        sql`update stock_transfers set status='DISPATCHED',dispatched_at=now(),version=version+1,updated_by=${scope.userId},updated_at=now() where id=${id}`,
      );
      await this.audit(tx, scope, 'STOCK_TRANSFER_DISPATCHED', id, { lineCount: lines.length });
      return this.findOn(tx, id, scope);
    });
  }

  async receive(id: string, expectedVersion: number, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      const transfer = (
        await tx.execute<{
          source_dispensing_point_id: string;
          destination_dispensing_point_id: string;
          status: string;
          version: number;
        }>(
          sql`select source_dispensing_point_id,destination_dispensing_point_id,status,version from stock_transfers where id=${id} for update`,
        )
      ).rows[0];
      if (!transfer) return { outcome: 'not_found' as const };
      await this.lockTransferPoints(
        tx,
        transfer.source_dispensing_point_id,
        transfer.destination_dispensing_point_id,
        scope,
      );
      if (transfer.status === 'RECEIVED') return this.findOn(tx, id, scope);
      if (transfer.version !== expectedVersion)
        return { outcome: 'version_conflict' as const, currentVersion: transfer.version };
      if (transfer.status !== 'DISPATCHED') throw new Error('STOCK_TRANSFER_INVALID_STATUS');
      const lines = (
        await tx.execute<{
          id: string;
          commercial_code: string;
          lot_number: string;
          expiration_date: string;
          quantity: number;
        }>(
          sql`select id,commercial_code,lot_number,expiration_date::text,quantity from stock_transfer_lines where stock_transfer_id=${id} order by id for update`,
        )
      ).rows;

      // Transitional bridge for legacy point creation after migration 0064.
      await tx.execute(sql`
        insert into inventory_locations (
          organization_id,
          code,
          name,
          active,
          legacy_dispensing_point_id,
          created_by,
          updated_by
        )
        select
          dp.organization_id,
          dp.code,
          dp.name,
          dp.active,
          dp.id,
          dp.created_by,
          dp.created_by
        from dispensing_points dp
        where dp.id = ${transfer.destination_dispensing_point_id}
        on conflict do nothing
      `);

      const destinationLocation = await tx.execute<{ id: string }>(sql`
        select id
        from inventory_locations
        where legacy_dispensing_point_id = ${transfer.destination_dispensing_point_id}
        limit 1
      `);

      const destinationInventoryLocationId = destinationLocation.rows[0]?.id;

      if (!destinationInventoryLocationId) {
        throw new Error('STOCK_TRANSFER_DESTINATION_LOCATION_NOT_FOUND');
      }

      for (const line of lines) {
        const destinationLotLockKey = [
          'INVENTORY_LOT',
          destinationInventoryLocationId,
          line.commercial_code,
          line.lot_number,
          line.expiration_date,
        ].join(':');

        await tx.execute(sql`
          select pg_advisory_xact_lock(
            hashtextextended(
              ${destinationLotLockKey},
              0
            )
          )
        `);

        await tx.execute(
          sql`insert into inventory_lots (commercial_code,inventory_location_id,dispensing_point_id,lot_number,expiration_date) values (${line.commercial_code},${destinationInventoryLocationId},${transfer.destination_dispensing_point_id},${line.lot_number},${line.expiration_date}) on conflict (commercial_code,dispensing_point_id,lot_number,expiration_date) do nothing`,
        );

        // Transitional compatibility for a legacy lot that existed before
        // inventory_location_id became canonical.
        await tx.execute(sql`
          update inventory_lots
          set inventory_location_id = ${destinationInventoryLocationId}
          where commercial_code = ${line.commercial_code}
            and dispensing_point_id = ${transfer.destination_dispensing_point_id}
            and lot_number = ${line.lot_number}
            and expiration_date = ${line.expiration_date}
            and inventory_location_id is null
        `);

        const lot = (
          await tx.execute<{
            id: string;
            inventory_location_id: string | null;
          }>(
            sql`select id,inventory_location_id from inventory_lots where commercial_code=${line.commercial_code} and dispensing_point_id=${transfer.destination_dispensing_point_id} and lot_number=${line.lot_number} and expiration_date=${line.expiration_date} for update`,
          )
        ).rows[0];

        if (!lot) {
          throw new Error('STOCK_TRANSFER_DESTINATION_LOT_FAILED');
        }

        if (lot.inventory_location_id !== destinationInventoryLocationId) {
          throw new Error('STOCK_TRANSFER_DESTINATION_LOCATION_MISMATCH');
        }
        await tx.execute(
          sql`insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by,metadata) values (${lot.id},'TRANSFER_IN',${line.quantity},'TRANSFER_LINE',${line.id},now(),${scope.userId},${JSON.stringify({ stockTransferId: id })}::jsonb) on conflict (movement_type,source_type,source_id) do nothing`,
        );
      }
      await tx.execute(
        sql`update stock_transfers set status='RECEIVED',received_at=now(),version=version+1,updated_by=${scope.userId},updated_at=now() where id=${id}`,
      );
      await this.audit(tx, scope, 'STOCK_TRANSFER_RECEIVED', id, { lineCount: lines.length });
      return this.findOn(tx, id, scope);
    });
  }

  async cancel(id: string, expectedVersion: number, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      const row = (
        await tx.execute<{
          status: string;
          version: number;
          source_dispensing_point_id: string;
          destination_dispensing_point_id: string;
        }>(
          sql`select status,version,source_dispensing_point_id,destination_dispensing_point_id from stock_transfers where id=${id} for update`,
        )
      ).rows[0];
      if (!row) return { outcome: 'not_found' as const };
      await this.lockTransferPoints(
        tx,
        row.source_dispensing_point_id,
        row.destination_dispensing_point_id,
        scope,
      );
      if (row.version !== expectedVersion)
        return { outcome: 'version_conflict' as const, currentVersion: row.version };
      if (row.status !== 'CREATED') throw new Error('STOCK_TRANSFER_CANCEL_NOT_ALLOWED');
      await tx.execute(
        sql`update stock_transfers set status='CANCELLED',version=version+1,updated_by=${scope.userId},updated_at=now() where id=${id}`,
      );
      await this.audit(tx, scope, 'STOCK_TRANSFER_CANCELLED', id, null);
      return this.findOn(tx, id, scope);
    });
  }

  async existsIgnoringPoint(id: string): Promise<boolean> {
    const result = await this.database.db.execute<{ id: string }>(
      sql`select id from stock_transfers where id=${id}`,
    );
    return Boolean(result.rows[0]);
  }

  list(scope: Scope, status?: string) {
    return this.database.db
      .execute<{
        id: string;
      }>(
        sql`select distinct st.id,st.created_at from stock_transfers st join dispensing_points dp on dp.id=st.source_dispensing_point_id join dispensing_points dest on dest.id=st.destination_dispensing_point_id where (${status ?? null}::varchar is null or st.status=${status ?? null}) and ${this.transferVisible(scope)} order by st.created_at desc`,
      )
      .then((result) => Promise.all(result.rows.map((row) => this.find(row.id, scope))));
  }
  find(id: string, scope: Scope) {
    return this.findOn(this.database.db, id, scope);
  }

  private async validatePoints(tx: Tx, source: string, destination: string, scope: Scope) {
    if (source === destination) throw new Error('STOCK_TRANSFER_SAME_POINT');
    await lockActivePointGrants(tx, scope, [source, destination]);
    const points = await tx.execute<{ id: string }>(
      sql`select dp.id from dispensing_points dp where dp.id in (${source},${destination}) and ${this.pointScope(scope)}`,
    );
    if (points.rows.length !== 2) throw new PointAccessDeniedError();
  }

  private async lockTransferPoints(
    tx: Tx,
    source: string,
    destination: string,
    scope: Scope,
  ): Promise<void> {
    await lockActivePointGrants(tx, scope, [source, destination]);
  }
  private async replaceLines(
    tx: Tx,
    transferId: string,
    source: string,
    lines: CreateStockTransferRequest['lines'],
  ) {
    await tx.execute(sql`delete from stock_transfer_lines where stock_transfer_id=${transferId}`);
    for (const line of lines) {
      const lot = (
        await tx.execute<{ commercial_code: string; lot_number: string; expiration_date: string }>(
          sql`select commercial_code,lot_number,expiration_date::text from inventory_lots where id=${line.sourceInventoryLotId} and dispensing_point_id=${source}`,
        )
      ).rows[0];
      if (!lot) throw new Error('STOCK_TRANSFER_LINE_OUT_OF_SCOPE');
      await tx.execute(
        sql`insert into stock_transfer_lines (stock_transfer_id,source_inventory_lot_id,commercial_code,lot_number,expiration_date,quantity) values (${transferId},${line.sourceInventoryLotId},${lot.commercial_code},${lot.lot_number},${lot.expiration_date},${line.quantity})`,
      );
    }
  }
  private async audit(tx: Tx, scope: Scope, action: string, id: string, after: unknown) {
    await tx.execute(
      sql`insert into audit_events (actor_type,actor_id,organization_id,action,resource_type,resource_id,after,correlation_id,request_id,result) values ('USER',${scope.userId},${scope.organizationId},${action},'stock_transfer',${id},${after ? JSON.stringify(after) : null}::jsonb,${scope.correlationId},${scope.correlationId},'SUCCESS')`,
    );
  }
  private async findOn(conn: Tx | Database['db'], id: string, scope: Scope) {
    const result = await conn.execute<TransferViewRow>(
      sql`select st.*,sp.code source_code,sp.name source_name,dp.code destination_code,dp.name destination_name,sl.id line_id,sl.source_inventory_lot_id,sl.commercial_code,sl.lot_number,sl.expiration_date::text,sl.quantity,coalesce((select sum(m.quantity_delta) from inventory_movements m where m.inventory_lot_id=sl.source_inventory_lot_id),0)::int source_physical,coalesce((select sum(m.quantity_delta) from inventory_movements m where m.inventory_lot_id=sl.source_inventory_lot_id and m.inventory_lot_id in (select id from inventory_lots where expiration_date >= current_date)),0)::int source_usable,coalesce((select sum(m.quantity_delta) from inventory_movements m join inventory_lots dl on dl.id=m.inventory_lot_id where m.movement_type in ('RECEIPT','TRANSFER_IN') and dl.dispensing_point_id=st.destination_dispensing_point_id and dl.commercial_code=sl.commercial_code and dl.lot_number=sl.lot_number and dl.expiration_date=sl.expiration_date),0)::int destination_physical from stock_transfers st join dispensing_points sp on sp.id=st.source_dispensing_point_id join dispensing_points dp on dp.id=st.destination_dispensing_point_id left join stock_transfer_lines sl on sl.stock_transfer_id=st.id where st.id=${id} and ${this.transferVisible(scope)} order by sl.id`,
    );
    if (!result.rows[0]) return null;
    const first = result.rows[0];
    const metrics = await conn.execute<TransferMetrics>(
      sql`select coalesce((select sum(quantity) from stock_transfer_lines l join stock_transfers t on t.id=l.stock_transfer_id where t.status='DISPATCHED'),0)::int in_transit,coalesce((select sum(m.quantity_delta) from inventory_movements m),0)::int physical`,
    );
    const metric = metrics.rows[0]!;
    return {
      id: first.id,
      sourceDispensingPointId: first.source_dispensing_point_id,
      sourceDispensingPointCode: first.source_code,
      sourceDispensingPointName: first.source_name,
      destinationDispensingPointId: first.destination_dispensing_point_id,
      destinationDispensingPointCode: first.destination_code,
      destinationDispensingPointName: first.destination_name,
      status: first.status,
      dispatchedAt: first.dispatched_at,
      receivedAt: first.received_at,
      version: first.version,
      createdBy: first.created_by,
      updatedBy: first.updated_by,
      createdAt: first.created_at,
      updatedAt: first.updated_at,
      inTransit: metric.in_transit,
      globalControlledQuantity: metric.physical + metric.in_transit,
      lines: result.rows
        .filter((row) => row.line_id)
        .map((row) => ({
          id: row.line_id,
          sourceInventoryLotId: row.source_inventory_lot_id,
          commercialCode: row.commercial_code,
          lotNumber: row.lot_number,
          expirationDate: row.expiration_date,
          quantity: row.quantity,
          sourceUsableBalance: row.source_usable,
          destinationPhysicalBalance: row.destination_physical,
        })),
    };
  }
}
