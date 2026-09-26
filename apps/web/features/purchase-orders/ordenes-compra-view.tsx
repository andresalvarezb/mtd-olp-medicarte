'use client';

import { useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import type {
  PurchaseOrderListQuery,
  PurchaseOrderOperationalState,
  PurchaseOrderResponse,
} from '@authorization/contracts';

import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHead } from '@/components/ui/card';
import { FilterActions, FilterBar, FilterField } from '@/components/ui/filter-bar';
import { useApiData } from '@/hooks/use-api-data';
import { useRole } from '@/components/layout/role-context';
import {
  downloadPurchaseOrderTemplate,
  listPurchaseOrders,
  listSupplierPurchaseOrders,
  uploadPurchaseOrderImport,
  type PurchaseOrderImportResult,
} from '@/lib/purchase-orders-api';
import { issuePurchaseOrder } from '@/lib/purchase-orders-api';
import {
  downloadExportable,
  saveExportable,
} from '@/lib/exportables-api';

type DetailedOrder =
  Omit<
    PurchaseOrderResponse,
    'status' | 'orderType'
  > & {
    status: string;

    orderType:
      | 'STANDARD'
      | 'COMPLEMENTARY'
      | null;

    olpAcceptedAt?:
      | string
      | null;

    olpCommittedDate?:
      | string
      | null;

    latestSupplierObservation?:
      | string
      | null;

    operationalState?:
      PurchaseOrderOperationalState;

    requestedQuantity?:
      number;

    receivedQuantity?:
      number;

    pendingQuantity?:
      number;
  };

type OrderStatusGroup =
  | ''
  | PurchaseOrderOperationalState;


const STATUS_GROUP_LABELS:
  Record<
    PurchaseOrderOperationalState,
    string
  > = {
    PENDING_OLP:
      'Pendiente OLP',

    PENDING_MEDICARTE:
      'Pendiente Medicarte',

    RECEIVED_WITH_PENDING:
      'Recibida con pendiente',

    RECEIVED:
      'Recibida',

    REJECTED:
      'Rechazada',

    CANCELLED:
      'Cancelada',
  };


const STATUS_GROUP_CLASSES:
  Record<
    PurchaseOrderOperationalState,
    string
  > = {
    PENDING_OLP:
      'status-pending-olp',

    PENDING_MEDICARTE:
      'status-pending-medicarte',

    RECEIVED_WITH_PENDING:
      'status-received-with-pending',

    RECEIVED:
      'status-received',

    REJECTED:
      'status-rejected',

    CANCELLED:
      'status-cancelled',
  };


function statusGroup(
  order: Pick<
    DetailedOrder,
    | 'status'
    | 'olpAcceptedAt'
    | 'operationalState'
  >,
): PurchaseOrderOperationalState {
  /*
   * Fuente autoritativa para la bandeja:
   * estado operacional calculado por backend a partir
   * de aceptación OLP + recepción acumulada real.
   */
  if (
    order.operationalState
  ) {
    return order.operationalState;
  }

  /*
   * Fallback defensivo para respuestas antiguas.
   */
  if (
    order.status ===
    'CANCELLED'
  ) {
    return 'CANCELLED';
  }

  if (
    order.status ===
    'REJECTED'
  ) {
    return 'REJECTED';
  }

  if (
    order.status ===
    'RECEIVED'
  ) {
    return 'RECEIVED';
  }

  if (
    order.status ===
    'PARTIALLY_RECEIVED'
  ) {
    return 'RECEIVED_WITH_PENDING';
  }

  if (
    order.olpAcceptedAt ||
    [
      'ACCEPTED',
      'PARTIALLY_ACCEPTED',
      'IN_FULFILLMENT',
      'PARTIALLY_DISPATCHED',
      'FULLY_DISPATCHED',
    ].includes(
      order.status,
    )
  ) {
    return 'PENDING_MEDICARTE';
  }

  return 'PENDING_OLP';
}


function statusGroupLabel(
  order: Pick<
    DetailedOrder,
    | 'status'
    | 'olpAcceptedAt'
    | 'operationalState'
  >,
) {
  return STATUS_GROUP_LABELS[
    statusGroup(
      order,
    )
  ];
}


function statusGroupClass(
  order: Pick<
    DetailedOrder,
    | 'status'
    | 'olpAcceptedAt'
    | 'operationalState'
  >,
) {
  return STATUS_GROUP_CLASSES[
    statusGroup(
      order,
    )
  ];
}


function issueOutcomeLabel(
  status: string,
) {
  if (
    status ===
    'REJECTED'
  ) {
    return 'Devuelta por OLP';
  }

  if (
    status ===
    'CANCELLED'
  ) {
    return 'Cancelada';
  }

  return null;
}


function rowStatusReason(
  status: string,
) {
  return issueOutcomeLabel(
    status,
  );
}


function money(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  URL.revokeObjectURL(url);
}

export function PurchaseOrdersView() {
  const router = useRouter();
  const {
    organizationId,
    hasPermission,
    me,
  } = useRole();

  const canManage =
    hasPermission(
      'purchase_orders.manage',
    );

  const activeOrganization =
    me?.organizations.find(
      (organization) =>
        organization.id ===
        organizationId,
    );

  const isOlp =
    activeOrganization?.code ===
    'OLP';

  const canExport =
    activeOrganization?.code ===
      'MTD'
    &&
    hasPermission(
      'operational_exports.create',
    );

  const fileInput = useRef<HTMLInputElement>(null);

  const [filters, setFilters] = useState<{
    purchaseOrderCode: string;
    commercialCode: string;
    status: OrderStatusGroup;
    orderType: PurchaseOrderListQuery['orderType'];
  }>({
    purchaseOrderCode: '',
    commercialCode: '',
    status: '',
    orderType: undefined,
  });

  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [selectedOrder, setSelectedOrder] = useState<DetailedOrder | null>(null);
  const [importResult, setImportResult] = useState<PurchaseOrderImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [
    exporting,
    setExporting,
  ] =
    useState<
      | 'AUTO_OC'
      | 'OC'
      | null
    >(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const orders = useApiData(async () => {
    /*
     * Los filtros de texto/tipo se ejecutan en el backend.
     * El filtro de macroestado se aplica en frontend porque
     * PENDING_OLP/PENDING_MEDICARTE son estados operacionales
     * y no necesariamente coinciden con po.status.
     */
    const query = {
      purchaseOrderCode:
        appliedFilters.purchaseOrderCode ||
        undefined,

      commercialCode:
        appliedFilters.commercialCode ||
        undefined,

      orderType:
        appliedFilters.orderType,

      limit: 500,
    };

    const list =
      isOlp
        ? listSupplierPurchaseOrders
        : listPurchaseOrders;

    const [
      active,
      cancelled,
    ] =
      await Promise.all([
        list(
          organizationId,
          query,
        ),

        list(
          organizationId,
          {
            ...query,
            status:
              'CANCELLED',
          },
        ),
      ]);

    const unique =
      new Map<
        string,
        DetailedOrder
      >();

    for (
      const raw
      of [
        ...active.items,
        ...cancelled.items,
      ]
    ) {
      const order =
        raw as DetailedOrder;

      unique.set(
        order.id,
        order,
      );
    }

    return {
      items:
        Array.from(
          unique.values(),
        ),
    };
  }, [
    organizationId,
    appliedFilters,
    isOlp,
  ]);


  const visibleOrders = (orders.data?.items ?? []).filter(
    (order) => !appliedFilters.status || statusGroup(order) === appliedFilters.status,
  );

  const totalPages =
    Math.max(
      Math.ceil(
        visibleOrders.length / pageSize,
      ),
      1,
    );

  const safePage =
    Math.min(
      page,
      totalPages,
    );

  const firstVisible =
    visibleOrders.length > 0
      ? (safePage - 1) * pageSize + 1
      : 0;

  const lastVisible =
    Math.min(
      safePage * pageSize,
      visibleOrders.length,
    );

  const pagedOrders =
    visibleOrders.slice(
      (safePage - 1) * pageSize,
      safePage * pageSize,
    );

  async function exportPurchaseOrderWorkbook(
    kind:
      'AUTO_OC'
      | 'OC',
  ) {
    setError(
      null,
    );

    setExporting(
      kind,
    );

    try {
      if (
        kind ===
          'AUTO_OC'
      ) {
        const blob =
          await downloadExportable(
            organizationId,
            'purchase-order-candidates',
          );

        saveExportable(
          blob,
          'AUTO-para-generar-OC.xlsx',
        );

        return;
      }

      const blob =
        await downloadExportable(
          organizationId,
          'purchase-orders',
        );

      saveExportable(
        blob,
        'ordenes-compra.xlsx',
      );
    } catch (
      cause
    ) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible generar la exportación.',
      );
    } finally {
      setExporting(
        null,
      );
    }
  }


  async function uploadOc(file: File | undefined) {
    if (!file) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result = await uploadPurchaseOrderImport(organizationId, file);

      setImportResult(result);
      orders.reload();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No fue posible cargar las órdenes de compra.',
      );
    } finally {
      setBusy(false);

      if (fileInput.current) {
        fileInput.current.value = '';
      }
    }
  }

  async function issue(order: DetailedOrder) {
    setBusy(true);
    setError(null);

    try {
      const issued = await issuePurchaseOrder(organizationId, order.id, order.version);

      setSelectedOrder(issued as DetailedOrder);
      orders.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible emitir la OC.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Órdenes de compra"
        description="Carga y consulta las órdenes de compra que serán revisadas por OLP y recibidas por Medicarte."
        actions={
          <>
            {canExport ? (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={
                    exporting !==
                    null
                  }
                  onClick={() => {
                    void exportPurchaseOrderWorkbook(
                      'AUTO_OC',
                    );
                  }}
                >
                  {
                    exporting ===
                      'AUTO_OC'
                      ? 'Generando…'
                      : 'Exportar AUTO para OC'
                  }
                </button>

                <button
                  type="button"
                  className="btn"
                  disabled={
                    exporting !==
                    null
                  }
                  onClick={() => {
                    void exportPurchaseOrderWorkbook(
                      'OC',
                    );
                  }}
                >
                  {
                    exporting ===
                      'OC'
                      ? 'Generando…'
                      : 'Exportar OC'
                  }
                </button>
              </>
            ) : null}

            {canManage ? (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void downloadPurchaseOrderTemplate(organizationId).then((blob) =>
                      downloadBlob(blob, 'plantilla-ordenes-compra.xlsx'),
                    );
                  }}
                >
                  Descargar plantilla
                </button>

                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  Cargar OC
                </button>

                <input
                  ref={fileInput}
                  hidden
                  type="file"
                  accept=".xlsx"
                  onChange={(event) => {
                    void uploadOc(event.target.files?.[0]);
                  }}
                />
              </>
            ) : null}
          </>
        }
      />

      {error ? (
        <div className="login-error" role="alert">
          {error}
        </div>
      ) : null}

      {orders.error ? (
        <div
          className="login-error"
          role="alert"
        >
          {orders.error}
        </div>
      ) : null}

      {importResult ? (
        <Card>
          <CardHead title="Carga finalizada" subtitle="Resultado del archivo procesado." />

          <CardBody>
            <div className="auto-import-summary">
              <div className="auto-import-metric">
                <span>Procesadas</span>

                <strong>{(importResult.acceptedRows ?? 0) + importResult.rejectedRows}</strong>
              </div>

              <div className="auto-import-metric success">
                <span>Pasaron</span>

                <strong>{importResult.acceptedRows ?? 0}</strong>
              </div>

              <div className="auto-import-metric danger">
                <span>No pasaron</span>

                <strong>{importResult.rejectedRows}</strong>
              </div>
            </div>

            <div className="purchase-upload-summary-footer">
              <div className="purchase-upload-created">
                <span>OC creadas</span>

                <strong>{importResult.createdOrders}</strong>
              </div>

              {importResult.rejectedRows > 0 && importResult.rejectedWorkbookBase64 ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const rejectedWorkbook = importResult.rejectedWorkbookBase64;

                    if (!rejectedWorkbook) {
                      return;
                    }

                    const binary = window.atob(rejectedWorkbook);

                    const bytes = new Uint8Array(binary.length);

                    for (let index = 0; index < binary.length; index += 1) {
                      bytes[index] = binary.charCodeAt(index);
                    }

                    downloadBlob(
                      new Blob([bytes], {
                        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                      }),
                      'OC-rechazadas.xlsx',
                    );
                  }}
                >
                  Descargar rechazadas
                </button>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card className="operational-list-workspace">
        <CardBody>
          <FilterBar>
              <FilterField label="Código OC">
                <input
                  className="control"
                  value={filters.purchaseOrderCode}
                  onChange={(event) =>
                    setFilters({
                      ...filters,
                      purchaseOrderCode: event.target.value,
                    })
                  }
                  placeholder="OC-..."
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

              <FilterField label="Tipo">
                <select
                  className="control"
                  value={filters.orderType ?? ''}
                  onChange={(event) =>
                    setFilters({
                      ...filters,
                      orderType: (event.target.value ||
                        undefined) as PurchaseOrderListQuery['orderType'],
                    })
                  }
                >
                  <option value="">Todos</option>
                  <option value="STANDARD">Estándar</option>
                  <option value="COMPLEMENTARY">Complementaria</option>
                </select>
              </FilterField>

              <FilterField label="Estado">
                <select
                  className="control"
                  value={filters.status ?? ''}
                  onChange={(event) =>
                    setFilters({
                      ...filters,
                      status: event.target.value as OrderStatusGroup,
                    })
                  }
                >
                  <option value="">Todos</option>
                  <option value="PENDING_OLP">
                    Pendiente OLP
                  </option>
                  <option value="PENDING_MEDICARTE">
                    Pendiente Medicarte
                  </option>
                  <option value="RECEIVED_WITH_PENDING">
                    Recibida con pendiente
                  </option>
                  <option value="RECEIVED">
                    Recibida
                  </option>
                  <option value="REJECTED">
                    Rechazada
                  </option>
                  <option value="CANCELLED">
                    Cancelada
                  </option>
</select>
              </FilterField>

              <FilterActions>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    setAppliedFilters(filters);
                    setPage(1);
                  }}
                >
                  Filtrar
                </button>

                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const cleared = {
                      purchaseOrderCode: '',
                      commercialCode: '',
                      status: '' as OrderStatusGroup,
                      orderType: undefined as PurchaseOrderListQuery['orderType'],
                    };

                    setFilters(cleared);
                    setAppliedFilters(cleared);
                    setPage(1);
                  }}
                >
                  Limpiar
                </button>
              </FilterActions>
          </FilterBar>

          <div className="operational-list-table-section">
            <div className="table-wrap operational-list-table-wrap">
              <table className="purchase-orders-table">
                <thead>
                  <tr>
                    <th>OC</th>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Productos</th>
                    <th>Unidades</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>

                <tbody>
                  {visibleOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="table-empty-state">
                          <strong>Sin órdenes de compra</strong>
                          <span>
                            Aún no hay OC cargadas o no existen resultados con los filtros
                            aplicados.
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    pagedOrders.map((order) => {
                      const units = order.lines.reduce(
                        (total, line) => total + line.requestedQuantity,
                        0,
                      );

                      return (
                        <tr key={order.id}>
                          <td>
                            <strong>{order.purchaseOrderCode ?? 'Sin código'}</strong>
                          </td>

                          <td>{new Date(order.createdAt).toLocaleDateString('es-CO')}</td>

                          <td>{
  order.orderType ===
  'STANDARD'
    ? 'Estándar'
    : order.orderType ===
        'COMPLEMENTARY'
      ? 'Complementaria'
      : 'Sin tipo'
}</td>

                          <td>{order.lines.length}</td>

                          <td>{units}</td>

                          <td>
                            <div className="oc-status-cell">
                              <span
                                className={`status-chip ${statusGroupClass(
                                  order,
                                )}`}
                              >
                                {
                                  statusGroupLabel(
                                    order,
                                  )
                                }
                              </span>

                              {rowStatusReason(order.status) ? (
                                <span className="oc-status-reason">
                                  {rowStatusReason(order.status)}
                                </span>
                              ) : null}
                            </div>
                          </td>

                          <td>
                            <button
                              type="button"
                              className="btn"
                              onClick={() =>
                                router.push(
                                  `/ordenes-compra/${order.id}`,
                                )
                              }
                            >
                              Ver
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="purchase-orders-pagination list-pagination">
            <div className="purchase-orders-pagination-summary">
              <span>
                {`Mostrando ${firstVisible}–${lastVisible} de ${visibleOrders.length}`}
              </span>

              <label className="purchase-orders-page-size-field">
                <span>
                  Filas
                </span>

                <select
                  className="control purchase-orders-page-size"
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
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>

            <div className="purchase-orders-pagination-controls">
              <button
                type="button"
                className="btn"
                disabled={
                  safePage <= 1 ||
                  orders.loading
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
                Página {safePage} de {totalPages}
              </strong>

              <button
                type="button"
                className="btn"
                disabled={
                  safePage >= totalPages ||
                  orders.loading
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

      {selectedOrder ? (
        <div className="operation-drawer-backdrop" onMouseDown={() => setSelectedOrder(null)}>
          <aside className="operation-drawer wide" onMouseDown={(event) => event.stopPropagation()}>
            <div className="operation-drawer-header">
              <div>
                <span>Orden de compra</span>

                <h2>{selectedOrder.purchaseOrderCode ?? 'Borrador'}</h2>

                <p>
                  {statusGroupLabel(selectedOrder)}

                  {rowStatusReason(selectedOrder.status)
                    ? ` · ${rowStatusReason(selectedOrder.status)}`
                    : ''}
                </p>
              </div>

              <button
                type="button"
                className="operation-close"
                onClick={() => setSelectedOrder(null)}
              >
                ×
              </button>
            </div>

            <div className="operation-metrics">
              <div>
                <span>Productos</span>
                <strong>{selectedOrder.lines.length}</strong>
              </div>

              <div>
                <span>Unidades</span>
                <strong>
                  {selectedOrder.lines.reduce((total, line) => total + line.requestedQuantity, 0)}
                </strong>
              </div>

              <div>
                <span>Valor contractual</span>
                <strong>
                  {money(
                    selectedOrder.lines.reduce(
                      (total, line) =>
                        total +
                        (line.acceptedQuantity ?? 0) * Number(line.compensarUnitRateSnapshot),
                      0,
                    ),
                  )}
                </strong>
              </div>

              <div>
                <span>Gasto OLP</span>
                <strong>
                  {money(
                    selectedOrder.lines.reduce(
                      (total, line) =>
                        total + (line.acceptedQuantity ?? 0) * Number(line.supplierUnitCost ?? 0),
                      0,
                    ),
                  )}
                </strong>
              </div>
            </div>

            {selectedOrder.latestSupplierObservation ? (
              <div className="operation-observation">
                <strong>Observación OLP</strong>
                <p>{selectedOrder.latestSupplierObservation}</p>
              </div>
            ) : null}

            <div className="operation-section-title">Productos</div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Producto</th>
                    <th>Solicitado</th>
                    <th>Aceptado OLP</th>
                    <th>Punto</th>
                    <th>Fecha</th>
                  </tr>
                </thead>

                <tbody>
                  {selectedOrder.lines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.commercialCode}</td>
                      <td>{line.productDescription ?? '—'}</td>
                      <td>{line.requestedQuantity}</td>
                      <td>{line.acceptedQuantity ?? '—'}</td>
                      <td>{line.dispensingPointName ?? '—'}</td>
                      <td>{line.requestedDeliveryDate ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="operation-drawer-footer">
              {canManage && selectedOrder.status === 'DRAFT' ? (
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => {
                    void issue(selectedOrder);
                  }}
                >
                  Emitir OC a OLP
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
