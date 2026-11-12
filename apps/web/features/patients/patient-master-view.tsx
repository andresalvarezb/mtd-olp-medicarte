'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { PatientMasterSearchResponse } from '@authorization/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { useRole } from '@/components/layout/role-context';
import { ApiError } from '@/lib/api-client';
import { searchPatientMaster } from '@/lib/patient-master-api';
import styles from './patient-master-demo-view.module.css';

const PAGE_SIZE = 25;

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

export function PatientMasterView() {
  const { me, organizationId, hasPermission } = useRole();
  const organization = me?.organizations.find((item) => item.id === organizationId);
  const isMedicarte = organization?.code === 'MEDICARTE';
  const isMtd = organization?.code === 'MTD';
  const accessiblePointIds = organization?.pointAccess.accessiblePointIds ?? [];
  const hasReadPermission = hasPermission('patient_master.read');

  const [pointId, setPointId] = useState('');
  const [identityType, setIdentityType] = useState('');
  const [identityValue, setIdentityValue] = useState('');
  const [appliedIdentity, setAppliedIdentity] = useState<{
    identificationType?: string;
    identificationValue?: string;
  }>({});
  const [page, setPage] = useState(1);
  const [list, setList] = useState<PatientMasterSearchResponse | null>(null);
  const [state, setState] = useState<'loading' | 'denied' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);

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
      return;
    }

    const abort = new AbortController();
    setState('loading');
    setError(null);

    void searchPatientMaster(organizationId, query, abort.signal)
      .then((response) => {
        setList(response);
        setState('ready');
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
    hasReadPermission,
    isMedicarte,
    isMtd,
    organizationId,
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
    setAppliedIdentity(
      type && value ? { identificationType: type, identificationValue: value } : {},
    );
    setPage(1);
  };

  return (
    <main className={styles.container}>
      <PageHeader
        title="Maestro de pacientes"
        description="Consulta del maestro de pacientes a través de la API dentro del alcance autorizado."
      />

      <section className={styles.card} aria-label="Búsqueda de pacientes">
        <form className={styles.filters} onSubmit={submitSearch}>
          {isMedicarte ? (
            <label>
              Punto autorizado
              <select value={pointId} onChange={(event) => setPointId(event.target.value)}>
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
            Tipo exacto de identificación
            <input
              value={identityType}
              onChange={(event) => setIdentityType(event.target.value)}
              maxLength={10}
            />
          </label>

          <label>
            Valor exacto de identificación
            <input
              value={identityValue}
              onChange={(event) => setIdentityValue(event.target.value)}
              maxLength={30}
            />
          </label>

          <button type="submit" disabled={!hasReadPermission || (isMedicarte && !pointId)}>
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
              }}
            >
              Limpiar búsqueda
            </button>
          ) : null}
        </form>

        <p className={styles.scopeNotice}>
          La búsqueda usa tipo homologado y documento exacto, y no devuelve el documento. Los
          resultados se obtienen desde la API del maestro.
        </p>

        {error ? <p role="alert">{error}</p> : null}

        {state === 'loading' ? <p role="status">Cargando pacientes…</p> : null}
        {state === 'denied' ? (
          <p role="status">
            No tienes autorización para consultar el maestro dentro del alcance solicitado.
          </p>
        ) : null}
        {state === 'error' && !error ? (
          <p role="alert">No fue posible consultar el maestro.</p>
        ) : null}

        {state === 'ready' && list?.items.length === 0 ? (
          <p>Sin resultados dentro del alcance autorizado.</p>
        ) : null}

        {state === 'ready' && list && list.items.length > 0 ? (
          <>
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
    </main>
  );
}
