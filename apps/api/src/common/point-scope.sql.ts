import { sql, type SQL } from 'drizzle-orm';
import { PointAccessDeniedError } from '@authorization/domain';
import type { PointAccessKind } from '@authorization/contracts';

export type PointScopeActor = Readonly<{
  userId: string;
  pointAccessKind: PointAccessKind;
}>;

export type PointScopeExecutor = {
  execute: (query: SQL) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export function applyPointScope(column: SQL, actor: PointScopeActor): SQL {
  if (actor.pointAccessKind !== 'explicit') return sql`true`;
  return sql`${column} in (
    select ups.dispensing_point_id
    from user_point_scopes ups
    where ups.user_id = ${actor.userId}::uuid
      and ups.revoked_at is null
  )`;
}

export function applyTransferPointScope(
  sourceColumn: SQL,
  destinationColumn: SQL,
  actor: PointScopeActor,
): SQL {
  return sql`${applyPointScope(sourceColumn, actor)} and ${applyPointScope(destinationColumn, actor)}`;
}

export async function lockActivePointGrants(
  tx: PointScopeExecutor,
  actor: PointScopeActor,
  pointIds: readonly string[],
): Promise<void> {
  if (actor.pointAccessKind !== 'explicit') return;
  const unique = [...new Set(pointIds)].sort();
  if (unique.length === 0 || unique.some((id) => !id)) {
    throw new PointAccessDeniedError();
  }
  for (const pointId of unique) {
    const result = await tx.execute(sql`
      select id
      from user_point_scopes
      where user_id = ${actor.userId}::uuid
        and dispensing_point_id = ${pointId}::uuid
        and revoked_at is null
      for share
    `);
    if (!result.rows[0]) throw new PointAccessDeniedError();
  }
}
