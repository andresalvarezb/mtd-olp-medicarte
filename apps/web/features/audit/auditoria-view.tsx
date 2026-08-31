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

type TabFilter = 'LISTO' | 'EN_REVISION' | 'RECHAZADO' | 'APROBADO';

export function AuditoriaView() {
  const { organizationId, hasPermission, roles } = useRole();
  const [tab, setTab] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const isAuditor = roles.includes('MTD_AUDITOR');
  const canStart = hasPermission('audit.start');
  const canApprove = hasPermission('audit.approve');
  const canReject = hasPermission('audit.reject');

  const { data: indicators } = useApiData(() => getIndicators(organizationId), [organizationId]);

  const tabs: TabFilter[] = ['LISTO', 'EN_REVISION', 'RECHAZADO', 'APROBADO'];
  const ready = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        auditStatus: 'LISTO',
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId],
  );
  const inReview = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        auditStatus: 'EN_REVISION',
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId],
  );
  const rejected = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        auditStatus: 'RECHAZADO',
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId],
  );
  const approved = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        auditStatus: 'APROBADO',
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId],
  );

  const pages = {
    LISTO: { items: ready.items },
    EN_REVISION: { items: inReview.items },
    RECHAZADO: { items: rejected.items },
    APROBADO: { items: approved.items },
  };
  const hooks = [ready, inReview, rejected, approved];
  const currentFilter = tabs[tab] ?? 'LISTO';
  const reloadCurrent = (hooks[tab] ?? ready).reload;

  const findOpenReview = async (itemId: string): Promise<AuditReview | null> => {
    const detail = await getAuthorizationItemDetail(itemId, organizationId);
    const reviews = detail.auditReviews ?? [];
    return reviews.find((review) => review.status === 'EN_REVISION') ?? null;
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

  const handleAuditorCheck = (itemId: string, version: number, numero: string) =>
    runAction(
      `approve-${itemId}`,
      async () => {
        const started = await startAuditReview(itemId, organizationId, version);
        const observations = window.prompt('Observaciones del visto bueno (opcional):')?.trim();
        await approveAuditReview(
          started.review.id,
          organizationId,
          started.item.version,
          observations || undefined,
        );
      },
      `${numero}: visto bueno registrado; listo para admisión.`,
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
      `${numero}: ${decision === 'approve' ? 'aprobada (DISPENSADO)' : 'rechazada'}.`,
    );

  const buildRows = (filter: TabFilter) =>
    (pages[filter]?.items ?? []).map((item) => {
      const actions: React.ReactNode[] = [];
      const readyActionKey = isAuditor && canApprove ? `approve-${item.id}` : `start-${item.id}`;
      if (filter === 'LISTO' && canStart) {
        actions.push(
          <button
            key={readyActionKey}
            type="button"
            className="btn"
            disabled={busy === readyActionKey}
            onClick={() => {
              if (isAuditor && canApprove) {
                void handleAuditorCheck(item.id, item.version, item.numeroAutorizacion);
              } else {
                void handleStart(item.id, item.version, item.numeroAutorizacion);
              }
            }}
          >
            {busy === readyActionKey
              ? 'Procesando…'
              : isAuditor && canApprove
                ? 'Dar visto bueno'
                : 'Iniciar auditoría'}
          </button>,
        );
      }
      if (filter === 'EN_REVISION' && canApprove) {
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
            {isAuditor ? 'Dar visto bueno' : 'Aprobar'}
          </button>,
        );
      }
      if (filter === 'EN_REVISION' && canReject) {
        actions.push(
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
        description="El visto bueno explícito marca el registro como DISPENSADO y lo deja listo para admisión."
        actions={
          <span className="pill blue">{indicators?.readyForReview ?? 0} listas para revisar</span>
        }
      />
      {isAuditor ? (
        <div className="note" style={{ marginBottom: 14 }}>
          Este perfil solo puede revisar soportes y dar visto bueno. No puede rechazar, registrar
          hallazgos, importar, exportar ni administrar usuarios.
        </div>
      ) : null}
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
          value={indicators?.byAuditStatus.LISTO ?? 0}
          foot="Listas para revisión"
          icon="LA"
          iconBg="#eef4ff"
          iconColor="#2456c7"
        />
        <KpiCard
          label="En revisión"
          value={indicators?.byAuditStatus.EN_REVISION ?? 0}
          foot="Auditoría humana activa"
          icon="ER"
          iconBg="#fff4e5"
          iconColor="#b54708"
        />
        <KpiCard
          label="Rechazadas"
          value={indicators?.byAuditStatus.RECHAZADO ?? 0}
          foot="Requieren corrección"
          icon="RJ"
          iconBg="#fff0ee"
          iconColor="#b42318"
        />
        <KpiCard
          label="Aprobadas"
          value={indicators?.byAuditStatus.APROBADO ?? 0}
          foot="Listas para admisión"
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
