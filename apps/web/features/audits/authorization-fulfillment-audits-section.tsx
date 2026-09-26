'use client';

import {
  useState,
} from 'react';

import type {
  ApplicationAuditStatus,
  FulfillmentAuditResponse,
} from '@authorization/contracts';

import {
  Card,
  CardBody,
  CardHead,
} from '@/components/ui/card';

import {
  StatusBadge,
  type PillTone,
} from '@/components/ui/status-badge';

import {
  useRole,
} from '@/components/layout/role-context';

import {
  useApiData,
} from '@/hooks/use-api-data';

import {
  ApiError,
} from '@/lib/api-client';

import {
  approveAuthorizationFulfillmentAudit,
  listAuthorizationFulfillmentAudits,
  rejectAuthorizationFulfillmentAudit,
  startAuthorizationFulfillmentAudit,
} from '@/lib/authorization-fulfillment-audits-api';

const statusMeta:
  Record<
    ApplicationAuditStatus,
    {
      label: string;
      tone: PillTone;
    }
  > = {
    READY_FOR_AUDIT: {
      label:
        'Pendiente de auditoría',

      tone:
        'blue',
    },

    IN_REVIEW: {
      label:
        'En auditoría',

      tone:
        'orange',
    },

    APPROVED: {
      label:
        'Se puede facturar',

      tone:
        'green',
    },

    REJECTED: {
      label:
        'No se puede facturar',

      tone:
        'red',
    },
  };

function describeError(
  error:
    unknown,
) {
  if (
    error instanceof
      ApiError
  ) {
    return `${error.code}: ${error.message}`;
  }

  return error instanceof Error
    ? error.message
    : 'No fue posible completar la operación.';
}

function fulfillmentTypeLabel(
  type:
    FulfillmentAuditResponse['fulfillmentType'],
) {
  return type ===
    'APPLICATION'
    ? 'Aplicación'
    : 'Entrega';
}

export function AuthorizationFulfillmentAuditsSection() {
  const {
    organizationId,
    hasPermission,
  } =
    useRole();

  const canManage =
    hasPermission(
      'application_audits.manage',
    );

  const [
    status,
    setStatus,
  ] =
    useState<ApplicationAuditStatus | ''>(
      'READY_FOR_AUDIT',
    );

  const [
    selectedId,
    setSelectedId,
  ] =
    useState<string | null>(
      null,
    );

  const [
    observation,
    setObservation,
  ] =
    useState('');

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null,
    );

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const audits =
    useApiData(
      () =>
        listAuthorizationFulfillmentAudits(
          organizationId,
          {
            ...(status
              ? {
                  status,
                }
              : {}),

            limit:
              500,
          },
        ),
      [
        organizationId,
        status,
      ],
    );

  const selected =
    audits.data?.items.find(
      (item) =>
        item.fulfillmentId ===
          selectedId,
    ) ??
    null;

  async function run(
    action:
      () =>
        Promise<unknown>,
  ) {
    setBusy(
      true,
    );

    setError(
      null,
    );

    try {
      await action();

      setObservation(
        '',
      );

      audits.reload();
    } catch (
      cause
    ) {
      setError(
        describeError(
          cause,
        ),
      );

      audits.reload();
    } finally {
      setBusy(
        false,
      );
    }
  }

  function start(
    item:
      FulfillmentAuditResponse,
  ) {
    void run(
      () =>
        startAuthorizationFulfillmentAudit(
          organizationId,
          item.fulfillmentId,
        ),
    );
  }

  function approve(
    item:
      FulfillmentAuditResponse,
  ) {
    if (
      !item.id
    ) {
      return;
    }

    void run(
      () =>
        approveAuthorizationFulfillmentAudit(
          organizationId,
          item.id!,
        ),
    );
  }

  function reject(
    item:
      FulfillmentAuditResponse,
  ) {
    if (
      !item.id
      ||
      !observation.trim()
    ) {
      setError(
        'Debes registrar la razón por la cual no se puede facturar.',
      );

      return;
    }

    void run(
      () =>
        rejectAuthorizationFulfillmentAudit(
          organizationId,
          item.id!,
          {
            observation:
              observation.trim(),
          },
        ),
    );
  }

  return (
    <Card className="operational-list-workspace">
      <CardHead
        title="Entregas y aplicaciones"
        subtitle="Auditoría del fulfillment moderno. La decisión no modifica el hecho físico ni devuelve inventario."
      />

      <CardBody>
        <label>
          Estado

          <select
            className="control"
            value={status}
            onChange={(
              event,
            ) =>
              setStatus(
                event.target.value as
                  ApplicationAuditStatus
                  |
                  '',
              )
            }
          >
            <option value="">
              Todos
            </option>

            <option value="READY_FOR_AUDIT">
              Pendiente de auditoría
            </option>

            <option value="IN_REVIEW">
              En auditoría
            </option>

            <option value="APPROVED">
              Se puede facturar
            </option>

            <option value="REJECTED">
              No se puede facturar
            </option>
          </select>
        </label>

        {
          error
            ? (
                <p role="alert">
                  {error}
                </p>
              )
            : null
        }

        {
          audits.loading
            ? (
                <p>
                  Cargando entregas/aplicaciones...
                </p>
              )
            : null
        }

        <div className="table-wrap operational-list-table-wrap">
          <table aria-label="Auditoría de entregas y aplicaciones">
            <thead>
              <tr>
                <th>
                  Paciente
                </th>

                <th>
                  Autorización
                </th>

                <th>
                  Producto
                </th>

                <th>
                  Tipo
                </th>

                <th>
                  Fecha
                </th>

                <th>
                  Punto
                </th>

                <th>
                  Cantidad
                </th>

                <th>
                  Estado
                </th>

                <th>
                  Acciones
                </th>
              </tr>
            </thead>

            <tbody>
              {
                audits.data?.items.map(
                  (
                    item,
                  ) => {
                    const meta =
                      statusMeta[
                        item.status
                      ];

                    return (
                      <tr
                        key={
                          item.fulfillmentId
                        }
                      >
                        <td>
                          {
                            item.patientName ??
                            item.patientDocument ??
                            '—'
                          }
                        </td>

                        <td>
                          {
                            item.authorizationNumber
                          }
                        </td>

                        <td>
                          {
                            item.commercialCode
                          }
                        </td>

                        <td>
                          {
                            fulfillmentTypeLabel(
                              item.fulfillmentType,
                            )
                          }
                        </td>

                        <td>
                          {
                            item.effectiveDate
                          }
                        </td>

                        <td>
                          {
                            item.dispensingPointCode ??
                            '—'
                          }
                        </td>

                        <td>
                          {
                            item.quantity
                          }
                        </td>

                        <td>
                          <StatusBadge
                            tone={
                              meta.tone
                            }
                          >
                            {
                              meta.label
                            }
                          </StatusBadge>
                        </td>

                        <td>
                          <button
                            type="button"
                            className="btn"
                            onClick={
                              () =>
                                setSelectedId(
                                  item.fulfillmentId,
                                )
                            }
                          >
                            Ver detalle
                          </button>

                          {' '}

                          {
                            canManage &&
                            item.status ===
                              'READY_FOR_AUDIT'
                              ? (
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={
                                      busy
                                    }
                                    onClick={
                                      () =>
                                        start(
                                          item,
                                        )
                                    }
                                  >
                                    Iniciar auditoría
                                  </button>
                                )
                              : null
                          }
                        </td>
                      </tr>
                    );
                  },
                )
              }
            </tbody>
          </table>
        </div>

        {
          selected
            ? (
                <div className="flow">
                  <h3>
                    Detalle de entrega / aplicación
                  </h3>

                  <p>
                    <strong>
                      Paciente:
                    </strong>{' '}
                    {
                      selected.patientName ??
                      '—'
                    }{' '}
                    ·{' '}
                    <strong>
                      Documento:
                    </strong>{' '}
                    {
                      selected.patientDocument ??
                      '—'
                    }
                  </p>

                  <p>
                    <strong>
                      Autorización:
                    </strong>{' '}
                    {
                      selected.authorizationNumber
                    }{' '}
                    ·{' '}
                    <strong>
                      Producto:
                    </strong>{' '}
                    {
                      selected.commercialCode
                    }
                  </p>

                  <p>
                    <strong>
                      Evento:
                    </strong>{' '}
                    {
                      fulfillmentTypeLabel(
                        selected.fulfillmentType,
                      )
                    }{' '}
                    ·{' '}
                    <strong>
                      Fecha:
                    </strong>{' '}
                    {
                      selected.effectiveDate
                    }{' '}
                    ·{' '}
                    <strong>
                      Cantidad:
                    </strong>{' '}
                    {
                      selected.quantity
                    }
                  </p>

                  <p>
                    <strong>
                      Punto:
                    </strong>{' '}
                    {
                      selected.dispensingPointName ??
                      selected.dispensingPointCode ??
                      '—'
                    }{' '}
                    ·{' '}
                    <strong>
                      OC:
                    </strong>{' '}
                    {
                      selected.purchaseOrders.length >
                        0
                        ? selected.purchaseOrders.join(
                            ', ',
                          )
                        : '—'
                    }
                  </p>

                  <p>
                    <strong>
                      Estado:
                    </strong>{' '}
                    {
                      statusMeta[
                        selected.status
                      ].label
                    }
                  </p>

                  {
                    selected.observation
                      ? (
                          <p>
                            <strong>
                              Observación:
                            </strong>{' '}
                            {
                              selected.observation
                            }
                          </p>
                        )
                      : null
                  }

                  {
                    canManage &&
                    selected.status ===
                      'IN_REVIEW'
                      ? (
                          <>
                            <button
                              type="button"
                              className="button primary"
                              disabled={
                                busy
                              }
                              onClick={
                                () =>
                                  approve(
                                    selected,
                                  )
                              }
                            >
                              Se puede facturar
                            </button>

                            <label>
                              Motivo para no facturar

                              <textarea
                                className="control"
                                value={
                                  observation
                                }
                                onChange={(
                                  event,
                                ) =>
                                  setObservation(
                                    event.target.value,
                                  )
                                }
                              />
                            </label>

                            <button
                              type="button"
                              className="button"
                              disabled={
                                busy
                                ||
                                !observation.trim()
                              }
                              onClick={
                                () =>
                                  reject(
                                    selected,
                                  )
                              }
                            >
                              No se puede facturar
                            </button>
                          </>
                        )
                      : null
                  }
                </div>
              )
            : null
        }
      </CardBody>
    </Card>
  );
}
