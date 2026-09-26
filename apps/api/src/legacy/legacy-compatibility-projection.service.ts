import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { auditCompatibilityProjection } from '@authorization/domain';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;
export type LegacyProjectionTx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];

export type AuditCompatibilityDrift = Readonly<{
  authorizationItemId: string;
  modernAuditStatus: string;
  legacyAuditStatus: string;
  admissionStatus: string;
}>;

/**
 * ESP-016 unidirectional compatibility writer.
 * NEW DOMAIN → authorization_items.audit_status (and READY admission when required).
 * Never reads legacy columns to decide modern state.
 */
@Injectable()
export class LegacyCompatibilityProjectionService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async projectAuditDecision(
    tx: LegacyProjectionTx,
    input: {
      authorizationItemId: string;
      modernStatus: 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
      actorUserId: string;
    },
  ): Promise<void> {
    const projection = auditCompatibilityProjection(input.modernStatus);
    if (projection.setAdmissionReady) {
      await tx.execute(sql`
        update authorization_items
        set audit_status = ${projection.auditStatus},
            admission_status = 'READY',
            version = version + 1,
            updated_by = ${input.actorUserId},
            updated_at = now()
        where id = ${input.authorizationItemId}
      `);
      return;
    }
    if (input.modernStatus === 'REJECTED') {
      await tx.execute(sql`
        update authorization_items
        set audit_status = ${projection.auditStatus},
            version = version + 1,
            updated_by = ${input.actorUserId},
            updated_at = now()
        where id = ${input.authorizationItemId} and admission_status <> 'READY'
      `);
      return;
    }
    await tx.execute(sql`
      update authorization_items
      set audit_status = ${projection.auditStatus},
          version = version + 1,
          updated_by = ${input.actorUserId},
          updated_at = now()
      where id = ${input.authorizationItemId}
    `);
  }

  async projectFulfillmentAuditDecision(
    tx: LegacyProjectionTx,
    input: {
      authorizationItemId: string;
      modernStatus: 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
      actorUserId: string;
    },
  ): Promise<void> {
    const projection = auditCompatibilityProjection(input.modernStatus);

    /*
     * El fulfillment moderno tiene su propia auditoría.
     * audit_status se mantiene únicamente como proyección de compatibilidad.
     *
     * A diferencia de patient_application_audits, esta aprobación NO fuerza
     * admission_status=READY: admisión sigue siendo un downstream separado.
     */
    await tx.execute(sql`
      update authorization_items
      set audit_status = ${projection.auditStatus},
          version = version + 1,
          updated_by = ${input.actorUserId},
          updated_at = now()
      where id = ${input.authorizationItemId}
    `);
  }

  async findAuditCompatibilityDrift(): Promise<AuditCompatibilityDrift[]> {
    const result = await this.database.db.execute<AuditCompatibilityDrift>(sql`
      select paa.authorization_item_id as "authorizationItemId",
             paa.status as "modernAuditStatus",
             ai.audit_status as "legacyAuditStatus",
             ai.admission_status as "admissionStatus"
        from patient_application_audits paa
        join authorization_items ai on ai.id = paa.authorization_item_id
       where (paa.status = 'APPROVED'
              and (ai.audit_status <> 'APPROVED' or ai.admission_status <> 'READY'))
          or (paa.status = 'REJECTED' and ai.audit_status <> 'REJECTED')
          or (paa.status = 'IN_REVIEW' and ai.audit_status <> 'IN_REVIEW')
    `);
    return result.rows;
  }
}
