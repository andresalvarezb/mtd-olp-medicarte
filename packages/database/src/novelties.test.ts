import { describe, expect, it } from 'vitest';
import {
  itemNoveltyLogicalKey,
  tariffNoveltyLogicalKey,
  tariffNoveltyLogicalKeyPrefix,
} from './novelties';

describe('novelty logical keys', () => {
  it('is deterministic for item causals and distinguishes fields', () => {
    expect(
      itemNoveltyLogicalKey({
        authorizationItemId: 'item-1',
        code: 'ANX_001',
        stage: 'TARIFF',
        field: 'CODIGO_PRODUCTO',
      }),
    ).toBe('ITEM|item-1|ANX_001|TARIFF|CODIGO_PRODUCTO');
    expect(
      itemNoveltyLogicalKey({
        authorizationItemId: 'item-1',
        code: 'ANX_001',
        stage: 'TARIFF',
        field: 'OTHER',
      }),
    ).not.toBe('ITEM|item-1|ANX_001|TARIFF|CODIGO_PRODUCTO');
  });

  it('is deterministic for tariff causals and supports an exact business prefix', () => {
    const input = {
      organizationId: 'org-1',
      normalizedProductCode: 'MED-001',
      code: 'ANX_001',
      stage: 'TARIFF',
      field: null,
    };
    expect(tariffNoveltyLogicalKey(input)).toBe('TARIFF|org-1|MED-001|ANX_001|TARIFF|-');
    expect(tariffNoveltyLogicalKeyPrefix(input)).toBe('TARIFF|org-1|MED-001|');
  });
});
