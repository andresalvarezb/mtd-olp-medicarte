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
  createPurchaseOrderDirectReceipt,
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
    'Recibida con pendiente',

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
    (
      line.managedQuantity ??
      line.acceptedQuantity
    ) ===
    0
  ) {
    return {
      label:
        'Sin gestión OLP',

      style:
        styles.receiptHistorical,
    };
  }

  const managedQuantity =
    line.managedQuantity ??
    line.acceptedQuantity ??
    line.requestedQuantity;

  if (
    line.receivedQuantity >=
    managedQuantity
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


type UniversalHistoryLine = Readonly<{
  id: string;
  commercialCode: string;
  productDescription: string | null;
  dispensingPointCode: string | null;
  receivedNow: number;
  accumulated: number;
  pendingAfter: number;
}>;


type UniversalHistoryEvent = Readonly<{
  id: string;
  kind:
    | 'CREATED'
    | 'OLP_ACCEPTED'
    | 'RECEIPT';
  occurredAt: string;
  title: string;
  actorName: string;
  stateLabel: string;
  committedDate: string | null;
  lines: readonly UniversalHistoryLine[];
}>;


function UniversalOrderHistorySection({
  detail,
}: {
  detail: PurchaseOrderOperationalDetail;
}) {
  const lineById =
    new Map(
      detail.lines.map(
        (line) => [
          line.id,
          line,
        ],
      ),
    );

  const accumulatedByLine =
    new Map<string, number>();

  const receiptSources =
    (
      detail.receiptHistory ??
      []
    )
      .map(
        (receipt) => ({
          id:
            `DIRECT:${receipt.id}`,

          occurredAt:
            receipt.confirmedAt ??
            receipt.receivedAt,

          actorName:
            receipt.actorName ??
            'Medicarte',

          lines:
            receipt.lines.map(
              (line) => ({
                id:
                  line.id,

                purchaseOrderLineId:
                  line.purchaseOrderLineId,

                receivedQuantity:
                  line.receivedQuantity,
              }),
            ),
        }),
      )
      .sort(
        (
          left,
          right,
        ) =>
          new Date(
            left.occurredAt,
          ).getTime()
          -
          new Date(
            right.occurredAt,
          ).getTime(),
      );


  const receiptEvents:
    UniversalHistoryEvent[] =
    [];


  for (
    const receipt of
    receiptSources
  ) {
    const eventLines:
      UniversalHistoryLine[] =
      [];

    for (
      const receiptLine of
      receipt.lines
    ) {
      const line =
        lineById.get(
          receiptLine.purchaseOrderLineId,
        );

      if (!line) {
        continue;
      }

      const previous =
        accumulatedByLine.get(
          line.id,
        ) ??
        0;

      const accumulated =
        previous +
        receiptLine.receivedQuantity;

      accumulatedByLine.set(
        line.id,
        accumulated,
      );

      eventLines.push({
        id:
          `${receipt.id}:${receiptLine.id}`,

        commercialCode:
          line.commercialCode,

        productDescription:
          line.productDescription,

        dispensingPointCode:
          line.dispensingPointCode,

        receivedNow:
          receiptLine.receivedQuantity,

        accumulated,

        pendingAfter:
          Math.max(
            (
              line.managedQuantity ??
              line.acceptedQuantity ??
              line.requestedQuantity
            ) -
            accumulated,
            0,
          ),
      });
    }


    if (
      eventLines.length ===
      0
    ) {
      continue;
    }


    const totalRequested =
      detail.lines.reduce(
        (
          total,
          line,
        ) =>
          total +
          (
            line.acceptedQuantity ??
            line.requestedQuantity
          ),
        0,
      );

    const totalAccumulated =
      detail.lines.reduce(
        (
          total,
          line,
        ) =>
          total +
          (
            accumulatedByLine.get(
              line.id,
            ) ??
            0
          ),
        0,
      );


    receiptEvents.push({
      id:
        receipt.id,

      kind:
        'RECEIPT',

      occurredAt:
        receipt.occurredAt,

      title:
        'Recepción Medicarte',

      actorName:
        receipt.actorName,

      stateLabel:
        totalRequested > 0 &&
        totalAccumulated >=
          totalRequested
          ? 'Recibida'
          : 'Recibida con pendiente',

      committedDate:
        null,

      lines:
        eventLines,
    });
  }


  const events:
    UniversalHistoryEvent[] =
    [
      {
        id:
          `CREATED:${detail.id}`,

        kind:
          'CREATED' as const,

        occurredAt:
          detail.createdAt,

        title:
          'OC generada',

        actorName:
          detail.createdByName ??
          'MTD',

        stateLabel:
          'Pendiente OLP',

        committedDate:
          null,

        lines:
          [],
      },

      ...(detail.olpAcceptedAt
        ? [
            {
              id:
                `OLP:${detail.id}`,

              kind:
                'OLP_ACCEPTED' as const,

              occurredAt:
                detail.olpAcceptedAt,

              title:
                'Aceptación OLP',

              actorName:
                detail.olpAcceptedByName ??
                'OLP',

              stateLabel:
                'Pendiente Medicarte',

              committedDate:
                detail.olpCommittedDate,

              lines:
                [],
            },
          ]
        : []),

      ...receiptEvents,
    ]
      .sort(
        (
          left,
          right,
        ) =>
          new Date(
            right.occurredAt,
          ).getTime()
          -
          new Date(
            left.occurredAt,
          ).getTime(),
      );


  return (
    <section
      data-order-history="true"
      className={
        styles.orderHistoryPanel
      }
    >
      <div
        className={
          styles.orderHistoryHeader
        }
      >
        <div>
          <strong>
            Historial de la orden
          </strong>

          <span>
            Trazabilidad de creación, aceptación y recepciones registradas sobre esta OC.
          </span>
        </div>

        <span
          className={
            styles.orderHistoryCount
          }
        >
          {
            events.length
          }{' '}
          {
            events.length ===
            1
              ? 'evento'
              : 'eventos'
          }
        </span>
      </div>


      <div
        className={
          styles.orderHistoryList
        }
      >
        {
          events.map(
            (event) => (
              <article
                key={
                  event.id
                }
                className={
                  styles.orderHistoryEvent
                }
              >
                <div
                  className={`${styles.orderHistoryMarker} ${
                    event.kind ===
                    'RECEIPT'
                      ? styles.orderHistoryMarkerReceipt
                      : event.kind ===
                          'OLP_ACCEPTED'
                        ? styles.orderHistoryMarkerOlp
                        : styles.orderHistoryMarkerCreated
                  }`}
                >
                  {
                    event.kind ===
                    'RECEIPT'
                      ? 'R'
                      : event.kind ===
                          'OLP_ACCEPTED'
                        ? 'O'
                        : 'M'
                  }
                </div>


                <div
                  className={
                    styles.orderHistoryContent
                  }
                >
                  <div
                    className={
                      styles.orderHistoryEventHeader
                    }
                  >
                    <div>
                      <strong>
                        {
                          event.title
                        }
                      </strong>

                      <span>
                        {
                          dateTime(
                            event.occurredAt,
                          )
                        }
                      </span>
                    </div>

                    <span
                      className={
                        styles.orderHistoryState
                      }
                    >
                      {
                        event.stateLabel
                      }
                    </span>
                  </div>


                  <div
                    className={
                      styles.orderHistoryMeta
                    }
                  >
                    <span>
                      Registrado por
                    </span>

                    <strong>
                      {
                        event.actorName
                      }
                    </strong>

                    {
                      event.committedDate
                        ? (
                          <>
                            <span>
                              ·
                            </span>

                            <span>
                              Fecha de entrega
                            </span>

                            <strong>
                              {
                                dateOnly(
                                  event.committedDate,
                                )
                              }
                            </strong>
                          </>
                        )
                        : null
                    }
                  </div>


                  {
                    event.lines.length >
                    0
                      ? (
                        <div
                          className={
                            styles.orderHistoryReceiptTable
                          }
                        >
                          <div
                            className="table-scroll"
                          >
                            <table
                              className="data-table"
                            >
                              <thead>
                                <tr>
                                  <th>
                                    Código
                                  </th>

                                  <th>
                                    Producto
                                  </th>

                                  <th>
                                    Punto
                                  </th>

                                  <th>
                                    Recibido ahora
                                  </th>

                                  <th>
                                    Acumulado
                                  </th>

                                  <th>
                                    Pendiente después
                                  </th>
                                </tr>
                              </thead>

                              <tbody>
                                {
                                  event.lines.map(
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
                                          <strong>
                                            +{
                                              line.receivedNow
                                            }
                                          </strong>
                                        </td>

                                        <td>
                                          {
                                            line.accumulated
                                          }
                                        </td>

                                        <td>
                                          <strong>
                                            {
                                              line.pendingAfter
                                            }
                                          </strong>
                                        </td>
                                      </tr>
                                    ),
                                  )
                                }
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )
                      : null
                  }
                </div>
              </article>
            ),
          )
        }
      </div>
    </section>
  );
}


export function PurchaseOrderOperationalView() {
  const router =
    useRouter();

  const params =
    useParams();

  const {
    organizationId,
    hasPermission,
    me,
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

  const activeOrganization =
    me?.organizations.find(
      (organization) =>
        organization.id ===
        organizationId,
    );

  const isOlp =
    activeOrganization?.code ===
    'OLP';


  const isMedicarte =
    activeOrganization?.code ===
    'MEDICARTE';

  const canReceiveMedicarte =
    hasPermission(
      'medicarte_receipts.manage',
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
    olpQuantities,
    setOlpQuantities,
  ] =
    useState<Record<string, string>>(
      {},
    );

  const [
    receiptQuantities,
    setReceiptQuantities,
  ] =
    useState<Record<string, string>>(
      {},
    );

  const [
    receiptBusy,
    setReceiptBusy,
  ] =
    useState(false);


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

      /*
       * La captura OLP representa únicamente la cantidad
       * adicional de esta gestión.
       *
       * El acumulado viene persistido desde backend en
       * line.managedQuantity.
       */
      setOlpQuantities(
        {},
      );

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

    const lines:
      Array<{
        purchaseOrderLineId: string;
        managedQuantity: number;
      }> =
      [];

    for (
      const line of
      detail.lines
    ) {
      const raw =
        (
          olpQuantities[
            line.id
          ] ??
          ''
        ).trim();

      if (
        raw ===
        ''
      ) {
        continue;
      }

      const quantityNow =
        Number(
          raw,
        );

      const alreadyManaged =
        line.managedQuantity ??
        0;

      const remaining =
        Math.max(
          line.requestedQuantity -
          alreadyManaged,
          0,
        );

      if (
        !Number.isInteger(
          quantityNow,
        ) ||
        quantityNow <=
          0 ||
        quantityNow >
          remaining
      ) {
        setError(
          `Para ${line.commercialCode} puedes gestionar ahora entre 1 y ${remaining} unidad(es).`,
        );

        return;
      }

      lines.push({
        purchaseOrderLineId:
          line.id,

        /*
         * IMPORTANTE:
         * managedQuantity en el request es DELTA de esta
         * operación. Backend lo suma al acumulado persistido.
         */
        managedQuantity:
          quantityNow,
      });
    }

    if (
      lines.length ===
      0
    ) {
      setError(
        'Registra la cantidad que OLP gestionará ahora en al menos un producto.',
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


  async function confirmMedicarteReceipt() {
    if (
      !detail ||
      !organizationId ||
      receiptBusy
    ) {
      return;
    }

    const entries =
      detail.lines
        .filter(
          (line) =>
            (
              receiptQuantities[
                line.id
              ]
              ??
              ''
            ).trim() !== '',
        )
        .map(
          (line) => ({
            line,
            raw:
              (
                receiptQuantities[
                  line.id
                ]
                ??
                ''
              ).trim(),
          }),
        );

    if (
      entries.length ===
      0
    ) {
      setError(
        'Registra la cantidad recibida en al menos un producto.',
      );

      return;
    }

    const lines:
      Array<{
        purchaseOrderLineId: string;
        receivedQuantity: number;
      }> =
      [];

    for (
      const entry of
      entries
    ) {
      const quantity =
        Number(
          entry.raw,
        );

      if (
        !Number.isInteger(
          quantity,
        ) ||
        quantity <= 0
      ) {
        setError(
          `La cantidad recibida para ${entry.line.commercialCode} debe ser un número entero mayor que cero.`,
        );

        return;
      }

      if (
        quantity >
        entry.line.pendingQuantity
      ) {
        setError(
          `No puedes recibir ${quantity} unidades de ${entry.line.commercialCode}. Solo quedan ${entry.line.pendingQuantity} pendientes.`,
        );

        return;
      }

      lines.push({
        purchaseOrderLineId:
          entry.line.id,

        receivedQuantity:
          quantity,
      });
    }

    setReceiptBusy(
      true,
    );

    setError(
      null,
    );

    try {
      await createPurchaseOrderDirectReceipt(
        organizationId,
        detail.id,
        {
          lines,
        },
      );

      setReceiptQuantities(
        {},
      );

      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible confirmar la recepción.',
      );
    } finally {
      setReceiptBusy(
        false,
      );
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


  const showReceiptCaptureColumn =
    isMedicarte &&
    canReceiveMedicarte &&
    !historical &&
    Boolean(
      detail.olpAcceptedAt,
    ) &&
    detail.operationalState !==
      'RECEIVED';


  const canReceiveThisOrder =
    showReceiptCaptureColumn &&
    detail.summary.pendingQuantity >
      0;


  const olpManagedTotal =
    detail.lines.reduce(
      (
        total,
        line,
      ) =>
        total +
        (
          line.managedQuantity ??
          0
        ),
      0,
    );

  const olpRemainingTotal =
    detail.lines.reduce(
      (
        total,
        line,
      ) =>
        total +
        Math.max(
          line.requestedQuantity -
          (
            line.managedQuantity ??
            0
          ),
          0,
        ),
      0,
    );

  const olpManagingNowTotal =
    detail.lines.reduce(
      (
        total,
        line,
      ) => {
        const raw =
          (
            olpQuantities[
              line.id
            ] ??
            ''
          ).trim();

        if (
          raw ===
          ''
        ) {
          return total;
        }

        const quantity =
          Number(
            raw,
          );

        return (
          total +
          (
            Number.isInteger(
              quantity,
            ) &&
            quantity >
              0
              ? quantity
              : 0
          )
        );
      },
      0,
    );

  const canManageOlpQuantities =
    isOlp &&
    canAcceptOlp &&
    ![
      'REJECTED',
      'CANCELLED',
    ].includes(
      detail.technicalStatus,
    ) &&
    olpRemainingTotal >
      0;


  /*
   * En esta etapa estamos validando la experiencia visual OLP.
   * Las OC HISTORICAL_ONLY permiten visualizar el bloque
   * sin convertir ni modificar información histórica.
   */
  const showOlpAcceptanceUi =
    canManageOlpQuantities;


  const olpStepText =
    detail.olpAcceptedAt
      ? `Gestionado ${olpManagedTotal} de ${detail.summary.requestedQuantity} · Entrega ${dateOnly(
          detail.olpCommittedDate,
        )}`
      : historical
        ? 'Pendiente de gestión OLP'
        : 'Pendiente de gestión';


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
                    colSpan={2}
                    className={
                      styles.receptionGroup
                    }
                  >
                    Recepción OLP
                  </th>

                  <th
                    colSpan={
                      showReceiptCaptureColumn
                        ? 4
                        : 3
                    }
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
                    Gestionado
                  </th>

                  <th>
                    Gestionar ahora
                  </th>

                  <th>
                    Estado
                  </th>

                  <th>
                    Recibido
                  </th>

                  <th>
                    Pendiente
                  </th>

                  {showReceiptCaptureColumn ? (
                    <th>
                      Recibir ahora
                    </th>
                  ) : null}
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
                          <strong>
                            {
                              line.managedQuantity ??
                              0
                            }
                            {' / '}
                            {
                              line.requestedQuantity
                            }
                          </strong>
                        </td>

                        <td>
                          {
                            canManageOlpQuantities &&
                            (
                              line.managedQuantity ??
                              0
                            ) <
                              line.requestedQuantity
                              ? (
                                <input
                                  type="number"
                                  min={1}
                                  max={
                                    Math.max(
                                      line.requestedQuantity -
                                      (
                                        line.managedQuantity ??
                                        0
                                      ),
                                      0,
                                    )
                                  }
                                  step={1}
                                  inputMode="numeric"
                                  className={
                                    styles.receiptQuantityInput
                                  }
                                  value={
                                    olpQuantities[
                                      line.id
                                    ] ??
                                    ''
                                  }
                                  disabled={
                                    busy
                                  }
                                  aria-label={`Gestionar ahora OLP ${line.commercialCode}`}
                                  onChange={(
                                    event,
                                  ) => {
                                    const value =
                                      event.target.value;

                                    if (
                                      value === '' ||
                                      /^\d+$/.test(
                                        value,
                                      )
                                    ) {
                                      setOlpQuantities(
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
                                  }}
                                />
                              )
                              : '—'
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

                        {showReceiptCaptureColumn ? (
  <td>
                            {
                              canReceiveThisOrder &&
                              line.pendingQuantity >
                                0
                                ? (
                                  <input
                                    type="number"
                                    min={1}
                                    max={
                                      line.pendingQuantity
                                    }
                                    step={1}
                                    inputMode="numeric"
                                    className={
                                      styles.receiptQuantityInput
                                    }
                                    value={
                                      receiptQuantities[
                                        line.id
                                      ] ??
                                      ''
                                    }
                                    disabled={
                                      receiptBusy
                                    }
                                    aria-label={`Recibir ahora ${line.commercialCode}`}
                                    onChange={(
                                      event,
                                    ) => {
                                      const value =
                                        event.target.value;

                                      if (
                                        value === '' ||
                                        /^\d+$/.test(
                                          value,
                                        )
                                      ) {
                                        setReceiptQuantities(
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
                                    }}
                                  />
                                )
                                : (
                                  '—'
                                )
                            }
                          </td>
                        ) : null}
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

                  <td>
                    <strong>
                      {
                        olpManagedTotal
                      }
                      {' / '}
                      {
                        detail.summary
                          .requestedQuantity
                      }
                    </strong>
                  </td>

                  <td>
                    <strong>
                      {
                        olpManagingNowTotal >
                          0
                          ? olpManagingNowTotal
                          : '—'
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

                  {showReceiptCaptureColumn ? (
                    <td
                    className={
                      styles.receiptTotalSpacer
                    }
                  />
                  ) : null}
</tr>
              </tbody>
            </table>
          </div>


          {canReceiveThisOrder ? (
            <div
              className={
                styles.receiptActions
              }
            >
              <button
                type="button"
                className="button primary"
                disabled={
                  receiptBusy
                }
                onClick={() =>
                  void confirmMedicarteReceipt()
                }
              >
                {
                  receiptBusy
                    ? 'Confirmando…'
                    : 'Confirmar recepción'
                }
              </button>
            </div>
          ) : null}
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
          {detail.olpAcceptedAt &&
          !canManageOlpQuantities ? (
            <>
              <div>
                <strong>
                  Gestión OLP completada
                </strong>

                <span>
                  OLP confirmó las cantidades a gestionar y la orden quedó disponible
                  para la recepción de Medicarte.
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
                    Revisa el acumulado y registra únicamente la cantidad adicional que OLP gestionará ahora.
                  </span>

                  <span>
                    Luego define la fecha de entrega para confirmar la gestión.
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
                      Gestionar entrega
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
                          Confirmar gestión de entrega
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
                              : 'Confirmar gestión'
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

      <UniversalOrderHistorySection
        detail={
          detail
        }
      />

    </>
  );
}
