'use client';

import { useState } from 'react';
import type {
  PlanningPeriodResponse,
  ProjectedDemandLineResponse,
  ProjectedDemandSourceResponse,
} from '@authorization/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHead } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import { listPlanningPeriods } from '@/lib/planning-periods-api';
import {
  consolidatePeriod,
  getProjectedDemandSources,
  listProjectedDemand,
} from '@/lib/projected-demand-api';

const BOGOTA_DATE_TIME = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  dateStyle: 'medium',
  timeStyle: 'short',
});

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Error inesperado.';
}

export function ProjectedDemandView() {
  const { organizationId, hasPermission } = useRole();
  const canConsolidate = hasPermission('projected_demand.manage');
  const periods = useApiData(() => listPlanningPeriods(organizationId), [organizationId]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [selectedLine, setSelectedLine] = useState<ProjectedDemandLineResponse | null>(null);
  const [sources, setSources] = useState<
    Array<ProjectedDemandSourceResponse & { loading?: boolean }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const demand = useApiData(
    () =>
      selectedPeriodId
        ? listProjectedDemand(organizationId, { planningPeriodId: selectedPeriodId })
        : Promise.resolve({ items: [] }),
    [organizationId, selectedPeriodId],
  );

  const run = (action: () => Promise<void>): void => {
    setBusy(true);
    setError(null);
    setMessage(null);
    void action()
      .catch((err: unknown) => setError(describeError(err)))
      .finally(() => setBusy(false));
  };

  const handleConsolidate = (): void =>
    run(async () => {
      const summary = await consolidatePeriod(organizationId, selectedPeriodId);
      setMessage(
        `Consolidación completada desde autorizaciones: ${summary.lineCount} líneas, ${summary.sourceCount} fuentes, ` +
          `${summary.projectedQuantity} unidades (regular ${summary.regularQuantity} / late ${summary.lateQuantity}).`,
      );
      demand.reload();
    });

  const openDetail = (line: ProjectedDemandLineResponse): void =>
    run(async () => {
      const result = await getProjectedDemandSources(organizationId, line.id);
      setSelectedLine(line);
      setSources(result.items);
    });

  const periodItems = periods.data?.items ?? [];
  const lineItems = demand.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Demanda proyectada"
        description="Consolidación reproducible de las autorizaciones cargadas por período, punto y código comercial. La demanda consolidada no es editable manualmente."
        actions={
          canConsolidate ? (
            <button
              type="button"
              className="btn primary"
              disabled={busy || !selectedPeriodId}
              onClick={handleConsolidate}
            >
              {busy ? 'Consolidando…' : 'Consolidar período'}
            </button>
          ) : (
            <span className="pill gray">Solo lectura</span>
          )
        }
      />

      {error ? (
        <div className="login-error" role="alert" style={{ marginBottom: 14 }}>
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="pill green" role="status" style={{ marginBottom: 14 }}>
          {message}
        </div>
      ) : null}

      <Card>
        <CardHead title="Período" subtitle="Selecciona el período a consolidar o consultar." />
        <CardBody>
          <div className="field">
            <label htmlFor="demand-period">Período</label>
            <select
              id="demand-period"
              className="control"
              value={selectedPeriodId}
              onChange={(event) => {
                setSelectedPeriodId(event.target.value);
                setSelectedLine(null);
              }}
            >
              <option value="">Selecciona un período</option>
              {periodItems.map((period: PlanningPeriodResponse) => (
                <option key={period.id} value={period.id}>
                  {period.startDate} → {period.endDate} ({period.status})
                </option>
              ))}
            </select>
          </div>
        </CardBody>
      </Card>

      {selectedPeriodId ? (
        <Card>
          <CardHead
            title="Líneas de demanda consolidada"
            subtitle="Una línea por período + código comercial. El punto se define en la orden de compra."
          />
          <CardBody>
            {demand.loading ? (
              <p style={{ color: 'var(--muted)' }}>Cargando demanda…</p>
            ) : lineItems.length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>
                Sin líneas consolidadas. Ejecuta "Consolidar período" para generarlas desde las
                autorizaciones cargadas.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Punto</th>
                      <th>Regular</th>
                      <th>Late</th>
                      <th>Proyectado</th>
                      <th>Fuentes</th>
                      <th>Última consolidación</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((line) => (
                      <tr key={line.id}>
                        <td>
                          <strong>{line.commercialCode}</strong>
                        </td>
                        <td>
                          {line.dispensingPointCode ?? 'Se define en la OC'}
                        </td>
                        <td>{line.regularQuantity}</td>
                        <td>{line.lateQuantity}</td>
                        <td>
                          <strong>{line.projectedQuantity}</strong>
                        </td>
                        <td>{line.sourceCount}</td>
                        <td>
                          {line.consolidatedAt
                            ? BOGOTA_DATE_TIME.format(new Date(line.consolidatedAt))
                            : '—'}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: '2px 8px', fontSize: 10 }}
                            onClick={() => openDetail(line)}
                          >
                            Ver detalle
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {selectedLine ? (
        <Card>
          <CardHead
            title={`Autorizaciones fuente · ${selectedLine.commercialCode}`}
            subtitle={`${selectedLine.planningPeriodStartDate} → ${selectedLine.planningPeriodEndDate}`}
            aside={<StatusBadge tone="blue">{selectedLine.sourceCount} fuentes</StatusBadge>}
          />
          <CardBody>
            {sources.length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>Sin fuentes registradas.</p>
            ) : (
              <div className="table-wrap">
                <table aria-label="Autorizaciones fuente">
                  <thead>
                    <tr>
                      <th>Autorización</th>
                      <th>Paciente</th>
                      <th>Documento</th>
                      <th>Cargada</th>
                      <th>Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((source) => (
                      <tr key={source.authorizationItemId}>
                        <td>{source.authorizationNumber}</td>
                        <td>{source.patientName ?? '—'}</td>
                        <td>{source.patientDocument ?? '—'}</td>
                        <td>{source.loadedAt}</td>
                        <td>{source.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ color: 'var(--muted)', marginTop: 12 }}>
              Las cantidades consolidadas no son editables: se recalculan desde el último cargue de
              autorizaciones al consolidar el período.
            </p>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
