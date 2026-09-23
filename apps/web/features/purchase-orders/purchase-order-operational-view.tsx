'use client';

import {
  useEffect,
  useState,
} from 'react';

import {
  useParams,
  useRouter,
} from 'next/navigation';

import {
  PageHeader,
} from '@/components/ui/page-header';

import {
  Card,
  CardBody,
} from '@/components/ui/card';

import {
  useRole,
} from '@/components/layout/role-context';

import {
  acceptOperationalPurchaseOrder,
  getPurchaseOrderOperationalDetail,
  type PurchaseOrderOperationalDetail,
  type PurchaseOrderOperationalLine,
} from '@/lib/purchase-orders-api';

import styles from './purchase-order-operational-view.module.css';


const STATE_LABELS: Record<
  PurchaseOrderOperationalDetail['operationalState'],
  string
> = {
  PENDING_OLP:
    'Pendiente OLP',

  PENDING_MEDICARTE:
    'Pendiente Medicarte',

  RECEIVED_WITH_PENDING:
    'Recibida con pendientes',

  RECEIVED:
    'Recibida',
};


function dateTime(
  value: string | null,
) {
  if (!value) {
    return '—';
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return value;
  }

  return new Intl.DateTimeFormat(
    'es-CO',
    {
      dateStyle:
        'medium',

      timeStyle:
        'short',
    },
  ).format(date);
}


function dateOnly(
  value: string | null,
) {
  if (!value) {
    return '—';
  }

  const parts =
    value.split('-');

  if (
    parts.length === 3
  ) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  return value;
}


function receiptState(
  line: PurchaseOrderOperationalLine,
  historical: boolean,
) {
  if (
    line.receiptOutcome ===
    'NOT_RECEIVED'
  ) {
    return {
      label:
        'No recibido',

      style:
        styles.receiptNotReceived,
    };
  }

  if (
    line.receivedQuantity >=
    line.requestedQuantity
  ) {
    return {
      label:
        'Recibido',

      style:
        styles.receiptComplete,
    };
  }

  if (
    line.receivedQuantity >
    0
  ) {
    return {
      label:
        'Recibido parcial',

      style:
        styles.receiptPartial,
    };
  }

  if (historical) {
    return {
      label:
        'Sin evidencia',

      style:
        styles.receiptHistorical,
    };
  }

  return {
    label:
      'Pendiente',

    style:
      styles.receiptPending,
  };
}


export function PurchaseOrderOperationalView() {
  const router =
    useRouter();

  const params =
    useParams();

  const {
    organizationId,
    hasPermission,
  } =
    useRole();

  const rawId =
    params.id;

  const id =
    Array.isArray(rawId)
      ? rawId[0] ?? ''
      : String(rawId ?? '');

  const canAcceptOlp =
    hasPermission(
      'purchase_orders.review_supplier',
    );

  const [
    detail,
    setDetail,
  ] =
    useState<PurchaseOrderOperationalDetail | null>(
      null,
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

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

  const [
    accepting,
    setAccepting,
  ] =
    useState(false);

  const [
    shippingDate,
    setShippingDate,
  ] =
    useState('');


  const [
    supplierUnitCosts,
    setSupplierUnitCosts,
  ] =
    useState<Record<string, string>>(
      {},
    );


  async function load() {
    if (!id) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result =
        await getPurchaseOrderOperationalDetail(
          organizationId,
          id,
        );

      setDetail(result);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible consultar la orden de compra.',
      );
    } finally {
      setLoading(false);
    }
  }


  useEffect(
    () => {
      void load();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      organizationId,
      id,
    ],
  );


  async function acceptOrder() {
    if (
      !detail ||
      !shippingDate
    ) {
      return;
    }

    const lines =
      detail.lines.map(
        (line) => ({
          lineId:
            line.id,

          supplierUnitCost:
            Number(
              supplierUnitCosts[
                line.id
              ],
            ),
        }),
      );

    const invalidCost =
      lines.some(
        (line) =>
          !Number.isFinite(
            line.supplierUnitCost,
          ) ||
          line.supplierUnitCost <= 0,
      );

    if (invalidCost) {
      setError(
        'Debes registrar un costo unitario OLP mayor que cero para cada producto.',
      );

      return;
    }

    setBusy(true);
    setError(null);

    try {
      await acceptOperationalPurchaseOrder(
        organizationId,
        detail.id,
        detail.version,
        shippingDate,
        lines,
      );

      setAccepting(false);
      setShippingDate('');
      setSupplierUnitCosts({});

      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible aceptar la orden de compra.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader
          title="Orden de compra"
          description="Cargando información..."
        />

        <Card>
          <CardBody>
            Consultando orden de compra...
          </CardBody>
        </Card>
      </>
    );
  }


  if (!detail) {
    return (
      <>
        <PageHeader
          title="Orden de compra"
          description="No fue posible cargar el detalle."
          actions={
            <button
              type="button"
              className="button"
              onClick={() =>
                router.push(
                  '/ordenes-compra',
                )
              }
            >
              Volver
            </button>
          }
        />

        <div
          className="login-error"
          role="alert"
        >
          {error ??
            'Orden de compra no encontrada.'}
        </div>
      </>
    );
  }


  const historical =
    detail.technicalStatus ===
    'HISTORICAL_ONLY';

  const canAcceptThisOrder =
    canAcceptOlp &&
    !historical &&
    !detail.olpAcceptedAt &&
    ['DRAFT', 'ISSUED'].includes(
      detail.technicalStatus,
    );

  const olpStepText =
    detail.olpAcceptedAt
      ? `Aceptada · Envío ${dateOnly(
          detail.olpCommittedDate,
        )}`
      : historical
        ? 'Sin evidencia de gestión'
        : 'Pendiente de aceptación';

  const medicarteStepText =
    detail.summary.receivedQuantity > 0
      ? detail.summary.pendingQuantity > 0
        ? 'Recepción parcial'
        : 'Recepción completa'
      : historical
        ? 'Sin evidencia de recepción'
        : detail.olpAcceptedAt
          ? 'Pendiente de recepción'
          : 'Pendiente';


  return (
    <>
      {error ? (
        <div
          className="login-error"
          role="alert"
        >
          {error}
        </div>
      ) : null}


      <header
        className={
          styles.orderHeader
        }
      >
        <div
          className={
            styles.orderHeaderLeft
          }
        >
          <button
            type="button"
            className={
              styles.backLink
            }
            onClick={() =>
              router.push(
                '/ordenes-compra',
              )
            }
          >
            ← Órdenes de compra
          </button>

          <div
            className={
              styles.orderTitleRow
            }
          >
            <h1>
              OC {detail.purchaseOrderCode ?? 'Sin código'}
            </h1>

            <span
              className={`${styles.statusBadge} ${
                styles[
                  detail.operationalState
                ]
              }`}
            >
              {
                STATE_LABELS[
                  detail.operationalState
                ]
              }
            </span>
          </div>
        </div>


        <div
          className={
            styles.orderHeaderMeta
          }
        >
          {!historical ? (
            <div>
              <span>
                Responsable actual
              </span>

              <strong>
                {
                  detail.responsible
                }
              </strong>
            </div>
          ) : null}

          <div>
            <span>
              Generada
            </span>

            <strong>
              {
                dateTime(
                  detail.createdAt,
                )
              }
            </strong>
          </div>
        </div>
      </header>


      <section
        className={
          styles.processPanel
        }
      >
        <div
          className={
            styles.processTitle
          }
        >
          Proceso
        </div>

        <div
          className={
            styles.process
          }
        >
          <div
            className={`${styles.step} ${styles.stepDone}`}
          >
            <span
              className={
                styles.stepCircle
              }
            >
              ✓
            </span>

            <div>
              <strong>
                MTD generó la OC
              </strong>

              <small>
                {
                  dateTime(
                    detail.createdAt,
                  )
                }
              </small>
            </div>
          </div>


          <span
            className={`${styles.connector} ${styles.connectorDone}`}
          />


          <div
            className={`${styles.step} ${
              detail.olpAcceptedAt
                ? styles.stepDone
                : historical
                  ? ''
                  : styles.stepCurrent
            }`}
          >
            <span
              className={
                styles.stepCircle
              }
            >
              {detail.olpAcceptedAt
                ? '✓'
                : '2'}
            </span>

            <div>
              <strong>
                OLP gestiona
              </strong>

              <small>
                {
                  olpStepText
                }
              </small>
            </div>
          </div>


          <span
            className={
              styles.connector
            }
          />


          <div
            className={`${styles.step} ${
              detail.summary.pendingQuantity === 0 &&
              detail.summary.receivedQuantity > 0
                ? styles.stepDone
                : detail.summary.receivedQuantity > 0 ||
                    (
                      !historical &&
                      detail.olpAcceptedAt
                    )
                  ? styles.stepCurrent
                  : ''
            }`}
          >
            <span
              className={
                styles.stepCircle
              }
            >
              {detail.summary.pendingQuantity === 0 &&
              detail.summary.receivedQuantity > 0
                ? '✓'
                : '3'}
            </span>

            <div>
              <strong>
                Medicarte recibe
              </strong>

              <small>
                {
                  medicarteStepText
                }
              </small>
            </div>
          </div>
        </div>
      </section>


      <Card>
        <CardBody>
          <div
            className="table-scroll"
          >
            <table
              className="data-table"
            >
              <thead>
                <tr>
                  <th
                    rowSpan={2}
                    className={
                      styles.mainHeader
                    }
                  >
                    Código
                  </th>

                  <th
                    rowSpan={2}
                    className={
                      styles.mainHeader
                    }
                  >
                    Producto
                  </th>

                  <th
                    rowSpan={2}
                    className={
                      styles.mainHeader
                    }
                  >
                    Punto
                  </th>

                  <th
                    rowSpan={2}
                    className={
                      styles.mainHeader
                    }
                  >
                    Solicitado
                  </th>

                  <th
                    colSpan={3}
                    className={
                      styles.receptionGroup
                    }
                  >
                    Recepción Medicarte
                  </th>
                </tr>

                <tr
                  className={
                    styles.receptionSubHeader
                  }
                >
                  <th>
                    Estado
                  </th>

                  <th>
                    Recibido
                  </th>

                  <th>
                    Pendiente
                  </th>
                </tr>
              </thead>

              <tbody>
                {detail.lines.map(
                  (
                    line,
                  ) => {
                    const state =
                      receiptState(
                        line,
                        historical,
                      );

                    return (
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
                        </td>

                        <td>
                          {
                            line.productDescription ??
                            'Sin nombre'
                          }
                        </td>

                        <td>
                          {
                            line.dispensingPointCode ??
                            'Sin punto'
                          }
                        </td>

                        <td>
                          {
                            line.requestedQuantity
                          }
                        </td>

                        <td>
                          <span
                            className={`${styles.receiptState} ${state.style}`}
                          >
                            {
                              state.label
                            }
                          </span>
                        </td>

                        <td>
                          {
                            line.receivedQuantity
                          }
                        </td>

                        <td>
                          <strong>
                            {
                              line.pendingQuantity
                            }
                          </strong>
                        </td>
                      </tr>
                    );
                  },
                )}

                <tr
                  className={
                    styles.totalRow
                  }
                >
                  <td
                    colSpan={3}
                  >
                    <strong>
                      TOTAL
                    </strong>
                  </td>

                  <td>
                    <strong>
                      {
                        detail.summary
                          .requestedQuantity
                      }
                    </strong>
                  </td>

                  <td />

                  <td>
                    <strong>
                      {
                        detail.summary
                          .receivedQuantity
                      }
                    </strong>
                  </td>

                  <td>
                    <strong>
                      {
                        detail.summary
                          .pendingQuantity
                      }
                    </strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>


      {historical ? (
        <section
          className={
            styles.secondaryPanel
          }
        >
          <div>
            <strong>
              Información histórica
            </strong>

            <span>
              No existe evidencia autoritativa de aceptación
              o recepción para esta OC.
            </span>
          </div>
        </section>
      ) : (
        <section
          className={
            styles.actionPanel
          }
        >
          <div>
            <strong>
              Gestión OLP
            </strong>

            {detail.olpAcceptedAt ? (
              <span>
                OC aceptada por{' '}
                {
                  detail.olpAcceptedByName ??
                  'OLP'
                }
                {' · '}
                Fecha prevista de envío:{' '}
                {
                  dateOnly(
                    detail.olpCommittedDate,
                  )
                }
              </span>
            ) : (
              <span>
                OLP debe aceptar la OC completa y confirmar
                la fecha prevista de envío.
              </span>
            )}
          </div>


          {canAcceptThisOrder &&
          !accepting ? (
            <button
              type="button"
              className="button primary"
              onClick={() =>
                setAccepting(true)
              }
            >
              Aceptar OC
            </button>
          ) : null}


          {canAcceptThisOrder &&
          accepting ? (
            <div
              className={
                styles.acceptForm
              }
            >
              <label>
                <span>
                  Fecha de envío
                </span>

                <input
                  type="date"
                  value={
                    shippingDate
                  }
                  onChange={(
                    event,
                  ) =>
                    setShippingDate(
                      event.target.value,
                    )
                  }
                />
              </label>

              <div
              className={
                styles.olpCostSection
              }
            >
              <div
                className={
                  styles.olpCostHeader
                }
              >
                <strong>
                  Costos OLP
                </strong>

                <span>
                  Registra el costo unitario que OLP cobrará a MTD por cada producto.
                </span>
              </div>

              <div
                className={
                  styles.olpCostGrid
                }
              >
                {detail.lines.map(
                  (line) => (
                    <div
                      key={
                        line.id
                      }
                      className={
                        styles.olpCostRow
                      }
                    >
                      <div
                        className={
                          styles.olpCostProduct
                        }
                      >
                        <strong>
                          {
                            line.commercialCode
                          }
                        </strong>

                        <span>
                          {
                            line.productDescription ??
                            'Sin nombre'
                          }
                        </span>

                        <small>
                          Cantidad solicitada:{' '}
                          {
                            line.requestedQuantity
                          }
                        </small>
                      </div>

                      <label
                        className={
                          styles.olpCostField
                        }
                      >
                        <span>
                          Costo unitario OLP
                        </span>

                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          inputMode="decimal"
                          value={
                            supplierUnitCosts[
                              line.id
                            ] ??
                            ''
                          }
                          disabled={
                            busy
                          }
                          placeholder="0"
                          onChange={
                            (
                              event,
                            ) => {
                              const value =
                                event.target.value;

                              setSupplierUnitCosts(
                                (
                                  current,
                                ) => ({
                                  ...current,

                                  [
                                    line.id
                                  ]:
                                    value,
                                }),
                              );
                            }
                          }
                        />
                      </label>
                    </div>
                  ),
                )}
              </div>
            </div>

            <div>
                <button
                  type="button"
                  className="button"
                  disabled={
                    busy
                  }
                  onClick={() => {
                    setAccepting(false);
                    setShippingDate('');
                  }}
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  className="button primary"
                  disabled={
                    busy ||
                    !shippingDate
                  }
                  onClick={() => {
                    void acceptOrder();
                  }}
                >
                  Confirmar
                </button>
              </div>
            </div>
          ) : null}
        </section>
      )}
    </>
  );
}
