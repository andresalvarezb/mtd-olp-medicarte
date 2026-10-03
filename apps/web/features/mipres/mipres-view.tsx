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

import { Card } from '@/components/ui/card';

import { FilterActions, FilterBar, FilterField } from '@/components/ui/filter-bar';

import { PageHeader } from '@/components/ui/page-header';

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

function mipresStateClass(decision: string): string {
  return mipresState(decision) === 'UNLOCKED' ? styles.green! : styles.red!;
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

function directionClass(value: string): string {
  if (value === 'CONFIRMED') {
    return styles.green!;
  }

  if (value === 'QUERY_ERROR') {
    return styles.red!;
  }

  if (value === 'PENDING') {
    return styles.yellow!;
  }

  return styles.gray!;
}

function Badge({ children, tone }: { children: ReactNode; tone: string }) {
  return <span className={`${styles.badge!} ${tone}`}>{children}</span>;
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.detail!}>
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

  const [search, setSearch] = useState('');

  const [appliedSearch, setAppliedSearch] = useState('');

  const [page, setPage] = useState(1);

  const [pageSize, setPageSize] = useState(10);

  const [atStatus, setAtStatus] = useState('');

  const [manualDecision, setManualDecision] = useState('');

  const [state, setState] = useState('');

  const [appliedAtStatus, setAppliedAtStatus] = useState('');

  const [appliedManualDecision, setAppliedManualDecision] = useState('');

  const [appliedState, setAppliedState] = useState('');

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

            ...(appliedSearch
              ? {
                  search: appliedSearch,
                }
              : {}),

            ...(appliedAtStatus
              ? {
                  atStatus: appliedAtStatus,
                }
              : {}),

            ...(appliedManualDecision
              ? {
                  manualDecision: appliedManualDecision,
                }
              : {}),

            ...(appliedState
              ? {
                  state: appliedState,
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
      appliedSearch,
      appliedAtStatus,
      appliedManualDecision,
      appliedState,
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

    if (decisionAction === 'ENABLE' && detail.authorizationState !== 'ENABLED') {
      setActionError('Solo una AUTO Habilitada puede desbloquear MIPRES.');

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
          ? 'MIPRES quedó desbloqueada. La AUTO continúa con las reglas operacionales normales.'
          : decisionAction === 'DISABLE'
            ? 'La AUTO quedó bloqueada por MIPRES.'
            : 'La decisión fue restablecida. La AUTO vuelve a quedar bloqueada hasta una nueva habilitación manual.';

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

    setAppliedSearch(search.trim());
    setAppliedAtStatus(atStatus);
    setAppliedManualDecision(manualDecision);
    setAppliedState(state);
  }

  function clearSearch() {
    setSearch('');
    setAtStatus('');
    setManualDecision('');
    setState('');

    setAppliedSearch('');
    setAppliedAtStatus('');
    setAppliedManualDecision('');
    setAppliedState('');

    setPage(1);
  }

  function searchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();

      applySearch();
    }
  }

  return (
    <div className={styles.page!}>
      <PageHeader
        title="MIPRES"
        description="AUTOs con número MIPRES. Toda AUTO permanece bloqueada hasta ser habilitada manualmente por MTD."
      />

      <Card className="operational-list-workspace">
        <FilterBar>
          <FilterField label="Buscar">
            <input
              id="mipres-search"
              className="control"
              value={search}
              placeholder="AUTO, MIPRES, documento, paciente, producto o direccionamiento"
              onKeyDown={searchKeyDown}
              onChange={(event) => setSearch(event.target.value)}
            />
          </FilterField>

          <FilterField label="AT">
            <select
              className="control"
              value={atStatus}
              onChange={(event) => setAtStatus(event.target.value)}
            >
              <option value="">Todos</option>
              <option value="LISTED">Incluida</option>
              <option value="NOT_LISTED">No incluida</option>
              <option value="NOT_EVALUATED">No evaluada</option>
            </select>
          </FilterField>

          <FilterField label="Decisión MTD">
            <select
              className="control"
              value={manualDecision}
              onChange={(event) => setManualDecision(event.target.value)}
            >
              <option value="">Todas</option>
              <option value="PENDING_MANUAL_ENABLEMENT">Pendiente</option>
              <option value="MANUALLY_ENABLED">Desbloqueada</option>
              <option value="MANUALLY_DISABLED">Bloqueada</option>
            </select>
          </FilterField>

          <FilterField label="Estado">
            <select
              className="control"
              value={state}
              onChange={(event) => setState(event.target.value)}
            >
              <option value="">Todos</option>
              <option value="OPERABLE">Operable</option>
              <option value="BLOCKED">Bloqueada</option>
            </select>
          </FilterField>

          <FilterActions>
            <button type="button" className="btn" onClick={applySearch}>
              Filtrar
            </button>

            <button type="button" className="btn" onClick={clearSearch}>
              Limpiar
            </button>
          </FilterActions>
        </FilterBar>

        {listError ? (
          <div className={styles.error!} role="alert">
            {listError}
          </div>
        ) : null}

        <div className="operational-list-table-scope">
          <div className="operational-list-table-wrap">
            <table className="data-table">
              <colgroup>
                <col style={{ width: '20%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '30%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '14%' }} />
              </colgroup>

              <thead>
                <tr>
                  <th>AUTO / MIPRES</th>
                  <th>PACIENTE</th>
                  <th>PRODUCTO</th>
                  <th>HABILITACIÓN</th>
                  <th>MIPRES</th>
                </tr>
              </thead>

              <tbody>
                {!loading &&
                  items.map((item) => (
                    <tr
                      key={item.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => {
                        void openDrawer(item.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void openDrawer(item.id);
                        }
                      }}
                    >
                      <td>
                        <div>
                          <strong>{item.authorizationNumber}</strong>
                        </div>
                        <div>MIPRES: {display(item.prescriptionNumber)}</div>
                      </td>

                      <td>
                        <div>
                          <strong>{display(item.patientName)}</strong>
                        </div>
                        <div>{display(item.patientDocument)}</div>
                      </td>

                      <td>
                        <div>
                          <strong>{display(item.productDescription)}</strong>
                        </div>
                        <div>{display(item.commercialCode)}</div>
                      </td>

                      <td>
                        <Badge
                          tone={
                            item.authorizationState === 'ENABLED'
                              ? styles.green!
                              : item.authorizationState === 'PENDING'
                                ? styles.yellow!
                                : styles.red!
                          }
                        >
                          {item.authorizationState === 'ENABLED'
                            ? 'Habilitada'
                            : item.authorizationState === 'PENDING'
                              ? 'Pendiente'
                              : 'Inhabilitada'}
                        </Badge>
                      </td>

                      <td>
                        <Badge tone={item.mipresState === 'UNLOCKED' ? styles.green! : styles.red!}>
                          {item.mipresState === 'UNLOCKED' ? 'Desbloqueada' : 'Bloqueada'}
                        </Badge>
                      </td>
                    </tr>
                  ))}

                {loading ? (
                  <tr>
                    <td colSpan={5}>Cargando AUTOs MIPRES…</td>
                  </tr>
                ) : null}

                {!loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No hay AUTOs con MIPRES que coincidan con los filtros.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="authorization-imports-pagination list-pagination">
          <span>
            Mostrando {firstVisible}–{lastVisible} de {total}
          </span>

          <label>
            Filas{' '}
            <select
              className="control authorization-imports-page-size"
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

          <button
            type="button"
            className="btn"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
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
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            Siguiente
          </button>
        </div>
      </Card>

      {selectedId ? (
        <>
          <div className={styles.overlay!} aria-hidden="true" onClick={closeDrawer} />

          <aside
            className={styles.drawer!}
            role="dialog"
            aria-modal="true"
            aria-label="Detalle de autorización MIPRES"
          >
            <div className={styles.drawerHeader!}>
              <div className={styles.drawerTitle!}>
                <h2>
                  {detail ? `Autorización ${detail.authorizationNumber}` : 'Autorización MIPRES'}
                </h2>

                <p>{detail ? patientSubtitle(detail) : 'Cargando información…'}</p>
              </div>

              <button
                type="button"
                className={styles.closeButton!}
                aria-label="Cerrar"
                onClick={closeDrawer}
              >
                ×
              </button>
            </div>

            {drawerLoading && !detail ? (
              <div className={styles.drawerLoading!}>Cargando autorización…</div>
            ) : detail ? (
              <div className={styles.drawerBody!}>
                {actionError ? (
                  <div className={styles.error!} role="alert">
                    {actionError}
                  </div>
                ) : null}

                {actionMessage ? (
                  <div className={styles.success!} role="status">
                    {actionMessage}
                  </div>
                ) : null}

                <section className={styles.statusHero!}>
                  <div className={styles.statusHeroText!}>
                    <small>Estado MIPRES</small>

                    <strong>{mipresStateLabel(detail.manualDecision)}</strong>

                    <span className={styles.subtle!}>
                      {mipresState(detail.manualDecision) === 'UNLOCKED'
                        ? 'El bloqueo MIPRES fue levantado. La AUTO continúa con las reglas operacionales normales.'
                        : detail.authorizationState === 'ENABLED'
                          ? 'La AUTO está Habilitada. MIPRES permanece bloqueada hasta que MTD la desbloquee manualmente.'
                          : 'MIPRES permanece bloqueada porque la AUTO no se encuentra Habilitada.'}
                    </span>
                  </div>

                  <Badge tone={mipresStateClass(detail.manualDecision)}>
                    {mipresStateLabel(detail.manualDecision)}
                  </Badge>
                </section>

                <section className={styles.section!}>
                  <div className={styles.sectionHeader!}>
                    <h3>Autorización</h3>
                  </div>

                  <div className={styles.detailGrid!}>
                    <DetailField label="Autorización" value={detail.authorizationNumber} />

                    <DetailField label="Documento" value={display(detail.patientDocument)} />

                    <DetailField label="Paciente" value={display(detail.patientName)} />

                    <DetailField label="Producto" value={display(detail.productDescription)} />

                    <DetailField label="Código comercial" value={display(detail.commercialCode)} />

                    <DetailField label="Cantidad" value={display(detail.quantity)} />

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
                  </div>
                </section>

                <section className={`${styles.section!} ${styles.mipresSection!}`}>
                  <div className={styles.sectionHeader!}>
                    <h3>Información MIPRES</h3>

                    {canRecheck ? (
                      <button
                        type="button"
                        className={styles.button!}
                        disabled={rechecking || submitting}
                        onClick={() => {
                          void executeRecheck();
                        }}
                      >
                        {rechecking ? 'Reconsultando…' : 'Reconsultar MIPRES'}
                      </button>
                    ) : null}
                  </div>

                  <div className={styles.detailGrid!}>
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

                <section className={`${styles.section!} ${styles.decisionSection!}`}>
                  <div className={styles.sectionHeader!}>
                    <h3>Control manual MTD</h3>

                    <Badge tone={mipresStateClass(detail.manualDecision)}>
                      {mipresStateLabel(detail.manualDecision)}
                    </Badge>
                  </div>

                  <div className={styles.detailGrid!}>
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

                  {canManageDecision ? (
                    <div className={styles.actions!}>
                      {detail.manualDecision !== 'MANUALLY_ENABLED' ? (
                        <button
                          type="button"
                          className={`${styles.button!} ${styles.primary!}`}
                          disabled={
                            submitting || rechecking || detail.authorizationState !== 'ENABLED'
                          }
                          title={
                            detail.authorizationState !== 'ENABLED'
                              ? 'Solo una AUTO Habilitada puede desbloquear MIPRES.'
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
                          className={`${styles.button!} ${styles.danger!}`}
                          disabled={submitting || rechecking}
                          onClick={() => startDecision('DISABLE')}
                        >
                          Inhabilitar
                        </button>
                      ) : null}

                      {detail.manualDecision !== 'PENDING_MANUAL_ENABLEMENT' ? (
                        <button
                          type="button"
                          className={`${styles.button!} ${styles.secondaryDanger!}`}
                          disabled={submitting || rechecking}
                          onClick={() => startDecision('RESET')}
                        >
                          Restablecer
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className={styles.warningBox!}>
                      Tu perfil puede consultar MIPRES, pero no cambiar el estado manual.
                    </div>
                  )}

                  {decisionAction ? (
                    <div className={styles.formPanel!}>
                      <h4 className={styles.formTitle!}>
                        {decisionAction === 'ENABLE'
                          ? 'Habilitar AUTO'
                          : decisionAction === 'DISABLE'
                            ? 'Inhabilitar AUTO'
                            : 'Restablecer bloqueo MIPRES'}
                      </h4>

                      {decisionAction === 'RESET' ? (
                        <div className={styles.warningBox!}>
                          La AUTO volverá a quedar bloqueada hasta una nueva habilitación manual.
                        </div>
                      ) : (
                        <>
                          <div className={styles.field!}>
                            <label htmlFor="mipres-concept">Concepto *</label>

                            <select
                              id="mipres-concept"
                              className={styles.select!}
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

                          <div className={styles.field!}>
                            <label htmlFor="mipres-observation">
                              Observación
                              {observationRequired ? ' *' : ''}
                            </label>

                            <textarea
                              id="mipres-observation"
                              className={styles.textarea!}
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

                      <div className={styles.actions!}>
                        <button
                          type="button"
                          className={styles.button!}
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
                              ? `${styles.button!} ${styles.danger!}`
                              : `${styles.button!} ${styles.primary!}`
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
                              ? 'Confirmar habilitación'
                              : decisionAction === 'DISABLE'
                                ? 'Confirmar inhabilitación'
                                : 'Confirmar restablecimiento'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className={styles.section!}>
                  <div className={styles.sectionHeader!}>
                    <h3>Historial</h3>
                  </div>

                  {history.length === 0 ? (
                    <div className={styles.subtle!}>No hay eventos registrados.</div>
                  ) : (
                    <div className={styles.timeline!}>
                      {history.map((event) => (
                        <div key={event.id} className={styles.timelineItem!}>
                          <div className={styles.timelineRail!} />

                          <div className={styles.timelineContent!}>
                            <Badge tone={event.kind === 'MTD' ? styles.blue! : styles.gray!}>
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
              <div className={styles.drawerLoading!}>No fue posible cargar la autorización.</div>
            )}
          </aside>
        </>
      ) : null}
    </div>
  );
}
