'use client';

import { useApiData } from '@/hooks/use-api-data';

import {
  getFinancialAuditDashboard,
} from '@/lib/financial-audit-dashboard-api';

type Props = {
  organizationId: string;
};

const integer = new Intl.NumberFormat('es-CO');

const currency = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: string): string {
  if (!/^\d+\.\d{2}$/.test(value)) {
    return 'Valor no disponible';
  }

  const amount = Number(value);

  return Number.isFinite(amount)
    ? currency.format(amount)
    : 'Valor no disponible';
}

function Metric({
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

export function FinancialAuditDashboardSection({
  organizationId,
}: Props) {
  const summary = useApiData(
    signal =>
      getFinancialAuditDashboard(
        organizationId,
        signal,
      ),
    [organizationId],
    ['AUTHORIZATIONS', 'DASHBOARD'],
  );

  const data = summary.data;

  return (
    <section
      className="executive-section"
      aria-label="Dashboard financiero y auditoría"
    >
      <header className="question-header">
        <div className="question-number">06</div>

        <div>
          <h2>¿Cómo avanzan el recaudo y la auditoría?</h2>
          <p>
            Estado financiero de cuotas moderadoras y
            auditoría de facturación, consolidado por autorización.
          </p>
        </div>
      </header>

      <div className="authorization-management-actions">
        <button
          type="button"
          className="btn"
          disabled={summary.loading}
          onClick={summary.reload}
        >
          {summary.loading
            ? 'Actualizando indicadores…'
            : 'Actualizar indicadores'}
        </button>
      </div>

      {summary.loading && !data ? (
        <div className="executive-dashboard-state" role="status">
          Consultando información financiera…
        </div>
      ) : null}

      {summary.error ? (
        <div className="login-error" role="alert">
          No fue posible cargar los indicadores:
          {' '}
          {summary.error}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="dashboard-definition">
            Universo: {integer.format(data.authorizationTotal)}
            {' '}
            autorizaciones. Las cifras de recaudo corresponden
            al último estado registrado de cada autorización;
            no representan la suma histórica de todos los eventos.
          </div>

          <h3>Recaudo de cuota moderadora</h3>

          <div className="financial-kpis">
            <Metric
              label="Valor recaudado"
              value={money(data.moderatorFee.collectedAmountCop)}
              note="Recaudo efectivo según el último registro vigente"
            />

            <Metric
              label="Autorizaciones recaudadas"
              value={integer.format(data.moderatorFee.collectedCount)}
              note="Estado RECAUDADA"
            />

            <Metric
              label="No recaudadas"
              value={integer.format(data.moderatorFee.notCollectedCount)}
              note="MEDICARTE informó que no hubo recaudo"
            />

            <Metric
              label="Sin registro de recaudo"
              value={integer.format(data.moderatorFee.notRecordedCount)}
              note="No existe evento financiero"
            />
          </div>

          <h3>Auditoría de facturación</h3>

          <div className="financial-kpis">
            <Metric
              label="Auditorías conformes"
              value={integer.format(data.billingAudit.compliesCount)}
              note="Revisada · Cumple"
            />

            <Metric
              label="Auditorías no conformes"
              value={integer.format(data.billingAudit.doesNotComplyCount)}
              note="Revisada · No cumple"
            />

            <Metric
              label="Auditorías pendientes"
              value={integer.format(data.billingAudit.pendingCount)}
              note="Auditoría iniciada, sin decisión"
            />

            <Metric
              label="Sin auditoría"
              value={integer.format(data.billingAudit.notStartedCount)}
              note="No existe auditoría de facturación"
            />

            <Metric
              label="Registros inconsistentes"
              value={integer.format(data.billingAudit.inconsistentCount)}
              note="Requieren revisión de integridad"
            />
          </div>

          <h3>Entrega y aplicación</h3>

          <div className="financial-kpis">
            <Metric
              label="Autorizaciones con cumplimiento"
              value={integer.format(
                data.fulfillment.withFulfillmentCount,
              )}
              note="Al menos una entrega o aplicación confirmada"
            />
          </div>

          <p className="dashboard-definition">
            Recaudo, auditoría y entrega/aplicación son procesos
            independientes. Una cuota recaudada no implica
            que el medicamento haya sido entregado.
          </p>

          <small>
            Consulta generada:
            {' '}
            {new Date(data.generatedAt).toLocaleString('es-CO', {
              timeZone: 'America/Bogota',
            })}
          </small>
        </>
      ) : null}
    </section>
  );
}
