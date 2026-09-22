'use client';

import { useRouter } from 'next/navigation';

import { useRole } from '@/components/layout/role-context';
import { PageHeader } from '@/components/ui/page-header';
import { useApiData } from '@/hooks/use-api-data';
import { getDashboardAnalytics } from '@/lib/analytics-api';

const integer = new Intl.NumberFormat('es-CO');

const currency = new Intl.NumberFormat(
  'es-CO',
  {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  },
);

const STATUS_LABELS: Record<string, string> = {
  ACCEPTED: 'Aceptada',
  PARTIALLY_ACCEPTED: 'Aceptada parcialmente',
  REJECTED: 'Rechazada',
  IN_FULFILLMENT: 'En cumplimiento',
  PARTIALLY_DISPATCHED: 'Despachada parcialmente',
  FULLY_DISPATCHED: 'Despachada',
  PARTIALLY_RECEIVED: 'Recibida parcialmente',
  RECEIVED: 'Recibida',
};

function number(value: number) {
  return integer.format(value);
}

function money(value: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return value;
  }

  return currency.format(parsed);
}

function percentage(
  value: number,
  total: number,
) {
  if (total <= 0) return '0 %';

  return new Intl.NumberFormat(
    'es-CO',
    {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    },
  ).format(value / total);
}

export function DashboardView() {
  const router = useRouter();

  const { organizationId } =
    useRole();

  const dashboard = useApiData(
    () =>
      getDashboardAnalytics(
        organizationId,
      ),
    [organizationId],
  );

  const data = dashboard.data;

  return (
    <div className="executive-dashboard">
      <PageHeader
        title="Dashboard"
        description="Estado actual de las AUTO, inventario, novedades y órdenes de compra."
      />

      {dashboard.loading ? (
        <div className="executive-dashboard-state">
          Cargando información…
        </div>
      ) : null}

      {dashboard.error ? (
        <div
          className="login-error"
          role="alert"
        >
          {dashboard.error}
        </div>
      ) : null}

      {data ? (
        <>
          <section className="executive-section">
            <QuestionHeader
              number="01"
              title="¿Cuántas AUTO hay y cómo avanza su gestión?"
              description="Seguimiento de AUTO elegibles para compra hasta la recepción física asociada a su cobertura."
            />

            <div className="auto-funnel">
              <FunnelStage
                label="AUTO recibidas"
                value={
                  data.authorizations.total
                }
                note="Total persistido"
              />

              <FunnelArrow />

              <FunnelStage
                label="Pasaron primer filtro"
                value={
                  data.authorizations
                    .passedFirstFilter
                }
                note="Elegibles para compra hoy"
              />

              <FunnelArrow />

              <FunnelStage
                label="Con OC por MTD"
                value={
                  data.authorizations
                    .purchaseOrderIssued
                }
                note="Con cobertura en OC emitida"
              />

              <FunnelArrow />

              <FunnelStage
                label="OLP gestionó"
                value={
                  data.authorizations
                    .supplierManaged
                }
                note="Revisión OLP finalizada"
              />

              <FunnelArrow />

              <FunnelStage
                label="Recibidas en punto"
                value={
                  data.authorizations
                    .receivedAtPoint
                }
                note="Recepción confirmada"
                final
              />
            </div>

            <div className="dashboard-definition">
              La OC conserva trazabilidad hacia la AUTO para
              auditoría de cobertura. El inventario sigue siendo
              fungible por producto y no queda reservado para un
              paciente.
            </div>
          </section>

          <div className="executive-grid">
            <section className="executive-section">
              <QuestionHeader
                number="02"
                title="¿Cuántas AUTO son PBS y NO PBS?"
                description="Clasificación de cobertura de todas las AUTO recibidas."
              />

              <div className="coverage-grid">
                <CoverageCard
                  label="PBS"
                  value={data.coverage.pbs}
                  percentage={percentage(
                    data.coverage.pbs,
                    data.authorizations.total,
                  )}
                  tone="green"
                />

                <CoverageCard
                  label="NO PBS"
                  value={data.coverage.noPbs}
                  percentage={percentage(
                    data.coverage.noPbs,
                    data.authorizations.total,
                  )}
                  tone="amber"
                />
              </div>
            </section>

            <section className="executive-section">
              <QuestionHeader
                number="03"
                title="¿Qué moléculas están disponibles?"
                description="Saldo utilizable positivo, excluyendo lotes vencidos."
              />

              <div className="molecule-total">
                <span>
                  Moléculas / productos disponibles
                </span>

                <strong>
                  {number(
                    data.inventory
                      .availableMoleculeCount,
                  )}
                </strong>
              </div>

              <div className="executive-table-scroll inventory-table">
                <table className="executive-table">
                  <thead>
                    <tr>
                      <th>Molécula / producto</th>
                      <th>Código</th>
                      <th>Disponible</th>
                      <th>Ubicaciones</th>
                    </tr>
                  </thead>

                  <tbody>
                    {data.inventory.molecules.length ? (
                      data.inventory.molecules.map(
                        (item) => (
                          <tr
                            key={
                              item.commercialCode
                            }
                          >
                            <td>
                              <strong>
                                {item.molecule}
                              </strong>

                              {item
                                .commercialDescription ? (
                                <small>
                                  {
                                    item.commercialDescription
                                  }
                                </small>
                              ) : null}
                            </td>

                            <td>
                              {
                                item.commercialCode
                              }
                            </td>

                            <td className="numeric-cell">
                              {number(
                                item.usableQuantity,
                              )}
                            </td>

                            <td className="numeric-cell">
                              {number(
                                item.locationCount,
                              )}
                            </td>
                          </tr>
                        ),
                      )
                    ) : (
                      <tr>
                        <td colSpan={4}>
                          No hay inventario utilizable
                          disponible.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                className="dashboard-inline-action"
                onClick={() =>
                  router.push('/inventario')
                }
              >
                Ver inventario completo →
              </button>
            </section>
          </div>

          <section className="executive-section">
            <QuestionHeader
              number="04"
              title="¿Cuántas AUTO tienen novedades?"
              description="Novedades activas asociadas directamente a una AUTO."
            />

            <div className="novelty-kpis">
              <div>
                <span>
                  AUTO con novedad
                </span>

                <strong>
                  {number(
                    data.novelties
                      .affectedAuthorizationCount,
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Novedades activas
                </span>

                <strong>
                  {number(
                    data.novelties
                      .activeNoveltyCount,
                  )}
                </strong>
              </div>
            </div>

            <div className="executive-table-scroll">
              <table className="executive-table">
                <thead>
                  <tr>
                    <th>Causal</th>
                    <th>AUTO afectadas</th>
                    <th>Novedades activas</th>
                  </tr>
                </thead>

                <tbody>
                  {data.novelties.byCause.length ? (
                    data.novelties.byCause.map(
                      (item) => (
                        <tr key={item.code}>
                          <td>
                            <strong>
                              {item.description}
                            </strong>

                            <small>
                              {item.code}
                            </small>
                          </td>

                          <td className="numeric-cell">
                            {number(
                              item
                                .affectedAuthorizationCount,
                            )}
                          </td>

                          <td className="numeric-cell">
                            {number(
                              item.noveltyCount,
                            )}
                          </td>
                        </tr>
                      ),
                    )
                  ) : (
                    <tr>
                      <td colSpan={3}>
                        No existen novedades activas
                        asociadas a AUTO.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="executive-section">
            <QuestionHeader
              number="05"
              title="¿Cuál es el valor de las OC gestionadas y cuánto representan como gasto?"
              description="Valor contractual COMPENSAR frente al costo aceptado por OLP."
            />

            {data.purchaseOrders ? (
              <>
                <div className="financial-kpis">
                  <FinancialCard
                    label="OC gestionadas"
                    value={number(
                      data.purchaseOrders
                        .managedOrderCount,
                    )}
                    note="Revisión OLP finalizada"
                  />

                  <FinancialCard
                    label="Valor contractual"
                    value={money(
                      data.purchaseOrders
                        .totalContractualValue,
                    )}
                    note="Cantidad aceptada × tarifa COMPENSAR snapshot"
                  />

                  <FinancialCard
                    label="Gasto OLP"
                    value={money(
                      data.purchaseOrders
                        .totalSupplierExpense,
                    )}
                    note="Cantidad aceptada × costo unitario OLP"
                  />
                </div>

                <div className="executive-table-scroll">
                  <table className="executive-table">
                    <thead>
                      <tr>
                        <th>Orden de compra</th>
                        <th>Estado</th>
                        <th>Valor contractual</th>
                        <th>Gasto OLP</th>
                      </tr>
                    </thead>

                    <tbody>
                      {data.purchaseOrders.items.length ? (
                        data.purchaseOrders.items.map(
                          (order) => (
                            <tr key={order.id}>
                              <td>
                                <strong>
                                  {
                                    order.purchaseOrderCode
                                  }
                                </strong>
                              </td>

                              <td>
                                <span className="dashboard-status">
                                  {STATUS_LABELS[
                                    order.status
                                  ] ??
                                    order.status}
                                </span>
                              </td>

                              <td className="money-cell">
                                {money(
                                  order.contractualValue,
                                )}
                              </td>

                              <td className="money-cell">
                                {money(
                                  order.supplierExpense,
                                )}
                              </td>
                            </tr>
                          ),
                        )
                      ) : (
                        <tr>
                          <td colSpan={4}>
                            No existen órdenes
                            gestionadas por OLP.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <button
                  type="button"
                  className="dashboard-inline-action"
                  onClick={() =>
                    router.push(
                      '/ordenes-compra',
                    )
                  }
                >
                  Ver órdenes de compra →
                </button>
              </>
            ) : (
              <div className="executive-restricted">
                La información financiera está
                restringida para el rol actual.
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function QuestionHeader({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <header className="question-header">
      <div className="question-number">
        {number}
      </div>

      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  );
}

function FunnelStage({
  label,
  value,
  note,
  final = false,
}: {
  label: string;
  value: number;
  note: string;
  final?: boolean;
}) {
  return (
    <div
      className={
        final
          ? 'auto-stage final'
          : 'auto-stage'
      }
    >
      <span>{label}</span>

      <strong>{number(value)}</strong>

      <small>{note}</small>
    </div>
  );
}

function FunnelArrow() {
  return (
    <div
      className="auto-arrow"
      aria-hidden="true"
    >
      →
    </div>
  );
}

function CoverageCard({
  label,
  value,
  percentage,
  tone,
}: {
  label: string;
  value: number;
  percentage: string;
  tone: 'green' | 'amber';
}) {
  return (
    <div
      className={`coverage-metric ${tone}`}
    >
      <span>{label}</span>

      <strong>
        {number(value)}
      </strong>

      <small>
        {percentage} del total
      </small>
    </div>
  );
}

function FinancialCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="financial-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
