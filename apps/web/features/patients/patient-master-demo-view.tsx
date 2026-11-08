'use client';

import { useMemo, useState } from 'react';
import {
  filterPatientMasterDemoRecords,
  paginatePatientMasterDemoRecords,
  type PatientMasterDemoRecord,
  type PatientMasterDemoState,
} from './patient-master-demo-model';
import styles from './patient-master-demo-view.module.css';

type Props = Readonly<{
  records: ReadonlyArray<PatientMasterDemoRecord>;
  state?: PatientMasterDemoState;
  initialSelectedId?: string | null;
}>;

const STATUS_LABELS: Record<PatientMasterDemoRecord['localIdentityStatus'], string> = {
  VERIFIED_LOCAL: 'Identidad local verificable',
  INCOMPLETE: 'Identidad incompleta',
  AMBIGUOUS: 'Identidad ambigua',
};

const SYNC_LABELS: Record<PatientMasterDemoRecord['mtdomStatus'], string> = {
  PENDING: 'Pendiente',
  MATCHED: 'Encontrada en MTDOM',
  NOT_FOUND: 'No encontrada en MTDOM',
  AMBIGUOUS: 'Coincidencia ambigua en MTDOM',
  ERROR: 'Error técnico',
};

export function PatientMasterDemoView({
  records,
  state = 'ready',
  initialSelectedId = null,
}: Props) {
  const [query, setQuery] = useState('');
  const [identityStatus, setIdentityStatus] = useState<
    PatientMasterDemoRecord['localIdentityStatus'] | 'ALL'
  >('ALL');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const filtered = useMemo(
    () => filterPatientMasterDemoRecords(records, query, identityStatus),
    [records, query, identityStatus],
  );
  const paginated = paginatePatientMasterDemoRecords(filtered, page, 5);
  const selected = records.find((patient) => patient.id === selectedId) ?? null;

  if (state !== 'ready') {
    const messages: Record<Exclude<PatientMasterDemoState, 'ready'>, string> = {
      loading: 'Cargando pacientes…',
      denied: 'No tienes autorización para consultar el maestro de pacientes.',
      error: 'No fue posible cargar la información de pacientes.',
      empty: 'No hay pacientes dentro del alcance autorizado.',
    };
    return (
      <main className={styles.container}>
        <h1>Maestro de pacientes</h1>
        <p role={state === 'error' ? 'alert' : 'status'}>{messages[state]}</p>
      </main>
    );
  }

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>Maestro de pacientes</h1>
          <p>Demostración local con datos sintéticos. No consulta servicios ni datos reales.</p>
        </div>
        <span className={styles.demoBadge}>DEMO SINTÉTICA</span>
      </header>

      <section className={styles.card} aria-label="Listado de pacientes">
        <div className={styles.filters}>
          <label>
            Buscar
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Nombre sintético, ID interno o autorización"
            />
          </label>
          <label>
            Estado de identidad
            <select
              value={identityStatus}
              onChange={(event) => {
                setIdentityStatus(event.target.value as typeof identityStatus);
                setPage(1);
              }}
            >
              <option value="ALL">Todos</option>
              <option value="VERIFIED_LOCAL">Verificable localmente</option>
              <option value="INCOMPLETE">Incompleta</option>
              <option value="AMBIGUOUS">Ambigua</option>
            </select>
          </label>
        </div>

        {paginated.total === 0 ? (
          <p className={styles.stateMessage}>Sin resultados para los filtros actuales.</p>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table>
                <caption>Pacientes sintéticos vinculados a evidencia de autorización</caption>
                <thead>
                  <tr>
                    <th>Registro</th>
                    <th>Identidad local</th>
                    <th>Estado MTDOM</th>
                    <th>Autorizaciones visibles en el alcance de demo</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.items.map((patient) => (
                    <tr key={patient.id}>
                      <td>{patient.syntheticLabel}</td>
                      <td>{STATUS_LABELS[patient.localIdentityStatus]}</td>
                      <td>{SYNC_LABELS[patient.mtdomStatus]}</td>
                      <td>{patient.authorizations.length}</td>
                      <td>
                        <button type="button" onClick={() => setSelectedId(patient.id)}>
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
                Página {paginated.page} de {paginated.pageCount} · {paginated.total} pacientes
              </span>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page >= paginated.pageCount}
                onClick={() => setPage((current) => Math.min(paginated.pageCount, current + 1))}
              >
                Siguiente
              </button>
            </nav>
          </>
        )}
      </section>

      {selected ? (
        <section className={styles.card} aria-label="Detalle del paciente">
          <div className={styles.sectionHeading}>
            <h2>{selected.syntheticLabel}</h2>
            <button type="button" onClick={() => setSelectedId(null)}>
              Cerrar detalle
            </button>
          </div>
          <dl className={styles.details}>
            <dt>Identidad local</dt>
            <dd>
              {selected.localIdentity
                ? `${selected.localIdentity.type} / ${selected.localIdentity.value}`
                : 'No hay identidad local verificable'}
            </dd>
            <dt>Evidencia histórica</dt>
            <dd>
              {selected.historicalEvidence.map((entry) => (
                <div key={entry.source}>
                  <strong>{entry.source}:</strong> {entry.value}
                </div>
              ))}
            </dd>
            <dt>Fuente MTDOM</dt>
            <dd>{SYNC_LABELS[selected.mtdomStatus]}</dd>
            <dt>Último evento MTDOM</dt>
            <dd>{selected.mtdomUpdatedAt ?? 'Sin evento registrado'}</dd>
          </dl>

          <h3>Autorizaciones relacionadas</h3>
          <p className={styles.scopeNotice}>
            La demostración recibe únicamente las autorizaciones ya incluidas en su proyección de
            alcance; no expande relaciones indirectas.
          </p>
          <ul className={styles.authorizationList}>
            {selected.authorizations.map((authorization) => (
              <li key={authorization.id}>
                <span>{authorization.authorizationNumber}</span>
                <span>
                  {authorization.organizationLabel} · {authorization.pointLabel}
                </span>
                <span>{authorization.linked ? 'Enlazada al maestro' : 'Histórica sin enlace'}</span>
              </li>
            ))}
          </ul>

          <h3>Conciliación</h3>
          <p>
            {selected.reconciliationReason ?? 'Sin caso sintético pendiente'} · consulta de solo
            lectura; resolución deshabilitada hasta contar con política aprobada.
          </p>
          <button type="button" disabled title="Requiere autorización y regla aprobada">
            Registrar resolución
          </button>
        </section>
      ) : null}
    </main>
  );
}
