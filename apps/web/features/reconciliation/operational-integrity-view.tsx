'use client';

import { useMemo, useState } from 'react';
import type {
  ReconciliationDomain,
  ReconciliationFindingResponse,
  ReconciliationRunResponse,
  ReconciliationSeverity,
} from '@authorization/contracts';
import { Card, CardBody, CardHead } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { FilterBar, FilterField } from '@/components/ui/filter-bar';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge, type PillTone } from '@/components/ui/status-badge';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import { ApiError } from '@/lib/api-client';
import { listPlanningPeriods } from '@/lib/planning-periods-api';
import { listDispensingPoints } from '@/lib/patient-schedules-api';
import { OperationalIssuesPanel } from './operational-issues-panel';
import { OperationalOperationsPanel } from './operational-operations-panel';
import { OperationalAlertsPanel } from './operational-alerts-panel';
import {
  getReconciliationRun,
  listReconciliationFindings,
  listReconciliationRuns,
  startReconciliationRun,
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

function toneForStatus(status: string): PillTone {
  if (status === 'COMPLETED') return 'green';
  if (status === 'FAILED') return 'red';
  if (status === 'RUNNING') return 'orange';
  return 'gray';
}

function toneForSeverity(severity: ReconciliationSeverity): PillTone {
  if (severity === 'CRITICAL') return 'red';
  if (severity === 'ERROR') return 'orange';
  if (severity === 'WARNING') return 'purple';
  return 'blue';
}

function describeError(error: unknown) {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : 'No fue posible completar la operación.';
}

export function OperationalIntegrityView() {
  const { organizationId, hasPermission } = useRole();
  const canRun = hasPermission('reconciliation.run');
  const canTriage = hasPermission('reconciliation_issues.triage');
  const canComment = hasPermission('reconciliation_issues.comment');
  const canReadOperations = hasPermission('reconciliation_operations.read');
  const canManageOperations = hasPermission('reconciliation_operations.manage');
  const canReadNotifications = hasPermission('reconciliation_notifications.read');
  const [tab, setTab] = useState<'runs' | 'issues' | 'operations' | 'alerts'>('runs');
  const [focusIssueId, setFocusIssueId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [severity, setSeverity] = useState<ReconciliationSeverity | ''>('');
  const [domain, setDomain] = useState<ReconciliationDomain | ''>('');
  const [ruleCode, setRuleCode] = useState('');
  const [planningPeriodId, setPlanningPeriodId] = useState('');
  const [dispensingPointId, setDispensingPointId] = useState('');
  const [commercialCode, setCommercialCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runs = useApiData(() => listReconciliationRuns(organizationId), [organizationId]);
  const periods = useApiData(() => listPlanningPeriods(organizationId), [organizationId]);
  const points = useApiData(() => listDispensingPoints(organizationId), [organizationId]);
  const selectedRun = useApiData(
    () =>
      selectedId
        ? getReconciliationRun(organizationId, selectedId)
        : Promise.resolve(null as ReconciliationRunResponse | null),
    [organizationId, selectedId],
  );
  const findings = useApiData(
    () =>
      selectedId
        ? listReconciliationFindings(organizationId, selectedId, {
            ...(severity ? { severity } : {}),
            ...(domain ? { domain } : {}),
            ...(ruleCode.trim() ? { ruleCode: ruleCode.trim() } : {}),
            ...(planningPeriodId ? { planningPeriodId } : {}),
            ...(dispensingPointId ? { dispensingPointId } : {}),
            ...(commercialCode.trim() ? { commercialCode: commercialCode.trim() } : {}),
            limit: 500,
          })
        : Promise.resolve({ items: [] as ReconciliationFindingResponse[] }),
    [
      organizationId,
      selectedId,
      severity,
      domain,
      ruleCode,
      planningPeriodId,
      dispensingPointId,
      commercialCode,
    ],
  );
  const selectedFinding =
    findings.data?.items.find((item) => item.id === selectedFindingId) ??
    findings.data?.items[0] ??
    null;
  const domainSummary = useMemo(() => {
    const counts = new Map<
      ReconciliationDomain,
      { critical: number; error: number; warning: number; info: number }
    >();
    for (const key of Object.keys(DOMAIN_LABELS) as ReconciliationDomain[]) {
      counts.set(key, { critical: 0, error: 0, warning: 0, info: 0 });
    }
    for (const finding of findings.data?.items ?? []) {
      const bucket = counts.get(finding.domain);
      if (!bucket) continue;
      if (finding.severity === 'CRITICAL') bucket.critical += 1;
      if (finding.severity === 'ERROR') bucket.error += 1;
      if (finding.severity === 'WARNING') bucket.warning += 1;
      if (finding.severity === 'INFO') bucket.info += 1;
    }
    return counts;
  }, [findings.data]);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await startReconciliationRun(organizationId, {
        ...(planningPeriodId ? { planningPeriodId } : {}),
        ...(dispensingPointId ? { dispensingPointId } : {}),
      });
      setSelectedId(created.id);
      runs.reload();
      selectedRun.reload();
      findings.reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main>
      <PageHeader
        title="Integridad operacional"
        description="Verifica invariantes de ESP-001 a ESP-016 sobre PostgreSQL. No repara datos ni es una fuente de verdad."
        actions={
          canRun ? (
            <button
              className="btn primary"
              type="button"
              disabled={busy}
              onClick={() => void run()}
            >
              Ejecutar reconciliación
            </button>
          ) : null
        }
      />
      <p style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          className={`btn ${tab === 'runs' ? 'primary' : ''}`}
          type="button"
          onClick={() => setTab('runs')}
        >
          Runs
        </button>
        <button
          className={`btn ${tab === 'issues' ? 'primary' : ''}`}
          type="button"
          onClick={() => setTab('issues')}
        >
          Issues
        </button>
        {canReadOperations ? (
          <button
            className={`btn ${tab === 'operations' ? 'primary' : ''}`}
            type="button"
            onClick={() => setTab('operations')}
          >
            Operations
          </button>
        ) : null}
        {canReadNotifications ? (
          <button
            className={`btn ${tab === 'alerts' ? 'primary' : ''}`}
            type="button"
            onClick={() => setTab('alerts')}
          >
            Alerts
          </button>
        ) : null}
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      {tab === 'operations' ? (
        <OperationalOperationsPanel
          organizationId={organizationId}
          canManage={canManageOperations}
          canRun={canRun}
        />
      ) : tab === 'alerts' ? (
        <OperationalAlertsPanel
          organizationId={organizationId}
          canRead={canReadNotifications}
          onSelectRun={(runId) => {
            setTab('runs');
            setSelectedId(runId);
          }}
        />
      ) : tab === 'issues' ? (
        <OperationalIssuesPanel
          organizationId={organizationId}
          canTriage={canTriage}
          canComment={canComment}
          focusIssueId={focusIssueId}
          onOpenEvidence={(runId, findingId) => {
            setTab('runs');
            setSelectedId(runId);
            setSelectedFindingId(findingId);
          }}
        />
      ) : (
        <>
          <Card>
            <CardHead
              title="Últimos runs"
              subtitle="FAILED significa que el motor no terminó, no que haya findings."
            />
            <CardBody>
              <DataTable
                aria-label="Runs de reconciliación"
                columns={[
                  { label: 'Fecha' },
                  { label: 'Scope' },
                  { label: 'Estado' },
                  { label: 'Reglas' },
                  { label: 'Critical' },
                  { label: 'Errors' },
                  { label: 'Warnings' },
                  { label: 'Duración' },
                ]}
                emptyIcon="17"
                emptyTitle="Sin runs"
                emptyDescription="Ejecuta una reconciliación manual. No hay scheduler automático."
                rows={(runs.data?.items ?? []).map((item) => [
                  <button
                    key={item.id}
                    className="btn"
                    type="button"
                    onClick={() => {
                      setSelectedId(item.id);
                      setSelectedFindingId(null);
                    }}
                  >
                    {new Date(item.startedAt).toLocaleString('es-CO')}
                  </button>,
                  item.scope.kind,
                  <StatusBadge key={`${item.id}-status`} tone={toneForStatus(item.status)}>
                    {item.status}
                  </StatusBadge>,
                  item.rulesVersion,
                  String(item.criticalFindings),
                  String(item.errorFindings),
                  String(item.warningFindings),
                  item.durationMs == null ? '—' : `${item.durationMs} ms`,
                ])}
              />
            </CardBody>
          </Card>
          {selectedRun.data ? (
            <Card>
              <CardHead
                title="Resumen por dominio"
                subtitle={`${selectedRun.data.status} · ${selectedRun.data.rulesVersion}`}
              />
              <CardBody>
                <DataTable
                  aria-label="Resumen por dominio"
                  columns={[
                    { label: 'Dominio' },
                    { label: 'Critical' },
                    { label: 'Error' },
                    { label: 'Warning' },
                    { label: 'Info' },
                  ]}
                  emptyIcon="17"
                  emptyTitle="Sin findings"
                  emptyDescription="La base evaluada no produjo hallazgos en el filtro actual."
                  rows={[...domainSummary.entries()].map(([key, value]) => [
                    DOMAIN_LABELS[key],
                    String(value.critical),
                    String(value.error),
                    String(value.warning),
                    String(value.info),
                  ])}
                />
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHead title="Findings" />
            <CardBody>
              <FilterBar>
                <FilterField label="Severidad">
                  <select
                    className="control"
                    value={severity}
                    onChange={(event) =>
                      setSeverity(event.target.value as ReconciliationSeverity | '')
                    }
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
                <FilterField label="Regla">
                  <input
                    className="control"
                    value={ruleCode}
                    onChange={(event) => setRuleCode(event.target.value)}
                    placeholder="REC-APP-003"
                  />
                </FilterField>
                <FilterField label="Período">
                  <select
                    className="control"
                    value={planningPeriodId}
                    onChange={(event) => setPlanningPeriodId(event.target.value)}
                  >
                    <option value="">Todos</option>
                    {(periods.data?.items ?? []).map((period) => (
                      <option key={period.id} value={period.id}>
                        {period.startDate} — {period.endDate}
                      </option>
                    ))}
                  </select>
                </FilterField>
                <FilterField label="Punto">
                  <select
                    className="control"
                    value={dispensingPointId}
                    onChange={(event) => setDispensingPointId(event.target.value)}
                  >
                    <option value="">Todos</option>
                    {(points.data?.items ?? []).map((point) => (
                      <option key={point.id} value={point.id}>
                        {point.code}
                      </option>
                    ))}
                  </select>
                </FilterField>
                <FilterField label="Producto">
                  <input
                    className="control"
                    value={commercialCode}
                    onChange={(event) => setCommercialCode(event.target.value)}
                  />
                </FilterField>
              </FilterBar>
              <DataTable
                aria-label="Findings de reconciliación"
                columns={[
                  { label: 'Regla' },
                  { label: 'Severidad' },
                  { label: 'Entidad' },
                  { label: 'Mensaje' },
                ]}
                emptyIcon="17"
                emptyTitle="Sin findings"
                emptyDescription="Selecciona un run o ajusta los filtros."
                rows={(findings.data?.items ?? []).map((item) => [
                  <button
                    key={item.id}
                    className="btn"
                    type="button"
                    onClick={() => setSelectedFindingId(item.id)}
                  >
                    {item.ruleCode}
                  </button>,
                  <StatusBadge key={`${item.id}-sev`} tone={toneForSeverity(item.severity)}>
                    {item.severity}
                  </StatusBadge>,
                  `${item.entityType}${item.entityId ? ` ${item.entityId.slice(0, 8)}` : ''}`,
                  item.message,
                ])}
              />
            </CardBody>
          </Card>
          {selectedFinding ? (
            <Card>
              <CardHead title="Detalle del finding" subtitle={selectedFinding.ruleCode} />
              <CardBody>
                <p>
                  <StatusBadge tone={toneForSeverity(selectedFinding.severity)}>
                    {selectedFinding.severity}
                  </StatusBadge>{' '}
                  {selectedFinding.category}
                </p>
                <p>{selectedFinding.message}</p>
                <p>
                  Entidad: {selectedFinding.entityType} {selectedFinding.entityId ?? '—'}
                </p>
                <p>
                  Relacionada: {selectedFinding.relatedEntityType ?? '—'}{' '}
                  {selectedFinding.relatedEntityId ?? ''}
                </p>
                <p>Detectado: {new Date(selectedFinding.detectedAt).toLocaleString('es-CO')}</p>
                <pre>{JSON.stringify(selectedFinding.evidence, null, 2)}</pre>
                <p>{selectedFinding.recommendedAction}</p>
                {selectedFinding.entityType && ENTITY_HREF[selectedFinding.entityType] ? (
                  <a className="btn" href={ENTITY_HREF[selectedFinding.entityType]}>
                    Ver entidad
                  </a>
                ) : null}
                {selectedFinding.issueId ? (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      setFocusIssueId(selectedFinding.issueId);
                      setTab('issues');
                    }}
                  >
                    Ver issue
                  </button>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
        </>
      )}
    </main>
  );
}
