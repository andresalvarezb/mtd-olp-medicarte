import { describe, expect, it } from 'vitest';
import { ALL_NAV_ITEMS, ROLES } from './nav-config';

describe('clean navigation', () => {
  it('exposes foundation, planning periods, patient scheduling and user administration', () => {
    expect(ALL_NAV_ITEMS.map((item) => item.view)).toEqual([
      'foundation',
      'planningPeriods',
      'patientScheduling',
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

  it('exposes patient scheduling to Medicarte and read roles but never to OLP', () => {
    const scheduling = ALL_NAV_ITEMS.find((item) => item.view === 'patientScheduling');
    expect(scheduling?.permission).toBe('patient_schedules.read');
    expect(scheduling?.roles).toContain('MEDICARTE');
    expect(scheduling?.roles).toContain('READ_ONLY');
    expect(scheduling?.roles).not.toContain('OLP');
    expect(scheduling?.roles).not.toContain('COMPENSAR');
  });
});
