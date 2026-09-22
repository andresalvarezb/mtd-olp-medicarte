import { describe, expect, it } from 'vitest';

import { ALL_NAV_ITEMS, NAV_SECTIONS, isNavGroup } from './nav-config';

describe('operational navigation', () => {
  const topLevel = NAV_SECTIONS[0]?.items ?? [];

  it('exposes exactly three top-level modules', () => {
    expect(topLevel.map((entry) => (isNavGroup(entry) ? entry.title : entry.title))).toEqual([
      'Dashboard',
      'Autorizaciones',
      'Inventario',
    ]);
  });

  it('splits authorizations into upload and query', () => {
    const group = topLevel.find((entry) => isNavGroup(entry) && entry.title === 'Autorizaciones');

    expect(group && isNavGroup(group) ? group.children.map((child) => child.title) : []).toEqual([
      'Cargar',
      'Consultar',
    ]);
  });

  it('splits purchase orders into list and configuration', () => {
    const group = topLevel.find((entry) => isNavGroup(entry) && entry.title === 'Inventario');

    expect(group && isNavGroup(group) ? group.children.map((child) => child.title) : []).toEqual([
      'Disponibilidad',
      'Orden de compra',
      'Anexo Tarifario',
    ]);
  });

  it('keeps authorization routes', () => {
    expect(ALL_NAV_ITEMS.find((item) => item.view === 'authorizations')).toMatchObject({
      href: '/autorizaciones',

      permission: 'authorizations.read',
    });

    expect(ALL_NAV_ITEMS.find((item) => item.view === 'authorizationQuery')).toMatchObject({
      href: '/autorizaciones/consulta',

      permission: 'authorizations.read',
    });
  });

  it('keeps purchase routes', () => {
    expect(ALL_NAV_ITEMS.find((item) => item.view === 'purchaseOrders')).toMatchObject({
      href: '/ordenes-compra',

      permission: 'purchase_orders.read',
    });

    expect(ALL_NAV_ITEMS.find((item) => item.view === 'purchaseConfiguration')).toMatchObject({
      href: '/ordenes-compra/configuracion',

      permission: 'tariff_annex.read',
    });
  });

  it('keeps configuration restricted to MTD', () => {
    expect(ALL_NAV_ITEMS.find((item) => item.view === 'purchaseConfiguration')?.roles).toEqual([
      'MTD',
    ]);
  });
  it('exposes inventory availability inside inventory', () => {
    expect(ALL_NAV_ITEMS.find((item) => item.view === 'inventoryAvailability')).toMatchObject({
      href: '/inventario/disponibilidad',
      permission: 'inventory.read',
    });
  });
});
