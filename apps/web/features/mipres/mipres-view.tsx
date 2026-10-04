'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { useRole } from '@/components/layout/role-context';

import { Card, CardBody } from '@/components/ui/card';

import { FilterActions, FilterBar, FilterField } from '@/components/ui/filter-bar';

import { PageHeader } from '@/components/ui/page-header';

import { TableLoadingRow } from '@/components/ui/loading-state';

import {
  getMipresConcepts,
  getMipresDetail,
  getMipresHistory,
  listMipres,
  mipresErrorMessage,
  recheckMipres,
  submitMipresDecision,
  type MipresDecisionAction,
  type MipresDecisionConcept,
  type MipresDetail,
  type MipresHistoryEvent,
  type MipresListItem,
} from '@/lib/mipres-api';

import styles from './mipres-view.module.css';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

function display(value: string | null | undefined): string {
  return value?.trim() ? value : '—';
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',

    ...(value.includes('T')
      ? {
          timeStyle: 'short' as const,
        }
      : {}),

    timeZone: 'America/Bogota',
  }).format(parsed);
}

function mipresState(decision: string): 'UNLOCKED' | 'LOCKED' {
  return decision === 'MANUALLY_ENABLED' ? 'UNLOCKED' : 'LOCKED';
}

function mipresStateLabel(decision: string): string {
  return mipresState(decision) === 'UNLOCKED' ? 'Desbloqueada' : 'Bloqueada';
}

function mipresStateClass(decision: string): string | undefined {
  return mipresState(decision) === 'UNLOCKED' ? styles.green : styles.red;
}

function directionLabel(value: string): string {
  if (value === 'CONFIRMED') {
    return 'Confirmado';
  }

  if (value === 'QUERY_ERROR') {
    return 'Error de consulta';
  }

  if (value === 'NOT_APPLICABLE') {
    return 'No aplica';
  }

  return 'Pendiente';
}

function directionClass(value: string): string | undefined {
  if (value === 'CONFIRMED') {
    return styles.green;
  }

  if (value === 'QUERY_ERROR') {
    return styles.red;
  }

  if (value === 'PENDING') {
    return styles.yellow;
  }

  return styles.gray;
}

const AUTHORIZATION_REASON_LABELS: Record<string, string> = {
  SOURCE_BLOCKED: 'El estado fuente de la AUTO no está habilitado.',
  TARIFF_NOT_LISTED: 'El producto no cumple la validación del anexo tarifario.',
  INVALID_QUANTITY: 'La cantidad de la autorización es inválida.',
  BELOW_MINIMUM_QUANTITY: 'La cantidad está por debajo del mínimo permitido.',
  OPERATIONAL_WINDOW_BLOCKED: 'Pendiente de habilitación automática.',
};

function authorizationRestrictionReason(detail: MipresListItem | MipresDetail): string {
  const naturalReasons = detail.blockedReasons
    .filter((reason) => reason !== 'PENDING_MANUAL_ENABLEMENT' && reason !== 'MANUALLY_DISABLED')
    .map((reason) => AUTHORIZATION_REASON_LABELS[reason] ?? reason);

  if (naturalReasons.length > 0) {
    return naturalReasons.join(' ');
  }

  if (detail.authorizationState === 'PENDING') {
    if (detail.coverageType === 'NO_PBS' && detail.directionStatus !== 'CONFIRMED') {
      return 'La AUTO está pendiente de un direccionamiento MIPRES confirmado.';
    }

    return 'Pendiente de habilitación automática.';
  }

  return 'Sin bloqueos de habilitación.';
}

function Badge({ children, tone }: { children: ReactNode; tone: string | undefined }) {
  return <span className={[styles.badge, tone].filter(Boolean).join(' ')}>{children}</span>;
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.detail}>
      <span>{label}</span>

      <strong>{value}</strong>
    </div>
  );
}

function patientSubtitle(item: MipresListItem | MipresDetail): string {
  return [item.patientName, item.patientDocument].filter(Boolean).join(' · ');
}

export function MipresView() {
  const { organizationId, hasPermission } = useRole();

  const [authorizationSearch, setAuthorizationSearch] = useState('');

  const [patientSearch, setPatientSearch] = useState('');

  const [appliedAuthorizationSearch, setAppliedAuthorizationSearch] = useState('');

  const [appliedPatientSearch, setAppliedPatientSearch] = useState('');

  const [page, setPage] = useState(1);

  const [pageSize, setPageSize] = useState(10);

  const [authorizationStateFilter, setAuthorizationStateFilter] = useState('');

  const [mipresStateFilter, setMipresStateFilter] = useState('');

  const [appliedAuthorizationState, setAppliedAuthorizationState] = useState('');

  const [appliedMipresState, setAppliedMipresState] = useState('');

  const [items, setItems] = useState<MipresListItem[]>([]);

  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(false);

  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [detail, setDetail] = useState<MipresDetail | null>(null);

  const [history, setHistory] = useState<MipresHistoryEvent[]>([]);

  const [concepts, setConcepts] = useState<MipresDecisionConcept[]>([]);

  const [drawerLoading, setDrawerLoading] = useState(false);

  const [decisionAction, setDecisionAction] = useState<MipresDecisionAction | null>(null);

  const [conceptCode, setConceptCode] = useState('');

  const [observation, setObservation] = useState('');

  const [submitting, setSubmitting] = useState(false);

  const [rechecking, setRechecking] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);

  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const canManageDecision = hasPermission('mipres.decision.manage');

  const canRecheck = hasPermission('mipres.recheck');

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const firstVisible = total === 0 ? 0 : (page - 1) * pageSize + 1;

  const lastVisible = Math.min(page * pageSize, total);

  const loadList = useCallback(
    async (signal?: AbortSignal) => {
      if (!organizationId) {
        return;
      }

      setLoading(true);
      setListError(null);

      try {
        const response = await listMipres(
          organizationId,
          {
            page,

            limit: pageSize,

            ...(appliedAuthorizationSearch
              ? {
                  authorization: appliedAuthorizationSearch,
                }
              : {}),

            ...(appliedPatientSearch
              ? {
                  patient: appliedPatientSearch,
                }
              : {}),

            ...(appliedAuthorizationState
              ? {
                  authorizationState: appliedAuthorizationState as
                    | 'ENABLED'
                    | 'PENDING'
                    | 'DISABLED',
                }
              : {}),

            ...(appliedMipresState
              ? {
                  mipresState: appliedMipresState as 'LOCKED' | 'UNLOCKED',
                }
              : {}),
          },
          signal,
        );

        setItems(response.items);

        setTotal(response.total);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        setListError(mipresErrorMessage(error));
      } finally {
        setLoading(false);
      }
    },
    [
      organizationId,
      page,
      pageSize,
      appliedAuthorizationSearch,
      appliedPatientSearch,
      appliedAuthorizationState,
      appliedMipresState,
    ],
  );

  useEffect(() => {
    const controller = new AbortController();

    void loadList(controller.signal);

    return () => {
      controller.abort();
    };
  }, [loadList]);

  const refreshDrawer = useCallback(
    async (id: string) => {
      if (!organizationId) {
        return;
      }

      const [nextDetail, nextHistory] = await Promise.all([
        getMipresDetail(id, organizationId),

        getMipresHistory(id, organizationId),
      ]);

      setDetail(nextDetail);

      setHistory(nextHistory);
    },
    [organizationId],
  );

  async function openDrawer(id: string) {
    if (!organizationId) {
      return;
    }

    setSelectedId(id);
    setDrawerLoading(true);
    setDetail(null);
    setHistory([]);
    setDecisionAction(null);
    setConceptCode('');
    setObservation('');
    setActionError(null);
    setActionMessage(null);

    try {
      const [nextDetail, nextHistory, nextConcepts] = await Promise.all([
        getMipresDetail(id, organizationId),

        getMipresHistory(id, organizationId),

        getMipresConcepts(organizationId),
      ]);

      setDetail(nextDetail);

      setHistory(nextHistory);

      setConcepts(nextConcepts);
    } catch (error) {
      setActionError(mipresErrorMessage(error));
    } finally {
      setDrawerLoading(false);
    }
  }

  function closeDrawer() {
    if (submitting || rechecking) {
      return;
    }

    setSelectedId(null);
    setDetail(null);
    setHistory([]);
    setDecisionAction(null);
    setConceptCode('');
    setObservation('');
    setActionError(null);
    setActionMessage(null);
  }

  const visibleConcepts = useMemo(() => {
    if (decisionAction !== 'ENABLE' && decisionAction !== 'DISABLE') {
      return [];
    }

    return concepts.filter((concept) => concept.action === decisionAction);
  }, [concepts, decisionAction]);

  const selectedConcept = visibleConcepts.find((concept) => concept.code === conceptCode);

  const observationRequired = selectedConcept?.requiresObservation ?? false;

  function startDecision(action: MipresDecisionAction) {
    setDecisionAction(action);

    setConceptCode('');
    setObservation('');
    setActionError(null);
    setActionMessage(null);
  }

  async function executeDecision() {
    if (!detail || !organizationId || !decisionAction) {
      return;
    }

    if (decisionAction !== 'RESET' && !conceptCode) {
      setActionError('Debes seleccionar un concepto.');

      return;
    }

    if (observationRequired && !observation.trim()) {
      setActionError('La observación es obligatoria para el concepto seleccionado.');

      return;
    }

    if (decisionAction === 'ENABLE' && detail.authorizationState === 'DISABLED') {
      setActionError(
        'Las AUTOs Habilitadas o Pendientes pueden desbloquear MIPRES manualmente. Una AUTO Inhabilitada no puede desbloquearse.',
      );

      return;
    }

    setSubmitting(true);
    setActionError(null);
    setActionMessage(null);

    try {
      await submitMipresDecision({
        id: detail.id,

        organizationId,

        action: decisionAction,

        expectedVersion: detail.manualVersion,

        ...(conceptCode
          ? {
              conceptCode,
            }
          : {}),

        ...(observation.trim()
          ? {
              observation: observation.trim(),
            }
          : {}),
      });

      await Promise.all([refreshDrawer(detail.id), loadList()]);

      const message =
        decisionAction === 'ENABLE'
          ? 'MIPRES quedó Desbloqueada. La Habilitación de la AUTO no fue modificada.'
          : decisionAction === 'DISABLE'
            ? 'MIPRES quedó Bloqueada. La Habilitación de la AUTO no fue modificada.'
            : 'MIPRES volvió al estado Bloqueada. La Habilitación de la AUTO no fue modificada.';

      setDecisionAction(null);
      setConceptCode('');
      setObservation('');

      setActionMessage(message);
    } catch (error) {
      setActionError(mipresErrorMessage(error));

      try {
        await refreshDrawer(detail.id);
      } catch {
        // Mantener error original.
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function executeRecheck() {
    if (!detail || !organizationId) {
      return;
    }

    setRechecking(true);
    setActionError(null);
    setActionMessage(null);

    try {
      await recheckMipres(detail.id, organizationId);

      await Promise.all([refreshDrawer(detail.id), loadList()]);

      setActionMessage(
        'La evidencia MIPRES fue actualizada. El bloqueo MIPRES Bloqueada/Desbloqueada no fue modificado.',
      );
    } catch (error) {
      setActionError(mipresErrorMessage(error));
    } finally {
      setRechecking(false);
    }
  }

  function applySearch() {
    setPage(1);

    setAppliedAuthorizationSearch(authorizationSearch.trim());
    setAppliedPatientSearch(patientSearch.trim());
    setAppliedAuthorizationState(authorizationStateFilter);
    setAppliedMipresState(mipresStateFilter);
  }

  function clearSearch() {
    setAuthorizationSearch('');
    setPatientSearch('');
    setAuthorizationStateFilter('');
    setMipresStateFilter('');

    setAppliedAuthorizationSearch('');
    setAppliedPatientSearch('');
    setAppliedAuthorizationState('');
    setAppliedMipresState('');

    setPage(1);
  }

  function searchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();

      applySearch();
    }
  }

  return (
    <>
      <PageHeader
        title="MIPRES"
        description="AUTOs con número MIPRES. MIPRES inicia Bloqueada y puede desbloquearse manualmente por MTD cuando la AUTO está Habilitada o Pendiente."
      />

      <Card
        className={`operational-list-workspace authorization-query-workspace ${styles.mipresQueryWorkspace}`}
      >
        <CardBody>
          <FilterBar>
            <FilterField label="Autorización / MIPRES">
              <input
                id="mipres-authorization-search"
                className="control"
                value={authorizationSearch}
                placeholder="Número de autorización o MIPRES"
                onKeyDown={searchKeyDown}
                onChange={(event) => setAuthorizationSearch(event.target.value)}
              />
            </FilterField>

            <FilterField label="Paciente">
              <input
                id="mipres-patient-search"
                className="control"
                value={patientSearch}
                placeholder="Nombre o documento"
                onKeyDown={searchKeyDown}
                onChange={(event) => setPatientSearch(event.target.value)}
              />
            </FilterField>

            <FilterField label="Habilitación">
              <select
                className="control"
                value={authorizationStateFilter}
                onChange={(event) => setAuthorizationStateFilter(event.target.value)}
              >
                <option value="">Todas</option>
                <option value="ENABLED">Habilitada</option>
                <option value="PENDING">Pendiente</option>
                <option value="DISABLED">Inhabilitada</option>
              </select>
            </FilterField>

            <FilterField label="MIPRES">
              <select
                className="control"
                value={mipresStateFilter}
                onChange={(event) => setMipresStateFilter(event.target.value)}
              >
                <option value="">Todos</option>
                <option value="LOCKED">Bloqueada</option>
                <option value="UNLOCKED">Desbloqueada</option>
              </select>
            </FilterField>

            <FilterActions>
              <button type="button" className="btn primary" onClick={applySearch}>
                Filtrar
              </button>

              <button type="button" className="btn" onClick={clearSearch}>
                Limpiar
              </button>
            </FilterActions>
          </FilterBar>

          {listError ? (
            <div className={styles.error} role="alert">
              {listError}
            </div>
          ) : null}

          <div className="table-wrap">
            <table
              className="authorization-query-table"
              style={{
                width: '100%',
                minWidth: 0,
                tableLayout: 'fixed',
              }}
            >
              <colgroup>
                <col style={{ width: '18%' }} />
                <col style={{ width: '19%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '7%' }} />
              </colgroup>

              <thead>
                <tr>
                  <th>AUTO / MIPRES</th>
                  <th>Paciente</th>
                  <th>Producto</th>
                  <th>Habilitación</th>
                  <th>MIPRES</th>

                  <th
                    style={{
                      position: 'sticky',
                      right: 0,
                      zIndex: 2,
                      background: 'inherit',
                      textAlign: 'center',
                    }}
                  >
                    Acción
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <TableLoadingRow colSpan={6} label="Cargando AUTOs MIPRES" />
                ) : (
                  <>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="authorization-cell-stack">
                            <strong>{item.authorizationNumber}</strong>

                            <span>MIPRES: {display(item.prescriptionNumber)}</span>
                          </div>
                        </td>

                        <td>
                          <div className="authorization-cell-stack">
                            <strong>{display(item.patientName)}</strong>

                            <span>{display(item.patientDocument)}</span>
                          </div>
                        </td>

                        <td>
                          <div className="authorization-cell-stack">
                            <strong>{display(item.productDescription)}</strong>

                            <span>COD: {display(item.productCode)}</span>
                          </div>
                        </td>

                        <td
                          style={{
                            verticalAlign: 'middle',
                          }}
                        >
                          <div
                            className="authorization-cell-stack"
                            style={{
                              whiteSpace: 'normal',
                              lineHeight: 1.25,
                            }}
                          >
                            <strong>
                              {item.authorizationState === 'ENABLED'
                                ? 'Habilitada'
                                : item.authorizationState === 'PENDING'
                                  ? 'Pendiente'
                                  : 'Inhabilitada'}
                            </strong>

                            <span title={authorizationRestrictionReason(item)}>
                              {authorizationRestrictionReason(item)}
                            </span>
                          </div>
                        </td>

                        <td
                          style={{
                            verticalAlign: 'middle',
                          }}
                        >
                          <Badge tone={item.mipresState === 'UNLOCKED' ? styles.green : styles.red}>
                            {item.mipresState === 'UNLOCKED' ? 'Desbloqueada' : 'Bloqueada'}
                          </Badge>
                        </td>

                        <td
                          style={{
                            position: 'sticky',
                            right: 0,
                            zIndex: 1,
                            background: 'white',
                            textAlign: 'center',
                          }}
                        >
                          <button
                            type="button"
                            className="button"
                            onClick={() => {
                              void openDrawer(item.id);
                            }}
                          >
                            Ver
                          </button>
                        </td>
                      </tr>
                    ))}

                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={6}>
                          <div className="table-empty-state">
                            <strong>Sin resultados</strong>

                            <span>No existen AUTOs con MIPRES con los filtros seleccionados.</span>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </>
                )}
              </tbody>
            </table>
          </div>

          <div className="authorization-query-pagination list-pagination">
            <div className="authorization-query-pagination-summary">
              <span>
                {loading ? 'Mostrando —' : `Mostrando ${firstVisible}–${lastVisible} de ${total}`}
              </span>

              <label className="authorization-query-page-size-field">
                <span>Filas</span>

                <select
                  className="control authorization-query-page-size"
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="authorization-query-pagination-controls">
              <button
                type="button"
                className="btn"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(current - 1, 1))}
              >
                Anterior
              </button>

              <strong>
                Página {page} de {totalPages}
              </strong>

              <button
                type="button"
                className="btn"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((current) => Math.min(current + 1, totalPages))}
              >
                Siguiente
              </button>
            </div>
          </div>
        </CardBody>
      </Card>

      {selectedId ? (
        <>
          <div className={styles.overlay} aria-hidden="true" onClick={closeDrawer} />

          <aside
            className={styles.drawer}
            role="dialog"
            aria-modal="true"
            aria-label="Detalle de autorización MIPRES"
          >
            <div className={styles.drawerHeader}>
              <div className={styles.drawerTitle}>
                <h2>
                  {detail ? `Autorización ${detail.authorizationNumber}` : 'Autorización MIPRES'}
                </h2>

                <p>{detail ? patientSubtitle(detail) : 'Cargando información…'}</p>

                {detail ? (
                  <div className={styles.drawerBadges}>
                    <Badge
                      tone={
                        detail.authorizationState === 'ENABLED'
                          ? styles.green
                          : detail.authorizationState === 'PENDING'
                            ? styles.yellow
                            : styles.red
                      }
                    >
                      {detail.authorizationState === 'ENABLED'
                        ? 'Habilitada'
                        : detail.authorizationState === 'PENDING'
                          ? 'Pendiente'
                          : 'Inhabilitada'}
                    </Badge>

                    <Badge tone={mipresStateClass(detail.manualDecision)}>
                      MIPRES {mipresStateLabel(detail.manualDecision)}
                    </Badge>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                className={styles.closeButton}
                aria-label="Cerrar"
                onClick={closeDrawer}
              >
                ×
              </button>
            </div>

            {drawerLoading && !detail ? (
              <div className={styles.drawerLoading}>Cargando autorización…</div>
            ) : detail ? (
              <div className={styles.drawerBody}>
                {actionError ? (
                  <div className={styles.error} role="alert">
                    {actionError}
                  </div>
                ) : null}

                {actionMessage ? (
                  <div className={styles.success} role="status">
                    {actionMessage}
                  </div>
                ) : null}

                {detail.authorizationState === 'DISABLED' ? (
                  <div className={styles.warningBox}>
                    <strong>No se puede desbloquear MIPRES.</strong>{' '}
                    {authorizationRestrictionReason(detail)}
                  </div>
                ) : null}

                <section className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <h3>Resumen de la AUTO</h3>
                  </div>

                  <div className={styles.detailGrid}>
                    <DetailField label="Autorización" value={detail.authorizationNumber} />

                    <DetailField label="Paciente" value={display(detail.patientName)} />

                    <DetailField label="Documento" value={display(detail.patientDocument)} />

                    <DetailField label="Producto" value={display(detail.productDescription)} />

                    <DetailField label="Código de producto" value={display(detail.productCode)} />

                    <DetailField label="Cantidad" value={display(detail.quantity)} />

                    <DetailField label="Cobertura" value={display(detail.coverageType)} />

                    <DetailField
                      label="Fecha de asignación"
                      value={formatDate(detail.assignmentDate)}
                    />

                    <DetailField label="Vigencia" value={formatDate(detail.validityEndDate)} />

                    <DetailField
                      label="Habilitación"
                      value={
                        detail.authorizationState === 'ENABLED'
                          ? 'Habilitada'
                          : detail.authorizationState === 'PENDING'
                            ? 'Pendiente'
                            : 'Inhabilitada'
                      }
                    />

                    {detail.authorizationState === 'DISABLED' ? (
                      <div className={styles.restrictionReason}>
                        <strong>No se puede desbloquear MIPRES</strong>
                        <span>{authorizationRestrictionReason(detail)}</span>
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className={`${styles.section} ${styles.mipresSection}`}>
                  <div className={styles.sectionHeader}>
                    <h3>Información MIPRES</h3>

                    {canRecheck ? (
                      <button
                        type="button"
                        className={styles.button}
                        disabled={rechecking || submitting}
                        onClick={() => {
                          void executeRecheck();
                        }}
                      >
                        {rechecking ? 'Reconsultando…' : 'Reconsultar MIPRES'}
                      </button>
                    ) : null}
                  </div>

                  <div className={styles.detailGrid}>
                    <DetailField label="No. MIPRES" value={display(detail.prescriptionNumber)} />

                    <DetailField
                      label="Direccionamiento"
                      value={
                        <Badge tone={directionClass(detail.directionStatus)}>
                          {directionLabel(detail.directionStatus)}
                        </Badge>
                      }
                    />

                    <DetailField
                      label="ID direccionamiento"
                      value={display(detail.currentDirection?.directionId)}
                    />

                    <DetailField
                      label="Tipo tecnología"
                      value={display(detail.currentDirection?.technologyType)}
                    />

                    <DetailField
                      label="Consecutivo"
                      value={display(detail.currentDirection?.technologyConsecutive)}
                    />

                    <DetailField
                      label="Fecha máxima entrega"
                      value={formatDate(detail.currentDirection?.maximumDeliveryDate)}
                    />

                    <DetailField
                      label="Estado externo"
                      value={display(detail.currentDirection?.externalStatus)}
                    />

                    <DetailField
                      label="Anulado"
                      value={
                        detail.currentDirection?.annulled === null
                          ? '—'
                          : detail.currentDirection?.annulled
                            ? 'Sí'
                            : 'No'
                      }
                    />
                  </div>
                </section>

                <section className={`${styles.section} ${styles.decisionSection}`}>
                  <div className={styles.sectionHeader}>
                    <h3>Control manual MTD</h3>

                    <Badge tone={mipresStateClass(detail.manualDecision)}>
                      {mipresStateLabel(detail.manualDecision)}
                    </Badge>
                  </div>

                  <div className={styles.detailGrid}>
                    <DetailField
                      label="Estado MIPRES"
                      value={mipresStateLabel(detail.manualDecision)}
                    />

                    <DetailField
                      label="Concepto"
                      value={display(detail.manualConceptName ?? detail.manualConceptCode)}
                    />

                    <DetailField label="Observación" value={display(detail.manualObservation)} />

                    <DetailField label="Actualizado por" value={display(detail.manualUpdatedBy)} />

                    <DetailField label="Fecha" value={formatDate(detail.manualUpdatedAt)} />
                  </div>

                  {detail.authorizationState === 'PENDING' ? (
                    <div className={styles.futureWindowNotice}>
                      <strong>Desbloqueo manual permitido</strong>

                      <span>
                        La AUTO está Pendiente, pero MTD puede desbloquear MIPRES manualmente. La
                        autorización continuará Pendiente hasta que sus condiciones naturales
                        cambien. Desbloquear MIPRES no modifica su habilitación.
                      </span>
                    </div>
                  ) : null}

                  {canManageDecision ? (
                    <div className={styles.actions}>
                      {detail.manualDecision !== 'MANUALLY_ENABLED' ? (
                        <button
                          type="button"
                          className={`${styles.button} ${styles.primary}`}
                          disabled={
                            submitting || rechecking || detail.authorizationState === 'DISABLED'
                          }
                          title={
                            detail.authorizationState === 'DISABLED'
                              ? 'Las AUTOs Habilitadas o Pendientes pueden desbloquear MIPRES manualmente. Una AUTO Inhabilitada no puede desbloquearse.'
                              : undefined
                          }
                          onClick={() => startDecision('ENABLE')}
                        >
                          Desbloquear MIPRES
                        </button>
                      ) : null}

                      {detail.manualDecision !== 'MANUALLY_DISABLED' ? (
                        <button
                          type="button"
                          className={`${styles.button} ${styles.danger}`}
                          disabled={submitting || rechecking}
                          onClick={() => startDecision('DISABLE')}
                        >
                          {detail.manualDecision === 'MANUALLY_ENABLED'
                            ? 'Bloquear MIPRES'
                            : 'Registrar bloqueo MIPRES'}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className={styles.warningBox}>
                      Tu perfil puede consultar MIPRES, pero no cambiar el estado manual.
                    </div>
                  )}

                  {decisionAction ? (
                    <div className={styles.formPanel}>
                      <h4 className={styles.formTitle}>
                        {decisionAction === 'ENABLE'
                          ? 'Desbloquear MIPRES'
                          : decisionAction === 'DISABLE'
                            ? 'Bloquear MIPRES'
                            : 'Restablecer bloqueo MIPRES'}
                      </h4>

                      {decisionAction === 'RESET' ? (
                        <div className={styles.warningBox}>
                          MIPRES volverá al estado Bloqueada. La Habilitación de la AUTO no será
                          modificada.
                        </div>
                      ) : (
                        <>
                          <div className={styles.field}>
                            <label htmlFor="mipres-concept">Concepto *</label>

                            <select
                              id="mipres-concept"
                              className={styles.select}
                              value={conceptCode}
                              onChange={(event) => setConceptCode(event.target.value)}
                            >
                              <option value="">Seleccionar concepto</option>

                              {visibleConcepts.map((concept) => (
                                <option key={concept.code} value={concept.code}>
                                  {concept.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className={styles.field}>
                            <label htmlFor="mipres-observation">
                              Observación
                              {observationRequired ? ' *' : ''}
                            </label>

                            <textarea
                              id="mipres-observation"
                              className={styles.textarea}
                              value={observation}
                              placeholder={
                                observationRequired
                                  ? 'La observación es obligatoria para este concepto.'
                                  : 'Observación opcional.'
                              }
                              onChange={(event) => setObservation(event.target.value)}
                            />
                          </div>
                        </>
                      )}

                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.button}
                          disabled={submitting}
                          onClick={() => {
                            setDecisionAction(null);

                            setConceptCode('');
                            setObservation('');
                          }}
                        >
                          Cancelar
                        </button>

                        <button
                          type="button"
                          className={
                            decisionAction === 'DISABLE'
                              ? `${styles.button} ${styles.danger}`
                              : `${styles.button} ${styles.primary}`
                          }
                          disabled={
                            submitting ||
                            (decisionAction !== 'RESET' && !conceptCode) ||
                            (observationRequired && !observation.trim())
                          }
                          onClick={() => {
                            void executeDecision();
                          }}
                        >
                          {submitting
                            ? 'Guardando…'
                            : decisionAction === 'ENABLE'
                              ? 'Confirmar desbloqueo'
                              : decisionAction === 'DISABLE'
                                ? 'Confirmar bloqueo'
                                : 'Confirmar restablecimiento'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <h3>Historial</h3>
                  </div>

                  {history.length === 0 ? (
                    <div className={styles.subtle}>No hay eventos registrados.</div>
                  ) : (
                    <div className={styles.timeline}>
                      {history.map((event) => (
                        <div key={event.id} className={styles.timelineItem}>
                          <div className={styles.timelineRail} />

                          <div className={styles.timelineContent}>
                            <Badge tone={event.kind === 'MTD' ? styles.blue : styles.gray}>
                              {event.kind}
                            </Badge>

                            <strong>{event.title}</strong>

                            {event.description ? <p>{event.description}</p> : null}

                            {event.actor ? <p>Usuario: {event.actor}</p> : null}

                            <time>{formatDate(event.createdAt)}</time>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <div className={styles.drawerLoading}>No fue posible cargar la autorización.</div>
            )}
          </aside>
        </>
      ) : null}
    </>
  );
}
