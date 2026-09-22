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
  PointScopeGuard,
} from '@/components/point-scope/empty-point-scope';

import {
  confirmReceipt,
  createReceipt,
  listMedicarteDeliveries,
  updateReceipt,
} from '@/lib/purchase-orders-api';

import type {
  DeliveryResponse,
} from '@authorization/contracts';

export function ReceiptsView() {
  const {
    organizationId,
    hasPermission,
  } = useRole();

  const canManage =
    hasPermission(
      'medicarte_receipts.manage',
    );

  const deliveries =
    useApiData(
      () =>
        listMedicarteDeliveries(
          organizationId,
        ),
      [organizationId],
    );

  const [
    selected,
    setSelected,
  ] =
    useState<
      DeliveryResponse | null
    >(null);

  const [
    observation,
    setObservation,
  ] =
    useState('');

  const [
    filter,
    setFilter,
  ] =
    useState('');

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

  async function acceptReceipt() {
    if (!selected) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const receipt =
        await createReceipt(
          organizationId,
          selected.id,
        );

      const updated =
        await updateReceipt(
          organizationId,
          receipt.id,
          {
            expectedVersion:
              receipt.version,

            lines:
              receipt.lines.map(
                (line) => ({
                  deliveryLineId:
                    line.deliveryLineId,

                  receivedQuantity:
                    line.dispatchedQuantity,

                  acceptedQuantity:
                    line.dispatchedQuantity,

                  rejectedQuantity:
                    0,

                  receivedLotNumber:
                    line.expectedLotNumber,

                  receivedExpirationDate:
                    line.expectedExpirationDate,

                  conformity:
                    'CONFORMING',

                  nonconformityReason:
                    null,

                  observation:
                    null,
                }),
              ),
          },
        );

      await confirmReceipt(
        organizationId,
        updated.id,
        updated.version,
      );

      setSelected(null);
      setObservation('');
      deliveries.reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible confirmar la recepción.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function returnReceipt() {
    if (!selected) {
      return;
    }

    if (
      observation.trim().length <
      3
    ) {
      setError(
        'La observación es obligatoria para devolver la recepción.',
      );
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const receipt =
        await createReceipt(
          organizationId,
          selected.id,
        );

      const updated =
        await updateReceipt(
          organizationId,
          receipt.id,
          {
            expectedVersion:
              receipt.version,

            lines:
              receipt.lines.map(
                (line) => ({
                  deliveryLineId:
                    line.deliveryLineId,

                  receivedQuantity:
                    line.dispatchedQuantity,

                  acceptedQuantity:
                    0,

                  rejectedQuantity:
                    line.dispatchedQuantity,

                  receivedLotNumber:
                    line.expectedLotNumber,

                  receivedExpirationDate:
                    line.expectedExpirationDate,

                  conformity:
                    'NON_CONFORMING',

                  nonconformityReason:
                    'OTHER',

                  observation:
                    observation.trim(),
                }),
              ),
          },
        );

      await confirmReceipt(
        organizationId,
        updated.id,
        updated.version,
      );

      setSelected(null);
      setObservation('');
      deliveries.reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible registrar la devolución.',
      );
    } finally {
      setBusy(false);
    }
  }

  const pending =
    (
      deliveries.data?.items ??
      []
    ).filter(
      (delivery) =>
        delivery.status ===
          'DISPATCHED' &&
        (
          !filter ||
          (
            delivery.purchaseOrderCode ??
            delivery.supplierReference ??
            delivery.id
          )
            .toLowerCase()
            .includes(
              filter.toLowerCase(),
            )
        ),
    );

  return (
    <PointScopeGuard>
      <>
        <PageHeader
          title="Recepción de productos"
          description="Confirma los productos recibidos de OLP o devuelve la recepción indicando la novedad."
        />

        {error ? (
          <div className="login-error">
            {error}
          </div>
        ) : null}

        <FilterBar>
          <FilterField label="OC / despacho">
            <input
              className="control"
              value={filter}
              onChange={(event) =>
                setFilter(
                  event.target.value,
                )
              }
              placeholder="Buscar"
            />
          </FilterField>
        </FilterBar>

        <Card>
          <CardBody>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>OC</th>
                    <th>Despacho</th>
                    <th>Punto</th>
                    <th>Productos</th>
                    <th>Unidades</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>

                <tbody>
                  {pending.map(
                    (delivery) => (
                      <tr
                        key={
                          delivery.id
                        }
                      >
                        <td>
                          <strong>
                            {
                              delivery.purchaseOrderCode ??
                              '—'
                            }
                          </strong>
                        </td>

                        <td>
                          {
                            delivery.supplierReference ??
                            delivery.id
                          }
                        </td>

                        <td>
                          {
                            delivery.lines[
                              0
                            ]
                              ?.dispensingPointName ??
                            '—'
                          }
                        </td>

                        <td>
                          {
                            delivery.lines
                              .length
                          }
                        </td>

                        <td>
                          {delivery.lines.reduce(
                            (
                              total,
                              line,
                            ) =>
                              total +
                              line.quantity,
                            0,
                          )}
                        </td>

                        <td>
                          Pendiente de recepción
                        </td>

                        <td>
                          <button
                            type="button"
                            className="button"
                            onClick={() => {
                              setSelected(
                                delivery,
                              );
                              setObservation(
                                '',
                              );
                            }}
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
                    Medicarte
                  </span>

                  <h2>
                    Recepción
                    {' '}
                    {
                      selected.purchaseOrderCode ??
                      ''
                    }
                  </h2>

                  <p>
                    {
                      selected.supplierReference ??
                      selected.id
                    }
                  </p>
                </div>

                <button
                  type="button"
                  className="operation-close"
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
                      <th>Cantidad</th>
                      <th>Lote</th>
                      <th>Vencimiento</th>
                    </tr>
                  </thead>

                  <tbody>
                    {selected.lines.map(
                      (line) => (
                        <tr
                          key={
                            line.id
                          }
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
                              line.quantity
                            }
                          </td>

                          <td>
                            {
                              line.lotNumber
                            }
                          </td>

                          <td>
                            {
                              line.expirationDate
                            }
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>

              {canManage ? (
                <>
                  <div className="operation-section-title">
                    Novedad de recepción
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
                    placeholder="Obligatoria únicamente si vas a devolver la recepción..."
                  />

                  <div className="operation-drawer-footer">
                    <button
                      type="button"
                      className="button danger-action"
                      disabled={busy}
                      onClick={() => {
                        void returnReceipt();
                      }}
                    >
                      Devolver con observación
                    </button>

                    <button
                      type="button"
                      className="button primary"
                      disabled={busy}
                      onClick={() => {
                        void acceptReceipt();
                      }}
                    >
                      Aceptar recepción
                    </button>
                  </div>
                </>
              ) : null}
            </aside>
          </div>
        ) : null}
      </>
    </PointScopeGuard>
  );
}
