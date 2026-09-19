import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ORGANIZATION_IDS } from './helpers/auth';

const database = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://authorization:authorization@localhost:15432/authorization_test_integration',
});

const suffix = randomUUID().slice(0, 8).toUpperCase();

let foundationUserId = '';
let standaloneLocationId = '';

describe('Macro 3C W1 — inventory location foundation', () => {
  beforeAll(async () => {
    await database.connect();

    const user = await database.query<{ id: string }>(
      `select id
       from users
       where username = 'foundation-admin'`,
    );

    foundationUserId = user.rows[0]?.id ?? '';

    if (!foundationUserId) {
      throw new Error('FOUNDATION_ADMIN_NOT_AVAILABLE');
    }
  });

  afterAll(async () => {
    try {
      if (standaloneLocationId) {
        await database.query(
          `delete from inventory_locations
           where id = $1`,
          [standaloneLocationId],
        );
      }
    } finally {
      await database.end();
    }
  });

  it('creates the independent inventory location model', async () => {
    const table = await database.query<{ count: number }>(
      `select count(*)::int count
       from information_schema.tables
       where table_schema = 'public'
         and table_name = 'inventory_locations'`,
    );

    expect(table.rows[0]?.count).toBe(1);

    const columns = await database.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'inventory_locations'
       order by ordinal_position`,
    );

    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'id',
      'organization_id',
      'code',
      'name',
      'active',
      'legacy_dispensing_point_id',
      'created_by',
      'updated_by',
      'created_at',
      'updated_at',
    ]);
  });

  it('backfills exactly one legacy inventory location per dispensing point', async () => {
    const result = await database.query<{
      points: number;
      mapped: number;
      unmapped: number;
      duplicates: number;
      mismatches: number;
    }>(
      `select
         (select count(*)::int
            from dispensing_points) as points,

         (select count(*)::int
            from inventory_locations
           where legacy_dispensing_point_id is not null) as mapped,

         (select count(*)::int
            from dispensing_points dp
           where not exists (
             select 1
             from inventory_locations il
             where il.legacy_dispensing_point_id = dp.id
           )) as unmapped,

         (select count(*)::int
            from (
              select legacy_dispensing_point_id
              from inventory_locations
              where legacy_dispensing_point_id is not null
              group by legacy_dispensing_point_id
              having count(*) > 1
            ) duplicated) as duplicates,

         (select count(*)::int
            from inventory_locations il
            join dispensing_points dp
              on dp.id = il.legacy_dispensing_point_id
           where il.organization_id <> dp.organization_id
              or il.code <> dp.code
              or il.name <> dp.name
              or il.active <> dp.active) as mismatches`,
    );

    const row = result.rows[0]!;

    expect(row.mapped).toBe(row.points);
    expect(row.unmapped).toBe(0);
    expect(row.duplicates).toBe(0);
    expect(row.mismatches).toBe(0);
  });

  it('allows a real inventory location with no dispensing-point identity', async () => {
    const inserted = await database.query<{
      id: string;
      legacy_dispensing_point_id: string | null;
    }>(
      `insert into inventory_locations (
         organization_id,
         code,
         name,
         active,
         legacy_dispensing_point_id,
         created_by,
         updated_by
       )
       values (
         $1,
         $2,
         $3,
         true,
         null,
         $4,
         $4
       )
       returning
         id,
         legacy_dispensing_point_id`,
      [
        ORGANIZATION_IDS.MTD,
        `M3C-LOCATION-${suffix}`,
        `Macro 3C Location ${suffix}`,
        foundationUserId,
      ],
    );

    standaloneLocationId = inserted.rows[0]!.id;

    expect(inserted.rows[0]!.legacy_dispensing_point_id).toBeNull();

    const matchingPoint = await database.query<{ count: number }>(
      `select count(*)::int count
         from dispensing_points
         where id = $1`,
      [standaloneLocationId],
    );

    expect(matchingPoint.rows[0]?.count).toBe(0);
  });

  it('keeps the location model free of patient, authorization and planning identity', async () => {
    const forbidden = await database.query<{ count: number }>(
      `select count(*)::int count
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'inventory_locations'
           and column_name in (
             'patient_id',
             'patient_schedule_id',
             'authorization_item_id',
             'planning_period_id',
             'projected_demand_line_id'
           )`,
    );

    expect(forbidden.rows[0]?.count).toBe(0);
  });

  it('retains legacy point compatibility after canonical inventory location is introduced', async () => {
    const result = await database.query<{
      inventory_location_id: number;
      dispensing_point_id: number;
    }>(
      `select
           count(*) filter (
             where column_name =
               'inventory_location_id'
           )::int
             as inventory_location_id,

           count(*) filter (
             where column_name =
               'dispensing_point_id'
               and is_nullable = 'NO'
           )::int
             as dispensing_point_id
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'inventory_lots'`,
    );

    expect(result.rows[0]).toEqual({
      inventory_location_id: 1,
      dispensing_point_id: 1,
    });
  });
});
