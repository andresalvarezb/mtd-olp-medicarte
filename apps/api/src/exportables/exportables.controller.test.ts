import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ExportablesController } from './exportables.controller';

describe('ExportablesController purchase order export access', () => {
  it('requires operational_exports.create before invoking the export service', async () => {
    const organizationId = '11111111-1111-4111-8111-111111111111';
    const userId = '22222222-2222-4222-8222-222222222222';
    const denied = new ForbiddenException({ code: 'PERMISSION_DENIED' });
    const requirePermission = vi.fn().mockRejectedValue(denied);
    const purchaseOrderCandidates = vi.fn();
    const controller = new ExportablesController(
      { purchaseOrderCandidates } as never,
      { requirePermission } as never,
    );

    await expect(
      controller.purchaseOrderCandidates(
        organizationId,
        { auth: { sub: userId } } as never,
        {} as never,
      ),
    ).rejects.toBe(denied);

    expect(requirePermission).toHaveBeenCalledWith(
      userId,
      organizationId,
      'operational_exports.create',
    );
    expect(purchaseOrderCandidates).not.toHaveBeenCalled();
  });
});
