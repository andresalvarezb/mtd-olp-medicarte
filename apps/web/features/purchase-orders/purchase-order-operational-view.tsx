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
    roles,
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

  const isOlp =
    roles.includes('OLP');

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
      setError(
        'Debes seleccionar la fecha comprometida de envío.',
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
      );

      setAccepting(false);
      setShippingDate('');

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
      'HISTORICAL_ONLY' &&
    !detail.olpAcceptedAt;

  const canAcceptThisOrder =
    canAcceptOlp &&
    !historical &&
    !detail.olpAcceptedAt &&
    ['DRAFT', 'ISSUED'].includes(
      detail.technicalStatus,
    );


  /*
   * En esta etapa estamos validando la experiencia visual OLP.
   * Las OC HISTORICAL_ONLY permiten visualizar el bloque
   * sin convertir ni modificar información histórica.
   */
  const showOlpAcceptanceUi =
    canAcceptThisOrder ||
    (
      isOlp &&
      historical &&
      !detail.olpAcceptedAt
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


      {historical && !isOlp ? (
        <section
          className={
            styles.secondaryPanel
          }
        >
          <div>
            <strong>
              Registro histórico
            </strong>

            <span>
              Esta OC no tiene evidencia operacional autoritativa
              suficiente para continuar el ciclo OLP / Medicarte.
            </span>
          </div>
        </section>
      ) : (
        <section
          className={
            styles.actionPanel
          }
        >
          {detail.olpAcceptedAt ? (
            <>
              <div>
                <strong>
                  Gestión OLP completada
                </strong>

                <span>
                  La orden fue aceptada y quedó disponible
                  para la gestión de Medicarte.
                </span>
              </div>

              <div
                className={
                  styles.acceptEvidence
                }
              >
                <div>
                  <span>
                    Aceptada por
                  </span>

                  <strong>
                    {
                      detail.olpAcceptedByName ??
                      'OLP'
                    }
                  </strong>
                </div>

                <div>
                  <span>
                    Fecha de aceptación
                  </span>

                  <strong>
                    {
                      dateTime(
                        detail.olpAcceptedAt,
                      )
                    }
                  </strong>
                </div>

                <div>
                  <span>
                    Fecha de entrega
                  </span>

                  <strong>
                    {
                      dateOnly(
                        detail.olpCommittedDate,
                      )
                    }
                  </strong>
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <strong>
                  Gestión OLP
                </strong>

                <div>
                  <span>
                    Revisa los productos y cantidades de la orden.
                  </span>

                  <span>
                    Para aceptarla, define la fecha de entrega.
                  </span>
                </div>
              </div>

              {showOlpAcceptanceUi ? (
                <div
                  className={
                    styles.acceptWorkspace
                  }
                >
                  <div
                    className={
                      styles.acceptForm
                    }
                  >
                    <label>
                      <span>
                        Fecha de entrega
                      </span>

                      <input
                        type="date"
                        value={
                          shippingDate
                        }
                        disabled={
                          busy
                        }
                        onChange={(
                          event,
                        ) => {
                          setShippingDate(
                            event.target.value,
                          );

                          /*
                           * Si cambia la fecha después de abrir
                           * la confirmación, se exige confirmar
                           * nuevamente el nuevo valor.
                           */
                          setAccepting(false);
                        }}
                      />
                    </label>

                    <button
                      type="button"
                      className="button primary"
                      disabled={
                        busy ||
                        !shippingDate
                      }
                      onClick={() => {
                        if (
                          !shippingDate
                        ) {
                          setError(
                            'Debes seleccionar la fecha de entrega.',
                          );

                          return;
                        }

                        setError(null);
                        setAccepting(true);
                      }}
                    >
                      Aceptar OC
                    </button>
                  </div>

                  {accepting ? (
                    <div
                      className={
                        styles.acceptConfirmation
                      }
                    >
                      <div>
                        <strong>
                          Confirmar aceptación
                        </strong>

                        <span>
                          La OC{' '}
                          {
                            detail.purchaseOrderCode ??
                            ''
                          }{' '}
                          pasará a Pendiente Medicarte con fecha
                          prevista de envío{' '}
                          {
                            dateOnly(
                              shippingDate,
                            )
                          }.
                        </span>
                      </div>

                      <div
                        className={
                          styles.acceptConfirmationActions
                        }
                      >
                        <button
                          type="button"
                          className="button"
                          disabled={
                            busy
                          }
                          onClick={() =>
                            setAccepting(
                              false,
                            )
                          }
                        >
                          Cancelar
                        </button>

                        <button
                          type="button"
                          className="button primary"
                          disabled={
                            busy
                          }
                          onClick={() => {
                            void acceptOrder();
                          }}
                        >
                          {
                            busy
                              ? 'Confirmando...'
                              : 'Confirmar aceptación'
                          }
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div
                  className={
                    styles.acceptUnavailable
                  }
                >
                  Esta orden no tiene una acción pendiente para OLP.
                </div>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
