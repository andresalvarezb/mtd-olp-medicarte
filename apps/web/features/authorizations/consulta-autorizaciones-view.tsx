'use client';

import { useState } from 'react';

import { PageHeader } from '@/components/ui/page-header';

import { Card, CardBody, CardHead } from '@/components/ui/card';

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
      'Asignada',

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

import { DispensacionBulkActions } from './dispensacion-bulk-actions';
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

  const canFulfill =
    hasPermission(
      'patient_applications.manage',
    );


  const query = useApiData(
    () =>
      listAuthorizationQuery(organizationId, {
        page,
        limit: 50,

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
    [organizationId, appliedFilters, page],
  );

  const data = query.data;

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

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

      query.reload();
    } catch (caught) {
      setFulfillmentError(
        caught instanceof Error
          ? caught.message
          : 'No fue posible registrar la dispensación.',
      );
    } finally {
      setFulfilling(
        false,
      );
    }
  }

  const todayBogota =
    currentBogotaDate();

  const fulfillmentMaxDate =
    selected?.validityEndDate &&
    selected.validityEndDate <
      todayBogota
      ? selected.validityEndDate
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
      />

      <DispensacionBulkActions
        organizationId={organizationId}
        canManage={hasPermission('bulk_updates.dispensation_date')}
        onImported={() => {
          window.location.reload();
        }}
      />

      <FulfillmentBulkActions
        organizationId={organizationId}
        canManage={hasPermission(
          'patient_applications.manage',
        )}
        onImported={() => {
          window.location.reload();
        }}
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
                <div className="authorization-query-actions">
              <button type="button" className="button primary" onClick={applyFilters}>
                Filtrar
              </button>

              <button type="button" className="button" onClick={clearFilters}>
                Limpiar
              </button>

                </div>
              </FilterActions>
          </FilterBar>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Autorización</th>

                  <th>Paciente</th>

                  <th>Producto</th>

                  <th>Asignación</th>

                  <th>OC</th>

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
                      {item.operationalStatus === 'CLOSED'
                        ? 'Consumida'
                        : item.remainingAssignedQuantity > 0
                          ? `${item.remainingAssignedQuantity} asignada(s)`
                          : 'Sin asignar'}
                    </td>

                    <td>
                      {item.purchaseOrder ?? '—'}
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

          <div className="query-pagination">
            <span>{data ? `${data.total} registros` : 'Cargando…'}</span>

            <div>
              <button
                type="button"
                className="button"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Anterior
              </button>

              <span>
                Página {page} de {totalPages}
              </span>

              <button
                type="button"
                className="button"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
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
              <div>
                <span>
                  Autorización
                </span>

                <h2>
                  {selected.authorizationNumber}
                </h2>

                <p>
                  {operationalLabel(selected.operationalStatus)}
                </p>
              </div>

              <button
                type="button"
                className="operation-close"
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>

            <div className="operation-section-title">
              Paciente
            </div>

            <div className="authorization-detail-patient">
              <strong>
                {selected.patientName ?? 'Sin nombre registrado'}
              </strong>

              <span>
                {selected.patientDocument ?? 'Sin documento'}
              </span>
            </div>

            <div className="operation-section-title">
              Producto y asignación
            </div>

            <div className="authorization-detail-grid">
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
                  {selected.productDescription ?? 'Sin nombre'}
                </strong>
              </div>

              <div>
                <span>
                  Cantidad autorizada
                </span>

                <strong>
                  {selected.quantity ?? '—'}
                </strong>
              </div>

              <div>
                <span>
                  Cantidad asignada
                </span>

                <strong>
                  {selected.allocatedQuantity}
                </strong>
              </div>

              <div>
                <span>
                  Pendiente asignada
                </span>

                <strong>
                  {selected.remainingAssignedQuantity}
                </strong>
              </div>

              <div>
                <span>
                  Orden de compra
                </span>

                <strong>
                  {selected.purchaseOrder ?? 'Sin OC'}
                </strong>
              </div>

              <div>
                <span>
                  Punto
                </span>

                <strong>
                  {selected.dispensingPointCode ?? 'Sin punto'}
                </strong>

                {selected.dispensingPointName ? (
                  <small>
                    {selected.dispensingPointName}
                  </small>
                ) : null}
              </div>

              <div>
                <span>
                  Vigencia
                </span>

                <strong>
                  {selected.validityEndDate ?? '—'}
                </strong>
              </div>

              <div>
                <span>
                  Cobertura
                </span>

                <strong>
                  {selected.coverageType}
                </strong>
              </div>

              <div>
                <span>
                  Estado fuente
                </span>

                <strong>
                  {enablementLabel(selected.enablementStatus)}
                </strong>
              </div>
            </div>

            <div className="operation-section-title">
              Operación Medicarte
            </div>

            {selected.operationalStatus === 'CLOSED' ? (
              <div className="authorization-closure-summary">
                <div>
                  <span>
                    Estado
                  </span>

                  <strong>
                    Cerrada
                  </strong>
                </div>

                <div>
                  <span>
                    Tipo
                  </span>

                  <strong>
                    {fulfillmentTypeLabel(
                      selected.fulfillment?.type ?? null,
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    Fecha efectiva
                  </span>

                  <strong>
                    {selected.fulfillment?.effectiveDate ?? '—'}
                  </strong>
                </div>

                <div>
                  <span>
                    Cantidad
                  </span>

                  <strong>
                    {selected.fulfillment?.quantity ?? '—'}
                  </strong>
                </div>

                <div>
                  <span>
                    Registrado en sistema
                  </span>

                  <strong>
                    {dateTimeLabel(
                      selected.fulfillment?.confirmedAt ?? null,
                    )}
                  </strong>
                </div>
              </div>
            ) : canFulfillSelected ? (
              <div className="authorization-fulfillment-form">
                <div>
                  <span className="authorization-fulfillment-label">
                    Tipo de dispensación
                  </span>

                  <div className="authorization-fulfillment-choice">
                    <label>
                      <input
                        type="radio"
                        name="fulfillmentType"
                        checked={fulfillmentType === 'APPLICATION'}
                        onChange={() => setFulfillmentType('APPLICATION')}
                      />

                      Aplicación
                    </label>

                    <label>
                      <input
                        type="radio"
                        name="fulfillmentType"
                        checked={fulfillmentType === 'DELIVERY'}
                        onChange={() => setFulfillmentType('DELIVERY')}
                      />

                      Entrega
                    </label>
                  </div>
                </div>

                <label className="authorization-fulfillment-date">
                  <span>
                    {fulfillmentType === 'APPLICATION'
                      ? 'Fecha de aplicación'
                      : 'Fecha de entrega'}
                  </span>

                  <input
                    type="date"
                    className="control"
                    value={fulfillmentDate}
                    max={fulfillmentMaxDate}
                    onChange={(event) =>
                      setFulfillmentDate(event.target.value)
                    }
                  />
                </label>

                <p className="authorization-fulfillment-help">
                  La autorización puede estar vencida hoy. La fecha efectiva debe ser como máximo el último día de vigencia.
                </p>

                {fulfillmentError ? (
                  <div
                    className="authorization-fulfillment-error"
                    role="alert"
                  >
                    {fulfillmentError}
                  </div>
                ) : null}

                <div className="authorization-detail-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={!fulfillmentDate || fulfilling}
                    onClick={() => void confirmFulfillment()}
                  >
                    {fulfilling
                      ? 'Registrando…'
                      : 'Confirmar dispensación'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="authorization-operation-message">
                {selected.operationalStatus === 'UNASSIGNED'
                  ? 'La autorización todavía no tiene producto asignado en Disponibilidad.'
                  : 'La operación está disponible únicamente para Medicarte.'}
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </>
  );
}
