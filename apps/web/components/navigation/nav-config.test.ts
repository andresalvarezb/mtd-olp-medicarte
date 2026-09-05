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

  it('ordena la operación y no muestra Notificaciones', () => {
    const operation = ALL_NAV_ITEMS
      .filter((item) => ['available', 'application', 'purchaseOrders', 'logistics'].includes(item.view))
      .map((item) => item.view);
    expect(operation).toEqual(['available', 'application', 'purchaseOrders', 'logistics']);
    expect(ALL_NAV_ITEMS.some((item) => item.title === 'Notificaciones')).toBe(false);
  });

  it('permite a READ_ONLY navegar en lectura, excepto administración y tarifas', () => {
    const readOnlyItems = ALL_NAV_ITEMS.filter((item) => item.roles.includes('READ_ONLY'));
    expect(readOnlyItems.map((item) => item.view)).toContain('dashboard');
    expect(readOnlyItems.map((item) => item.view)).toContain('authorizations');
    expect(readOnlyItems.map((item) => item.view)).toContain('purchaseOrders');
    expect(readOnlyItems.map((item) => item.view)).not.toContain('admin');
    expect(readOnlyItems.map((item) => item.view)).not.toContain('tariff');
  });
});
