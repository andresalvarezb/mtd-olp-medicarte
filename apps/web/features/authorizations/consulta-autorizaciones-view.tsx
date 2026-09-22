'use client';

import { useState } from 'react';

import { PageHeader } from '@/components/ui/page-header';

import { Card, CardBody, CardHead } from '@/components/ui/card';

import { FilterActions, FilterBar, FilterField } from '@/components/ui/filter-bar';

import { useRole } from '@/components/layout/role-context';

import { useApiData } from '@/hooks/use-api-data';

import {
  listAuthorizationQuery,
  type AuthorizationQueryFilters,
  type AuthorizationQueryItem,
} from '@/lib/authorization-query-api';

function enablementLabel(status: string) {
  return status === 'ENABLED' ? 'Habilitada' : 'Bloqueada';
}

function operationLabel(status: string | null) {
  const labels: Record<string, string> = {
    BLOCKED: 'Bloqueada',

    READY_TO_DISPENSE: 'Elegible',

    DISPENSATION_REPORTED: 'Dispensación reportada',

    DISPENSED: 'Dispensada',

    EXPIRED: 'Vencida',
  };

  return status ? (labels[status] ?? status) : 'Sin estado';
}

export function ConsultaAutorizacionesView() {
  const { organizationId } = useRole();

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

  return (
    <>
      <PageHeader
        title="Consulta de Autorizaciones"
        description="Consulta las autorizaciones registradas y su estado actual."
      />

      <Card>
        <CardHead
          title="Autorizaciones"
          subtitle="Busca por autorización, producto, paciente o estado."
        />

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
              <button type="button" className="button primary" onClick={applyFilters}>
                Filtrar
              </button>

              <button type="button" className="button" onClick={clearFilters}>
                Limpiar
              </button>
            </FilterActions>
          </FilterBar>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Autorización</th>

                  <th>Producto</th>

                  <th>Paciente</th>

                  <th>Documento</th>

                  <th>Asignación</th>

                  <th>Vigencia</th>

                  <th>Estado</th>

                  <th />
                </tr>
              </thead>

              <tbody>
                {(data?.items ?? []).map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.authorizationNumber}</strong>
                    </td>

                    <td>{item.commercialCode}</td>

                    <td>{item.patientName ?? '—'}</td>

                    <td>{item.patientDocument ?? '—'}</td>

                    <td>{item.assignmentDate ?? '—'}</td>

                    <td>{item.validityEndDate ?? '—'}</td>

                    <td>{enablementLabel(item.enablementStatus)}</td>

                    <td>
                      <button type="button" className="button" onClick={() => setSelected(item)}>
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}

                {!query.loading && (data?.items.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="table-empty-state">
                        <strong>Sin resultados</strong>

                        <span>No existen autorizaciones con los filtros seleccionados.</span>
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
        <div className="operation-drawer-backdrop" onMouseDown={() => setSelected(null)}>
          <aside className="operation-drawer" onMouseDown={(event) => event.stopPropagation()}>
            <div className="operation-drawer-header">
              <div>
                <span>Autorización</span>

                <h2>{selected.authorizationNumber}</h2>

                <p>{operationLabel(selected.logisticsStatus)}</p>
              </div>

              <button type="button" className="operation-close" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>

            <div className="authorization-detail-grid">
              <div>
                <span>Código comercial</span>

                <strong>{selected.commercialCode}</strong>
              </div>

              <div>
                <span>Cantidad</span>

                <strong>{selected.quantity ?? '—'}</strong>
              </div>

              <div>
                <span>Cobertura</span>

                <strong>{selected.coverageType}</strong>
              </div>

              <div>
                <span>Estado</span>

                <strong>{enablementLabel(selected.enablementStatus)}</strong>
              </div>

              <div>
                <span>Asignación</span>

                <strong>{selected.assignmentDate ?? '—'}</strong>
              </div>

              <div>
                <span>Vigencia</span>

                <strong>{selected.validityEndDate ?? '—'}</strong>
              </div>

              <div>
                <span>Orden de compra</span>

                <strong>{selected.purchaseOrder ?? 'Sin asignar'}</strong>
              </div>
            </div>

            <div className="operation-section-title">Paciente</div>

            <div className="authorization-detail-patient">
              <strong>{selected.patientName ?? 'Sin nombre registrado'}</strong>

              <span>{selected.patientDocument ?? 'Sin documento'}</span>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
