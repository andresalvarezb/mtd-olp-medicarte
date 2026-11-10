import { describe, expect, it, vi } from 'vitest';
import type { Scope } from '../common/request-scope';
import { AuthorizationQueryRepository } from './authorization-query.repository';

const filters = { page: 1, limit: 10 };
const scope: Scope = {
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  organizationCode: 'MEDICARTE',
  userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  readSensitive: true,
  isFoundationAdmin: false,
  canCrossOrganizationOperationalExport: false,
  pointAccessKind: 'global',
};

function repositoryWithQuery(queryRows: ReturnType<typeof vi.fn>) {
  const repository = new AuthorizationQueryRepository({
    pool: {
      totalCount: 1,
      idleCount: 1,
      waitingCount: 0,
      options: { max: 4 },
    },
  } as never);
  Object.defineProperty(repository, 'queryRows', { value: queryRows });
  Object.defineProperty(repository, 'logger', { value: { log: vi.fn(), warn: vi.fn() } });
  return repository;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe('AuthorizationQueryRepository single-flight list reads', () => {
  it('shares an identical in-flight read for the same organization and user', async () => {
    const pendingQuery = deferred<{ rows: never[] }>();
    const queryRows = vi.fn(() => pendingQuery.promise);
    const repository = repositoryWithQuery(queryRows);

    const first = repository.list(filters, scope);
    const duplicate = repository.list(filters, {
      ...scope,
      correlationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      realtimeEventIds: ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'],
    });

    expect(queryRows).toHaveBeenCalledOnce();
    pendingQuery.resolve({ rows: [] });
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { items: [], total: 0, page: 1, pageSize: 10 },
      { items: [], total: 0, page: 1, pageSize: 10 },
    ]);
  });

  it('does not share a read across users, organizations, or mutable point grants', async () => {
    const queryRows = vi.fn().mockResolvedValue({ rows: [] });
    const repository = repositoryWithQuery(queryRows);

    await Promise.all([
      repository.list(filters, scope),
      repository.list(filters, { ...scope, userId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
      repository.list(filters, { ...scope, organizationId: '99999999-9999-4999-8999-999999999999' }),
      repository.list(filters, { ...scope, pointAccessKind: 'explicit' }),
    ]);

    expect(queryRows).toHaveBeenCalledTimes(4);
  });
});
