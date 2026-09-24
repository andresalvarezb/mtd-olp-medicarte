'use client';

import { useState } from 'react';

import { PageHeader } from '@/components/ui/page-header';

import { Card, CardBody } from '@/components/ui/card';

import { FilterActions, FilterBar, FilterField } from '@/components/ui/filter-bar';

import { useRole } from '@/components/layout/role-context';

import { useApiData } from '@/hooks/use-api-data';

import {
  fulfillAuthorization,
  getAuthorizationQueryItem,
  listAuthorizationQuery,
  type AuthorizationFulfillmentType,
  type AuthorizationQueryFilters,
  type AuthorizationQueryItem,
} from '@/lib/authorization-query-api';

function enablementLabel(status: string) {
  return status === 'ENABLED' ? 'Habilitada' : 'Bloqueada';
}

function operationalLabel(
  status:
    AuthorizationQueryItem['operationalStatus'],
) {
  const labels = {
    UNASSIGNED:
      'Sin asignar',

    ASSIGNED:
      'Lista para entrega/aplicación',

    CLOSED:
      'Cerrada',
  };

  return labels[status];
}

function fulfillmentTypeLabel(
  type:
    string | null,
) {
  if (
    type === 'APPLICATION'
  ) {
    return 'Aplicación';
  }

  if (
    type === 'DELIVERY'
  ) {
    return 'Entrega';
  }

  return '—';
}

function currentBogotaDate() {
  return new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone:
        'America/Bogota',

      year:
        'numeric',

      month:
        '2-digit',

      day:
        '2-digit',
    },
  ).format(
    new Date(),
  );
}

function authorizationDateLabel(
  value:
    string | null,
) {
  if (!value) {
    return '—';
  }

  const normalized =
    value.trim();

  const compact =
    normalized.match(
      /^(\d{4})(\d{2})(\d{2})$/,
    );

  if (compact) {
    return `${compact[3]}/${compact[2]}/${compact[1]}`;
  }

  const iso =
    normalized.match(
      /^(\d{4})-(\d{2})-(\d{2})/,
    );

  if (iso) {
    return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }

  return normalized;
}


function authorizationDateInputValue(
  value:
    string | null,
) {
  if (!value) {
    return null;
  }

  const normalized =
    value.trim();

  const compact =
    normalized.match(
      /^(\d{4})(\d{2})(\d{2})$/,
    );

  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }

  const iso =
    normalized.match(
      /^(\d{4})-(\d{2})-(\d{2})/,
    );

  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  return null;
}


function dateTimeLabel(
  value:
    string | null,
) {
  if (!value) {
    return '—';
  }

  const parsed =
    new Date(
      value,
    );

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    return value;
  }

  return parsed.toLocaleString(
    'es-CO',
  );
}

import { FulfillmentBulkActions } from './fulfillment-bulk-actions';

export function ConsultaAutorizacionesView() {
  const { organizationId, hasPermission } = useRole();

  const [filters, setFilters] = useState({
    authorizationNumber: '',
    commercialCode: '',
    patient: '',
    enablementStatus: '',
    coverageType: '',
  });

  const [appliedFilters, setAppliedFilters] = useState(filters);

  const [page, setPage] = useState(1);

  const [pageSize, setPageSize] = useState(10);

  const [selected, setSelected] = useState<AuthorizationQueryItem | null>(null);

  const [
    fulfillmentType,
    setFulfillmentType,
  ] =
    useState<AuthorizationFulfillmentType>(
      'APPLICATION',
    );

  const [
    fulfillmentDate,
    setFulfillmentDate,
  ] =
    useState('');

  const [
    fulfilling,
    setFulfilling,
  ] =
    useState(false);

  const [
    fulfillmentError,
    setFulfillmentError,
  ] =
    useState<string | null>(
      null,
    );

  const [
    managingAuthorization,
    setManagingAuthorization,
  ] =
    useState(false);


  const canFulfill =
    hasPermission(
      'patient_applications.manage',
    );


  const query = useApiData(
    () =>
      listAuthorizationQuery(organizationId, {
        page,
        limit: pageSize,

        ...(appliedFilters.authorizationNumber
          ? {
              authorizationNumber: appliedFilters.authorizationNumber,
            }
          : {}),

        ...(appliedFilters.commercialCode
          ? {
              commercialCode: appliedFilters.commercialCode,
            }
          : {}),

        ...(appliedFilters.patient
          ? {
              patient: appliedFilters.patient,
            }
          : {}),

        ...(appliedFilters.enablementStatus
          ? {
              enablementStatus: appliedFilters.enablementStatus as NonNullable<
                AuthorizationQueryFilters['enablementStatus']
              >,
            }
          : {}),

        ...(appliedFilters.coverageType
          ? {
              coverageType: appliedFilters.coverageType as NonNullable<
                AuthorizationQueryFilters['coverageType']
              >,
            }
          : {}),
      }),
    [organizationId, appliedFilters, page, pageSize],
  );

  const data = query.data;

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const firstVisible =
    data && data.total > 0
      ? (page - 1) * data.pageSize + 1
      : 0;

  const lastVisible =
    data
      ? Math.min(
          page * data.pageSize,
          data.total,
        )
      : 0;

  function applyFilters() {
    setPage(1);
    setAppliedFilters(filters);
  }

  function clearFilters() {
    const cleared = {
      authorizationNumber: '',
      commercialCode: '',
      patient: '',
      enablementStatus: '',
      coverageType: '',
    };

    setFilters(cleared);
    setAppliedFilters(cleared);
    setPage(1);
  }

  function openDetail(
    item:
      AuthorizationQueryItem,
  ) {
    setSelected(
      item,
    );

    setFulfillmentType(
      'APPLICATION',
    );

    setFulfillmentDate(
      '',
    );

    setFulfillmentError(
      null,
    );

    setManagingAuthorization(
      false,
    );
  }

  async function confirmFulfillment() {
    if (
      !selected ||
      !organizationId ||
      !fulfillmentDate ||
      fulfilling
    ) {
      return;
    }

    setFulfilling(
      true,
    );

    setFulfillmentError(
      null,
    );

    try {
      await fulfillAuthorization(
        organizationId,
        selected.id,
        {
          fulfillmentType,
          effectiveDate:
            fulfillmentDate,
        },
      );

      const refreshed =
        await getAuthorizationQueryItem(
          organizationId,
          selected.id,
        );

      setSelected(
        refreshed,
      );

      setFulfillmentDate(
        '',
      );

      setManagingAuthorization(
        false,
      );

      query.reload();
    } catch (caught) {
      setFulfillmentError(
        caught instanceof Error
          ? caught.message
          : 'No fue posible completar la operación.',
      );
    } finally {
      setFulfilling(
        false,
      );
    }
  }

  const todayBogota =
    currentBogotaDate();

  const selectedValidityEndDate =
    authorizationDateInputValue(
      selected?.validityEndDate ??
        null,
    );

  const fulfillmentMaxDate =
    selectedValidityEndDate &&
    selectedValidityEndDate <
      todayBogota
      ? selectedValidityEndDate
      : todayBogota;

  const canFulfillSelected =
    Boolean(
      selected &&
      canFulfill &&
      selected.operationalStatus ===
        'ASSIGNED' &&
      selected.remainingAssignedQuantity >
        0,
    );

  return (
    <>
      <PageHeader
        title="Consulta de Autorizaciones"
        description="Consulta las autorizaciones registradas y su estado actual."
        actions={
          <FulfillmentBulkActions
            organizationId={organizationId}
            canManage={hasPermission(
              'patient_applications.manage',
            )}
            onImported={() => {
              window.location.reload();
            }}
          />
        }
      />



      <Card className="operational-list-workspace">
<CardBody>
          <FilterBar>
            <FilterField label="Autorización">
              <input
                className="control"
                value={filters.authorizationNumber}
                onChange={(event) =>
                  setFilters({
                    ...filters,

                    authorizationNumber: event.target.value,
                  })
                }
                placeholder="Número de autorización"
              />
            </FilterField>

            <FilterField label="Producto">
              <input
                className="control"
                value={filters.commercialCode}
                onChange={(event) =>
                  setFilters({
                    ...filters,

                    commercialCode: event.target.value,
                  })
                }
                placeholder="Código comercial"
              />
            </FilterField>

            <FilterField label="Paciente">
              <input
                className="control"
                value={filters.patient}
                onChange={(event) =>
                  setFilters({
                    ...filters,

                    patient: event.target.value,
                  })
                }
                placeholder="Nombre o documento"
              />
            </FilterField>

            <FilterField label="Estado">
              <select
                className="control"
                value={filters.enablementStatus}
                onChange={(event) =>
                  setFilters({
                    ...filters,

                    enablementStatus: event.target.value,
                  })
                }
              >
                <option value="">Todos</option>

                <option value="ENABLED">Habilitada</option>

                <option value="BLOCKED_SOURCE_STATUS">Bloqueada</option>
              </select>
            </FilterField>

            <FilterField label="Cobertura">
              <select
                className="control"
                value={filters.coverageType}
                onChange={(event) =>
                  setFilters({
                    ...filters,

                    coverageType: event.target.value,
                  })
                }
              >
                <option value="">Todas</option>

                <option value="PBS">PBS</option>

                <option value="NO_PBS">NO PBS</option>
              </select>
            </FilterField>

            <FilterActions>
              <button
                type="button"
                className="btn primary"
                onClick={applyFilters}
              >
                Filtrar
              </button>

              <button
                type="button"
                className="btn"
                onClick={clearFilters}
              >
                Limpiar
              </button>
            </FilterActions>
          </FilterBar>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Autorización</th>

                  <th>Paciente</th>

                  <th>Producto</th>

                  <th>Cantidad</th>

                  <th>Vencimiento</th>

                  <th>Punto</th>

                  <th>Estado operativo</th>

                  <th />
                </tr>
              </thead>

              <tbody>
                {(data?.items ?? []).map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>
                        {item.authorizationNumber}
                      </strong>
                    </td>

                    <td>
                      <div className="authorization-cell-stack">
                        <strong>
                          {item.patientName ?? 'Sin nombre'}
                        </strong>

                        <span>
                          {item.patientDocument ?? 'Sin documento'}
                        </span>
                      </div>
                    </td>

                    <td>
                      <div className="authorization-cell-stack">
                        <strong>
                          {item.commercialCode}
                        </strong>

                        <span>
                          {item.productDescription ?? 'Sin nombre de producto'}
                        </span>
                      </div>
                    </td>

                    <td>
                      {item.quantity ?? '—'}
                    </td>

                    <td>
                      {authorizationDateLabel(
                        item.validityEndDate,
                      )}
                    </td>

                    <td>
                      {item.dispensingPointCode ?? '—'}
                    </td>

                    <td>
                      <span
                        className={`authorization-operational-status ${item.operationalStatus.toLowerCase()}`}
                      >
                        {operationalLabel(item.operationalStatus)}
                      </span>
                    </td>

                    <td>
                      <button
                        type="button"
                        className="button"
                        onClick={() => openDetail(item)}
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}

                {!query.loading && (data?.items.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="table-empty-state">
                        <strong>
                          Sin resultados
                        </strong>

                        <span>
                          No existen autorizaciones con los filtros seleccionados.
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="authorization-query-pagination list-pagination">
            <div className="authorization-query-pagination-summary">
              <span>
                {data
                  ? `Mostrando ${firstVisible}–${lastVisible} de ${data.total}`
                  : 'Cargando…'}
              </span>

              <label className="authorization-query-page-size-field">
                <span>
                  Filas
                </span>

                <select
                  className="control authorization-query-page-size"
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(
                      Number(
                        event.target.value,
                      ),
                    );

                    setPage(1);
                  }}
                >
                  <option value={10}>
                    10
                  </option>

                  <option value={25}>
                    25
                  </option>

                  <option value={50}>
                    50
                  </option>

                  <option value={100}>
                    100
                  </option>
                </select>
              </label>
            </div>

            <div className="authorization-query-pagination-controls">
              <button
                type="button"
                className="btn"
                disabled={
                  page <= 1 ||
                  query.loading
                }
                onClick={() =>
                  setPage(
                    (current) =>
                      Math.max(
                        current - 1,
                        1,
                      ),
                  )
                }
              >
                Anterior
              </button>

              <strong>
                Página {page} de {totalPages}
              </strong>

              <button
                type="button"
                className="btn"
                disabled={
                  page >= totalPages ||
                  query.loading
                }
                onClick={() =>
                  setPage(
                    (current) =>
                      Math.min(
                        current + 1,
                        totalPages,
                      ),
                  )
                }
              >
                Siguiente
              </button>
            </div>
          </div>
        </CardBody>
      </Card>

      {selected ? (
        <div
          className="operation-drawer-backdrop"
          onMouseDown={() => setSelected(null)}
        >
          <aside
            className="operation-drawer"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="operation-drawer-header">
              <div className="authorization-drawer-heading">
                <span>
                  Autorización
                </span>

                <h2>
                  {selected.authorizationNumber}
                </h2>

                <div className="authorization-header-badges">
                  <strong
                    className={`authorization-operational-status ${selected.operationalStatus.toLowerCase()}`}
                  >
                    {operationalLabel(
                      selected.operationalStatus,
                    )}
                  </strong>

                  <strong className="authorization-coverage-badge">
                    {selected.coverageType}
                  </strong>
                </div>
              </div>

              <button
                type="button"
                className="operation-close"
                aria-label="Cerrar detalle"
                onClick={() => {
                  setSelected(null);
                  setManagingAuthorization(false);
                }}
              >
                ×
              </button>
            </div>


            <div className="operation-section-title">
              Paciente
            </div>

            <div className="authorization-detail-patient">
              <strong>
                {selected.patientName ??
                  'Sin nombre registrado'}
              </strong>

              <span>
                {selected.patientDocument ??
                  'Sin documento'}
              </span>
            </div>


            <div className="operation-section-title">
              Medicamento
            </div>

            <div className="authorization-detail-grid authorization-product-grid">
              <div>
                <span>
                  Código
                </span>

                <strong>
                  {selected.commercialCode}
                </strong>
              </div>

              <div>
                <span>
                  Producto
                </span>

                <strong>
                  {selected.productDescription ??
                    'Sin nombre'}
                </strong>
              </div>
            </div>


            <div className="operation-section-title">
              Autorización
            </div>

            <div className="authorization-detail-grid">
              <div>
                <span>
                  Cantidad autorizada
                </span>

                <strong>
                  {selected.quantity ??
                    '—'}
                </strong>
              </div>

              <div>
                <span>
                  Estado
                </span>

                <strong>
                  {enablementLabel(
                    selected.enablementStatus,
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Inicio
                </span>

                <strong>
                  {authorizationDateLabel(
                    selected.assignmentDate,
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Vencimiento
                </span>

                <strong>
                  {authorizationDateLabel(
                    selected.validityEndDate,
                  )}
                </strong>
              </div>
            </div>


            <div className="operation-section-title">
              Asignación e inventario
            </div>

            <div className="authorization-detail-grid">
              <div>
                <span>
                  Cantidad elegible
                </span>

                <strong>
                  {selected.allocatedQuantity} de{' '}
                  {selected.quantity ??
                    '—'}
                </strong>
              </div>

              <div>
                <span>
                  Orden de compra
                </span>

                <strong>
                  {selected.purchaseOrder ??
                    'Sin OC'}
                </strong>
              </div>

              <div className="authorization-detail-wide">
                <span>
                  Punto
                </span>

                <strong>
                  {selected.dispensingPointCode ??
                    'Sin punto'}
                </strong>

                {selected.dispensingPointName ? (
                  <small>
                    {
                      selected.dispensingPointName
                    }
                  </small>
                ) : null}
              </div>
            </div>


            <div className="operation-section-title">
              Operación Medicarte
            </div>

            {selected.operationalStatus ===
            'CLOSED' ? (
              <div className="authorization-closure-panel">
                <div className="authorization-closure-heading">
                  <div className="authorization-closure-check">
                    ✓
                  </div>

                  <div>
                    <strong>
                      Autorización cerrada
                    </strong>

                    <span>
                      La operación fue registrada correctamente.
                    </span>
                  </div>
                </div>

                <div className="authorization-closure-summary">
                  <div>
                    <span>
                      Tipo
                    </span>

                    <strong>
                      {fulfillmentTypeLabel(
                        selected.fulfillment
                          ?.type ??
                          null,
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Cantidad
                    </span>

                    <strong>
                      {selected.fulfillment
                        ?.quantity ??
                        '—'}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Fecha efectiva
                    </span>

                    <strong>
                      {authorizationDateLabel(
                        selected.fulfillment
                          ?.effectiveDate ??
                          null,
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Registrado
                    </span>

                    <strong>
                      {dateTimeLabel(
                        selected.fulfillment
                          ?.confirmedAt ??
                          null,
                      )}
                    </strong>
                  </div>
                </div>
              </div>
            ) : canFulfillSelected ? (
              <>
                {!managingAuthorization ? (
                  <div className="authorization-management-entry">
                    <p>
                      La autorización está disponible para que Medicarte registre su cumplimiento.
                    </p>

                    <button
                      type="button"
                      className="btn primary authorization-manage-button"
                      onClick={() => {
                        setManagingAuthorization(
                          true,
                        );

                        setFulfillmentType(
                          'APPLICATION',
                        );

                        setFulfillmentDate(
                          '',
                        );

                        setFulfillmentError(
                          null,
                        );
                      }}
                    >
                      Gestionar autorización
                    </button>
                  </div>
                ) : (
                  <div className="authorization-fulfillment-form">
                    <div className="authorization-management-heading">
                      <strong>
                        ¿Qué deseas registrar?
                      </strong>

                      <span>
                        Selecciona la operación realizada al paciente.
                      </span>
                    </div>

                    <div className="authorization-fulfillment-choice">
                      <label
                        className={
                          fulfillmentType ===
                          'APPLICATION'
                            ? 'selected'
                            : ''
                        }
                      >
                        <input
                          type="radio"
                          name="fulfillmentType"
                          checked={
                            fulfillmentType ===
                            'APPLICATION'
                          }
                          onChange={() => {
                            setFulfillmentType(
                              'APPLICATION',
                            );

                            setFulfillmentDate(
                              '',
                            );

                            setFulfillmentError(
                              null,
                            );
                          }}
                        />

                        <span>
                          Aplicar
                        </span>
                      </label>

                      <label
                        className={
                          fulfillmentType ===
                          'DELIVERY'
                            ? 'selected'
                            : ''
                        }
                      >
                        <input
                          type="radio"
                          name="fulfillmentType"
                          checked={
                            fulfillmentType ===
                            'DELIVERY'
                          }
                          onChange={() => {
                            setFulfillmentType(
                              'DELIVERY',
                            );

                            setFulfillmentDate(
                              '',
                            );

                            setFulfillmentError(
                              null,
                            );
                          }}
                        />

                        <span>
                          Entregar
                        </span>
                      </label>
                    </div>

                    <label className="authorization-fulfillment-date">
                      <span>
                        {fulfillmentType ===
                        'APPLICATION'
                          ? 'Fecha de aplicación'
                          : 'Fecha de entrega'}
                      </span>

                      <input
                        type="date"
                        className="control"
                        value={
                          fulfillmentDate
                        }
                        max={
                          fulfillmentMaxDate
                        }
                        onChange={(event) =>
                          setFulfillmentDate(
                            event.target.value,
                          )
                        }
                      />
                    </label>

                    <div className="authorization-management-summary">
                      <div>
                        <span>
                          Cantidad
                        </span>

                        <strong>
                          {selected.remainingAssignedQuantity}
                        </strong>
                      </div>

                      <div>
                        <span>
                          Punto
                        </span>

                        <strong>
                          {selected.dispensingPointCode ??
                            'Sin punto'}
                        </strong>
                      </div>
                    </div>

                    <p className="authorization-fulfillment-help">
                      La fecha efectiva no puede superar la fecha de vencimiento de la autorización.
                    </p>

                    {fulfillmentError ? (
                      <div
                        className="authorization-fulfillment-error"
                        role="alert"
                      >
                        {
                          fulfillmentError
                        }
                      </div>
                    ) : null}

                    <div className="authorization-management-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={
                          fulfilling
                        }
                        onClick={() => {
                          setManagingAuthorization(
                            false,
                          );

                          setFulfillmentDate(
                            '',
                          );

                          setFulfillmentError(
                            null,
                          );
                        }}
                      >
                        Cancelar
                      </button>

                      <button
                        type="button"
                        className="btn primary"
                        disabled={
                          !fulfillmentDate ||
                          fulfilling
                        }
                        onClick={() =>
                          void confirmFulfillment()
                        }
                      >
                        {fulfilling
                          ? 'Guardando…'
                          : fulfillmentType ===
                              'APPLICATION'
                            ? 'Confirmar aplicación'
                            : 'Confirmar entrega'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="authorization-operation-message">
                {selected.operationalStatus ===
                'UNASSIGNED'
                  ? 'La autorización todavía no tiene inventario asignado.'
                  : 'La gestión está disponible únicamente para Medicarte.'}
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </>
  );
}
