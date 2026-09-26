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
  type AuthorizationQueryAuditStatus,
  type AuthorizationQueryFilters,
  type AuthorizationQueryItem,
} from '@/lib/authorization-query-api';

import {
  downloadExportable,
  saveExportable,
} from '@/lib/exportables-api';

function initialValidationLabel(
  status:
    AuthorizationQueryItem['initialValidationStatus'],
) {
  const labels = {
    PASSED:
      'Cumple',

    PENDING:
      'Validación pendiente',

    FAILED:
      'No cumple',
  } satisfies Record<
    AuthorizationQueryItem['initialValidationStatus'],
    string
  >;

  return labels[status];
}


function authorizationLifecycleLabel(
  item: AuthorizationQueryItem,
): 'Habilitada' | 'Inhabilitada' | 'Pendiente' {
  /*
   * Habilitación funcional:
   *
   * 1. La validación inicial es prerrequisito.
   * 2. Una AUTO pendiente de validación no puede
   *    considerarse habilitada todavía.
   * 3. Si ya pasó la validación, el vencimiento
   *    solo la inhabilita cuando NO existe OC
   *    relacionada.
   *
   * La existencia histórica de una OC nunca se
   * elimina por esta decisión.
   */
  if (
    item.initialValidationStatus ===
      'FAILED'
  ) {
    return 'Inhabilitada';
  }

  if (
    item.initialValidationStatus ===
      'PENDING'
  ) {
    return 'Pendiente';
  }

  const expiredWithoutPurchaseOrder =
    item.validityStatus ===
      'EXPIRED'
    &&
    item.purchaseOrders.length ===
      0;

  return expiredWithoutPurchaseOrder
    ? 'Inhabilitada'
    : 'Habilitada';
}


function validityLabel(
  status:
    AuthorizationQueryItem['validityStatus'],
) {
  const labels = {
    IN_WINDOW:
      'Dentro de rango',

    EXPIRED:
      'Vencida',

    OUTSIDE_HORIZON:
      'Fuera de rango +30',

    INVALID_DATE:
      'Fecha inválida',
  } satisfies Record<
    AuthorizationQueryItem['validityStatus'],
    string
  >;

  return labels[status];
}


function fulfillmentStatusLabel(
  status:
    AuthorizationQueryItem['fulfillmentStatus'],
) {
  const labels = {
    PENDING:
      'Pendiente',

    DELIVERED:
      'Entregada',

    APPLIED:
      'Aplicada',
  } satisfies Record<
    AuthorizationQueryItem['fulfillmentStatus'],
    string
  >;

  return labels[status];
}


function auditStatusLabel(
  status:
    AuthorizationQueryAuditStatus,
) {
  const labels = {
    PENDING:
      'Pendiente',

    IN_REVIEW:
      'En auditoría',

    APPROVED:
      'Se puede facturar',

    REJECTED:
      'No se puede facturar',
  } satisfies Record<
    AuthorizationQueryAuditStatus,
    string
  >;

  return labels[status];
}


function authorizationAuditStatus(
  item:
    AuthorizationQueryItem,
): AuthorizationQueryAuditStatus {
  const {
    auditStatus,
  } =
    item;

  return auditStatus;
}


function operationalLabel(
  status:
    AuthorizationQueryItem['operationalStatus'],
) {
  const labels = {
    UNASSIGNED:
      'Pendiente de recepción/asignación',

    ASSIGNED:
      'Lista para entrega/aplicación',

    CLOSED:
      'Cerrada',
  };

  return labels[status];
}

function singlePurchaseOrderCode(
  value:
    string | null,
) {
  if (!value) {
    return null;
  }

  const codes =
    value
      .split(',')
      .map(
        (candidate) =>
          candidate.trim(),
      )
      .filter(Boolean);

  if (
    codes.length !==
    1
  ) {
    return null;
  }

  return codes[0]!;
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
    operationalStatus: '',
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

  const [
    exportingAuthorizations,
    setExportingAuthorizations,
  ] =
    useState(
      false,
    );


  async function exportAuthorizations() {
    setFulfillmentError(
      null,
    );

    setExportingAuthorizations(
      true,
    );

    try {
      const blob =
        await downloadExportable(
          organizationId,
          'authorizations',
        );

      saveExportable(
        blob,
        'autorizaciones-consolidado.xlsx',
      );
    } catch (
      cause
    ) {
      setFulfillmentError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible exportar las autorizaciones.',
      );
    } finally {
      setExportingAuthorizations(
        false,
      );
    }
  }


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

        ...(appliedFilters.operationalStatus
          ? {
              operationalStatus: appliedFilters.operationalStatus as NonNullable<
                AuthorizationQueryFilters['operationalStatus']
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
      operationalStatus: '',
      coverageType: '',
    };

    setFilters(cleared);
    setAppliedFilters(cleared);
    setPage(1);
  }

  async function openDetail(
    item:
      AuthorizationQueryItem,
  ) {
    /*
     * La lista trae purchaseOrders[] vacío
     * intencionalmente para mantenerse liviana.
     *
     * Al abrir Ver recuperamos el detail real,
     * que contiene la relación durable
     * AUTO -> purchase_order_authorization_sources -> OC.
     */
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

    if (!organizationId) {
      return;
    }

    try {
      const detail =
        await getAuthorizationQueryItem(
          organizationId,
          item.id,
        );

      /*
       * Evita que una respuesta tardía reabra o
       * reemplace otra autorización seleccionada.
       */
      setSelected(
        (current) =>
          current?.id === item.id
            ? detail
            : current,
      );
    } catch (cause) {
      setFulfillmentError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible cargar el detalle completo de la autorización.',
      );
    }
  }


  async function confirmFulfillment() {
    const purchaseOrderCode =
      singlePurchaseOrderCode(
        selected?.purchaseOrder ??
          null,
      );

    if (
      !selected ||
      !organizationId ||
      !fulfillmentDate ||
      fulfilling
    ) {
      return;
    }

    if (
      !selected.operationalEligible
    ) {
      setFulfillmentError(
        'La autorización no está habilitada para entrega/aplicación porque está fuera de la ventana operacional Hoy + 30 o no superó la validación.',
      );

      return;
    }

    if (
      !purchaseOrderCode
    ) {
      setFulfillmentError(
        'No existe una única orden de compra asociada a la asignación disponible.',
      );

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
          purchaseOrderCode,

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
      selected.operationalEligible &&
      canFulfill &&
      selected.operationalStatus ===
        'ASSIGNED' &&
      selected.remainingAssignedQuantity >
        0 &&
      singlePurchaseOrderCode(
        selected.purchaseOrder,
      ) !== null,
    );

  return (
    <>
      <PageHeader
        title="Consulta de Autorizaciones"
        description="Consulta las autorizaciones registradas y su estado actual."
        actions={
          <>
            {hasPermission(
              'operational_exports.create',
            ) ? (
              <button
                type="button"
                className="btn"
                disabled={
                  exportingAuthorizations
                }
                onClick={() => {
                  void exportAuthorizations();
                }}
              >
                {
                  exportingAuthorizations
                    ? 'Generando…'
                    : 'Exportar autorizaciones'
                }
              </button>
            ) : null}

            <FulfillmentBulkActions
              organizationId={organizationId}
              canManage={hasPermission(
                'patient_applications.manage',
              )}
              onImported={() => {
                window.location.reload();
              }}
            />
          </>
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
                value={filters.operationalStatus}
                onChange={(event) =>
                  setFilters({
                    ...filters,

                    operationalStatus:
                      event.target.value,
                  })
                }
              >
                <option value="">
                  Todos
                </option>

                <option value="UNASSIGNED">
                  Pendiente de recepción/asignación
                </option>

                <option value="ASSIGNED">
                  Lista para entrega/aplicación
                </option>

                <option value="CLOSED">
                  Cerrada
                </option>
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
            <table
              style={{
                minWidth: '1245px',
                tableLayout: 'fixed',
              }}
            >
              <colgroup>
                <col style={{ width: '145px' }} />
                <col style={{ width: '170px' }} />
                <col style={{ width: '205px' }} />
                <col style={{ width: '60px' }} />
                <col style={{ width: '145px' }} />
                <col style={{ width: '225px' }} />
                <col style={{ width: '155px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '85px' }} />
              </colgroup>

              <thead>
                <tr>
                  <th>Autorización</th>

                  <th>Paciente</th>

                  <th>Producto</th>

                  <th>Cant.</th>

                  <th>Vigencia</th>

                  <th>Estado operativo</th>

                  <th>Validación</th>

                  <th>Auditoría</th>

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
                          {item.productDescription ??
                            'Sin nombre de producto'}
                        </strong>

                        <span>
                          COD: {item.commercialCode}
                        </span>
                      </div>
                    </td>

                    <td>
                      <strong>
                        {item.quantity ?? '—'}
                      </strong>
                    </td>

                    <td>
                      <div className="authorization-cell-stack">
                        <strong>
                          {validityLabel(
                            item.validityStatus,
                          )}
                        </strong>

                        <span>
                          {item.validityStatus ===
                          'OUTSIDE_HORIZON'
                            ? `Inicia: ${authorizationDateLabel(
                                item.assignmentDate,
                              )}`
                            : item.validityStatus ===
                                'EXPIRED'
                              ? `Venció: ${authorizationDateLabel(
                                  item.validityEndDate,
                                )}`
                              : item.validityStatus ===
                                  'IN_WINDOW'
                                ? `Vence: ${authorizationDateLabel(
                                    item.validityEndDate,
                                  )}`
                                : 'Fechas no válidas'}
                        </span>
                      </div>
                    </td>

                    <td
                      style={{
                        verticalAlign: 'middle',
                        overflow: 'hidden',
                      }}
                    >
                      <span
                        className={`authorization-operational-status ${item.operationalStatus.toLowerCase()}`}
                        style={{
                          whiteSpace: 'normal',
                          lineHeight: 1.25,
                          maxWidth: '100%',
                          textAlign: 'left',
                        }}
                      >
                        {operationalLabel(
                          item.operationalStatus,
                        )}
                      </span>
                    </td>

                    <td
                      style={{
                        verticalAlign: 'middle',
                        paddingLeft: '20px',
                      }}
                    >
                      <strong>
                        {initialValidationLabel(
                          item.initialValidationStatus,
                        )}
                      </strong>
                    </td>

                    <td>
                      <strong>
                        {auditStatusLabel(
                          authorizationAuditStatus(
                            item,
                          ),
                        )}
                      </strong>
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
                          void openDetail(item);
                        }}
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}

                {!query.loading &&
                (data?.items.length ?? 0) ===
                  0 ? (
                  <tr>
                    <td colSpan={9}>
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
                  Habilitación
                </span>

                <strong>
                  {authorizationLifecycleLabel(
                    selected,
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Validación inicial
                </span>

                <strong>
                  {initialValidationLabel(
                    selected.initialValidationStatus,
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

              <div>
                <span>
                  Vigencia
                </span>

                <strong>
                  {validityLabel(
                    selected.validityStatus,
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Entrega / aplicación
                </span>

                <strong>
                  {fulfillmentStatusLabel(
                    selected.fulfillmentStatus,
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Auditoría
                </span>

                <strong>
                  {auditStatusLabel(
                    authorizationAuditStatus(
                      selected,
                    ),
                  )}
                </strong>
              </div>
            </div>


            {!selected.operationalEligible ? (
              <div className="authorization-operation-message">
                Esta autorización se conserva visible para consulta,
                pero no está habilitada para operaciones. Para entregar,
                aplicar o participar en gestión de compra debe haber superado
                la validación inicial y estar dentro de la ventana operacional
                Hoy + 30.
              </div>
            ) : null}


            <div className="operation-section-title">
              Asignación e inventario
            </div>

            <div className="authorization-detail-grid">
              <div>
                <span>
                  Cantidad asignada
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
                  {selected.purchaseOrders.length > 0
                    ? selected.purchaseOrders
                        .map(
                          (order) =>
                            order.purchaseOrderCode,
                        )
                        .join(', ')
                    : 'Sin OC'}
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
                  ? 'La autorización aún no tiene producto recibido y asignado. OLP debe gestionar la cantidad y Medicarte debe confirmar la recepción antes de entregar o aplicar.'
                  : 'La gestión está disponible únicamente para Medicarte.'}
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </>
  );
}
