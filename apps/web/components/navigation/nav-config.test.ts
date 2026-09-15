import { describe, expect, it } from 'vitest';
import { ALL_NAV_ITEMS, ROLES } from './nav-config';

describe('clean navigation', () => {
  it('exposes the logistics surfaces through ESP-012', () => {
    expect(ALL_NAV_ITEMS.map((item) => item.view)).toEqual([
      'foundation',
      'planningPeriods',
      'patientScheduling',
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
      'operationalIndicators',
      'bulkImports',
      'admin',
      'operationalScopes',
    ]);
    expect(ALL_NAV_ITEMS[0]?.roles).toEqual(ROLES);
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

  it('exposes patient scheduling to Medicarte and read roles but never to OLP', () => {
    const scheduling = ALL_NAV_ITEMS.find((item) => item.view === 'patientScheduling');
    expect(scheduling?.permission).toBe('patient_schedules.read');
    expect(scheduling?.roles).toContain('MEDICARTE');
    expect(scheduling?.roles).toContain('READ_ONLY');
    expect(scheduling?.roles).not.toContain('OLP');
    expect(scheduling?.roles).not.toContain('COMPENSAR');
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

  it('exposes operational point scopes to MTD admin and auditoria', () => {
    const scopes = ALL_NAV_ITEMS.find((item) => item.view === 'operationalScopes');
    expect(scopes).toMatchObject({
      href: '/administracion',
      permission: 'operational_scopes.read',
    });
    expect(scopes?.roles).toContain('MTD');
    expect(scopes?.roles).toContain('MTD_AUDITORIA');
    expect(scopes?.roles).not.toContain('MEDICARTE');
  });
});
