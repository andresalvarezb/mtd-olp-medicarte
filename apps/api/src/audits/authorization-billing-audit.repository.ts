import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { createDatabase } from '@authorization/database';

import type { Scope } from '../common/request-scope';
import { DATABASE } from '../tokens';
import { billingAuditFulfillmentSnapshotSql, isBillingAuditFulfillmentEligible, type BillingAuditFulfillmentRow } from './authorization-billing-audit-eligibility';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
type Conn = Tx | Database['db'];

type AuditLockRow = {
  id: string;
  authorization_item_id: string;
  status: 'PENDING' | 'REVIEWED';
  result: 'COMPLIES' | 'DOES_NOT_COMPLY' | null;
  observation: string | null;
};

type AuditReadRow = {
  id: string;
  authorization_item_id: string;
  authorization_number: string;
  status: 'PENDING' | 'REVIEWED';
  result: 'COMPLIES' | 'DOES_NOT_COMPLY' | null;
  observation: string | null;
  created_by: string;
  created_at: string;
  audited_by: string | null;
  audited_by_name: string | null;
  audited_at: string | null;
  correlation_id: string;
  updated_at: string;
  drive_support_status:
    'UNKNOWN'
    | 'WITH_SUPPORT'
    | 'WITHOUT_SUPPORT';
  drive_support_last_checked_at:
    string | null;
};

type EvidenceRow = {
  id: string;
  billing_audit_id: string;
  drive_file_id: string;
  file_name: string;
  mime_type: string | null;
  web_view_link: string | null;
  size_bytes: string | null;
  md5_checksum: string | null;
  drive_modified_at: string | null;
  discovered_at: string;
  created_at: string;
};

@Injectable()
export class AuthorizationBillingAuditRepository {
  constructor(
    @Inject(DATABASE)
    private readonly database: Database,
  ) {}

  async detailByAuthorizationItemId(authorizationItemId: string) {
    const authorization = (
      await this.database.db.execute<{
        id: string;
      }>(sql`
        select id
        from authorization_items
        where id = ${authorizationItemId}
        limit 1
      `)
    ).rows[0];

    if (!authorization) {
      return {
        outcome: 'not_found' as const,
      };
    }

    return {
      outcome: 'found' as const,
      audit: await this.readByAuthorizationItemId(this.database.db, authorizationItemId),
    };
  }

  async start(authorizationItemId: string, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      const authorization = (
        await tx.execute<BillingAuditFulfillmentRow>(
          billingAuditFulfillmentSnapshotSql(authorizationItemId),
        )
      ).rows[0];

      if (!authorization) {
        return {
          outcome: 'not_found' as const,
        };
      }

      const existing = (
        await tx.execute<{
          id: string;
          status: 'PENDING' | 'REVIEWED';
        }>(sql`
            select id, status
            from authorization_billing_audits
            where authorization_item_id =
              ${authorizationItemId}
            for update
          `)
      ).rows[0];

      if (existing?.status === 'REVIEWED') {
        return { outcome: 'already_reviewed' as const };
      }
      if (!isBillingAuditFulfillmentEligible(authorization)) {
        return { outcome: 'not_eligible' as const };
      }
      if (existing) {
        return {
          outcome: 'existing' as const,
          audit: await this.readbackOrThrow(tx, authorizationItemId),
        };
      }

      const created = (
        await tx.execute<{
          id: string;
        }>(sql`
            insert into authorization_billing_audits (
              authorization_item_id,
              status,
              result,
              observation,
              created_by,
              correlation_id
            )
            values (
              ${authorizationItemId},
              'PENDING',
              null,
              null,
              ${scope.userId},
              ${scope.correlationId}
            )
            returning id
          `)
      ).rows[0];

      if (!created) {
        throw new Error('AUTHORIZATION_BILLING_AUDIT_READBACK_FAILED');
      }

      await this.writeAuditEvent(
        tx,
        scope,
        'AUTHORIZATION_BILLING_AUDIT_STARTED',
        created.id,
        null,
        {
          authorizationItemId,
          status: 'PENDING',
          result: null,
        },
      );

      return {
        outcome: 'started' as const,
        audit: await this.readbackOrThrow(tx, authorizationItemId),
      };
    });
  }

  async decide(
    auditId: string,
    result: 'COMPLIES' | 'DOES_NOT_COMPLY',
    observation: string | null,
    scope: Scope,
  ) {
    return this.database.db.transaction(async (tx) => {
      // Orden de bloqueo: AUTO primero y auditoría después, igual que bulk.
      const target = (await tx.execute<{ authorization_item_id: string }>(sql`
        select authorization_item_id from authorization_billing_audits where id = ${auditId}
      `)).rows[0];
      if (!target) return { outcome: 'not_found' as const };
      const authorization = (await tx.execute<BillingAuditFulfillmentRow>(
        billingAuditFulfillmentSnapshotSql(target.authorization_item_id),
      )).rows[0];
      if (!authorization) return { outcome: 'not_found' as const };
      const audit = (
        await tx.execute<AuditLockRow>(sql`
            select
              id,
              authorization_item_id,
              status,
              result,
              observation
            from authorization_billing_audits
            where id = ${auditId}
            for update
          `)
      ).rows[0];

      if (!audit || audit.authorization_item_id !== authorization.id) {
        return { outcome: 'not_found' as const };
      }

      if (audit.status === 'REVIEWED') {
        return {
          outcome: 'already_reviewed' as const,
        };
      }
      if (!isBillingAuditFulfillmentEligible(authorization)) {
        return { outcome: 'not_eligible' as const };
      }
      const evidenceCount =
        Number(
          (
            await tx.execute<{
              count:
                number | string;
            }>(sql`
              select
                count(*)::int
                  as count

              from
                authorization_drive_supports

              where
                authorization_item_id =
                  ${audit.authorization_item_id}

                and is_present =
                  true
            `)
          ).rows[0]?.count
          ??
          0,
        );


      if (
        evidenceCount ===
          0
        &&
        observation ===
          null
      ) {
        return {
          outcome:
            'observation_required_without_evidence',
        } as const;
      }



      const updated = (
        await tx.execute<{
          id: string;
        }>(sql`
            update authorization_billing_audits
            set
              status = 'REVIEWED',
              result = ${result},
              observation = ${observation},
              audited_by = ${scope.userId},
              audited_at = now(),
              updated_at = now()
            where id = ${auditId}
              and status = 'PENDING'
            returning id
          `)
      ).rows[0];

      if (!updated) {
        return {
          outcome: 'already_reviewed' as const,
        };
      }

      await this.writeAuditEvent(
        tx,
        scope,
        'AUTHORIZATION_BILLING_AUDIT_REVIEWED',
        auditId,
        {
          authorizationItemId: audit.authorization_item_id,
          status: audit.status,
          result: audit.result,
          observation: audit.observation,
        },
        {
          authorizationItemId: audit.authorization_item_id,
          status: 'REVIEWED',
          result,
          observation,
        },
      );

      return {
        outcome: 'decided' as const,
        audit: await this.readbackOrThrow(tx, audit.authorization_item_id),
      };
    });
  }

  async findDriveSearchContext(auditId: string) {
    const row = (
      await this.database.db.execute<{
        id: string;
        authorization_item_id: string;
        authorization_number: string;
        status: 'PENDING' | 'REVIEWED';
      }>(sql`
        select
          aba.id,
          aba.authorization_item_id,
          ai.numero_autorizacion
            as authorization_number,
          aba.status
        from authorization_billing_audits aba
        join authorization_items ai
          on ai.id =
            aba.authorization_item_id
        where aba.id = ${auditId}
        limit 1
      `)
    ).rows[0];

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      authorizationItemId: row.authorization_item_id,
      authorizationNumber: row.authorization_number,
      status: row.status,
    };
  }

  async findEvidenceForContent(
    auditId: string,
    evidenceId: string,
  ) {
    const row = (
      await this.database.db.execute<{
        drive_file_id: string;
        file_name: string;
        mime_type: string | null;
      }>(sql`
        select
          evidence.drive_file_id,
          evidence.file_name,
          evidence.mime_type

        from
          authorization_drive_supports
            evidence

        join
          authorization_billing_audits
            audit
              on audit.authorization_item_id =
                 evidence.authorization_item_id

        where
          audit.id =
            ${auditId}

          and evidence.id =
            ${evidenceId}

          and evidence.is_present =
            true

        limit 1
      `)
    ).rows[0];

    if (!row) {
      return null;
    }

    return {
      driveFileId:
        row.drive_file_id,

      fileName:
        row.file_name,

      mimeType:
        row.mime_type,
    };
  }


  async upsertDriveEvidence(
    auditId: string,
    authorizationItemId: string,
    files: readonly {
      driveFileId: string;
      fileName: string;
      mimeType: string | null;
      webViewLink: string | null;
      sizeBytes: number | null;
      md5Checksum: string | null;
      driveModifiedAt: string | null;
    }[],
  ) {
    return this.database.db.transaction(async (tx) => {
      /*
       * authorization_drive_supports es la fuente
       * documental actual por AUTO.
       *
       * Una búsqueda manual debe producir exactamente
       * el mismo estado que la sincronización del worker.
       */
      await tx.execute(sql`
        update
          authorization_drive_supports

        set
          is_present =
            false,

          missing_since =
            coalesce(
              missing_since,
              now()
            ),

          updated_at =
            now()

        where
          authorization_item_id =
            ${authorizationItemId}
      `);


      for (const file of files) {
        await tx.execute(sql`
          insert into
            authorization_drive_supports (
              authorization_item_id,
              drive_file_id,
              file_name,
              mime_type,
              web_view_link,
              size_bytes,
              md5_checksum,
              drive_modified_at,
              first_seen_at,
              last_seen_at,
              missing_since,
              is_present,
              created_at,
              updated_at
            )

          values (
            ${authorizationItemId},
            ${file.driveFileId},
            ${file.fileName},
            ${file.mimeType},
            ${file.webViewLink},
            ${file.sizeBytes},
            ${file.md5Checksum},
            ${file.driveModifiedAt},
            now(),
            now(),
            null,
            true,
            now(),
            now()
          )

          on conflict (
            authorization_item_id,
            drive_file_id
          )

          do update set
            file_name =
              excluded.file_name,

            mime_type =
              excluded.mime_type,

            web_view_link =
              excluded.web_view_link,

            size_bytes =
              excluded.size_bytes,

            md5_checksum =
              excluded.md5_checksum,

            drive_modified_at =
              excluded.drive_modified_at,

            last_seen_at =
              now(),

            missing_since =
              null,

            is_present =
              true,

            updated_at =
              now()
        `);


        /*
         * Compatibilidad histórica.
         *
         * Conservamos la relación antigua auditoría-evidencia
         * mientras termina la transición al índice global.
         */
        await tx.execute(sql`
          insert into
            authorization_billing_audit_evidence (
              billing_audit_id,
              drive_file_id,
              file_name,
              mime_type,
              web_view_link,
              size_bytes,
              md5_checksum,
              drive_modified_at,
              discovered_at
            )

          values (
            ${auditId},
            ${file.driveFileId},
            ${file.fileName},
            ${file.mimeType},
            ${file.webViewLink},
            ${file.sizeBytes},
            ${file.md5Checksum},
            ${file.driveModifiedAt},
            now()
          )

          on conflict (
            billing_audit_id,
            drive_file_id
          )

          do update set
            file_name =
              excluded.file_name,

            mime_type =
              excluded.mime_type,

            web_view_link =
              excluded.web_view_link,

            size_bytes =
              excluded.size_bytes,

            md5_checksum =
              excluded.md5_checksum,

            drive_modified_at =
              excluded.drive_modified_at,

            discovered_at =
              now()
        `);
      }


      await tx.execute(sql`
        insert into
          authorization_drive_support_sync (
            authorization_item_id,
            support_status,
            evidence_count,
            last_checked_at,
            last_success_at,
            next_check_at,
            consecutive_failures,
            last_error,
            created_at,
            updated_at
          )

        values (
          ${authorizationItemId},
          ${files.length > 0
            ? 'WITH_SUPPORT'
            : 'WITHOUT_SUPPORT'},
          ${files.length},
          now(),
          now(),
          now() + interval '30 minutes',
          0,
          null,
          now(),
          now()
        )

        on conflict (
          authorization_item_id
        )

        do update set
          support_status =
            excluded.support_status,

          evidence_count =
            excluded.evidence_count,

          last_checked_at =
            now(),

          last_success_at =
            now(),

          next_check_at =
            excluded.next_check_at,

          consecutive_failures =
            0,

          last_error =
            null,

          updated_at =
            now()
      `);


      return this.readbackOrThrow(
        tx,
        authorizationItemId,
      );
    });
  }


  private async readbackOrThrow(conn: Conn, authorizationItemId: string) {
    const audit = await this.readByAuthorizationItemId(conn, authorizationItemId);

    if (!audit) {
      throw new Error('AUTHORIZATION_BILLING_AUDIT_READBACK_FAILED');
    }

    return audit;
  }

  private async readByAuthorizationItemId(conn: Conn, authorizationItemId: string) {
    const audit = (
      await conn.execute<AuditReadRow>(sql`
        select
          aba.id,
          aba.authorization_item_id,
          ai.numero_autorizacion
            as authorization_number,
          aba.status,
          aba.result,
          aba.observation,
          aba.created_by,

          to_char(
            aba.created_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ) as created_at,

          aba.audited_by,
          auditor.display_name
            as audited_by_name,

          case
            when aba.audited_at is null
              then null
            else to_char(
              aba.audited_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
          end as audited_at,

          aba.correlation_id,

          to_char(
            aba.updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ) as updated_at,

          coalesce(
            support_sync.support_status,
            'UNKNOWN'
          )
            as drive_support_status,

          case
            when
              support_sync.last_checked_at
                is null
            then
              null

            else
              to_char(
                support_sync.last_checked_at
                  at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
              )
          end
            as drive_support_last_checked_at

        from authorization_billing_audits aba

        join authorization_items ai
          on ai.id =
            aba.authorization_item_id

        left join users auditor
          on auditor.id =
            aba.audited_by

        left join
          authorization_drive_support_sync
            support_sync
              on support_sync.authorization_item_id =
                 aba.authorization_item_id

        where aba.authorization_item_id =
          ${authorizationItemId}

        limit 1
      `)
    ).rows[0];

    if (!audit) {
      return null;
    }

    const evidence = await conn.execute<EvidenceRow>(sql`
        select
          support.id,

          ${audit.id}::uuid
            as billing_audit_id,

          support.drive_file_id,

          support.file_name,

          support.mime_type,

          support.web_view_link,

          support.size_bytes::text
            as size_bytes,

          support.md5_checksum,

          case
            when
              support.drive_modified_at
                is null
            then
              null

            else
              to_char(
                support.drive_modified_at
                  at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
              )
          end
            as drive_modified_at,

          to_char(
            support.first_seen_at
              at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
            as discovered_at,

          to_char(
            support.created_at
              at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
            as created_at

        from
          authorization_drive_supports
            support

        where
          support.authorization_item_id =
            ${authorizationItemId}

          and support.is_present =
            true

        order by
          support.file_name asc,
          support.id asc
      `);


    return {
      id: audit.id,

      authorizationItemId: audit.authorization_item_id,

      authorizationNumber: audit.authorization_number,

      status: audit.status,

      result: audit.result,

      observation: audit.observation,

      createdBy: audit.created_by,

      createdAt: audit.created_at,

      auditedBy: audit.audited_by,

      auditedByName: audit.audited_by_name,

      auditedAt: audit.audited_at,

      correlationId: audit.correlation_id,

      updatedAt: audit.updated_at,

      driveSupportStatus:
        audit.drive_support_status,

      driveSupportLastCheckedAt:
        audit.drive_support_last_checked_at,

      evidence: evidence.rows.map((item) => ({
        id: item.id,

        billingAuditId: item.billing_audit_id,

        driveFileId: item.drive_file_id,

        fileName: item.file_name,

        mimeType: item.mime_type,

        webViewLink: item.web_view_link,

        sizeBytes: item.size_bytes === null ? null : Number(item.size_bytes),

        md5Checksum: item.md5_checksum,

        driveModifiedAt: item.drive_modified_at,

        discoveredAt: item.discovered_at,

        createdAt: item.created_at,
      })),
    };
  }

  private async writeAuditEvent(
    tx: Tx,
    scope: Scope,
    action: string,
    resourceId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ) {
    await tx.execute(sql`
      insert into audit_events (
        actor_type,
        actor_id,
        organization_id,
        action,
        resource_type,
        resource_id,
        before,
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
        'authorization_billing_audit',
        ${resourceId},
        ${before === null ? null : JSON.stringify(before)}::jsonb,
        ${JSON.stringify(after)}::jsonb,
        ${scope.correlationId},
        ${scope.correlationId},
        'SUCCESS'
      )
    `);
  }
}
