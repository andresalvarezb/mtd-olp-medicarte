import { randomUUID } from 'node:crypto';
import { loginDev } from './helpers/auth';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const mtdOrganizationId = '10000000-0000-4000-8000-000000000001';
const olpOrganizationId = '10000000-0000-4000-8000-000000000003';
const medicarteOrganizationId = '10000000-0000-4000-8000-000000000004';
const adminUserId = '40000000-0000-4000-8000-000000000001';

const database = new Client({ connectionString: databaseUrl });
let olpToken: string;
let medicarteToken: string;
let adminToken: string;

async function login(username: string, password: string): Promise<string> {
  return loginDev(username, password); // ADR-026
}

async function seedItem(
  label: string,
  options: { withDates?: boolean; auditStatus?: string } = {},
): Promise<{ id: string; authorization: string; medication: string; version: number }> {
  const batchId = randomUUID();
  const authorization = `AUTH-F6-${label}-${randomUUID()}`.toUpperCase();
  const medication = `MED-F6-${label}`.toUpperCase();
  const itemId = randomUUID();
  const withDates = options.withDates ?? true;
  const auditStatus = options.auditStatus ?? (withDates ? 'READY' : 'NOT_STARTED');
  await database.query(
    `insert into import_batches
       (id, organization_id, created_by, original_filename, mime_type, size_bytes, sha256,
        processor_version, status, total_rows, valid_rows, confirmed_rows)
     values ($1, $2, $3, 'phase6.csv', 'text/csv', 1, $4, 1, 'COMPLETED', 1, 1, 1)`,
    [batchId, mtdOrganizationId, adminUserId, randomUUID().replaceAll('-', '').padEnd(64, '0')],
  );
  await database.query(
    `insert into authorization_items
       (id, numero_autorizacion, codigo_medicamento, authorization_key, source_data,
        source_status_normalized, source_prescripcion_normalized, no_prescripcion,
        enablement_status, coverage_type, direction_status, operation_status,
        coverage_rule_version, lugar_dispensacion, fecha_dispensacion, fecha_aplicacion,
        audit_status, operational_version, created_from_batch_id)
     values ($1, $2, $3, $4, '{}'::jsonb, '5', '', '', 'ENABLED', 'PBS', 'NOT_APPLICABLE',
             $5, 'F2-COVERAGE-2', $6, $7, $8, $9, $10, $11)`,
    [
      itemId,
      authorization,
      medication,
      `${authorization}:${medication}`,
      withDates ? 'DISPENSATION_REPORTED' : 'READY_TO_DISPENSE',
      withDates ? 'Sede F6' : null,
      withDates ? '2026-08-29' : null,
      withDates ? '2026-08-30' : null,
      auditStatus,
      withDates ? 3 : 1,
      batchId,
    ],
  );
  await database.query(
    `insert into authorization_item_organizations (authorization_item_id, organization_id)
     values ($1, $2), ($1, $3)`,
    [itemId, olpOrganizationId, medicarteOrganizationId],
  );
  return { id: itemId, authorization, medication, version: 1 };
}

function auditPost(
  token: string,
  organizationId: string,
  path: string,
  body: unknown,
  idempotencyKey = randomUUID(),
): Promise<Response> {
  return fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': organizationId,
      'idempotency-key': idempotencyKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('Gate F6', () => {
  beforeAll(async () => {
    await database.connect();
    [olpToken, medicarteToken, adminToken] = await Promise.all([
      login('olp-operator', 'olp-operator'),
      login('medicarte-operator', 'medicarte-operator'),
      login('foundation-admin', 'foundation-admin'),
    ]);
  });

  afterAll(async () => database.end());

  it('ambas fechas habilitan revision pero jamas aprueban automaticamente', async () => {
    const item = await seedItem('READY-DERIVATION');
    const row = await database.query<{ audit_status: string; operation_status: string }>(
      `select audit_status, operation_status from authorization_items where id = $1`,
      [item.id],
    );
    expect(row.rows[0]).toMatchObject({
      audit_status: 'READY',
      operation_status: 'DISPENSATION_REPORTED',
    });

    const blocked = await seedItem('NOT-READY', { withDates: false });
    const attempt = await auditPost(
      adminToken,
      mtdOrganizationId,
      `/api/v1/authorization-items/${blocked.id}/audit-reviews`,
      { expectedVersion: blocked.version },
    );
    expect(attempt.status).toBe(409);
    const error = (await attempt.json()) as { code: string };
    expect(error.code).toBe('INVALID_AUDIT_TRANSITION');
  });

  it('ejecuta hallazgos, rechazo, revision posterior y aprobacion con trazabilidad', async () => {
    const item = await seedItem('FLOW');

    const started = await auditPost(
      adminToken,
      mtdOrganizationId,
      `/api/v1/authorization-items/${item.id}/audit-reviews`,
      { expectedVersion: item.version },
    );
    expect(started.status).toBe(201);
    const startBody = (await started.json()) as {
      review: { id: string; reviewNumber: number; status: string };
      item: { auditStatus: string; version: number };
    };
    expect(startBody.review).toMatchObject({ reviewNumber: 1, status: 'IN_REVIEW' });
    expect(startBody.item.auditStatus).toBe('IN_REVIEW');

    const finding = await auditPost(
      adminToken,
      mtdOrganizationId,
      `/api/v1/audit-reviews/${startBody.review.id}/findings`,
      { code: 'SUPPORT_INCOMPLETE', description: 'Falta soporte de aplicación en Drive.' },
    );
    expect(finding.status).toBe(201);
    expect(await finding.json()).toMatchObject({ code: 'SUPPORT_INCOMPLETE' });

    const rejectWithoutObservations = await auditPost(
      adminToken,
      mtdOrganizationId,
      `/api/v1/audit-reviews/${startBody.review.id}/reject`,
      { expectedVersion: startBody.item.version, observations: ' ' },
    );
    expect(rejectWithoutObservations.status).toBe(400);

    const rejected = await auditPost(
      adminToken,
      mtdOrganizationId,
      `/api/v1/audit-reviews/${startBody.review.id}/reject`,
      {
        expectedVersion: startBody.item.version,
        observations: 'Subsanar soportes en Drive corporativo.',
      },
    );
    expect(rejected.status).toBe(200);
    const rejectBody = (await rejected.json()) as {
      review: { status: string; observations: string };
      item: {
        auditStatus: string;
        operationStatus: string;
        admissionStatus: string;
        version: number;
      };
    };
    expect(rejectBody.review.status).toBe('REJECTED');
    expect(rejectBody.item).toMatchObject({
      auditStatus: 'REJECTED',
      operationStatus: 'DISPENSATION_REPORTED',
      admissionStatus: 'NOT_READY',
    });

    const second = await auditPost(
      adminToken,
      mtdOrganizationId,
      `/api/v1/authorization-items/${item.id}/audit-reviews`,
      { expectedVersion: rejectBody.item.version },
    );
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as {
      review: { id: string; reviewNumber: number };
      item: { version: number };
    };
    expect(secondBody.review.reviewNumber).toBe(2);

    const versionConflict = await auditPost(
      adminToken,
      mtdOrganizationId,
      `/api/v1/audit-reviews/${secondBody.review.id}/approve`,
      { expectedVersion: 999 },
    );
    expect(versionConflict.status).toBe(409);

    const replayKey = randomUUID();
    const approved = await auditPost(
      adminToken,
      mtdOrganizationId,
      `/api/v1/audit-reviews/${secondBody.review.id}/approve`,
      { expectedVersion: secondBody.item.version, observations: 'Soportes completos.' },
      replayKey,
    );
    expect(approved.status).toBe(200);
    const approveBody = (await approved.json()) as {
      review: { id: string };
      item: { auditStatus: string; operationStatus: string; admissionStatus: string };
    };
    expect(approveBody.item).toMatchObject({
      auditStatus: 'APPROVED',
      operationStatus: 'DISPENSED',
      admissionStatus: 'READY',
    });

    const replay = await auditPost(
      adminToken,
      mtdOrganizationId,
      `/api/v1/audit-reviews/${secondBody.review.id}/approve`,
      { expectedVersion: secondBody.item.version, observations: 'Soportes completos.' },
      replayKey,
    );
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { review: { id: string } }).review.id).toBe(
      approveBody.review.id,
    );

    const decidedTwice = await auditPost(
      adminToken,
      mtdOrganizationId,
      `/api/v1/audit-reviews/${secondBody.review.id}/approve`,
      { expectedVersion: secondBody.item.version },
    );
    expect(decidedTwice.status).toBe(409);

    const persisted = await database.query<{
      audit_status: string;
      operation_status: string;
      admission_status: string;
    }>(
      `select audit_status, operation_status, admission_status from authorization_items where id = $1`,
      [item.id],
    );
    expect(persisted.rows[0]).toMatchObject({
      audit_status: 'APPROVED',
      operation_status: 'DISPENSED',
      admission_status: 'READY',
    });

    const events = await database.query<{
      action: string;
      actor_id: string;
      organization_id: string;
    }>(
      `select action, actor_id, organization_id from audit_events
       where resource_type = 'authorization_item' and resource_id = $1
         and action in ('AUDIT_REVIEW_STARTED', 'AUDIT_FINDING_RECORDED', 'AUDIT_REJECTED', 'AUDIT_APPROVED')
       order by occurred_at`,
      [item.id],
    );
    expect(events.rows.map((row) => row.action)).toEqual([
      'AUDIT_REVIEW_STARTED',
      'AUDIT_FINDING_RECORDED',
      'AUDIT_REJECTED',
      'AUDIT_REVIEW_STARTED',
      'AUDIT_APPROVED',
    ]);
    expect(
      events.rows.every(
        (row) => row.actor_id === adminUserId && row.organization_id === mtdOrganizationId,
      ),
    ).toBe(true);

    const reviews = await database.query<{
      review_number: number;
      status: string;
      decided_by: string | null;
    }>(
      `select review_number, status, decided_by from audit_reviews
       where authorization_item_id = $1 order by review_number`,
      [item.id],
    );
    expect(reviews.rows).toEqual([
      { review_number: 1, status: 'REJECTED', decided_by: adminUserId },
      { review_number: 2, status: 'APPROVED', decided_by: adminUserId },
    ]);
  });

  it('rechaza actores no auditores y organizaciones cruzadas', async () => {
    const item = await seedItem('SECURITY');
    const olpAttempt = await auditPost(
      olpToken,
      olpOrganizationId,
      `/api/v1/authorization-items/${item.id}/audit-reviews`,
      { expectedVersion: item.version },
    );
    expect(olpAttempt.status).toBe(403);

    const medicarteAttempt = await auditPost(
      medicarteToken,
      medicarteOrganizationId,
      `/api/v1/authorization-items/${item.id}/audit-reviews`,
      { expectedVersion: item.version },
    );
    expect(medicarteAttempt.status).toBe(403);

    const reviews = await database.query<{ count: string }>(
      `select count(*)::text as count from audit_reviews where authorization_item_id = $1`,
      [item.id],
    );
    expect(reviews.rows[0]?.count).toBe('0');
  });

  it('consolida solo aprobados, audita la exportacion y no persiste copia', async () => {
    const approved = await seedItem('CONSOLIDATED');
    const rejected = await seedItem('EXCLUDED');
    await auditPost(
      adminToken,
      mtdOrganizationId,
      `/api/v1/authorization-items/${approved.id}/audit-reviews`,
      { expectedVersion: approved.version },
    );
    const review = await database.query<{ id: string }>(
      `select id from audit_reviews where authorization_item_id = $1`,
      [approved.id],
    );
    const itemRow = await database.query<{ version: number }>(
      `select version from authorization_items where id = $1`,
      [approved.id],
    );
    const approval = await auditPost(
      adminToken,
      mtdOrganizationId,
      `/api/v1/audit-reviews/${review.rows[0]!.id}/approve`,
      { expectedVersion: itemRow.rows[0]!.version },
    );
    expect(approval.status).toBe(200);

    const csv = await fetch(`${apiUrl}/api/v1/exports/authorization-items.csv`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    expect(csv.status).toBe(200);
    const csvText = await csv.text();
    expect(csvText).toContain(approved.authorization);
    expect(csvText).not.toContain(rejected.authorization);
    expect(csvText).toContain('admission_status');

    const xlsx = await fetch(`${apiUrl}/api/v1/exports/authorization-items.xlsx?coverageType=PBS`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get('content-type')).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const denied = await fetch(`${apiUrl}/api/v1/exports/authorization-items.csv`, {
      headers: { authorization: `Bearer ${olpToken}`, 'x-organization-id': olpOrganizationId },
    });
    expect(denied.status).toBe(403);

    const exportAudit = await database.query<{ result: string }>(
      `select result from audit_events
       where action = 'CONSOLIDATED_EXPORT_CREATED' and actor_id = $1
       order by occurred_at desc limit 1`,
      [adminUserId],
    );
    expect(exportAudit.rows.length).toBeGreaterThan(0);
  });

  it('expone indicadores operativos derivados por alcance', async () => {
    const response = await fetch(`${apiUrl}/api/v1/indicators`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    expect(response.status).toBe(200);
    const indicators = (await response.json()) as {
      byAuditStatus: Record<string, number>;
      approvedForAdmission: number;
      readyForReview: number;
    };
    expect(indicators.byAuditStatus.APPROVED).toBeGreaterThanOrEqual(1);
    expect(indicators.approvedForAdmission).toBeGreaterThanOrEqual(1);
  });

  it('publica el contrato OpenAPI sin flujos de soportes', async () => {
    const openApi = await fetch(`${apiUrl}/api/v1/openapi.json`);
    expect(openApi.status).toBe(200);
    const document = (await openApi.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(document.paths)).toContain('/api/v1/authorization-items/{id}/audit-reviews');
    expect(Object.keys(document.paths)).toContain('/api/v1/audit-reviews/{id}/approve');
    expect(Object.keys(document.paths)).toContain('/api/v1/exports/authorization-items.csv');
    expect(
      Object.keys(document.paths).some((path) => /attachment|support|drive-file/i.test(path)),
    ).toBe(false);
  });
});
