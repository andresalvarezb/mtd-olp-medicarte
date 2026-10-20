import {
  ForbiddenException,
} from '@nestjs/common';

import { describe, expect, it, vi } from 'vitest';

import type { Scope } from '../common/request-scope';

import { AnalyticsRepository } from './analytics.repository';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';

const organizationId =
  '10000000-0000-4000-8000-000000000001';

const userId =
  '40000000-0000-4000-8000-000000000001';

const correlationId =
  '50000000-0000-4000-8000-000000000001';

const mtdScope = {
  organizationId,
  organizationCode: 'MTD',
  userId,
  correlationId,
} as Scope;

describe('Dashboard financiero y auditoría', () => {
  it('agrega los datos por autorización sin multiplicar eventos', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        authorization_total: 12,
        collected_count: 4,
        not_collected_count: 3,
        not_recorded_count: 5,
        collected_amount_cop: '90500.50',
        audit_not_started_count: 2,
        audit_pending_count: 3,
        audit_complies_count: 5,
        audit_not_complies_count: 2,
        audit_inconsistent_count: 0,
        fulfilled_authorizations_count: 7,
      }],
    });

    const repository = new AnalyticsRepository({
      pool: { query },
    } as never);

    const result = await repository.financialAuditDashboard();

    expect(result.authorizationTotal).toBe(12);
    expect(result.moderatorFee).toEqual({
      collectedCount: 4,
      notCollectedCount: 3,
      notRecordedCount: 5,
      collectedAmountCop: '90500.50',
    });

    expect(result.billingAudit.compliesCount).toBe(5);
    expect(result.billingAudit.doesNotComplyCount).toBe(2);
    expect(result.fulfillment.withFulfillmentCount).toBe(7);

    const sql = String(query.mock.calls[0]?.[0]);

    expect(sql).toContain('authorization_moderator_fee_events event');
    expect(sql).toContain('authorization_billing_audits ba');
    expect(sql).toContain('authorization_fulfillments af');
    expect(sql).toContain('from patient_applications pa');
    expect(sql).toContain("pa.status = 'CONFIRMED'");
    expect(sql).toContain('from patient_applications pa');
    expect(sql).toContain("pa.status = 'CONFIRMED'");

    expect(sql).toMatch(
      /order by event\.version desc\s+limit 1/
    );

    expect(sql).toMatch(
      /order by ba\.created_at desc, ba\.id desc\s+limit 1/
    );

    expect(sql).toContain('left join lateral');

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('responde valores cero si no existen autorizaciones', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        authorization_total: 0,
        collected_count: 0,
        not_collected_count: 0,
        not_recorded_count: 0,
        collected_amount_cop: '0.00',
      }],
    });

    const repository = new AnalyticsRepository({
      pool: { query },
    } as never);

    const result = await repository.financialAuditDashboard();

    expect(result.authorizationTotal).toBe(0);
    expect(result.moderatorFee.collectedAmountCop).toBe('0.00');
    expect(result.billingAudit.pendingCount).toBe(0);
  });

  it('impide consultar el resumen financiero desde MEDICARTE', async () => {
    const financialAuditDashboard = vi.fn();

    const service = new AnalyticsService({
      financialAuditDashboard,
    } as never);

    await expect(
      service.financialAuditDashboard({
        ...mtdScope,
        organizationCode: 'MEDICARTE',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(financialAuditDashboard).not.toHaveBeenCalled();
  });

  it('permite la consulta MTD', async () => {
    const financialAuditDashboard = vi.fn()
      .mockResolvedValue({ authorizationTotal: 12 });

    const service = new AnalyticsService({
      financialAuditDashboard,
    } as never);

    const result = await service.financialAuditDashboard(mtdScope);

    expect(result.authorizationTotal).toBe(12);
    expect(financialAuditDashboard).toHaveBeenCalledTimes(1);
  });

  it('exige los permisos de economía y auditoría', async () => {
    const payload = { authorizationTotal: 12 };

    const analytics = {
      financialAuditDashboard: vi.fn().mockResolvedValue(payload),
    };

    const profile = {
      id: userId,
      organizations: [{
        id: organizationId,
        code: 'MTD',
        roles: ['MTD_ADMIN'],
        isSystemAdmin: true,
        permissions: [
          'analytics.economics.read',
          'application_audits.read',
        ],
      }],
    };

    const access = {
      requirePermission: vi.fn().mockResolvedValue(profile),
    };

    const controller = new AnalyticsController(
      analytics as never,
      access as never,
      {} as never,
    );

    const result = await controller.financialAuditDashboard(
      organizationId,
      {
        auth: { sub: userId },
        correlationId,
      } as never,
    );

    expect(result).toEqual(payload);

    expect(access.requirePermission).toHaveBeenNthCalledWith(
      1,
      userId,
      organizationId,
      'analytics.economics.read',
    );

    expect(access.requirePermission).toHaveBeenNthCalledWith(
      2,
      userId,
      organizationId,
      'application_audits.read',
    );

    expect(analytics.financialAuditDashboard).toHaveBeenCalledTimes(1);
  });

  it('no ejecuta analytics si falta autorización de auditoría', async () => {
    const analytics = {
      financialAuditDashboard: vi.fn(),
    };

    const access = {
      requirePermission: vi.fn()
        .mockResolvedValueOnce({
          id: userId,
          organizations: [],
        })
        .mockRejectedValueOnce(new ForbiddenException()),
    };

    const controller = new AnalyticsController(
      analytics as never,
      access as never,
      {} as never,
    );

    await expect(
      controller.financialAuditDashboard(
        organizationId,
        {
          auth: { sub: userId },
          correlationId,
        } as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(analytics.financialAuditDashboard).not.toHaveBeenCalled();
  });
});
