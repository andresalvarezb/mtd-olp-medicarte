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

const canonicalCode = `M3CW2-CANONICAL-${suffix}`;

const legacyCode = `M3CW2-LEGACY-${suffix}`;

const mismatchCode = `M3CW2-MISMATCH-${suffix}`;

const pointCode = `M3CW2-POINT-${suffix}`;

let userId = '';
let pointId = '';
let locationId = '';
let standaloneLocationId = '';

describe('Macro 3C W2 — canonical inventory lot location', () => {
  beforeAll(async () => {
    await database.connect();

    const user = await database.query<{ id: string }>(
      `select id
           from users
           where username='foundation-admin'`,
    );

    userId = user.rows[0]?.id ?? '';

    if (!userId) {
      throw new Error('FOUNDATION_ADMIN_NOT_AVAILABLE');
    }

    const point = await database.query<{ id: string }>(
      `insert into dispensing_points (
             organization_id,
             code,
             name,
             active,
             created_by
           )
           values (
             $1,
             $2,
             $3,
             true,
             $4
           )
           returning id`,
      [ORGANIZATION_IDS.MTD, pointCode, `Macro 3C W2 ${suffix}`, userId],
    );

    pointId = point.rows[0]!.id;

    const mapping = await database.query<{ id: string }>(
      `select id
           from inventory_locations
           where legacy_dispensing_point_id=$1`,
      [pointId],
    );

    locationId = mapping.rows[0]?.id ?? '';

    if (!locationId) {
      throw new Error('AUTOMATIC_INVENTORY_LOCATION_NOT_CREATED');
    }

    const standalone = await database.query<{ id: string }>(
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
           returning id`,
      [ORGANIZATION_IDS.MTD, `M3CW2-STANDALONE-${suffix}`, `Standalone ${suffix}`, userId],
    );

    standaloneLocationId = standalone.rows[0]!.id;
  });

  afterAll(async () => {
    try {
      await database.query(
        `delete from inventory_lots
           where commercial_code = any($1::text[])`,
        [[canonicalCode, legacyCode, mismatchCode]],
      );

      if (standaloneLocationId) {
        await database.query(
          `delete from inventory_locations
             where id=$1`,
          [standaloneLocationId],
        );
      }

      if (pointId) {
        await database.query(
          `delete from dispensing_points
             where id=$1`,
          [pointId],
        );
      }

      if (locationId) {
        await database.query(
          `delete from inventory_locations
             where id=$1`,
          [locationId],
        );
      }
    } finally {
      await database.end();
    }
  });

  it('creates one inventory location automatically for a legacy point', async () => {
    const mapping = await database.query<{
      count: number;
    }>(
      `select count(*)::int count
             from inventory_locations
             where legacy_dispensing_point_id=$1`,
      [pointId],
    );

    expect(mapping.rows[0]?.count).toBe(1);
  });

  it('has canonical inventory_location_id and transitional dispensing_point_id', async () => {
    const columns = await database.query<{
      column_name: string;
      is_nullable: string;
    }>(
      `select
               column_name,
               is_nullable
             from information_schema.columns
             where table_schema='public'
               and table_name='inventory_lots'
               and column_name in (
                 'inventory_location_id',
                 'dispensing_point_id'
               )
             order by column_name`,
    );

    expect(columns.rows).toEqual([
      {
        column_name: 'dispensing_point_id',
        is_nullable: 'NO',
      },
      {
        column_name: 'inventory_location_id',
        is_nullable: 'YES',
      },
    ]);
  });

  it('persists canonical lot identity with a matching compatibility point', async () => {
    const row = await database.query<{
      inventory_location_id: string | null;
      dispensing_point_id: string;
    }>(
      `insert into inventory_lots (
               commercial_code,
               inventory_location_id,
               dispensing_point_id,
               lot_number,
               expiration_date
             )
             values (
               $1,
               $2,
               $3,
               $4,
               '2099-12-31'
             )
             returning
               inventory_location_id,
               dispensing_point_id`,
      [canonicalCode, locationId, pointId, `LOT-${suffix}`],
    );

    expect(row.rows[0]).toEqual({
      inventory_location_id: locationId,
      dispensing_point_id: pointId,
    });
  });

  it('rejects inconsistent canonical location and legacy point', async () => {
    await expect(
      database.query(
        `insert into inventory_lots (
               commercial_code,
               inventory_location_id,
               dispensing_point_id,
               lot_number,
               expiration_date
             )
             values (
               $1,
               $2,
               $3,
               $4,
               '2099-12-31'
             )`,
        [mismatchCode, standaloneLocationId, pointId, `LOT-${suffix}`],
      ),
    ).rejects.toThrow();
  });

  it('keeps legacy-only fixture compatibility during migration', async () => {
    const row = await database.query<{
      inventory_location_id: string | null;
    }>(
      `insert into inventory_lots (
               commercial_code,
               dispensing_point_id,
               lot_number,
               expiration_date
             )
             values (
               $1,
               $2,
               $3,
               '2099-12-31'
             )
             returning inventory_location_id`,
      [legacyCode, pointId, `LEGACY-${suffix}`],
    );

    expect(row.rows[0]?.inventory_location_id).toBeNull();
  });

  it('preserves inventory location when its legacy point disappears', async () => {
    const temporaryPoint = await database.query<{ id: string }>(
      `insert into dispensing_points (
               organization_id,
               code,
               name,
               active,
               created_by
             )
             values (
               $1,
               $2,
               $3,
               true,
               $4
             )
             returning id`,
      [ORGANIZATION_IDS.MTD, `M3CW2-DELETE-${suffix}`, `Delete bridge ${suffix}`, userId],
    );

    const id = temporaryPoint.rows[0]!.id;

    const location = await database.query<{ id: string }>(
      `select id
             from inventory_locations
             where legacy_dispensing_point_id=$1`,
      [id],
    );

    expect(location.rows).toHaveLength(1);

    await database.query(
      `delete from dispensing_points
           where id=$1`,
      [id],
    );

    const preserved = await database.query<{
      legacy_dispensing_point_id: string | null;
    }>(
      `select legacy_dispensing_point_id
             from inventory_locations
             where id=$1`,
      [location.rows[0]!.id],
    );

    expect(preserved.rows[0]?.legacy_dispensing_point_id).toBeNull();

    await database.query(
      `delete from inventory_locations
           where id=$1`,
      [location.rows[0]!.id],
    );
  });
});
