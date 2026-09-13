import { describe, expect, it } from 'vitest';
import { ALL_NAV_ITEMS, ROLES } from './nav-config';

describe('clean navigation', () => {
  it('exposes foundation, planning periods and user administration', () => {
    expect(ALL_NAV_ITEMS.map((item) => item.view)).toEqual([
      'foundation',
      'planningPeriods',
      'admin',
    ]);
    expect(ALL_NAV_ITEMS[0]?.roles).toEqual(ROLES);
  });

  it('does not expose planning periods to OLP or Medicarte', () => {
    const periods = ALL_NAV_ITEMS.find((item) => item.view === 'planningPeriods');
    expect(periods?.permission).toBe('planning_periods.read');
    expect(periods?.roles).not.toContain('OLP');
    expect(periods?.roles).not.toContain('MEDICARTE');
  });
});
