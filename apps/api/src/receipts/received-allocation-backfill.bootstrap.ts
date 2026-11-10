import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import {
  sql,
} from 'drizzle-orm';

import type {
  createDatabase,
} from '@authorization/database';

import type {
  Scope,
} from '../common/request-scope';

import {
  DATABASE,
} from '../tokens';

import {
  ReceiptRepository,
} from './receipt.repository';


type Database =
  ReturnType<
    typeof createDatabase
  >;

const MAX_BACKFILL_BATCHES = 10_000;
const BACKFILL_LOCK_KEY =
  'mtd-olp-medicarte:received-allocation-backfill';


@Injectable()
export class ReceivedAllocationBackfillBootstrapService
  implements OnApplicationBootstrap {
  private readonly logger =
    new Logger(
      ReceivedAllocationBackfillBootstrapService.name,
    );

  constructor(
    @Inject(DATABASE)
    private readonly database:
      Database,

    private readonly receipts:
      ReceiptRepository,
  ) {}


  onApplicationBootstrap() {
    if (
      process.env.NODE_ENV !==
      'production'
    ) {
      return;
    }


    /*
     * No bloquear el health check del deploy.
     *
     * El backfill comienza después de que Nest ya terminó
     * su bootstrap y trabaja en lotes pequeños.
     */
    setTimeout(
      () => {
        void this.run();
      },
      7_000,
    );
  }


  private async run() {
    const runId =
      randomUUID();

    let lockClient:
      PoolClient | undefined;

    let lockAcquired =
      false;

    try {
      const poolMax =
        this.database.pool.options.max ??
        4;

      if (poolMax > 1) {
        lockClient =
          await this.database.pool.connect();

        const lock =
          await lockClient.query<{
            acquired: boolean;
          }>(
            `select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired`,
            [BACKFILL_LOCK_KEY],
          );

        lockAcquired =
          Boolean(
            lock.rows[0]?.acquired,
          );

        if (!lockAcquired) {
          this.logger.log(
            JSON.stringify({
              event:
                'RECEIVED_AUTO_BACKFILL_SKIPPED',

              reason:
                'ALREADY_RUNNING',

              runId,
            }),
          );

          return;
        }
      } else {
        this.logger.warn(
          JSON.stringify({
            event:
              'RECEIVED_AUTO_BACKFILL_DISTRIBUTED_LOCK_UNAVAILABLE',

            reason:
              'DATABASE_POOL_MAX_MUST_EXCEED_ONE',

            runId,
          }),
        );
      }

      const actor =
        await this.database.db.execute<{
          organization_id:
            string;

          user_id:
            string;
        }>(sql`
          select
            o.id
              as organization_id,

            uor.user_id
              as user_id

          from
            organizations o

          join
            user_organization_roles uor
              on uor.organization_id =
                 o.id

             and uor.active =
                 true

          join
            roles r
              on r.id =
                 uor.role_id

             and r.active =
                 true

             and r.is_system_admin =
                 true

          join
            users u
              on u.id =
                 uor.user_id

             and u.active =
                 true

          where
            o.code =
              'MTD'

            and r.code =
              'MTD_ADMIN'

          order by
            uor.created_at asc,
            uor.user_id asc

          limit 1
        `);


      const row =
        actor.rows[0];

      if (!row) {
        this.logger.error(
          JSON.stringify({
            event:
              'RECEIVED_AUTO_BACKFILL_SKIPPED',

            reason:
              'MTD_ADMIN_ACTOR_NOT_FOUND',

            runId,
          }),
        );

        return;
      }


      let cursor:
        string | undefined;

      let batch =
        0;

      let totalScanned =
        0;

      let totalChanged =
        0;

      let totalFailed =
        0;

      let totalAssigned =
        0;

      let hasMore =
        false;


      while (
        batch <
        MAX_BACKFILL_BATCHES
      ) {
        batch +=
          1;


        const scope:
          Scope = {
            organizationId:
              row.organization_id,

            organizationCode:
              'MTD',

            userId:
              row.user_id,

            correlationId:
              randomUUID(),

            readSensitive:
              true,

            isFoundationAdmin:
              true,

            canCrossOrganizationOperationalExport:
              false,

            pointAccessKind:
              'global',
          };


        const options: {
          limit: number;
          cursor?: string;
        } = {
          limit:
            10,
        };


        if (cursor) {
          options.cursor =
            cursor;
        }


        const result =
          await this.receipts.reconcileReceivedPurchaseOrders(
            scope,
            options,
          );


        totalScanned +=
          result.scanned;

        totalChanged +=
          result.changed;

        totalFailed +=
          result.failed;

        totalAssigned +=
          result.assignedQuantity;


        this.logger.log(
          JSON.stringify({
            event:
              'RECEIVED_AUTO_BACKFILL_BATCH',

            runId,

            batch,

            scanned:
              result.scanned,

            changed:
              result.changed,

            unchanged:
              result.unchanged,

            failed:
              result.failed,

            assignedQuantity:
              result.assignedQuantity,

            hasMore:
              result.hasMore,

            nextCursor:
              result.nextCursor,

            failedItems:
              result.items
                .filter(
                  (item) =>
                    item.status === 'FAILED',
                )
                .map(
                  (item) => ({
                    purchaseOrderId:
                      item.purchaseOrderId,

                    error:
                      (
                        item.error ??
                        'UNKNOWN_RECONCILIATION_ERROR'
                      ).slice(
                        0,
                        256,
                      ),
                  }),
                ),
          }),
        );


        if (
          !result.hasMore ||
          !result.nextCursor
        ) {
          hasMore =
            false;

          break;
        }


        hasMore =
          true;

        cursor =
          result.nextCursor;


        /*
         * Respiración entre lotes para no monopolizar
         * PostgreSQL ni degradar authorization-query.
         */
        await new Promise<void>(
          (resolve) => {
            setTimeout(
              resolve,
              500,
            );
          },
        );
      }


      this.logger.log(
        JSON.stringify({
          event: hasMore
            ? 'RECEIVED_AUTO_BACKFILL_LIMIT_REACHED'
            : 'RECEIVED_AUTO_BACKFILL_COMPLETED',

          runId,

          batches:
            batch,

          nextCursor:
            hasMore
              ? cursor
              : null,

          scanned:
            totalScanned,

          changed:
            totalChanged,

          failed:
            totalFailed,

          assignedQuantity:
            totalAssigned,
        }),
      );
    } catch (
      cause
    ) {
      this.logger.error(
        JSON.stringify({
          event:
            'RECEIVED_AUTO_BACKFILL_FATAL',

          runId,
        }),
        cause instanceof Error
          ? cause.stack
          : String(cause),
      );
    } finally {
      if (lockClient) {
        if (lockAcquired) {
          try {
            await lockClient.query(
              `select pg_advisory_unlock(hashtextextended($1, 0))`,
              [BACKFILL_LOCK_KEY],
            );
          } catch (cause) {
            this.logger.error(
              JSON.stringify({
                event:
                  'RECEIVED_AUTO_BACKFILL_LOCK_RELEASE_FAILED',

                runId,
              }),
              cause instanceof Error
                ? cause.stack
                : String(cause),
            );

            lockClient.release(
              cause instanceof Error
                ? cause
                : new Error(
                    'RECEIVED_AUTO_BACKFILL_LOCK_RELEASE_FAILED',
                  ),
            );

            lockClient =
              undefined;
          }
        }

        lockClient?.release();
      }
    }
  }
}
