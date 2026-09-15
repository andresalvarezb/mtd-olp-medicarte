'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  ReconciliationDomain,
  ReconciliationIssueResponse,
  ReconciliationIssueStatus,
  ReconciliationSeverity,
} from '@authorization/contracts';
import { Card, CardBody, CardHead } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { FilterBar, FilterField } from '@/components/ui/filter-bar';
import { StatusBadge, type PillTone } from '@/components/ui/status-badge';
import { useApiData } from '@/hooks/use-api-data';
import { ApiError } from '@/lib/api-client';
import {
  acceptIssueRisk,
  acknowledgeIssue,
  assignIssue,
  createIssueComment,
  getReconciliationIssue,
  listIssueAssignees,
  listIssueComments,
  listIssueEvents,
  listIssueFindings,
  listReconciliationIssues,
  reopenIssue,
  resolveIssue,
  unassignIssue,
} from '@/lib/reconciliation-api';

const DOMAIN_LABELS: Record<ReconciliationDomain, string> = {
  SCHEDULING: 'Scheduling',
  DEMAND: 'Demand',
  PURCHASE: 'Purchase',
  DELIVERY: 'Delivery',
  RECEIPT: 'Receipt',
  INVENTORY: 'Inventory',
  TRANSFER: 'Transfers',
  APPLICATION: 'Applications',
  OUTCOME: 'Outcomes',
  AUDIT: 'Audit',
  ANALYTICS: 'Analytics',
  BULK: 'Bulk',
  SCOPE: 'Scope',
  LEGACY: 'Legacy',
};

function toneForSeverity(severity: ReconciliationSeverity): PillTone {
  if (severity === 'CRITICAL') return 'red';
  if (severity === 'ERROR') return 'orange';
  if (severity === 'WARNING') return 'purple';
  return 'blue';
}

function toneForIssueStatus(status: ReconciliationIssueStatus): PillTone {
  if (status === 'OPEN') return 'red';
  if (status === 'ACKNOWLEDGED') return 'orange';
  if (status === 'ACCEPTED_RISK') return 'purple';
  return 'green';
}

function describeError(error: unknown) {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : 'No fue posible completar la operación.';
}

const ENTITY_HREF: Record<string, string> = {
  patient_schedule: '/programacion',
  patient_application: '/aplicaciones',
  patient_application_line: '/aplicaciones',
  patient_application_audit: '/auditorias',
  purchase_order: '/ordenes-compra',
  purchase_order_line: '/ordenes-compra',
  delivery: '/entregas',
  receipt: '/recepciones',
  inventory_lot: '/inventario',
  inventory_movement: '/inventario',
  stock_transfer: '/traslados',
  stock_transfer_line: '/traslados',
  projected_demand_line: '/demanda',
  bulk_import_job: '/importaciones',
  bulk_import_row: '/importaciones',
  user_point_scope: '/administracion',
};

export function OperationalIssuesPanel({
  organizationId,
  canTriage,
  canComment,
  focusIssueId,
  onOpenEvidence,
}: {
  organizationId: string;
  canTriage: boolean;
  canComment: boolean;
  focusIssueId?: string | null;
  onOpenEvidence?: (runId: string, findingId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(focusIssueId ?? null);
  const [status, setStatus] = useState<ReconciliationIssueStatus | ''>('');
  const [severity, setSeverity] = useState<ReconciliationSeverity | ''>('');
  const [domain, setDomain] = useState<ReconciliationDomain | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  useEffect(() => {
    if (focusIssueId) setSelectedId(focusIssueId);
  }, [focusIssueId]);
  const [resolutionNote, setResolutionNote] = useState('Corrected through the operational module.');
  const [riskReason, setRiskReason] = useState('');
  const issues = useApiData(
    () =>
      listReconciliationIssues(organizationId, {
        ...(status ? { status } : {}),
        ...(severity ? { severity } : {}),
        ...(domain ? { domain } : {}),
        limit: 200,
      }),
    [organizationId, status, severity, domain],
  );
  const selected = useApiData(
    () =>
      selectedId
        ? getReconciliationIssue(organizationId, selectedId)
        : Promise.resolve(null as ReconciliationIssueResponse | null),
    [organizationId, selectedId],
  );
  const occurrences = useApiData(
    () =>
      selectedId
        ? listIssueFindings(organizationId, selectedId, { limit: 50 })
        : Promise.resolve({ items: [] }),
    [organizationId, selectedId],
  );
  const events = useApiData(
    () =>
      selectedId ? listIssueEvents(organizationId, selectedId) : Promise.resolve({ items: [] }),
    [organizationId, selectedId],
  );
  const comments = useApiData(
    () =>
      selectedId ? listIssueComments(organizationId, selectedId) : Promise.resolve({ items: [] }),
    [organizationId, selectedId],
  );
  const assignees = useApiData(
    () => (canTriage ? listIssueAssignees(organizationId) : Promise.resolve({ items: [] })),
    [organizationId, canTriage],
  );
  const issue = selected.data;
  const latestOccurrence = occurrences.data?.items[0] ?? null;
  const entityHref = latestOccurrence ? ENTITY_HREF[latestOccurrence.entityType] : undefined;
  const timeline = useMemo(() => {
    const rows: Array<{ key: string; at: string; label: string }> = [
      ...(events.data?.items ?? []).map((item) => ({
        key: `event-${item.id}`,
        at: item.createdAt,
        label: `${item.eventType}${item.fromStatus ? ` ${item.fromStatus}→${item.toStatus}` : ''}`,
      })),
      ...(comments.data?.items ?? []).map((item) => ({
        key: `comment-${item.id}`,
        at: item.createdAt,
        label: `${item.authorUsername}: ${item.body}`,
      })),
    ];
    return rows.sort(
      (left, right) => left.at.localeCompare(right.at) || left.key.localeCompare(right.key),
    );
  }, [events.data, comments.data]);
  const reload = () => {
    issues.reload();
    selected.reload();
    occurrences.reload();
    events.reload();
    comments.reload();
  };
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {error ? <p className="banner error">{error}</p> : null}
      <Card>
        <CardHead
          title="Issues persistentes"
          subtitle="Governance sobre findings ESP-017. ACCEPTED_RISK no elimina el finding ni cambia el health del run."
        />
        <CardBody>
          <FilterBar>
            <FilterField label="Estado">
              <select
                className="control"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as ReconciliationIssueStatus | '')
                }
              >
                <option value="">Todos</option>
                <option value="OPEN">OPEN</option>
                <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
                <option value="RESOLVED">RESOLVED</option>
                <option value="ACCEPTED_RISK">ACCEPTED_RISK</option>
              </select>
            </FilterField>
            <FilterField label="Severidad">
              <select
                className="control"
                value={severity}
                onChange={(event) => setSeverity(event.target.value as ReconciliationSeverity | '')}
              >
                <option value="">Todas</option>
                <option value="CRITICAL">CRITICAL</option>
                <option value="ERROR">ERROR</option>
                <option value="WARNING">WARNING</option>
                <option value="INFO">INFO</option>
              </select>
            </FilterField>
            <FilterField label="Dominio">
              <select
                className="control"
                value={domain}
                onChange={(event) => setDomain(event.target.value as ReconciliationDomain | '')}
              >
                <option value="">Todos</option>
                {(Object.keys(DOMAIN_LABELS) as ReconciliationDomain[]).map((item) => (
                  <option key={item} value={item}>
                    {DOMAIN_LABELS[item]}
                  </option>
                ))}
              </select>
            </FilterField>
          </FilterBar>
          <DataTable
            aria-label="Issues de reconciliación"
            columns={[
              { label: 'Severity' },
              { label: 'Rule' },
              { label: 'Domain' },
              { label: 'Status' },
              { label: 'Occurrences' },
              { label: 'First seen' },
              { label: 'Last seen' },
              { label: 'Assignee' },
              { label: 'Risk review' },
            ]}
            emptyIcon="17"
            emptyTitle="Sin issues"
            emptyDescription="Los findings de un run se consolidan aquí por fingerprint."
            rows={(issues.data?.items ?? []).map((item) => [
              <StatusBadge key={`${item.id}-sev`} tone={toneForSeverity(item.currentSeverity)}>
                {item.currentSeverity}
              </StatusBadge>,
              <button
                key={item.id}
                className="btn"
                type="button"
                onClick={() => setSelectedId(item.id)}
              >
                {item.ruleCode}
              </button>,
              DOMAIN_LABELS[item.domain],
              <StatusBadge key={`${item.id}-st`} tone={toneForIssueStatus(item.status)}>
                {item.status}
              </StatusBadge>,
              String(item.occurrenceCount),
              new Date(item.firstSeenAt).toLocaleString('es-CO'),
              new Date(item.lastSeenAt).toLocaleString('es-CO'),
              item.assignee?.displayName ?? '—',
              item.riskReviewOverdue ? 'OVERDUE' : (item.riskReviewAt ?? '—'),
            ])}
          />
        </CardBody>
      </Card>
      {issue ? (
        <Card>
          <CardHead title={`Issue ${issue.ruleCode}`} subtitle={issue.fingerprint} />
          <CardBody>
            <p>
              <StatusBadge tone={toneForIssueStatus(issue.status)}>{issue.status}</StatusBadge>{' '}
              <StatusBadge tone={toneForSeverity(issue.currentSeverity)}>
                {issue.currentSeverity}
              </StatusBadge>{' '}
              max {issue.maxSeveritySeen} · {issue.occurrenceCount} occurrences
            </p>
            <p>{issue.description}</p>
            <p>{issue.recommendedAction}</p>
            <p>
              First seen {new Date(issue.firstSeenAt).toLocaleString('es-CO')} · Last seen{' '}
              {new Date(issue.lastSeenAt).toLocaleString('es-CO')}
            </p>
            {issue.riskReviewOverdue ? <p className="banner error">RISK_REVIEW_OVERDUE</p> : null}
            <p>
              Owner: {issue.assignee?.displayName ?? 'sin asignar'}
              {issue.daysSinceLastSeen > 0
                ? ` · ${issue.daysSinceLastSeen} días desde last seen`
                : ''}
            </p>
            <p>
              {onOpenEvidence ? (
                <>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => onOpenEvidence(issue.lastRunId, issue.lastFindingId)}
                  >
                    Ver último finding
                  </button>{' '}
                  <button
                    className="btn"
                    type="button"
                    onClick={() => onOpenEvidence(issue.lastRunId, issue.lastFindingId)}
                  >
                    Ver run
                  </button>
                </>
              ) : null}{' '}
              {entityHref ? (
                <a className="btn" href={entityHref}>
                  Ver entidad
                </a>
              ) : null}
            </p>
            {canTriage ? (
              <div className="cluster">
                {issue.status === 'OPEN' ? (
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(() => acknowledgeIssue(organizationId, issue.id, issue.version))
                    }
                  >
                    ACKNOWLEDGE
                  </button>
                ) : null}
                {issue.status === 'OPEN' || issue.status === 'ACKNOWLEDGED' ? (
                  <button
                    className="btn"
                    type="button"
                    disabled={busy || !riskReason.trim()}
                    onClick={() =>
                      void act(() =>
                        acceptIssueRisk(organizationId, issue.id, {
                          expectedVersion: issue.version,
                          acceptedRiskReason: riskReason.trim(),
                        }),
                      )
                    }
                  >
                    ACCEPT RISK
                  </button>
                ) : null}
                {issue.status !== 'RESOLVED' ? (
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        resolveIssue(organizationId, issue.id, {
                          expectedVersion: issue.version,
                          resolutionCode: 'DATA_CORRECTED',
                          resolutionNote: resolutionNote,
                        }),
                      )
                    }
                  >
                    RESOLVE
                  </button>
                ) : null}
                {issue.status === 'RESOLVED' || issue.status === 'ACCEPTED_RISK' ? (
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(() => reopenIssue(organizationId, issue.id, issue.version))
                    }
                  >
                    REOPEN
                  </button>
                ) : null}
                <select
                  className="control"
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                >
                  <option value="">Asignar a…</option>
                  {(assignees.data?.items ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
                <button
                  className="btn"
                  type="button"
                  disabled={busy || !assigneeId || issue.status === 'RESOLVED'}
                  onClick={() =>
                    void act(() =>
                      assignIssue(organizationId, issue.id, {
                        expectedVersion: issue.version,
                        assignedToUserId: assigneeId,
                      }),
                    )
                  }
                >
                  ASSIGN
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={busy || !issue.assignee}
                  onClick={() =>
                    void act(() => unassignIssue(organizationId, issue.id, issue.version))
                  }
                >
                  UNASSIGN
                </button>
                <input
                  className="control"
                  value={riskReason}
                  onChange={(event) => setRiskReason(event.target.value)}
                  placeholder="Motivo de accepted risk"
                />
                <input
                  className="control"
                  value={resolutionNote}
                  onChange={(event) => setResolutionNote(event.target.value)}
                  placeholder="Nota de resolución"
                />
              </div>
            ) : null}
            <p>No incluir datos clínicos o personales innecesarios.</p>
            {canComment ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!comment.trim()) return;
                  void act(async () => {
                    await createIssueComment(organizationId, issue.id, { body: comment.trim() });
                    setComment('');
                  });
                }}
              >
                <textarea
                  className="control"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  maxLength={2000}
                  placeholder="Comentario de governance"
                />
                <button className="btn" type="submit" disabled={busy}>
                  Comentar
                </button>
              </form>
            ) : null}
            <h3>Occurrences</h3>
            <ul>
              {(occurrences.data?.items ?? []).map((item) => (
                <li key={item.id}>
                  {item.ruleCode} · {item.severity} ·{' '}
                  {new Date(item.detectedAt).toLocaleString('es-CO')} · run{' '}
                  {item.reconciliationRunId.slice(0, 8)}
                </li>
              ))}
            </ul>
            <h3>Timeline</h3>
            <ul>
              {timeline.map((item) => (
                <li key={item.key}>
                  {new Date(item.at).toLocaleString('es-CO')} · {item.label}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
