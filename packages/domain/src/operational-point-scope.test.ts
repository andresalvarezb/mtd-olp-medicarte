import { describe, expect, it } from 'vitest';
import {
  POINT_ACCESS_DENIED,
  canAccessPoint,
  canAccessPoints,
  isGlobalPointScope,
  isPointScopeEligibleTarget,
  isPointScopeGlobalActor,
  requiresPointGrant,
} from './operational-point-scope';

describe('ESP-015 operational point scope', () => {
  it('keeps MTD global and Medicarte operator explicit', () => {
    expect(isPointScopeGlobalActor('MTD', ['MTD_ADMIN'])).toBe(true);
    expect(isPointScopeGlobalActor('MTD', ['READ_ONLY'])).toBe(true);
    expect(requiresPointGrant('MEDICARTE', ['MEDICARTE_OPERATOR'])).toBe(true);
    expect(requiresPointGrant('OLP', ['OLP_OPERATOR'])).toBe(false);
    expect(isPointScopeEligibleTarget(['MEDICARTE_OPERATOR'])).toBe(true);
    expect(isPointScopeEligibleTarget(['MTD_ADMIN'])).toBe(false);
    expect(requiresPointGrant('MEDICARTE', ['CUSTOM_REGIONAL_123'])).toBe(true);
    expect(isPointScopeGlobalActor('MTD', ['CUSTOM_REGIONAL_123'])).toBe(true);
    expect(isPointScopeEligibleTarget(['CUSTOM_REGIONAL_123'])).toBe(true);
  });

  it('fails closed when explicit grants are empty', () => {
    const empty = { kind: 'explicit' as const, pointIds: [] };
    expect(canAccessPoint(empty, 'point-a')).toBe(false);
    expect(isGlobalPointScope(empty)).toBe(false);
  });

  it('requires every listed point for transfers', () => {
    const scope = { kind: 'explicit' as const, pointIds: ['a'] };
    expect(canAccessPoints(scope, ['a'])).toBe(true);
    expect(canAccessPoints(scope, ['a', 'b'])).toBe(false);
    expect(canAccessPoints({ kind: 'global' }, ['a', 'b'])).toBe(true);
  });

  it('exports a stable denial code', () => {
    expect(POINT_ACCESS_DENIED).toBe('POINT_ACCESS_DENIED');
  });
});
