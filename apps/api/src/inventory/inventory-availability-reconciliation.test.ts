import { afterEach, describe, expect, it, vi } from 'vitest';
import type { createDatabase } from '@authorization/database';
import type { Scope } from '../common/request-scope';
import type { AccessService } from '../identity/access.service';
import { InventoryAvailabilityRepository } from './inventory-availability.repository';
import { InventoryAvailabilityReconciliationService } from './inventory-availability-reconciliation.service';
import {
  automaticReconciliationErrorCode,
  automaticReconciliationOptionsSchema,
  automaticReconciliationRequestSchema,
  parseAutomaticReconciliationSchedule,
} from './inventory-availability-reconciliation.contract';

const actor = {
  userId: '40000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000001',
  correlationId: '60000000-0000-4000-8000-000000000001',
};
const scope: Scope = {
  ...actor, organizationCode: 'MTD', readSensitive: false,
  isFoundationAdmin: true, canCrossOrganizationOperationalExport: false, pointAccessKind: 'global',
};
function profile(admin = true) {
  return {
    id: actor.userId,
    organizations: [{
      id: actor.organizationId, code: 'MTD', roles: admin ? ['MTD_ADMIN'] : ['MTD_GENERAL'],
      isSystemAdmin: admin, permissions: ['inventory.allocate'],
    }],
  };
}
function fixture(admin = true) {
  const list = vi.fn().mockResolvedValue({ commercialCodes: ['P-1'], hasMore: false, nextCursor: null });
  const execute = vi.fn().mockResolvedValue({ status: 'PREVIEWED', result: {
    assignedQuantity: 0, assignedAuthorizationKeys: [], unmatchedStock: [], plannedQuantity: 6,
  } });
  const permission = vi.fn().mockResolvedValue(profile(admin));
  const repository = {
    listAutomaticReconciliationProducts: list, reconcileAutomaticProduct: execute,
  } as unknown as InventoryAvailabilityRepository;
  const access = { requirePermission: permission } as unknown as AccessService;
  const service = new InventoryAvailabilityReconciliationService(repository, access);
  return { service, list, execute, permission };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('automatic availability reconciliation', () => {
  it('defaults to simulation and requires explicit execution acknowledgement', () => {
    expect(automaticReconciliationRequestSchema.parse({})).toMatchObject({ dryRun: true, limit: 1 });
    expect(() => automaticReconciliationRequestSchema.parse({ dryRun: false })).toThrow();
    expect(automaticReconciliationRequestSchema.parse({
      dryRun: false, confirm: 'ASSIGN_AVAILABLE_STOCK',
    }).dryRun).toBe(false);
    expect(() => automaticReconciliationRequestSchema.parse({ dryRun: 'false' })).toThrow();
  });

  it('does not silently ignore malformed filters or an unbounded page size', () => {
    expect(() => automaticReconciliationOptionsSchema.parse({ limit: 1000 })).toThrow();
    expect(() => automaticReconciliationOptionsSchema.parse({ commercialCodes: [] })).toThrow();
    expect(() => automaticReconciliationOptionsSchema.parse({ force: true })).toThrow();
  });

  it('passes preview mode and preserves the keyset cursor', async () => {
    const f = fixture();
    f.list.mockResolvedValue({ commercialCodes: ['P-1'], hasMore: true, nextCursor: 'P-1' });
    const result = await f.service.runPage(actor, { cursor: 'P-0' });
    expect(result).toMatchObject({ dryRun: true, assignedQuantity: 0, plannedQuantity: 6,
      hasMore: true, nextCursor: 'P-1', failed: 0 });
    expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ isFoundationAdmin: true }),
      'P-1', expect.objectContaining({ dryRun: true, cursor: 'P-0', limit: 1 }));
    expect(f.permission).toHaveBeenCalledTimes(2);
  });

  it('refuses an actor without the existing MTD administrator role', async () => {
    const f = fixture(false);
    await expect(f.service.runPage(actor)).rejects.toThrow();
    expect(f.list).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('stops when current access is revoked before executing the product', async () => {
    const f = fixture();
    f.permission.mockResolvedValueOnce(profile()).mockRejectedValueOnce(new Error('Permission revoked'));
    await expect(f.service.runPage(actor, { dryRun: false })).rejects.toThrow('Permission revoked');
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('reports independent product failures without reporting them as success', async () => {
    const f = fixture();
    f.list.mockResolvedValue({ commercialCodes: ['P-1', 'P-2'], hasMore: false, nextCursor: null });
    f.execute.mockRejectedValueOnce(new Error('SQL including sensitive data')).mockResolvedValueOnce({
      status: 'ASSIGNED', result: { assignedQuantity: 6, assignedAuthorizationKeys: [], unmatchedStock: [] },
    });
    const result = await f.service.runPage(actor, { dryRun: false, limit: 2 });
    expect(result).toMatchObject({ status: 'PARTIAL_FAILURE', failed: 1, assignedQuantity: 6 });
    expect(JSON.stringify(result)).not.toContain('sensitive');
    expect(f.execute).toHaveBeenCalledTimes(2);
  });

  it('retries a transaction aborted by a deadlock and rechecks access', async () => {
    const f = fixture();
    f.execute.mockRejectedValueOnce({ cause: { code: '40P01' } });
    const result = await f.service.runPage(actor, { dryRun: false });
    expect(result.failed).toBe(0);
    expect(f.execute).toHaveBeenCalledTimes(2);
    expect(f.permission).toHaveBeenCalledTimes(3);
  });

  it('does not present a concurrently locked product as assigned', async () => {
    const f = fixture();
    f.execute.mockResolvedValue({ status: 'BUSY', result: {
      assignedQuantity: 0, assignedAuthorizationKeys: [], unmatchedStock: [],
    } });
    expect(await f.service.runPage(actor, { dryRun: false })).toMatchObject({
      status: 'BUSY', busy: 1, assignedQuantity: 0,
    });
  });

  it('requires an explicit scheduler actor and defaults to dry-run', () => {
    expect(parseAutomaticReconciliationSchedule({})).toBeUndefined();
    expect(() => parseAutomaticReconciliationSchedule({ INVENTORY_AUTO_RECONCILE_ENABLED: 'true' })).toThrow();
    expect(parseAutomaticReconciliationSchedule({
      INVENTORY_AUTO_RECONCILE_ENABLED: 'true',
      INVENTORY_AUTO_RECONCILE_ACTOR_USER_ID: actor.userId,
      INVENTORY_AUTO_RECONCILE_ORGANIZATION_ID: actor.organizationId,
    })).toMatchObject({ dryRun: true, limit: 1, intervalMs: 60000 });
  });

  it('does not start a disabled scheduler', () => {
    vi.useFakeTimers();
    vi.stubEnv('INVENTORY_AUTO_RECONCILE_ENABLED', 'false');
    const f = fixture();
    f.service.onApplicationBootstrap();
    expect(vi.getTimerCount()).toBe(0);
    expect(f.list).not.toHaveBeenCalled();
  });

  it('starts one non-overlapping sweep and cancels its timer at shutdown', async () => {
    vi.useFakeTimers();
    vi.stubEnv('INVENTORY_AUTO_RECONCILE_ENABLED', 'true');
    vi.stubEnv('INVENTORY_AUTO_RECONCILE_ACTOR_USER_ID', actor.userId);
    vi.stubEnv('INVENTORY_AUTO_RECONCILE_ORGANIZATION_ID', actor.organizationId);
    vi.stubEnv('INVENTORY_AUTO_RECONCILE_DRY_RUN', 'true');
    const f = fixture();
    f.service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    f.service.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('extracts SQLSTATE without exposing a SQL statement or parameter', () => {
    expect(automaticReconciliationErrorCode({ cause: { code: '40001', message: 'private' } })).toBe('40001');
    expect(automaticReconciliationErrorCode(new Error('private'))).toBe('AUTO_RECONCILIATION_PRODUCT_FAILED');
  });
});

describe('repository transaction boundary', () => {
  it('executes preview in a read-only transaction and does not request a write lock', async () => {
    const tx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    const transaction = vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
    const repository = new InventoryAvailabilityRepository({ db: { transaction } } as unknown as ReturnType<typeof createDatabase>);
    const assign = vi.spyOn(repository, 'assignAutomaticallyInTx').mockResolvedValue({
      assignedQuantity: 0, assignedAuthorizationKeys: [], unmatchedStock: [], plannedQuantity: 6,
    });
    const result = await repository.reconcileAutomaticProduct(scope, 'P-1', { dryRun: true, limit: 1 });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      accessMode: 'read only', isolationLevel: 'repeatable read',
    });
    expect(tx.execute).toHaveBeenCalledTimes(2);
    expect(assign).toHaveBeenCalledWith(tx, scope, 'AVAILABILITY_RECONCILIATION',
      { commercialCodes: ['P-1'] }, expect.objectContaining({ dryRun: true }));
    expect(result.status).toBe('PREVIEWED');
  });

  it('does not allocate when another reconciler owns the product lock', async () => {
    const tx = { execute: vi.fn().mockResolvedValue({ rows: [{ locked: false }] }) };
    const transaction = vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
    const repository = new InventoryAvailabilityRepository({ db: { transaction } } as unknown as ReturnType<typeof createDatabase>);
    const assign = vi.spyOn(repository, 'assignAutomaticallyInTx');
    const result = await repository.reconcileAutomaticProduct(scope, 'P-1', { dryRun: false, limit: 1 });
    expect(result).toMatchObject({ status: 'BUSY', result: { assignedQuantity: 0 } });
    expect(assign).not.toHaveBeenCalled();
  });
});
