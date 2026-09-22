'use client';

import { useRef, useState } from 'react';

import type { PurchaseOrderListQuery, PurchaseOrderResponse } from '@authorization/contracts';

import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHead } from '@/components/ui/card';
import { FilterActions, FilterBar, FilterField } from '@/components/ui/filter-bar';
import { useApiData } from '@/hooks/use-api-data';
import { useRole } from '@/components/layout/role-context';
import {
  downloadPurchaseOrderTemplate,
  listPurchaseOrders,
  uploadPurchaseOrderImport,
  type PurchaseOrderImportResult,
} from '@/lib/purchase-orders-api';
import { issuePurchaseOrder } from '@/lib/purchase-orders-api';

type DetailedOrder = PurchaseOrderResponse & {
  latestSupplierObservation?: string | null;
};

type OrderStatusGroup =
  | ''
  | 'PENDING_OLP'
  | 'PENDING_MEDICARTE'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'ISSUE';

const STATUS_GROUP_LABELS: Record<Exclude<OrderStatusGroup, ''>, string> = {
  PENDING_OLP: 'Pendiente OLP',
  PENDING_MEDICARTE: 'Pendiente Medicarte',
  PARTIALLY_RECEIVED: 'Recibida parcialmente',
  RECEIVED: 'Recibida',
  ISSUE: 'Con novedad',
};

function statusGroup(status: string): Exclude<OrderStatusGroup, ''> {
  /*
   * Estados técnicos del backend.
   * La UI expone únicamente el estado operacional.
   */

  if (['DRAFT', 'ISSUED', 'UNDER_OLP_REVIEW'].includes(status)) {
    return 'PENDING_OLP';
  }

  if (
    [
      'ACCEPTED',
      'PARTIALLY_ACCEPTED',
      'IN_FULFILLMENT',
      'PARTIALLY_DISPATCHED',
      'FULLY_DISPATCHED',
    ].includes(status)
  ) {
    return 'PENDING_MEDICARTE';
  }

  if (status === 'PARTIALLY_RECEIVED') {
    return 'PARTIALLY_RECEIVED';
  }

  if (status === 'RECEIVED') {
    return 'RECEIVED';
  }

  return 'ISSUE';
}

function statusGroupLabel(status: string) {
  return STATUS_GROUP_LABELS[statusGroup(status)];
}

function statusReasonLabel(status: string) {
  if (status === 'PARTIALLY_RECEIVED') {
    return 'OLP no entregó completo';
  }

  return null;
}

function issueOutcomeLabel(status: string) {
  if (status === 'REJECTED') {
    return 'Devuelta por OLP';
  }

  if (status === 'CANCELLED') {
    return 'Cancelada';
  }

  return null;
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
  const { organizationId, hasPermission } = useRole();
  const canManage = hasPermission('purchase_orders.manage');

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

  const orders = useApiData(async () => {
    const query = {
      purchaseOrderCode: appliedFilters.purchaseOrderCode || undefined,

      commercialCode: appliedFilters.commercialCode || undefined,

      orderType: appliedFilters.orderType,
    };

    /*
     * La consulta estándar excluye CANCELLED.
     * Se consulta ese estado adicionalmente para que
     * el macroestado "Cerrada" sea completo.
     */
    const [active, cancelled] = await Promise.all([
      listPurchaseOrders(organizationId, query),

      listPurchaseOrders(organizationId, {
        ...query,
        status: 'CANCELLED',
      }),
    ]);

    const unique = new Map([...active.items, ...cancelled.items].map((order) => [order.id, order]));

    return {
      items: Array.from(unique.values()),
    };
  }, [organizationId, appliedFilters]);

  const visibleOrders = (orders.data?.items ?? []).filter(
    (order) => !appliedFilters.status || statusGroup(order.status) === appliedFilters.status,
  );

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
          canManage ? (
            <>
              <button
                type="button"
                className="button"
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
                className="button primary"
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
          ) : null
        }
      />

      {error ? (
        <div className="login-error" role="alert">
          {error}
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
                  className="button"
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

      <Card className="orders-workspace-card">
        <CardBody className="orders-workspace-body">
          <div className="orders-filters-block">
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

                  {Object.entries(STATUS_GROUP_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterActions>
                <button
                  type="button"
                  className="button primary"
                  onClick={() => setAppliedFilters(filters)}
                >
                  Filtrar
                </button>

                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    const cleared = {
                      purchaseOrderCode: '',
                      commercialCode: '',
                      status: '' as OrderStatusGroup,
                      orderType: undefined as PurchaseOrderListQuery['orderType'],
                    };

                    setFilters(cleared);
                    setAppliedFilters(cleared);
                  }}
                >
                  Limpiar
                </button>
              </FilterActions>
            </FilterBar>
          </div>

          <div className="orders-table-block">
            <div className="table-wrap">
              <table>
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
                    visibleOrders.map((order) => {
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

                          <td>{order.orderType === 'STANDARD' ? 'Estándar' : 'Complementaria'}</td>

                          <td>{order.lines.length}</td>

                          <td>{units}</td>

                          <td>
                            <div className="oc-status-cell">
                              <span className="status-chip">{statusGroupLabel(order.status)}</span>

                              {statusReasonLabel(order.status) ? (
                                <span className="oc-status-reason">
                                  {statusReasonLabel(order.status)}
                                </span>
                              ) : null}
                            </div>
                          </td>

                          <td>
                            <button
                              type="button"
                              className="button"
                              onClick={() => setSelectedOrder(order as DetailedOrder)}
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
                  {statusGroupLabel(selectedOrder.status)}

                  {statusReasonLabel(selectedOrder.status)
                    ? ` · ${statusReasonLabel(selectedOrder.status)}`
                    : statusGroup(selectedOrder.status) === 'ISSUE' &&
                        issueOutcomeLabel(selectedOrder.status)
                      ? ` · ${issueOutcomeLabel(selectedOrder.status)}`
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
                  className="button primary"
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
