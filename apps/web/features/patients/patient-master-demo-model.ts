export type PatientMasterDemoAuthorization = Readonly<{
  id: string;
  authorizationNumber: string;
  organizationLabel: string;
  pointLabel: string;
  linked: boolean;
}>;

export type PatientMasterDemoRecord = Readonly<{
  id: string;
  syntheticLabel: string;
  localIdentityStatus: 'VERIFIED_LOCAL' | 'INCOMPLETE' | 'AMBIGUOUS';
  localIdentity: Readonly<{ type: string; value: string }> | null;
  historicalEvidence: ReadonlyArray<Readonly<{ source: string; value: string }>>;
  mtdomStatus: 'PENDING' | 'MATCHED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'ERROR';
  mtdomUpdatedAt: string | null;
  reconciliationReason: string | null;
  authorizations: ReadonlyArray<PatientMasterDemoAuthorization>;
}>;

export type PatientMasterDemoState = 'loading' | 'denied' | 'error' | 'empty' | 'ready';

export const PATIENT_MASTER_DEMO_FIXTURES: ReadonlyArray<PatientMasterDemoRecord> = [
  {
    id: 'demo-patient-001',
    syntheticLabel: 'Paciente sintético A-001',
    localIdentityStatus: 'VERIFIED_LOCAL',
    localIdentity: { type: 'SINTETICO', value: 'TEST-ID-001' },
    historicalEvidence: [
      { source: 'Autorización sintética AUT-DEMO-001', value: 'SINTETICO / TEST-ID-001' },
    ],
    mtdomStatus: 'NOT_FOUND',
    mtdomUpdatedAt: '2026-01-15T10:00:00.000Z',
    reconciliationReason: 'MTDOM_NOT_FOUND',
    authorizations: [
      {
        id: 'demo-authorization-001',
        authorizationNumber: 'AUT-DEMO-001',
        organizationLabel: 'Organización de prueba',
        pointLabel: 'Punto de prueba A',
        linked: true,
      },
      {
        id: 'demo-authorization-002',
        authorizationNumber: 'AUT-DEMO-002',
        organizationLabel: 'Organización de prueba',
        pointLabel: 'Punto de prueba A',
        linked: false,
      },
    ],
  },
  {
    id: 'demo-patient-002',
    syntheticLabel: 'Paciente sintético B-002',
    localIdentityStatus: 'AMBIGUOUS',
    localIdentity: null,
    historicalEvidence: [
      { source: 'Autorización sintética AUT-DEMO-003', value: 'Identidad contradictoria (demo)' },
    ],
    mtdomStatus: 'AMBIGUOUS',
    mtdomUpdatedAt: null,
    reconciliationReason: 'LOCAL_IDENTITY_CONFLICT',
    authorizations: [
      {
        id: 'demo-authorization-003',
        authorizationNumber: 'AUT-DEMO-003',
        organizationLabel: 'Organización de prueba',
        pointLabel: 'Punto de prueba B',
        linked: false,
      },
    ],
  },
  {
    id: 'demo-patient-003',
    syntheticLabel: 'Paciente sintético C-003',
    localIdentityStatus: 'INCOMPLETE',
    localIdentity: null,
    historicalEvidence: [
      { source: 'Autorización sintética AUT-DEMO-004', value: 'Falta el tipo documental (demo)' },
    ],
    mtdomStatus: 'PENDING',
    mtdomUpdatedAt: null,
    reconciliationReason: 'LOCAL_IDENTITY_MISSING',
    authorizations: [
      {
        id: 'demo-authorization-004',
        authorizationNumber: 'AUT-DEMO-004',
        organizationLabel: 'Organización de prueba',
        pointLabel: 'Punto de prueba A',
        linked: false,
      },
    ],
  },
];

export function filterPatientMasterDemoRecords(
  records: ReadonlyArray<PatientMasterDemoRecord>,
  query: string,
  identityStatus: PatientMasterDemoRecord['localIdentityStatus'] | 'ALL',
): PatientMasterDemoRecord[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('es');
  return records.filter((patient) => {
    const matchesStatus =
      identityStatus === 'ALL' || patient.localIdentityStatus === identityStatus;
    const matchesQuery =
      normalizedQuery === '' ||
      [
        patient.syntheticLabel,
        patient.id,
        patient.mtdomStatus,
        ...patient.authorizations.map((item) => item.authorizationNumber),
      ].some((value) => value.toLocaleLowerCase('es').includes(normalizedQuery));
    return matchesStatus && matchesQuery;
  });
}

export function paginatePatientMasterDemoRecords<T>(
  items: ReadonlyArray<T>,
  page: number,
  pageSize: number,
): Readonly<{ items: T[]; page: number; pageCount: number; total: number }> {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const safePage = Math.min(Math.max(1, Math.floor(page)), pageCount);
  const start = (safePage - 1) * safePageSize;
  return {
    items: items.slice(start, start + safePageSize),
    page: safePage,
    pageCount,
    total: items.length,
  };
}
