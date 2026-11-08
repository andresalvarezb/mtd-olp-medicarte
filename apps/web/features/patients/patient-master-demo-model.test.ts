import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  filterPatientMasterDemoRecords,
  paginatePatientMasterDemoRecords,
  PATIENT_MASTER_DEMO_FIXTURES,
} from './patient-master-demo-model';
import { PatientMasterDemoView } from './patient-master-demo-view';

describe('patient master synthetic demo model', () => {
  it('searches by authorization while preserving the supplied scope projection', () => {
    const result = filterPatientMasterDemoRecords(
      PATIENT_MASTER_DEMO_FIXTURES,
      'AUT-DEMO-002',
      'ALL',
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('demo-patient-001');
    expect(result[0]?.authorizations.map((authorization) => authorization.id)).toEqual([
      'demo-authorization-001',
      'demo-authorization-002',
    ]);
  });

  it('filters incomplete and ambiguous identities without deriving a canonical key', () => {
    const result = filterPatientMasterDemoRecords(PATIENT_MASTER_DEMO_FIXTURES, '', 'AMBIGUOUS');

    expect(result).toHaveLength(1);
    expect(result[0]?.localIdentity).toBeNull();
    expect(result[0]?.reconciliationReason).toBe('LOCAL_IDENTITY_CONFLICT');
  });

  it('paginates with stable bounds for empty, out-of-range and invalid page inputs', () => {
    expect(paginatePatientMasterDemoRecords([1, 2, 3], 2, 2)).toEqual({
      items: [3],
      page: 2,
      pageCount: 2,
      total: 3,
    });
    expect(paginatePatientMasterDemoRecords([1, 2, 3], 99, 2).page).toBe(2);
    expect(paginatePatientMasterDemoRecords([], 0, 0)).toEqual({
      items: [],
      page: 1,
      pageCount: 1,
      total: 0,
    });
  });

  it('contains only clearly marked synthetic identifiers and no personal profile fields', () => {
    const serialized = JSON.stringify(PATIENT_MASTER_DEMO_FIXTURES);

    expect(serialized).toContain('TEST-ID-001');
    expect(serialized).toContain('AUT-DEMO-');
    expect(serialized).not.toMatch(/(address|phone|email|birthDate|coordinates)/i);
    expect(serialized).not.toMatch(/\b\d{7,12}\b/);
  });

  it('renders access-denied state without rendering supplied patient data', () => {
    const html = renderToStaticMarkup(
      createElement(PatientMasterDemoView, {
        records: PATIENT_MASTER_DEMO_FIXTURES,
        state: 'denied',
      }),
    );

    expect(html).toContain('No tienes autorización');
    expect(html).not.toContain('demo-patient-001');
    expect(html).not.toContain('TEST-ID-001');
  });

  it('renders distinct source/status sections and a disabled reconciliation mutation', () => {
    const html = renderToStaticMarkup(
      createElement(PatientMasterDemoView, {
        records: PATIENT_MASTER_DEMO_FIXTURES,
        initialSelectedId: 'demo-patient-001',
      }),
    );

    expect(html).toContain('Identidad local');
    expect(html).toContain('Evidencia histórica');
    expect(html).toContain('Fuente MTDOM');
    expect(html).toContain('Histórica sin enlace');
    expect(html).toContain('disabled=""');
    expect(html).toContain('TEST-ID-001');
  });

  it('renders an empty filtered listing without patient records', () => {
    const html = renderToStaticMarkup(createElement(PatientMasterDemoView, { records: [] }));

    expect(html).toContain('Sin resultados para los filtros actuales');
    expect(html).not.toContain('AUT-DEMO-');
  });

  it.each([
    ['loading', 'Cargando pacientes'],
    ['error', 'No fue posible cargar'],
    ['empty', 'No hay pacientes dentro'],
  ] as const)('renders the %s response state', (state, message) => {
    const html = renderToStaticMarkup(
      createElement(PatientMasterDemoView, {
        records: [],
        state,
      }),
    );

    expect(html).toContain(message);
  });
});
