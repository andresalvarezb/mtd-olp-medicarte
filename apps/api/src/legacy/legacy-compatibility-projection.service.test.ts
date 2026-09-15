import { describe, expect, it, vi } from 'vitest';
import { auditCompatibilityProjection } from '@authorization/domain';
import { LegacyCompatibilityProjectionService } from './legacy-compatibility-projection.service';

describe('legacy compatibility projection', () => {
  it('projects APPROVED as audit_status + admission READY in one update', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const service = new LegacyCompatibilityProjectionService({
      db: { execute },
    } as never);
    await service.projectAuditDecision({ execute } as never, {
      authorizationItemId: '10000000-0000-4000-8000-000000000001',
      modernStatus: 'APPROVED',
      actorUserId: '10000000-0000-4000-8000-000000000099',
    });
    expect(auditCompatibilityProjection('APPROVED').setAdmissionReady).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    const rendered = JSON.stringify(execute.mock.calls[0]?.[0]);
    expect(rendered).toContain('audit_status');
    expect(rendered).toContain('admission_status');
  });

  it('does not invent modern lineage from a drift query', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const service = new LegacyCompatibilityProjectionService({
      db: { execute },
    } as never);
    expect(await service.findAuditCompatibilityDrift()).toEqual([]);
  });
});
