'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { KpiCard, KpiGrid } from '@/components/ui/kpi-card';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  approveAuditReview,
  getAuthorizationItemDetail,
  getIndicators,
  listAuthorizationItems,
  rejectAuditReview,
  startAuditReview,
  type AuditReview,
} from '@/lib/authorization-items-api';
import {
  auditPill,
  AUDIT_STATUS_LABELS,
  patientName,
  patientDocument,
  medicationName,
} from '@/lib/labels';
import type { AuthorizationItemResponse } from '@authorization/contracts';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Documento' },
  { label: 'Paciente' },
  { label: 'Medicamento' },
  { label: 'Punto aplicación' },
  { label: 'Fecha aplicación' },
  { label: 'Estado' },
  { label: 'Acciones' },
];

type TabFilter = 'READY' | 'IN_REVIEW' | 'REJECTED' | 'APPROVED';

export function AuditoriaView() {
  const { organizationId, hasPermission } = useRole();
  const [tab, setTab] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const canStart = hasPermission('audit.start');
  const canDecide = hasPermission('audit.reject') && hasPermission('audit.approve');

  const { data: indicators } = useApiData(() => getIndicators(organizationId), [organizationId]);

  const tabs: TabFilter[] = ['READY', 'IN_REVIEW', 'REJECTED', 'APPROVED'];
  const ready = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        auditStatus: 'READY',
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId],
  );
  const inReview = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        auditStatus: 'IN_REVIEW',
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId],
  );
  const rejected = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        auditStatus: 'REJECTED',
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId],
  );
  const approved = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        auditStatus: 'APPROVED',
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId],
  );

  const pages = {
    READY: { items: ready.items },
    IN_REVIEW: { items: inReview.items },
    REJECTED: { items: rejected.items },
    APPROVED: { items: approved.items },
  };
  const hooks = [ready, inReview, rejected, approved];
  const currentFilter = tabs[tab] ?? 'READY';
  const reloadCurrent = (hooks[tab] ?? ready).reload;

  const findOpenReview = async (itemId: string): Promise<AuditReview | null> => {
    const detail = await getAuthorizationItemDetail(itemId, organizationId);
    const reviews = detail.auditReviews ?? [];
    return reviews.find((review) => review.status === 'IN_REVIEW') ?? null;
  };

  const runAction = async (key: string, action: () => Promise<void>, message: string) => {
    setBusy(key);
    setActionError(null);
    setActionInfo(null);
    try {
      await action();
      setActionInfo(message);
      reloadCurrent();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'La acción falló.');
    } finally {
      setBusy(null);
    }
  };

  const handleStart = (itemId: string, version: number, numero: string) =>
    runAction(
      `start-${itemId}`,
      async () => {
        await startAuditReview(itemId, organizationId, version);
      },
      `Auditoría iniciada para ${numero}.`,
    );

  const handleDecision = (
    itemId: string,
    version: number,
    numero: string,
    decision: 'approve' | 'reject',
  ) =>
    runAction(
      `${decision}-${itemId}`,
      async () => {
        const review = await findOpenReview(itemId);
        if (!review) throw new Error(`No hay revisión abierta para ${numero}.`);
        const observations = window
          .prompt(
            decision === 'reject'
              ? 'Observaciones del rechazo (obligatorias):'
              : 'Observaciones (opcional):',
          )
          ?.trim();
        if (decision === 'reject') {
          if (!observations) throw new Error('Las observaciones son obligatorias para rechazar.');
          await rejectAuditReview(review.id, organizationId, version, observations);
        } else {
          await approveAuditReview(review.id, organizationId, version, observations || undefined);
        }
      },
      `${numero}: ${decision === 'approve' ? 'aprobada (DISPENSED)' : 'rechazada'}.`,
    );

  const buildRows = (filter: TabFilter) =>
    (pages[filter]?.items ?? []).map((item) => {
      const actions: React.ReactNode[] = [];
      if ((filter === 'READY' || filter === 'REJECTED') && canStart) {
        actions.push(
          <button
            key={`start-${item.id}`}
            type="button"
            className="btn"
            disabled={busy === `start-${item.id}`}
            onClick={() => {
              void handleStart(item.id, item.version, item.numeroAutorizacion);
            }}
          >
            {busy === `start-${item.id}`
              ? 'Iniciando…'
              : filter === 'REJECTED'
                ? 'Volver a revisar'
                : 'Iniciar auditoría'}
          </button>,
        );
      }
      if (filter === 'IN_REVIEW' && canDecide) {
        actions.push(
          <button
            key={`approve-${item.id}`}
            type="button"
            className="btn primary"
            disabled={busy === `approve-${item.id}`}
            onClick={() => {
              void handleDecision(item.id, item.version, item.numeroAutorizacion, 'approve');
            }}
          >
            Aprobar
          </button>,
          <button
            key={`reject-${item.id}`}
            type="button"
            className="btn"
            disabled={busy === `reject-${item.id}`}
            onClick={() => {
              void handleDecision(item.id, item.version, item.numeroAutorizacion, 'reject');
            }}
          >
            Rechazar
          </button>,
        );
      }
      if (!actions.length) actions.push('—');
      return [
        <span key="num" style={{ fontWeight: 600 }}>
          {item.numeroAutorizacion}
        </span>,
        patientDocument(item.sourceData),
        patientName(item.sourceData),
        medicationName(item.sourceData),
        item.lugarDispensacion ?? '—',
        item.fechaAplicacion ?? '—',
        <StatusBadge key="audit" tone={auditPill(item.auditStatus)}>
          {AUDIT_STATUS_LABELS[item.auditStatus]}
        </StatusBadge>,
        ...actions,
      ];
    });

  return (
    <>
      <PageHeader
        title="Auditoría de soportes"
        description="La aprobación explícita marca el ítem como DISPENSED y habilita su descarga en el consolidado."
        actions={
          <span className="pill blue">{indicators?.readyForReview ?? 0} listas para revisar</span>
        }
      />
      {actionError ? (
        <div className="login-error" role="alert" style={{ marginBottom: 14 }}>
          {actionError}
        </div>
      ) : null}
      {actionInfo ? (
        <div className="note" style={{ marginBottom: 14 }}>
          {actionInfo}
        </div>
      ) : null}
      <KpiGrid>
        <KpiCard
          label="Listas para auditar"
          value={indicators?.byAuditStatus.READY ?? 0}
          foot="Soportes completos"
          icon="LA"
          iconBg="#eef4ff"
          iconColor="#2456c7"
        />
        <KpiCard
          label="En revisión"
          value={indicators?.byAuditStatus.IN_REVIEW ?? 0}
          foot="Auditoría humana activa"
          icon="ER"
          iconBg="#fff4e5"
          iconColor="#b54708"
        />
        <KpiCard
          label="Rechazadas"
          value={indicators?.byAuditStatus.REJECTED ?? 0}
          foot="Requieren corrección"
          icon="RJ"
          iconBg="#fff0ee"
          iconColor="#b42318"
        />
        <KpiCard
          label="Aprobadas"
          value={indicators?.byAuditStatus.APPROVED ?? 0}
          foot="DISPENSED"
          icon="AP"
          iconBg="#eaf8f2"
          iconColor="#16835d"
        />
      </KpiGrid>
      <Card>
        <Tabs
          tabs={['Por revisar', 'En revisión', 'Rechazadas', 'Aprobadas']}
          activeTab={tab}
          onChange={setTab}
        >
          {(() => {
            const currentHook = hooks[tab] ?? ready;
            const loading = currentHook.loading;
            const error = currentHook.error;
            return (
              <>
                {error ? (
                  <div className="login-error" role="alert" style={{ margin: '0 0 14px' }}>
                    {error}
                  </div>
                ) : null}
                <DataTable
                  columns={COLUMNS}
                  rows={loading ? undefined : buildRows(currentFilter)}
                  aria-label="Auditoría de soportes"
                  emptyIcon="✓"
                  emptyTitle={loading ? 'Cargando…' : 'No hay registros en este estado'}
                  emptyDescription={
                    loading
                      ? 'Consultando la API…'
                      : 'Las auditorías humanas sobre soportes de aplicación aparecerán aquí.'
                  }
                />
                <TablePagination
                  page={currentHook.page}
                  hasPrev={currentHook.hasPrev}
                  hasNext={currentHook.hasNext}
                  onPrev={currentHook.prevPage}
                  onNext={currentHook.nextPage}
                />
              </>
            );
          })()}
        </Tabs>
      </Card>
    </>
  );
}
