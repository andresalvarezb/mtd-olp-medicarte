'use client';

import { useMemo, useState } from 'react';
import type {
  ReconciliationCadence,
  ReconciliationExecutionStatus,
  ReconciliationOperationExecutionResponse,
  ReconciliationOperationPolicyResponse,
  ReconciliationSeverityAlertThreshold,
  ReconciliationTriggerType,
} from '@authorization/contracts';
import { calculateNextSlot } from '@authorization/domain';
import { Card, CardBody, CardHead } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { FilterBar, FilterField } from '@/components/ui/filter-bar';
import { StatusBadge, type PillTone } from '@/components/ui/status-badge';
import { ApiError } from '@/lib/api-client';
import {
  cancelOperationExecution,
  disableOperationPolicy,
  enableOperationPolicy,
  getOperationPolicy,
  listOperationExecutions,
  triggerManualOperationExecution,
  upsertOperationPolicy,
} from '@/lib/reconciliation-api';
import { useApiData } from '@/hooks/use-api-data';

function toneForExecutionStatus(status: ReconciliationExecutionStatus): PillTone {
  if (status === 'COMPLETED') return 'green';
  if (status === 'RUNNING' || status === 'CLAIMED') return 'orange';
  if (status === 'FAILED') return 'red';
  if (status === 'CANCELLED' || status === 'SKIPPED') return 'gray';
  return 'blue'; // PENDING
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : 'No fue posible completar la operación.';
}

export function OperationalOperationsPanel({
  organizationId,
  canManage,
  canRun,
}: {
  organizationId: string;
  canManage: boolean;
  canRun: boolean;
}) {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [triggerFilter, setTriggerFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Edit policy state
  const [editing, setEditing] = useState(false);
  const [cadence, setCadence] = useState<ReconciliationCadence>('DAILY');
  const [localTime, setLocalTime] = useState<string>('02:00');
  const [weekday, setWeekday] = useState<number>(1);
  const [severityThreshold, setSeverityThreshold] =
    useState<ReconciliationSeverityAlertThreshold>('ERROR');
  const [notifyOnRecovery, setNotifyOnRecovery] = useState<boolean>(true);
  const [notifyOnTechnicalFailure, setNotifyOnTechnicalFailure] = useState<boolean>(true);

  const policyData = useApiData(() => getOperationPolicy(organizationId), [organizationId]);

  const executionsData = useApiData(
    () =>
      listOperationExecutions(organizationId, {
        ...(statusFilter ? { status: statusFilter as ReconciliationExecutionStatus } : {}),
        ...(triggerFilter ? { triggerType: triggerFilter as ReconciliationTriggerType } : {}),
        limit: 100,
      }),
    [organizationId, statusFilter, triggerFilter],
  );

  const policy: ReconciliationOperationPolicyResponse | null = policyData.data?.policy ?? null;

  const executions: ReconciliationOperationExecutionResponse[] = executionsData.data?.items ?? [];

  // Active execution is either CLAIMED or RUNNING
  const activeExecution = useMemo(
    () => executions.find((e) => e.status === 'RUNNING' || e.status === 'CLAIMED') ?? null,
    [executions],
  );

  // Calculate preview of next slot using shared domain logic
  const previewNextRun = useMemo(() => {
    if (!policy || !policy.enabled) return null;
    return calculateNextSlot(
      {
        cadence: policy.cadence,
        timezone: policy.timezone,
        localTime: policy.localTime,
        weekday: policy.weekday,
      },
      new Date(),
    );
  }, [policy]);

  const handleStartEdit = () => {
    if (!policy) {
      setCadence('DAILY');
      setLocalTime('02:00');
      setWeekday(1);
      setSeverityThreshold('ERROR');
      setNotifyOnRecovery(true);
      setNotifyOnTechnicalFailure(true);
    } else {
      setCadence(policy.cadence);
      setLocalTime(policy.localTime ?? '02:00');
      setWeekday(policy.weekday ?? 1);
      setSeverityThreshold(policy.severityAlertThreshold);
      setNotifyOnRecovery(policy.notifyOnRecovery);
      setNotifyOnTechnicalFailure(policy.notifyOnTechnicalFailure);
    }
    setEditing(true);
    setError(null);
    setSuccess(null);
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await upsertOperationPolicy(organizationId, {
        enabled: policy ? policy.enabled : false,
        cadence,
        timezone: 'America/Bogota',
        localTime: cadence === 'MANUAL' ? null : localTime,
        weekday: cadence === 'WEEKLY' ? Number(weekday) : null,
        severityAlertThreshold: severityThreshold,
        notifyOnRecovery,
        notifyOnTechnicalFailure,
        ...(policy ? { expectedVersion: policy.version } : {}),
      });
      setSuccess('Política de operaciones guardada exitosamente.');
      setEditing(false);
      policyData.reload();
      executionsData.reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleEnabled = async () => {
    if (!policy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      if (policy.enabled) {
        await disableOperationPolicy(organizationId);
        setSuccess('Programación de reconciliación deshabilitada.');
      } else {
        await enableOperationPolicy(organizationId);
        setSuccess('Programación de reconciliación habilitada.');
      }
      policyData.reload();
      executionsData.reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleTriggerManual = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await triggerManualOperationExecution(organizationId, {});
      setSuccess('Ejecución manual solicitada e iniciada exitosamente.');
      executionsData.reload();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setError('Ya existe una reconciliación en ejecución para este tenant.');
      } else {
        setError(describeError(cause));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCancelExecution = async (executionId: string) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await cancelOperationExecution(organizationId, executionId);
      setSuccess(`Ejecución ${executionId.slice(0, 8)} cancelada.`);
      executionsData.reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {error ? <p className="banner error">{error}</p> : null}
      {success ? <p className="banner success">{success}</p> : null}

      {/* Active Execution Banner */}
      {activeExecution ? (
        <div
          style={{
            padding: '1rem',
            background: 'var(--amber-2, #fffbeb)',
            border: '1px solid var(--amber-7, #f59e0b)',
            borderRadius: '6px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <strong>Reconciliación en curso: </strong>
            <span>
              Ejecución {activeExecution.id.slice(0, 8)} ({activeExecution.triggerType}) en estado{' '}
              <StatusBadge tone={toneForExecutionStatus(activeExecution.status)}>
                {activeExecution.status}
              </StatusBadge>
            </span>
            <div style={{ fontSize: '0.875rem', color: '#666', marginTop: '0.25rem' }}>
              Iniciada:{' '}
              {activeExecution.startedAt
                ? new Date(activeExecution.startedAt).toLocaleString()
                : 'Recientemente'}
              {' | '}
              Generación: {activeExecution.claimGeneration}
            </div>
          </div>
        </div>
      ) : null}

      {/* Policy Card */}
      <Card>
        <CardHead
          title="Política de Operaciones y Programación"
          subtitle="Configuración durable de frecuencia, timezone, exclusión de solapamiento y umbrales de alerta."
          aside={
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {policy && canManage ? (
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void handleToggleEnabled()}
                >
                  {policy.enabled ? 'Deshabilitar scheduler' : 'Habilitar scheduler'}
                </button>
              ) : null}
              {canManage && !editing ? (
                <button
                  className="btn primary"
                  type="button"
                  disabled={busy}
                  onClick={handleStartEdit}
                >
                  {policy ? 'Configurar política' : 'Crear política'}
                </button>
              ) : null}
              {canRun ? (
                <button
                  className="btn"
                  type="button"
                  disabled={busy || !!activeExecution}
                  onClick={() => void handleTriggerManual()}
                  title={activeExecution ? 'Ya existe una reconciliación en ejecución' : ''}
                >
                  Ejecutar manualmente
                </button>
              ) : null}
            </div>
          }
        />
        <CardBody>
          {!policy && !editing ? (
            <div>
              <p style={{ color: '#666', fontStyle: 'italic' }}>
                Programación de reconciliación no configurada.
              </p>
              {canManage ? (
                <button
                  className="btn primary"
                  type="button"
                  style={{ marginTop: '0.5rem' }}
                  onClick={handleStartEdit}
                >
                  Crear política ahora
                </button>
              ) : null}
            </div>
          ) : editing ? (
            <form onSubmit={(e) => void handleSavePolicy(e)}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '1rem',
                  marginBottom: '1rem',
                }}
              >
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600 }}>
                    Cadencia
                  </label>
                  <select
                    className="control"
                    value={cadence}
                    onChange={(e) => setCadence(e.target.value as ReconciliationCadence)}
                  >
                    <option value="DAILY">DAILY (Diaria)</option>
                    <option value="WEEKLY">WEEKLY (Semanal)</option>
                    <option value="MANUAL">MANUAL</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600 }}>
                    Hora local (America/Bogota)
                  </label>
                  <input
                    type="time"
                    className="control"
                    disabled={cadence === 'MANUAL'}
                    value={localTime}
                    onChange={(e) => setLocalTime(e.target.value)}
                    required={cadence !== 'MANUAL'}
                  />
                </div>

                {cadence === 'WEEKLY' ? (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600 }}>
                      Día de la semana
                    </label>
                    <select
                      className="control"
                      value={weekday}
                      onChange={(e) => setWeekday(Number(e.target.value))}
                    >
                      <option value={1}>Lunes (1)</option>
                      <option value={2}>Martes (2)</option>
                      <option value={3}>Miércoles (3)</option>
                      <option value={4}>Jueves (4)</option>
                      <option value={5}>Viernes (5)</option>
                      <option value={6}>Sábado (6)</option>
                      <option value={7}>Domingo (7)</option>
                    </select>
                  </div>
                ) : null}

                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600 }}>
                    Umbral de Alerta
                  </label>
                  <select
                    className="control"
                    value={severityThreshold}
                    onChange={(e) =>
                      setSeverityThreshold(e.target.value as ReconciliationSeverityAlertThreshold)
                    }
                  >
                    <option value="CRITICAL">Solo CRITICAL</option>
                    <option value="ERROR">ERROR y CRITICAL</option>
                    <option value="WARNING">WARNING, ERROR y CRITICAL</option>
                    <option value="NONE">NONE (Sin alertas de findings)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={notifyOnRecovery}
                    onChange={(e) => setNotifyOnRecovery(e.target.checked)}
                  />
                  <span>Notificar recuperación (Recovery)</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={notifyOnTechnicalFailure}
                    onChange={(e) => setNotifyOnTechnicalFailure(e.target.checked)}
                  />
                  <span>Notificar fallos técnicos de ejecución</span>
                </label>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn primary" type="submit" disabled={busy}>
                  Guardar cambios
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : policy ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '1rem',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#666', textTransform: 'uppercase' }}>
                    Estado del Scheduler
                  </div>
                  <div>
                    <StatusBadge tone={policy.enabled ? 'green' : 'gray'}>
                      {policy.enabled ? 'HABILITADO' : 'DESHABILITADO'}
                    </StatusBadge>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', color: '#666', textTransform: 'uppercase' }}>
                    Cadencia
                  </div>
                  <div style={{ fontWeight: 600 }}>{policy.cadence}</div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', color: '#666', textTransform: 'uppercase' }}>
                    Horario Local ({policy.timezone})
                  </div>
                  <div style={{ fontWeight: 600 }}>
                    {policy.localTime ?? 'N/A'}
                    {policy.weekday ? ` (Día ${policy.weekday})` : ''}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', color: '#666', textTransform: 'uppercase' }}>
                    Próxima Ejecución
                  </div>
                  <div style={{ fontWeight: 600 }}>
                    {policy.enabled && previewNextRun
                      ? previewNextRun.toLocaleString()
                      : policy.nextRunAt
                        ? new Date(policy.nextRunAt).toLocaleString()
                        : 'No programada'}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', color: '#666', textTransform: 'uppercase' }}>
                    Umbral de Alerta
                  </div>
                  <div style={{ fontWeight: 600 }}>{policy.severityAlertThreshold}</div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', color: '#666', textTransform: 'uppercase' }}>
                    Opciones de Alerta
                  </div>
                  <div style={{ fontSize: '0.875rem' }}>
                    Recovery: {policy.notifyOnRecovery ? 'Sí' : 'No'} | Fallo técnico:{' '}
                    {policy.notifyOnTechnicalFailure ? 'Sí' : 'No'}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* Executions History */}
      <Card>
        <CardHead
          title="Historial de Ejecuciones Operacionales"
          subtitle="Seguimiento de claims, leases, reintentos y resultado de ejecuciones programadas y manuales."
        />
        <CardBody>
          <FilterBar>
            <FilterField label="Estado">
              <select
                className="control"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">Todos los estados</option>
                <option value="PENDING">PENDING</option>
                <option value="CLAIMED">CLAIMED</option>
                <option value="RUNNING">RUNNING</option>
                <option value="COMPLETED">COMPLETED</option>
                <option value="FAILED">FAILED</option>
                <option value="CANCELLED">CANCELLED</option>
                <option value="SKIPPED">SKIPPED</option>
              </select>
            </FilterField>
            <FilterField label="Disparador">
              <select
                className="control"
                value={triggerFilter}
                onChange={(e) => setTriggerFilter(e.target.value)}
              >
                <option value="">Todos los triggers</option>
                <option value="MANUAL">MANUAL</option>
                <option value="SCHEDULED">SCHEDULED</option>
                <option value="RETRY">RETRY</option>
              </select>
            </FilterField>
            <button className="btn" type="button" onClick={() => executionsData.reload()}>
              Refrescar
            </button>
          </FilterBar>

          <DataTable
            aria-label="Ejecuciones operacionales de reconciliación"
            columns={[
              { label: 'ID' },
              { label: 'Disparador' },
              { label: 'Programada / Inicio' },
              { label: 'Estado Operacional' },
              { label: 'Salud del Run' },
              { label: 'Intento / Gen' },
              { label: 'Acciones' },
            ]}
            emptyIcon="17"
            emptyTitle="Sin ejecuciones"
            emptyDescription="No se han registrado ejecuciones de reconciliación."
            rows={executions.map((row) => {
              let runHealthElement = <span style={{ color: '#666' }}>-</span>;
              if (row.status !== 'COMPLETED') {
                if (row.status === 'FAILED') {
                  runHealthElement = (
                    <span style={{ color: 'var(--red-9, #b91c1c)', fontSize: '0.875rem' }}>
                      Fallo técnico: {row.lastErrorCode ?? 'Error'}
                    </span>
                  );
                } else if (row.status === 'SKIPPED') {
                  runHealthElement = (
                    <span style={{ color: '#666', fontSize: '0.875rem' }}>
                      Omitida: {row.skipReason ?? 'Solapamiento'}
                    </span>
                  );
                }
              } else {
                const isHealthy = row.runHealth === 'HEALTHY';
                runHealthElement = (
                  <div>
                    <StatusBadge tone={isHealthy ? 'green' : 'orange'}>
                      {isHealthy ? 'HEALTHY' : 'FINDINGS'}
                    </StatusBadge>
                    {!isHealthy &&
                    (row.criticalFindings || row.errorFindings || row.warningFindings) ? (
                      <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                        {(row.criticalFindings ?? 0) > 0 ? (
                          <span style={{ color: 'var(--red-9, #b91c1c)', marginRight: '0.5rem' }}>
                            {row.criticalFindings} CRIT
                          </span>
                        ) : null}
                        {(row.errorFindings ?? 0) > 0 ? (
                          <span
                            style={{ color: 'var(--orange-9, #c2410c)', marginRight: '0.5rem' }}
                          >
                            {row.errorFindings} ERR
                          </span>
                        ) : null}
                        {(row.warningFindings ?? 0) > 0 ? (
                          <span style={{ color: '#666' }}>{row.warningFindings} WARN</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              }

              return [
                <span key="id" title={row.id} style={{ fontFamily: 'monospace' }}>
                  {row.id.slice(0, 8)}
                </span>,
                <strong key="trigger">{row.triggerType}</strong>,
                <div key="time">
                  <div>{row.scheduledFor ? new Date(row.scheduledFor).toLocaleString() : '-'}</div>
                  {row.startedAt ? (
                    <div style={{ fontSize: '0.75rem', color: '#666' }}>
                      Inició: {new Date(row.startedAt).toLocaleTimeString()}
                    </div>
                  ) : null}
                </div>,
                <StatusBadge key="status" tone={toneForExecutionStatus(row.status)}>
                  {row.status}
                </StatusBadge>,
                <div key="health">{runHealthElement}</div>,
                <span key="gen">
                  #{row.attemptCount} / Gen {row.claimGeneration}
                </span>,
                row.status === 'PENDING' && canManage ? (
                  <button
                    key="action"
                    className="btn small danger"
                    type="button"
                    disabled={busy}
                    onClick={() => void handleCancelExecution(row.id)}
                  >
                    Cancelar
                  </button>
                ) : (
                  <span key="action" style={{ color: '#aaa' }}>
                    -
                  </span>
                ),
              ];
            })}
          />
        </CardBody>
      </Card>
    </div>
  );
}
