import { describe, expect, it } from 'vitest';
import { ALL_NAV_ITEMS } from './nav-config';

describe('RBAC navigation', () => {
  it('does not expose the executive summary to OLP or Medicarte', () => {
    expect(ALL_NAV_ITEMS.find((item) => item.view === 'dashboard')?.roles).not.toContain('OLP');
    expect(ALL_NAV_ITEMS.find((item) => item.view === 'dashboard')?.roles).not.toContain(
      'MEDICARTE',
    );
    expect(ALL_NAV_ITEMS.find((item) => item.view === 'dashboard')?.permission).toBe(
      'view.dashboard',
    );
  });
});
