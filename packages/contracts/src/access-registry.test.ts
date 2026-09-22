import { describe, expect, it } from 'vitest';
import {
  ACCESS_MODULE_REGISTRY,
  ACCESS_PERMISSION_LIFECYCLES,
  ACCESS_PERMISSION_REGISTRY,
  ACCESS_RETIRED_PERMISSION_CODES,
  validateAccessRegistry,
} from './access-registry';

describe('ESP-020 access registry', () => {
  it('covers every current permission exactly once', () => {
    validateAccessRegistry();
    expect(ACCESS_PERMISSION_REGISTRY).toHaveLength(80);
    expect(new Set(ACCESS_PERMISSION_REGISTRY.map((entry) => entry.permissionCode)).size).toBe(80);
    expect(new Set(ACCESS_RETIRED_PERMISSION_CODES).size).toBe(6);
  });

  it('classifies every current permission with an approved lifecycle', () => {
    for (const entry of ACCESS_PERMISSION_REGISTRY) {
      expect(ACCESS_PERMISSION_LIFECYCLES).toContain(entry.lifecycle);
      expect(entry.moduleCode).toBeTruthy();
      expect(entry.actionCode).toBeTruthy();
      expect(entry.actorBoundary).toBeTruthy();
    }
  });

  it('keeps module routes and module actions unique', () => {
    expect(new Set(ACCESS_MODULE_REGISTRY.map((module) => module.route)).size).toBe(
      ACCESS_MODULE_REGISTRY.length,
    );
    const actionKeys = ACCESS_MODULE_REGISTRY.flatMap((module) =>
      module.actions.map((action) => `${module.code}:${action.code}`),
    );
    expect(new Set(actionKeys).size).toBe(actionKeys.length);
  });
});
