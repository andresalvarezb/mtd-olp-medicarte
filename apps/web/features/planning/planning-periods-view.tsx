'use client';

import { useState } from 'react';
import {
  planningPeriodTransitions,
  type PlanningPeriodResponse,
  type PlanningPeriodStatus,
} from '@authorization/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHead } from '@/components/ui/card';
import { StatusBadge, type PillTone } from '@/components/ui/status-badge';
import { Note } from '@/components/ui/timeline';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import {
  createPlanningPeriod,
  listPlanningPeriods,
  transitionPlanningPeriod,
  updatePlanningPeriod,
} from '@/lib/planning-periods-api';

const STATUS_TONES: Record<PlanningPeriodStatus, PillTone> = {
  OPEN: 'green',
  PLANNING_CLOSED: 'orange',
  PURCHASING: 'blue',
  IN_FULFILLMENT: 'purple',
  OPERATIONAL: 'blue',
  CLOSED: 'gray',
};

const STRUCTURALLY_EDITABLE: readonly PlanningPeriodStatus[] = ['OPEN', 'PLANNING_CLOSED'];

const BOGOTA_DATE_TIME = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDateTime(iso: string): string {
  return BOGOTA_DATE_TIME.format(new Date(iso));
}

/** datetime-local en horario de Bogotá (UTC-5 fijo, sin DST). */
function toBogotaIso(local: string): string {
  return new Date(`${local}:00-05:00`).toISOString();
}

function toLocalInput(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '00';
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}

interface FormState {
  startDate: string;
  endDate: string;
  cutoffLocal: string;
  poDeadlineLocal: string;
  expectedDeliveryDate: string;
}

const EMPTY_FORM: FormState = {
  startDate: '',
  endDate: '',
  cutoffLocal: '',
  poDeadlineLocal: '',
  expectedDeliveryDate: '',
};

export function PlanningPeriodsView() {
  const { organizationId, hasPermission } = useRole();
  const canManage = hasPermission('planning_periods.manage');
  const periods = useApiData(() => listPlanningPeriods(organizationId), [organizationId]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState<PlanningPeriodResponse | null>(null);
  const [selected, setSelected] = useState<PlanningPeriodResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const setField = (field: keyof FormState, value: string): void => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const run = (action: () => Promise<void>): void => {
    setBusy(true);
    setError(null);
    setMessage(null);
    void action()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Error inesperado.'))
      .finally(() => setBusy(false));
  };

  const handleSubmit = (): void =>
    run(async () => {
      const body = {
        startDate: form.startDate,
        endDate: form.endDate,
        schedulingCutoffAt: toBogotaIso(form.cutoffLocal),
        purchaseOrderDeadlineAt: toBogotaIso(form.poDeadlineLocal),
        expectedDeliveryDate: form.expectedDeliveryDate,
      };
      if (editing) {
        const updated = await updatePlanningPeriod(organizationId, editing.id, {
          expectedVersion: editing.version,
          ...body,
        });
        setEditing(updated);
        setSelected(updated);
        setMessage('Período actualizado.');
      } else {
        const created = await createPlanningPeriod(organizationId, body);
        setSelected(created);
        setMessage('Período creado.');
      }
      setForm(EMPTY_FORM);
      periods.reload();
    });

  const startEdit = (period: PlanningPeriodResponse): void => {
    setEditing(period);
    setSelected(period);
    setForm({
      startDate: period.startDate,
      endDate: period.endDate,
      cutoffLocal: toLocalInput(period.schedulingCutoffAt),
      poDeadlineLocal: toLocalInput(period.purchaseOrderDeadlineAt),
      expectedDeliveryDate: period.expectedDeliveryDate,
    });
    setError(null);
    setMessage(null);
  };

  const cancelEdit = (): void => {
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const handleTransition = (period: PlanningPeriodResponse, to: PlanningPeriodStatus): void =>
    run(async () => {
      const updated = await transitionPlanningPeriod(organizationId, period.id, {
        to,
        expectedVersion: period.version,
      });
      setSelected(updated);
      if (editing?.id === updated.id) setEditing(updated);
      setMessage(`Período en estado ${updated.status}.`);
      periods.reload();
    });

  const structureEditable = editing ? STRUCTURALLY_EDITABLE.includes(editing.status) : true;
  const items = periods.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Períodos de planificación"
        description="Ventana operativa sobre la cual Medicarte programa y MTD consolida demanda. El rango es inclusivo y no puede solaparse con otro período."
        actions={<span className="pill blue">{items.length} períodos</span>}
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

      {canManage ? (
        <Card>
          <CardHead
            title={
              editing ? `Editar período ${editing.startDate} → ${editing.endDate}` : 'Nuevo período'
            }
            subtitle="Las fechas de rango solo pueden modificarse en OPEN y PLANNING_CLOSED."
          />
          <CardBody>
            <div className="config-grid">
              <div className="field">
                <label htmlFor="period-start">Inicio</label>
                <input
                  id="period-start"
                  className="control"
                  type="date"
                  value={form.startDate}
                  disabled={busy || (editing !== null && !structureEditable)}
                  onChange={(event) => setField('startDate', event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="period-end">Fin</label>
                <input
                  id="period-end"
                  className="control"
                  type="date"
                  value={form.endDate}
                  disabled={busy || (editing !== null && !structureEditable)}
                  onChange={(event) => setField('endDate', event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="period-cutoff">Corte de programación</label>
                <input
                  id="period-cutoff"
                  className="control"
                  type="datetime-local"
                  value={form.cutoffLocal}
                  disabled={busy}
                  onChange={(event) => setField('cutoffLocal', event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="period-po-deadline">Límite de OC</label>
                <input
                  id="period-po-deadline"
                  className="control"
                  type="datetime-local"
                  value={form.poDeadlineLocal}
                  disabled={busy}
                  onChange={(event) => setField('poDeadlineLocal', event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="period-delivery">Entrega esperada</label>
                <input
                  id="period-delivery"
                  className="control"
                  type="date"
                  value={form.expectedDeliveryDate}
                  disabled={busy}
                  onChange={(event) => setField('expectedDeliveryDate', event.target.value)}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="button" className="btn" disabled={busy} onClick={handleSubmit}>
                {editing ? 'Guardar cambios' : 'Crear período'}
              </button>
              {editing ? (
                <button type="button" className="btn" disabled={busy} onClick={cancelEdit}>
                  Cancelar edición
                </button>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : (
        <Note>Tu rol permite consultar períodos, pero no crearlos ni modificarlos.</Note>
      )}

      <Card>
        <CardHead
          title="Calendario operativo"
          subtitle="Períodos ordenados del más reciente al más antiguo."
        />
        <CardBody>
          {periods.loading ? (
            <Note>Cargando períodos…</Note>
          ) : items.length === 0 ? (
            <Note>Sin períodos registrados todavía.</Note>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rango</th>
                    <th>Corte programación</th>
                    <th>Límite OC</th>
                    <th>Entrega esperada</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((period) => (
                    <tr key={period.id}>
                      <td>
                        <strong>
                          {period.startDate} → {period.endDate}
                        </strong>
                        <br />
                        <span style={{ color: 'var(--muted)' }}>v{period.version}</span>
                      </td>
                      <td>{formatDateTime(period.schedulingCutoffAt)}</td>
                      <td>{formatDateTime(period.purchaseOrderDeadlineAt)}</td>
                      <td>{period.expectedDeliveryDate}</td>
                      <td>
                        <StatusBadge tone={STATUS_TONES[period.status]}>
                          {period.status}
                        </StatusBadge>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: '2px 8px', fontSize: 10 }}
                            onClick={() => setSelected(period)}
                          >
                            Ver detalle
                          </button>
                          {canManage ? (
                            <button
                              type="button"
                              className="btn"
                              style={{ padding: '2px 8px', fontSize: 10 }}
                              disabled={busy}
                              onClick={() => startEdit(period)}
                            >
                              Editar
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {selected ? (
        <Card>
          <CardHead
            title={`Detalle ${selected.startDate} → ${selected.endDate}`}
            subtitle="Transiciones disponibles según la máquina de estados."
            aside={
              <StatusBadge tone={STATUS_TONES[selected.status]}>{selected.status}</StatusBadge>
            }
          />
          <CardBody>
            <div className="grid two-col">
              <div>
                <p>
                  <strong>Corte de programación:</strong>{' '}
                  {formatDateTime(selected.schedulingCutoffAt)}
                </p>
                <p>
                  <strong>Límite de OC:</strong> {formatDateTime(selected.purchaseOrderDeadlineAt)}
                </p>
                <p>
                  <strong>Entrega esperada:</strong> {selected.expectedDeliveryDate}
                </p>
                <p style={{ color: 'var(--muted)' }}>
                  Versión {selected.version} · actualizado {formatDateTime(selected.updatedAt)}
                </p>
              </div>
              <div>
                {canManage ? (
                  planningPeriodTransitions[selected.status].length > 0 ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {planningPeriodTransitions[selected.status].map((next) => (
                        <button
                          key={next}
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => handleTransition(selected, next)}
                        >
                          Pasar a {next}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Note>Estado final: no hay transiciones disponibles.</Note>
                  )
                ) : (
                  <Note>Tu rol no puede ejecutar transiciones.</Note>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
