import { describe, expect, it } from 'vitest';
import { ALL_NAV_ITEMS } from './nav-config';

describe('clean navigation', () => {
  it('keeps modules in numeric order', () => {
    const numbers = ALL_NAV_ITEMS.map((item) => Number.parseInt(item.icon, 10));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it('exposes the logistics surfaces through ESP-012', () => {
    expect(ALL_NAV_ITEMS.map((item) => item.view)).toEqual([
      'operationalIndicators',
      'planningPeriods',
      'projectedDemand',
      'purchaseOrders',
      'supplierPurchaseOrders',
      'supplierDeliveries',
      'medicarteDeliveries',
      'medicarteReceipts',
      'inventory',
      'stockTransfers',
      'patientApplications',
      'operationalOutcomes',
      'applicationAudits',
      'bulkImports',
      'operationalIntegrity',
      'admin',
      'operationalScopes',
      'roles',
    ]);
  });

  it('keeps supplier review separate from MTD management', () => {
    const supplier = ALL_NAV_ITEMS.find((item) => item.view === 'supplierPurchaseOrders');
    expect(supplier?.roles).toEqual(['OLP']);
    expect(supplier?.permission).toBe('purchase_orders.read');
  });

  it('keeps deliveries separated by OLP and Medicarte role', () => {
    expect(ALL_NAV_ITEMS.find((item) => item.view === 'supplierDeliveries')).toMatchObject({
      roles: ['OLP'],
      permission: 'supplier_deliveries.read',
    });
    expect(ALL_NAV_ITEMS.find((item) => item.view === 'medicarteDeliveries')).toMatchObject({
      roles: ['MEDICARTE'],
      permission: 'supplier_deliveries.read',
    });
  });

  it('does not expose planning periods to OLP or Medicarte', () => {
    const periods = ALL_NAV_ITEMS.find((item) => item.view === 'planningPeriods');
    expect(periods?.permission).toBe('planning_periods.read');
    expect(periods?.roles).not.toContain('OLP');
    expect(periods?.roles).not.toContain('MEDICARTE');
  });

  it('exposes projected demand to MTD and read roles but never to Medicarte or OLP', () => {
    const demand = ALL_NAV_ITEMS.find((item) => item.view === 'projectedDemand');
    expect(demand?.permission).toBe('projected_demand.read');
    expect(demand?.roles).toEqual(
      expect.arrayContaining(['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY']),
    );
    expect(demand?.roles).not.toContain('MEDICARTE');
    expect(demand?.roles).not.toContain('OLP');
  });

  it('exposes application audits to MTD read roles and never to Medicarte, OLP or Compensar', () => {
    const audits = ALL_NAV_ITEMS.find((item) => item.view === 'applicationAudits');
    expect(audits).toMatchObject({
      href: '/auditorias',
      permission: 'application_audits.read',
    });
    expect(audits?.roles).toEqual(['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY']);
    expect(audits?.roles).not.toContain('MEDICARTE');
    expect(audits?.roles).not.toContain('OLP');
    expect(audits?.roles).not.toContain('COMPENSAR');
  });

  it('exposes operational indicators to MTD read roles and never to Medicarte, OLP or Compensar', () => {
    const indicators = ALL_NAV_ITEMS.find((item) => item.view === 'operationalIndicators');
    expect(indicators).toMatchObject({
      href: '/indicadores',
      permission: 'analytics.read',
    });
    expect(indicators?.roles).toEqual(['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY']);
    expect(indicators?.roles).not.toContain('MEDICARTE');
    expect(indicators?.roles).not.toContain('OLP');
    expect(indicators?.roles).not.toContain('COMPENSAR');
  });

  it('exposes bulk imports to Medicarte and MTD, never to OLP or Compensar', () => {
    const imports = ALL_NAV_ITEMS.find((item) => item.view === 'bulkImports');
    expect(imports).toMatchObject({
      href: '/importaciones',
      permission: 'bulk_imports.read',
    });
    expect(imports?.roles).toContain('MEDICARTE');
    expect(imports?.roles).not.toContain('OLP');
    expect(imports?.roles).not.toContain('COMPENSAR');
  });

  it('exposes operational integrity to MTD read roles and never to Medicarte, OLP or Compensar', () => {
    const integrity = ALL_NAV_ITEMS.find((item) => item.view === 'operationalIntegrity');
    expect(integrity).toMatchObject({
      href: '/integridad',
      permission: 'reconciliation.read',
    });
    expect(integrity?.roles).toEqual(['MTD', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY']);
    expect(integrity?.roles).not.toContain('MEDICARTE');
    expect(integrity?.roles).not.toContain('OLP');
    expect(integrity?.roles).not.toContain('COMPENSAR');
  });
});
