'use client';

import {
  useState,
} from 'react';

import {
  PageHeader,
} from '@/components/ui/page-header';

import {
  Card,
  CardBody,
} from '@/components/ui/card';

import {
  FilterBar,
  FilterField,
} from '@/components/ui/filter-bar';

import {
  useApiData,
} from '@/hooks/use-api-data';

import {
  useRole,
} from '@/components/layout/role-context';

import {
  completeSupplierReview,
  listSupplierPurchaseOrders,
  returnSupplierPurchaseOrder,
  reviewSupplierLine,
  type SupplierPurchaseOrderResponse,
} from '@/lib/purchase-orders-api';

const LABELS:
  Record<string, string> = {
    ISSUED:
      'Pendiente de revisión',
    UNDER_OLP_REVIEW:
      'En revisión',
    ACCEPTED:
      'Aceptada',
    PARTIALLY_ACCEPTED:
      'Aceptada parcialmente',
    REJECTED:
      'Devuelta',
    IN_FULFILLMENT:
      'En preparación',
    PARTIALLY_DISPATCHED:
      'Despacho parcial',
    FULLY_DISPATCHED:
      'Despachada',
    PARTIALLY_RECEIVED:
      'Recepción parcial',
    RECEIVED:
      'Recibida',
  };

export function SupplierPurchaseOrdersView() {
  const {
    organizationId,
    hasPermission,
  } = useRole();

  const canReview =
    hasPermission(
      'purchase_orders.review_supplier',
    );

  const orders =
    useApiData(
      () =>
        listSupplierPurchaseOrders(
          organizationId,
        ),
      [organizationId],
    );

  const [
    selected,
    setSelected,
  ] =
    useState<
      SupplierPurchaseOrderResponse | null
    >(null);

  const [
    quantities,
    setQuantities,
  ] =
    useState<
      Record<string, number>
    >({});

  const [
    costs,
    setCosts,
  ] =
    useState<
      Record<string, string>
    >({});

  const [
    observation,
    setObservation,
  ] =
    useState('');

  const [
    filter,
    setFilter,
  ] = useState({
    code: '',
    product: '',
    status: '',
  });

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null,
    );

  function open(
    order:
      SupplierPurchaseOrderResponse,
  ) {
    setSelected(order);

    setQuantities(
      Object.fromEntries(
        order.lines.map(
          (line) => [
            line.id,
            line.acceptedQuantity ??
              line.requestedQuantity,
          ],
        ),
      ),
    );

    setCosts(
      Object.fromEntries(
        order.lines.map(
          (line) => [
            line.id,
            line.supplierUnitCost ??
              '',
          ],
        ),
      ),
    );

    setObservation('');
    setError(null);
  }

  async function accept() {
    if (!selected) {
      return;
    }

    for (
      const line
      of selected.lines
    ) {
      const accepted =
        quantities[line.id] ??
        0;

      const cost =
        Number(
          costs[line.id] ??
            0,
        );

      if (
        accepted < 0 ||
        accepted >
          line.requestedQuantity
      ) {
        setError(
          `Cantidad inválida para ${line.commercialCode}.`,
        );
        return;
      }

      if (
        accepted > 0 &&
        !(cost > 0)
      ) {
        setError(
          `Debes ingresar el costo OLP de ${line.commercialCode}.`,
        );
        return;
      }
    }

    setBusy(true);
    setError(null);

    try {
      let current = selected;

      for (const line of selected.lines) {
        const acceptedQuantity =
          quantities[line.id] ?? 0;

        const supplierUnitCost =
          Number(
            costs[line.id] ?? 0,
          );

        current =
          await reviewSupplierLine(
            organizationId,
            current.id,
            line.id,
            {
              expectedVersion:
                current.version,

              acceptedQuantity,

              ...(
                supplierUnitCost > 0
                  ? {
                      supplierUnitCost,
                    }
                  : {}
              ),
            },
          ) as SupplierPurchaseOrderResponse;
      }

      const completed =
        await completeSupplierReview(
          organizationId,
          current.id,
          current.version,
        ) as SupplierPurchaseOrderResponse;

      setSelected(
        completed,
      );

      orders.reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible completar la revisión.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function returnToMtd() {
    if (!selected) {
      return;
    }

    if (
      observation.trim().length <
      3
    ) {
      setError(
        'La observación es obligatoria para devolver la OC.',
      );
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const returned =
        await returnSupplierPurchaseOrder(
          organizationId,
          selected.id,
          selected.version,
          observation.trim(),
        );

      setSelected(
        returned,
      );

      orders.reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible devolver la OC.',
      );
    } finally {
      setBusy(false);
    }
  }

  const filtered =
    (
      orders.data?.items ??
      []
    ).filter(
      (order) =>
        (
          !filter.code ||
          (
            order.purchaseOrderCode ??
            order.id
          )
            .toLowerCase()
            .includes(
              filter.code.toLowerCase(),
            )
        ) &&
        (
          !filter.status ||
          order.status ===
            filter.status
        ) &&
        (
          !filter.product ||
          order.lines.some(
            (line) =>
              line.commercialCode
                .toLowerCase()
                .includes(
                  filter.product.toLowerCase(),
                ),
          )
        ),
    );

  return (
    <>
      <PageHeader
        title="Órdenes por revisar"
        description="Revisa las órdenes emitidas por MTD. Solo se muestran datos necesarios para el abastecimiento."
      />

      {error ? (
        <div className="login-error">
          {error}
        </div>
      ) : null}

      <FilterBar>
        <FilterField label="Código OC">
          <input
            className="control"
            value={filter.code}
            onChange={(event) =>
              setFilter({
                ...filter,
                code:
                  event.target.value,
              })
            }
          />
        </FilterField>

        <FilterField label="Producto">
          <input
            className="control"
            value={
              filter.product
            }
            onChange={(event) =>
              setFilter({
                ...filter,
                product:
                  event.target.value,
              })
            }
          />
        </FilterField>

        <FilterField label="Estado">
          <select
            className="control"
            value={
              filter.status
            }
            onChange={(event) =>
              setFilter({
                ...filter,
                status:
                  event.target.value,
              })
            }
          >
            <option value="">
              Todos
            </option>

            {Object.entries(
              LABELS,
            ).map(
              ([value, label]) => (
                <option
                  value={value}
                  key={value}
                >
                  {label}
                </option>
              ),
            )}
          </select>
        </FilterField>
      </FilterBar>

      <Card>
        <CardBody>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>OC</th>
                  <th>Fecha</th>
                  <th>Productos</th>
                  <th>Unidades</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {filtered.map(
                  (order) => (
                    <tr
                      key={
                        order.id
                      }
                    >
                      <td>
                        <strong>
                          {
                            order.purchaseOrderCode ??
                            '—'
                          }
                        </strong>
                      </td>

                      <td>
                        {new Date(
                          order.createdAt,
                        ).toLocaleDateString(
                          'es-CO',
                        )}
                      </td>

                      <td>
                        {
                          order.lines
                            .length
                        }
                      </td>

                      <td>
                        {order.lines.reduce(
                          (
                            total,
                            line,
                          ) =>
                            total +
                            line.requestedQuantity,
                          0,
                        )}
                      </td>

                      <td>
                        {
                          LABELS[
                            order.status
                          ] ??
                          order.status
                        }
                      </td>

                      <td>
                        <button
                          type="button"
                          className="button"
                          onClick={() =>
                            open(
                              order,
                            )
                          }
                        >
                          Ver
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {selected ? (
        <div
          className="operation-drawer-backdrop"
          onMouseDown={() =>
            setSelected(null)
          }
        >
          <aside
            className="operation-drawer wide"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
          >
            <div className="operation-drawer-header">
              <div>
                <span>
                  Revisión OLP
                </span>

                <h2>
                  {
                    selected.purchaseOrderCode ??
                    selected.id
                  }
                </h2>

                <p>
                  {
                    LABELS[
                      selected.status
                    ] ??
                    selected.status
                  }
                </p>
              </div>

              <button
                className="operation-close"
                type="button"
                onClick={() =>
                  setSelected(null)
                }
              >
                ×
              </button>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Presentación</th>
                    <th>Punto</th>
                    <th>Solicitada</th>
                    <th>Aceptar</th>
                    <th>Costo OLP</th>
                  </tr>
                </thead>

                <tbody>
                  {selected.lines.map(
                    (line) => (
                      <tr
                        key={line.id}
                      >
                        <td>
                          <strong>
                            {
                              line.commercialCode
                            }
                          </strong>
                          <br />
                          {
                            line.productDescription ??
                            ''
                          }
                        </td>

                        <td>
                          {
                            line.presentation ??
                            '—'
                          }
                        </td>

                        <td>
                          {
                            line.dispensingPointName ??
                            '—'
                          }
                        </td>

                        <td>
                          {
                            line.requestedQuantity
                          }
                        </td>

                        <td>
                          <input
                            className="control"
                            type="number"
                            min="0"
                            max={
                              line.requestedQuantity
                            }
                            disabled={
                              !canReview ||
                              ![
                                'ISSUED',
                                'UNDER_OLP_REVIEW',
                              ].includes(
                                selected.status,
                              )
                            }
                            value={
                              quantities[
                                line.id
                              ] ??
                              0
                            }
                            onChange={(event) =>
                              setQuantities({
                                ...quantities,
                                [line.id]:
                                  Number(
                                    event
                                      .target
                                      .value,
                                  ),
                              })
                            }
                          />
                        </td>

                        <td>
                          <input
                            className="control"
                            type="number"
                            min="0"
                            step="0.01"
                            disabled={
                              !canReview ||
                              ![
                                'ISSUED',
                                'UNDER_OLP_REVIEW',
                              ].includes(
                                selected.status,
                              )
                            }
                            value={
                              costs[
                                line.id
                              ] ?? ''
                            }
                            onChange={(event) =>
                              setCosts({
                                ...costs,
                                [line.id]:
                                  event
                                    .target
                                    .value,
                              })
                            }
                          />
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>

            {canReview &&
            [
              'ISSUED',
              'UNDER_OLP_REVIEW',
            ].includes(
              selected.status,
            ) ? (
              <>
                <div className="operation-section-title">
                  Devolver a MTD
                </div>

                <textarea
                  className="control operation-textarea"
                  value={
                    observation
                  }
                  onChange={(event) =>
                    setObservation(
                      event.target
                        .value,
                    )
                  }
                  placeholder="Observación obligatoria para devolver la OC..."
                />

                <div className="operation-drawer-footer">
                  <button
                    type="button"
                    className="button danger-action"
                    disabled={busy}
                    onClick={() => {
                      void returnToMtd();
                    }}
                  >
                    Devolver con observación
                  </button>

                  <button
                    type="button"
                    className="button primary"
                    disabled={busy}
                    onClick={() => {
                      void accept();
                    }}
                  >
                    Aceptar / confirmar revisión
                  </button>
                </div>
              </>
            ) : null}
          </aside>
        </div>
      ) : null}
    </>
  );
}
