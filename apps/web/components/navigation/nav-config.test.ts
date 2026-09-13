import { describe, expect, it } from 'vitest';
import { ALL_NAV_ITEMS, ROLES } from './nav-config';

describe('clean navigation', () => {
  it('exposes only the neutral foundation and user administration', () => {
    expect(ALL_NAV_ITEMS.map((item) => item.view)).toEqual(['foundation', 'admin']);
    expect(ALL_NAV_ITEMS[0]?.roles).toEqual(ROLES);
  });
});
