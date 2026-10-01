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
    try {
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
          'RECEIVED_AUTO_BACKFILL_SKIPPED: MTD_ADMIN actor not found',
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


      while (
        batch <
        10_000
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
              `deploy-received-auto-backfill-${batch}`,

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
          }),
        );


        if (
          !result.hasMore ||
          !result.nextCursor
        ) {
          break;
        }


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
          event:
            'RECEIVED_AUTO_BACKFILL_COMPLETED',

          batches:
            batch,

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
        'RECEIVED_AUTO_BACKFILL_FATAL',
        cause instanceof Error
          ? cause.stack
          : String(cause),
      );
    }
  }
}
