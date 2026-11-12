'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  PatientMasterDetail,
  PatientMasterLiveLookupResponse,
  PatientMasterPersonalResponse,
  PatientMasterSearchResponse,
  PatientReconciliationCase,
} from '@authorization/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { useRole } from '@/components/layout/role-context';
import { ApiError } from '@/lib/api-client';
import {
  getPatientMasterDetail,
  getPatientMasterPersonalProfile,
  listPatientReconciliationCases,
  lookupPatientMaster,
  searchPatientMaster,
} from '@/lib/patient-master-api';
import styles from './patient-master-view.module.css';

const PAGE_SIZE = 25;
const IDENTIFICATION_TYPES = [
  { value: 'CC', label: 'CC · Cédula de ciudadanía' },
  { value: 'CE', label: 'CE · Cédula de extranjería' },
  { value: 'TI', label: 'TI · Tarjeta de identidad' },
  { value: 'RC', label: 'RC · Registro civil' },
  { value: 'PA', label: 'PA · Pasaporte' },
  { value: 'NIT', label: 'NIT · Identificación tributaria' },
] as const;

function safeErrorMessage(error: unknown): string {
  if (error instanceof ApiError && [403, 404].includes(error.status)) {
    return 'Acceso denegado o recurso fuera del alcance autorizado.';
  }
  return 'No fue posible consultar el maestro. Intenta de nuevo más tarde.';
}

function permissionDenied(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

function profileValue(value: string | number | boolean | null): string {
  if (value === null) return 'Sin dato reportado';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return String(value);
}

export function PatientMasterView() {
  const { me, organizationId, hasPermission } = useRole();
  const organization = me?.organizations.find((item) => item.id === organizationId);
  const isMedicarte = organization?.code === 'MEDICARTE';
  const isMtd = organization?.code === 'MTD';
  const accessiblePointIds = organization?.pointAccess.accessiblePointIds ?? [];
  const hasReadPermission = hasPermission('patient_master.read');
  const canReadReconciliation = hasPermission('patient_reconciliation.read');
  const canReadPersonal = hasPermission('patient_master.personal.read');

  const [pointId, setPointId] = useState('');
  const [identityType, setIdentityType] = useState('');
  const [identityValue, setIdentityValue] = useState('');
  const [appliedIdentity, setAppliedIdentity] = useState<{
    identificationType?: string;
    identificationValue?: string;
  }>({});
  const [page, setPage] = useState(1);
  const [list, setList] = useState<PatientMasterSearchResponse | null>(null);
  const [liveLookup, setLiveLookup] = useState<PatientMasterLiveLookupResponse | null>(null);
  const [liveLookupState, setLiveLookupState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [liveLookupError, setLiveLookupError] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'denied' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PatientMasterDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [personal, setPersonal] = useState<PatientMasterPersonalResponse | null>(null);
  const [personalError, setPersonalError] = useState<string | null>(null);
  const [cases, setCases] = useState<PatientReconciliationCase[] | null>(null);
  const [casesError, setCasesError] = useState<string | null>(null);
  const [showCases, setShowCases] = useState(false);

  useEffect(() => {
    if (!isMedicarte) {
      setPointId('');
      return;
    }
    if (!accessiblePointIds.includes(pointId)) {
      setPointId(accessiblePointIds.length === 1 ? accessiblePointIds[0]! : '');
    }
  }, [accessiblePointIds, isMedicarte, pointId]);

  const query = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      ...(isMedicarte && pointId ? { dispensingPointId: pointId } : {}),
      ...appliedIdentity,
    }),
    [appliedIdentity, isMedicarte, page, pointId],
  );

  useEffect(() => {
    if (
      !organizationId ||
      !hasReadPermission ||
      (isMedicarte && !pointId) ||
      (isMtd && !appliedIdentity.identificationType)
    ) {
      setState('denied');
      setList(null);
      setLiveLookup(null);
      setLiveLookupError(null);
      setLiveLookupState('idle');
      return;
    }
    const abort = new AbortController();
    setState('loading');
    setError(null);
    if (page === 1) {
      setLiveLookup(null);
      setLiveLookupError(null);
      setLiveLookupState('idle');
    }
    void searchPatientMaster(organizationId, query, abort.signal)
      .then(async (response) => {
        if (abort.signal.aborted) return;
        setList(response);
        setState('ready');

        const hasExactIdentity = Boolean(
          appliedIdentity.identificationType && appliedIdentity.identificationValue,
        );
        if (!hasExactIdentity || page !== 1) return;
        if (response.total === 0) {
          setLiveLookup({ status: 'NOT_FOUND' });
          setLiveLookupState('ready');
          return;
        }

        setLiveLookupState('loading');
        try {
          const result = await lookupPatientMaster(
            organizationId,
            {
              identificationType: appliedIdentity.identificationType!,
              identificationValue: appliedIdentity.identificationValue!,
            },
            abort.signal,
          );
          if (abort.signal.aborted) return;
          setLiveLookup(result);
          setLiveLookupState('ready');
        } catch (cause) {
          if (abort.signal.aborted) return;
          setLiveLookupError(safeErrorMessage(cause));
          setLiveLookupState('error');
        }
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted) return;
        setState(permissionDenied(cause) ? 'denied' : 'error');
        setError(safeErrorMessage(cause));
        setList(null);
      });
    return () => abort.abort();
  }, [
    appliedIdentity.identificationType,
    appliedIdentity.identificationValue,
    hasReadPermission,
    isMedicarte,
    isMtd,
    organizationId,
    page,
    pointId,
    query,
  ]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const type = identityType;
    const value = identityValue;
    if (Boolean(type) !== Boolean(value)) {
      setError('Para buscar por identidad debes diligenciar tipo y valor exactos.');
      return;
    }
    setError(null);
    setLiveLookup(null);
    setLiveLookupError(null);
    setLiveLookupState('idle');
    setAppliedIdentity(
      type && value ? { identificationType: type, identificationValue: value } : {},
    );
    setPage(1);
  };

  const openDetail = async (patientId: string) => {
    if (!organizationId) return;
    setDetailError(null);
    setPersonal(null);
    setPersonalError(null);
    try {
      setSelected(
        await getPatientMasterDetail(organizationId, patientId, isMedicarte ? pointId : undefined),
      );
    } catch (cause) {
      setSelected(null);
      setDetailError(safeErrorMessage(cause));
    }
  };

  const openPersonal = async (patientId: string) => {
    if (!organizationId || !canReadPersonal) return;
    setPersonalError(null);
    try {
      setPersonal(
        await getPatientMasterPersonalProfile(
          organizationId,
          patientId,
          isMedicarte ? pointId : undefined,
        ),
      );
    } catch (cause) {
      setPersonal(null);
      setPersonalError(safeErrorMessage(cause));
    }
  };

  const openCases = async () => {
    if (!organizationId || !canReadReconciliation) return;
    setShowCases(true);
    setCasesError(null);
    try {
      const result = await listPatientReconciliationCases(organizationId);
      setCases(result.items);
    } catch (cause) {
      setCases(null);
      setCasesError(safeErrorMessage(cause));
    }
  };

  return (
    <main className={styles.container}>
      <PageHeader
        title="Maestro de pacientes"
        description="Consulta de identidad local, evidencia histórica y estado técnico MTDOM dentro del alcance autorizado."
        actions={
          canReadReconciliation ? (
            <button className="btn" type="button" onClick={() => void openCases()}>
              Casos de conciliación
            </button>
          ) : null
        }
      />
      {showCases ? (
        <section className={styles.card} aria-label="Casos de conciliación de pacientes">
          <div className={styles.sectionHeading}>
            <h2>Conciliación (solo lectura)</h2>
            <button type="button" onClick={() => setShowCases(false)}>
              Cerrar
            </button>
          </div>
          {casesError ? <p role="alert">{casesError}</p> : null}
          {cases === null && !casesError ? <p role="status">Cargando casos…</p> : null}
          {cases?.length === 0 ? <p>No hay casos dentro del alcance autorizado.</p> : null}
          {cases?.length ? (
            <ul className={styles.authorizationList}>
              {cases.map((item) => (
                <li key={item.id}>
                  <span>{item.reasonCode}</span>
                  <span>{statusLabel(item.status)}</span>
                  <span>{item.resolutionCode ?? 'Pendiente'}</span>
                  <span>{item.decidedAt ?? 'Sin decisión registrada'}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className={styles.card} aria-label="Búsqueda de pacientes">
        <div className={styles.sectionHeading}>
          <div>
            <h2>Consultar registros</h2>
            <p>Busca por identidad exacta y revisa el estado de vinculación.</p>
          </div>
          {state === 'ready' && list ? (
            <span className={styles.resultCount}>{list.total} registros</span>
          ) : null}
        </div>
        <form className={styles.filters} onSubmit={submitSearch}>
          {isMedicarte ? (
            <label>
              Punto autorizado
              <select
                aria-label="Punto autorizado"
                value={pointId}
                onChange={(event) => setPointId(event.target.value)}
              >
                <option value="">Selecciona un punto</option>
                {accessiblePointIds.map((id) => (
                  <option key={id} value={id}>
                    Punto {id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Tipo de identificación
            <select value={identityType} onChange={(event) => setIdentityType(event.target.value)}>
              <option value="">Selecciona un tipo</option>
              {IDENTIFICATION_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Valor exacto de identificación
            <input
              value={identityValue}
              placeholder="Ingresa el valor exacto"
              onChange={(event) => setIdentityValue(event.target.value)}
              maxLength={255}
            />
          </label>
          <button
            className={styles.primaryButton}
            type="submit"
            disabled={!hasReadPermission || (isMedicarte && !pointId)}
          >
            Buscar
          </button>
          {appliedIdentity.identificationValue ? (
            <button
              type="button"
              onClick={() => {
                setIdentityType('');
                setIdentityValue('');
                setAppliedIdentity({});
                setPage(1);
                setLiveLookup(null);
                setLiveLookupError(null);
                setLiveLookupState('idle');
              }}
            >
              Limpiar búsqueda
            </button>
          ) : null}
        </form>
        <p className={styles.scopeNotice}>
          <span aria-hidden="true">i</span>
          <span>
            La consulta usa tipo y número exactos. El perfil básico de MTDOM solo se consulta si
            existe una coincidencia local autorizada en Alto Costo.
          </span>
        </p>
        {liveLookupState === 'loading' ? (
          <p className={styles.stateMessage} role="status">
            Coincidencia local encontrada. Consultando perfil básico en MTDOM…
          </p>
        ) : null}
        {liveLookupState === 'error' && liveLookupError ? (
          <p className={styles.errorMessage} role="alert">
            {liveLookupError}
          </p>
        ) : null}
        {liveLookupState === 'ready' && liveLookup?.status === 'NOT_FOUND' ? (
          <p className={styles.stateMessage} role="status">
            No se encontró una coincidencia autorizada para esta identidad.
          </p>
        ) : null}
        {liveLookupState === 'ready' && liveLookup?.status === 'AMBIGUOUS' ? (
          <p className={styles.stateMessage} role="status">
            MTDOM encontró más de una coincidencia. Se requiere revisión antes de mostrar el perfil.
          </p>
        ) : null}
        {liveLookupState === 'ready' && liveLookup?.status === 'IDENTITY_MISMATCH' ? (
          <p className={styles.stateMessage} role="status">
            MTDOM respondió con una identidad distinta a la consultada; no se muestra el perfil.
          </p>
        ) : null}
        {liveLookupState === 'ready' && liveLookup?.status === 'UNAVAILABLE' ? (
          <p className={styles.stateMessage} role="status">
            MTDOM no está disponible en este momento. Intenta de nuevo más tarde.
          </p>
        ) : null}
        {liveLookupState === 'ready' && liveLookup?.status === 'FOUND' ? (
          <section className={styles.liveProfile} aria-label="Perfil básico de MTDOM">
            <div className={styles.sectionHeading}>
              <div>
                <h3>Perfil básico de MTDOM</h3>
                <p>Consulta en vivo; no modifica el registro ni la autorización.</p>
              </div>
            </div>
            <dl className={styles.details}>
              {(
                [
                  ['Tipo de identificación', liveLookup.basicProfile.tipo_identificacion],
                  ['Identificación', liveLookup.basicProfile.identificacion],
                  ['Primer nombre', liveLookup.basicProfile.primer_nombre],
                  ['Segundo nombre', liveLookup.basicProfile.segundo_nombre],
                  ['Primer apellido', liveLookup.basicProfile.primer_apellido],
                  ['Segundo apellido', liveLookup.basicProfile.segundo_apellido],
                  ['Sexo', liveLookup.basicProfile.sexo],
                  ['Ciudad', liveLookup.basicProfile.ciudad],
                  ['Departamento', liveLookup.basicProfile.departamento],
                  ['EPS', liveLookup.basicProfile.eps],
                  ['Plan', liveLookup.basicProfile.plan],
                  ['Activo en MTDOM', liveLookup.basicProfile.activo],
                  ['Paciente vivo según MTDOM', liveLookup.basicProfile.paciente_vivo],
                  ['Presente en fuente actual', liveLookup.basicProfile.presente_en_fuente_actual],
                  ['Actualizado en origen', liveLookup.basicProfile.actualizado_en],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{profileValue(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
        {error ? (
          <p className={styles.errorMessage} role="alert">
            {error}
          </p>
        ) : null}
        {state === 'loading' ? (
          <p className={styles.stateMessage} role="status">
            Cargando pacientes…
          </p>
        ) : null}
        {state === 'denied' ? (
          <p className={styles.stateMessage} role="status">
            No tienes autorización para consultar el maestro dentro del alcance solicitado.
          </p>
        ) : null}
        {state === 'error' && !error ? (
          <p className={styles.errorMessage} role="alert">
            No fue posible consultar el maestro.
          </p>
        ) : null}
        {state === 'ready' && list?.items.length === 0 ? (
          <p className={styles.stateMessage}>Sin resultados dentro del alcance autorizado.</p>
        ) : null}
        {state === 'ready' && list && list.items.length > 0 ? (
          <>
            <div className={styles.tableMeta}>
              <span>Resultados de búsqueda</span>
              <span>
                Mostrando {list.items.length} de {list.total}
              </span>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <caption>Pacientes dentro del alcance autorizado</caption>
                <thead>
                  <tr>
                    <th>Registro</th>
                    <th>Clave local</th>
                    <th>Estado MTDOM</th>
                    <th>Autorizaciones enlazadas</th>
                    <th>Históricas candidatas</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((patient) => (
                    <tr key={patient.id}>
                      <td>{patient.id.slice(0, 8)}</td>
                      <td>{statusLabel(patient.identityStatus)}</td>
                      <td>{statusLabel(patient.mtdomLookupStatus)}</td>
                      <td>{patient.linkedAuthorizationCount}</td>
                      <td>{patient.historicalCandidateAuthorizationCount}</td>
                      <td>
                        <button
                          className={styles.detailButton}
                          type="button"
                          onClick={() => void openDetail(patient.id)}
                        >
                          Ver detalle
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className={styles.pagination} aria-label="Paginación de pacientes">
              <span>
                Página {page} · {list.total} registros
              </span>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page * PAGE_SIZE >= list.total}
                onClick={() => setPage((value) => value + 1)}
              >
                Siguiente
              </button>
            </nav>
          </>
        ) : null}
      </section>

      {detailError ? <p role="alert">{detailError}</p> : null}
      {selected ? (
        <section className={styles.card} aria-label="Detalle del paciente">
          <div className={styles.sectionHeading}>
            <h2>Registro {selected.id.slice(0, 8)}</h2>
            <button type="button" onClick={() => setSelected(null)}>
              Cerrar detalle
            </button>
          </div>
          <dl className={styles.details}>
            <dt>Identidad local</dt>
            <dd>{statusLabel(selected.identityStatus)} · valor no incluido en la respuesta</dd>
            <dt>Estado MTDOM</dt>
            <dd>{statusLabel(selected.mtdomLookupStatus)}</dd>
            <dt>Último intento</dt>
            <dd>{selected.mtdomLastCheckedAt ?? 'Sin intento'}</dd>
            <dt>Último evento de cambios</dt>
            <dd>{selected.mtdomChangesSeenAt ?? 'Sin evento'}</dd>
            <dt>Código técnico</dt>
            <dd>{selected.mtdomLastErrorCode ?? '—'}</dd>
          </dl>
          {selected.basicProfile ? (
            <>
              <h3>Perfil básico MTDOM</h3>
              <dl className={styles.details}>
                {(
                  [
                    ['Tipo de identificación', selected.basicProfile.tipo_identificacion],
                    ['Identificación', selected.basicProfile.identificacion],
                    ['Primer nombre', selected.basicProfile.primer_nombre],
                    ['Segundo nombre', selected.basicProfile.segundo_nombre],
                    ['Primer apellido', selected.basicProfile.primer_apellido],
                    ['Segundo apellido', selected.basicProfile.segundo_apellido],
                    ['Sexo', selected.basicProfile.sexo],
                    ['Ciudad', selected.basicProfile.ciudad],
                    ['Código de ciudad', selected.basicProfile.codigo_ciudad],
                    ['Departamento', selected.basicProfile.departamento],
                    ['Código de departamento', selected.basicProfile.codigo_departamento],
                    ['EPS', selected.basicProfile.eps],
                    ['Código de EPS', selected.basicProfile.codigo_eps],
                    ['Plan', selected.basicProfile.plan],
                    ['Código de plan', selected.basicProfile.codigo_plan],
                    ['Tipo reportado', selected.basicProfile.tipo],
                    ['Código de tipo', selected.basicProfile.codigo_tipo],
                    ['Condición', selected.basicProfile.condicion],
                    ['Activo en MTDOM', selected.basicProfile.activo],
                    ['Paciente vivo según MTDOM', selected.basicProfile.paciente_vivo],
                    ['Fecha de fallecimiento reportada', selected.basicProfile.fecha_fallecimiento],
                    ['Presente en fuente actual', selected.basicProfile.presente_en_fuente_actual],
                    ['Estado de Registraduría', selected.basicProfile.registraduria_estado],
                    [
                      'Última validación de Registraduría',
                      selected.basicProfile.fecha_ultima_validacion_registraduria,
                    ],
                    ['Actualizado en origen', selected.basicProfile.actualizado_en],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{profileValue(value)}</dd>
                  </div>
                ))}
                {selected.basicProfileMetadata ? (
                  <div>
                    <dt>Origen / consulta en Medicarte</dt>
                    <dd>
                      {selected.basicProfileMetadata.source} ·{' '}
                      {selected.basicProfileMetadata.fetchedAt ?? 'Sin metadato de consulta'}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </>
          ) : (
            <p role="status">No hay atributos básicos disponibles para este registro.</p>
          )}
          {canReadPersonal ? (
            <div>
              <button type="button" onClick={() => void openPersonal(selected.id)}>
                Consultar datos personales autorizados
              </button>
              {personalError ? <p role="alert">{personalError}</p> : null}
              {personal?.personalProfile ? (
                <>
                  <p>
                    Origen {personal.personalProfileMetadata?.source ?? 'no disponible'} · última
                    consulta {personal.personalProfileMetadata?.fetchedAt ?? 'no disponible'}
                  </p>
                  <dl className={styles.details}>
                    {(
                      [
                        ['Fecha de nacimiento', personal.personalProfile.fecha_nacimiento],
                        ['Dirección', personal.personalProfile.direccion],
                        ['Barrio', personal.personalProfile.barrio],
                        ['Zona', personal.personalProfile.zona],
                        ['Latitud', personal.personalProfile.latitud],
                        ['Longitud', personal.personalProfile.longitud],
                        ['Teléfono 1', personal.personalProfile.telefono1],
                        ['Teléfono 2', personal.personalProfile.telefono2],
                        ['Correo', personal.personalProfile.email],
                        ['Correo validado', personal.personalProfile.email_validado],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{profileValue(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : null}
              {personal && !personal.personalProfile ? (
                <p role="status">No hay atributos personales disponibles para este registro.</p>
              ) : null}
            </div>
          ) : null}
          <h3>Evidencia de autorizaciones</h3>
          <ul className={styles.authorizationList}>
            {selected.authorizationEvidence.map((item) => (
              <li key={item.id}>
                <span>{item.authorizationNumber}</span>
                <span>
                  {item.linkage === 'LINKED'
                    ? 'Enlace al maestro'
                    : 'Snapshot histórico; candidato exacto sin enlace'}
                </span>
                <span>{item.organizationCodes.join(', ')}</span>
                {item.dispensingPointId ? (
                  <span>Punto {item.dispensingPointId.slice(0, 8)}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className={styles.scopeNotice}>
            Las coincidencias históricas se muestran como evidencia candidata: esta consulta no
            modifica `patient_id` ni crea enlaces.
          </p>
        </section>
      ) : null}
    </main>
  );
}
