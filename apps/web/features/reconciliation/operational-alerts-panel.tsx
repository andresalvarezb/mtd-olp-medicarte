'use client';

import { useState } from 'react';
import type {
  ReconciliationNotificationResponse,
  ReconciliationNotificationType,
  ReconciliationSeverity,
} from '@authorization/contracts';
import { Card, CardBody, CardHead } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { FilterBar, FilterField } from '@/components/ui/filter-bar';
import { StatusBadge, type PillTone } from '@/components/ui/status-badge';
import { ApiError } from '@/lib/api-client';
import {
  listReconciliationNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/reconciliation-api';
import { useApiData } from '@/hooks/use-api-data';

interface AlertPayload {
  errorCode?: string;
  errorMessage?: string;
  count?: number;
  critical?: number;
  error?: number;
  warning?: number;
  newCriticalIssues?: number;
  reopenedIssues?: number;
  acceptedRiskOverdue?: number;
  acceptedRiskIssues?: number;
}

function toneForSeverity(severity: ReconciliationSeverity): PillTone {
  if (severity === 'CRITICAL') return 'red';
  if (severity === 'ERROR') return 'orange';
  if (severity === 'WARNING') return 'purple';
  return 'blue';
}

function labelForType(type: ReconciliationNotificationType): string {
  switch (type) {
    case 'RECONCILIATION_CRITICAL':
      return 'Inconsistencia Crítica';
    case 'RECONCILIATION_ERROR':
      return 'Inconsistencia de Integridad';
    case 'RECONCILIATION_WARNING':
      return 'Advertencia Operacional';
    case 'RECONCILIATION_TECHNICAL_FAILURE':
      return 'Fallo Técnico del Reconciler';
    case 'RECONCILIATION_RECOVERY':
      return 'Recuperación Operacional';
    case 'RISK_REVIEW_OVERDUE':
      return 'Riesgo Aceptado Vencido';
    default:
      return type;
  }
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : 'No fue posible completar la operación.';
}

export function OperationalAlertsPanel({
  organizationId,
  canRead,
  onSelectRun,
}: {
  organizationId: string;
  canRead: boolean;
  onSelectRun?: ((runId: string) => void) | undefined;
}) {
  const [unreadOnly, setUnreadOnly] = useState<boolean>(false);
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const notificationsData = useApiData(
    () =>
      canRead
        ? listReconciliationNotifications(organizationId, {
            ...(unreadOnly ? { unreadOnly: true } : {}),
            ...(severityFilter ? { severity: severityFilter as ReconciliationSeverity } : {}),
            limit: 100,
          })
        : Promise.resolve({ items: [], total: 0 }),
    [organizationId, unreadOnly, severityFilter, canRead],
  );

  const notifications: ReconciliationNotificationResponse[] = notificationsData.data?.items ?? [];

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  const handleMarkRead = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await markNotificationRead(organizationId, id);
      notificationsData.reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleMarkAllRead = async () => {
    setBusy(true);
    setError(null);
    try {
      await markAllNotificationsRead(organizationId);
      notificationsData.reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {error ? <p className="banner error">{error}</p> : null}

      <Card>
        <CardHead
          title="Alertas de Reconciliación e Integridad"
          subtitle="Resumen operacional de discrepancias, recuperaciones y condiciones críticas."
          aside={
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {unreadCount > 0 ? (
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void handleMarkAllRead()}
                >
                  Marcar todas como leídas
                </button>
              ) : null}
            </div>
          }
        />
        <CardBody>
          <FilterBar>
            <FilterField label="Filtrar">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => setUnreadOnly(e.target.checked)}
                />
                <span>Solo no leídas</span>
              </label>
            </FilterField>
            <FilterField label="Severidad">
              <select
                className="input"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
              >
                <option value="">Todas</option>
                <option value="CRITICAL">CRITICAL</option>
                <option value="ERROR">ERROR</option>
                <option value="WARNING">WARNING</option>
                <option value="INFO">INFO</option>
              </select>
            </FilterField>
            <button className="btn" type="button" onClick={() => notificationsData.reload()}>
              Refrescar
            </button>
          </FilterBar>

          <DataTable
            aria-label="Alertas de reconciliación"
            columns={[
              { label: 'Estado' },
              { label: 'Severidad' },
              { label: 'Tipo' },
              { label: 'Fecha' },
              { label: 'Resumen' },
              { label: 'Run / Ejecución' },
              { label: 'Acción' },
            ]}
            emptyIcon="17"
            emptyTitle="Sin alertas"
            emptyDescription="No hay alertas registradas para los filtros seleccionados."
            rows={notifications.map((row) => {
              const p = (row.payload ?? {}) as AlertPayload;

              let summaryContent = null;
              if (row.notificationType === 'RECONCILIATION_TECHNICAL_FAILURE') {
                summaryContent = (
                  <div style={{ fontSize: '0.875rem', color: 'var(--red-9, #b91c1c)' }}>
                    <strong>Fallo técnico: </strong>
                    {p.errorCode ?? 'Error desconocido'} - {p.errorMessage ?? ''}
                  </div>
                );
              } else if (row.notificationType === 'RECONCILIATION_RECOVERY') {
                summaryContent = (
                  <div style={{ fontSize: '0.875rem', color: 'var(--green-9, #15803d)' }}>
                    <strong>Recuperado: </strong> Reconciliación ahora saludable (0 inconsistencias
                    críticas o de error).
                  </div>
                );
              } else if (row.notificationType === 'RISK_REVIEW_OVERDUE') {
                summaryContent = (
                  <div style={{ fontSize: '0.875rem', color: 'var(--purple-9, #7e22ce)' }}>
                    <strong>Revisión vencida: </strong>
                    {typeof p.count === 'number'
                      ? `${p.count} issues con aceptación de riesgo vencida`
                      : 'Riesgo aceptado vencido'}
                  </div>
                );
              } else {
                summaryContent = (
                  <div style={{ fontSize: '0.875rem' }}>
                    <div>
                      {typeof p.critical === 'number' && p.critical > 0 ? (
                        <span
                          style={{
                            color: 'var(--red-9, #b91c1c)',
                            fontWeight: 600,
                            marginRight: '0.5rem',
                          }}
                        >
                          {p.critical} CRIT
                        </span>
                      ) : null}
                      {typeof p.error === 'number' && p.error > 0 ? (
                        <span
                          style={{
                            color: 'var(--orange-9, #c2410c)',
                            fontWeight: 600,
                            marginRight: '0.5rem',
                          }}
                        >
                          {p.error} ERR
                        </span>
                      ) : null}
                      {typeof p.warning === 'number' && p.warning > 0 ? (
                        <span style={{ color: '#666', marginRight: '0.5rem' }}>
                          {p.warning} WARN
                        </span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#555', marginTop: '0.125rem' }}>
                      {typeof p.newCriticalIssues === 'number' && p.newCriticalIssues > 0
                        ? `Nuevos críticos: ${p.newCriticalIssues} | `
                        : ''}
                      {typeof p.reopenedIssues === 'number' && p.reopenedIssues > 0
                        ? `Reabiertos: ${p.reopenedIssues} | `
                        : ''}
                      {typeof p.acceptedRiskOverdue === 'number' && p.acceptedRiskOverdue > 0
                        ? `Riesgos vencidos: ${p.acceptedRiskOverdue} | `
                        : ''}
                      {typeof p.acceptedRiskIssues === 'number' && p.acceptedRiskIssues > 0
                        ? `Riesgos aceptados: ${p.acceptedRiskIssues}`
                        : ''}
                    </div>
                  </div>
                );
              }

              return [
                <StatusBadge key="status" tone={row.readAt ? 'gray' : 'blue'}>
                  {row.readAt ? 'LEÍDA' : 'NUEVA'}
                </StatusBadge>,
                <StatusBadge key="sev" tone={toneForSeverity(row.severity)}>
                  {row.severity}
                </StatusBadge>,
                <div key="type">
                  <strong>{labelForType(row.notificationType)}</strong>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>{row.notificationType}</div>
                </div>,
                <span key="date" style={{ fontSize: '0.875rem' }}>
                  {new Date(row.createdAt).toLocaleString()}
                </span>,
                <div key="summary">{summaryContent}</div>,
                <div key="run" style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>
                  {row.reconciliationRunId ? (
                    <div>
                      {onSelectRun ? (
                        <button
                          type="button"
                          className="btn small"
                          style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem' }}
                          onClick={() => onSelectRun(row.reconciliationRunId!)}
                        >
                          Ver Run {row.reconciliationRunId.slice(0, 8)}
                        </button>
                      ) : (
                        <span>Run: {row.reconciliationRunId.slice(0, 8)}</span>
                      )}
                    </div>
                  ) : null}
                  {row.executionId ? (
                    <div style={{ color: '#666' }}>Exec: {row.executionId.slice(0, 8)}</div>
                  ) : null}
                </div>,
                !row.readAt ? (
                  <button
                    key="action"
                    className="btn small"
                    type="button"
                    disabled={busy}
                    onClick={() => void handleMarkRead(row.id)}
                  >
                    Marcar leída
                  </button>
                ) : (
                  <span key="action" style={{ color: '#aaa', fontSize: '0.875rem' }}>
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
