'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { KpiCard, KpiGrid } from '@/components/ui/kpi-card';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { DataTable } from '@/components/ui/data-table';
import { useRole } from '@/components/layout/role-context';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { TablePagination } from '@/components/ui/table-pagination';
import { listAuthorizationItems, requestMipresRecheck } from '@/lib/authorization-items-api';
import type { AuthorizationItemResponse } from '@authorization/contracts';
import {
  COVERAGE_LABELS,
  DIRECTION_STATUS_LABELS,
  patientName,
  patientDocument,
  medicationName,
} from '@/lib/labels';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Documento' },
  { label: 'Paciente' },
  { label: 'Medicamento' },
  { label: 'Prescripción' },
  { label: 'Cobertura' },
  { label: 'Estado' },
  { label: 'Acciones' },
];

type DirectionFilter = 'PENDIENTE' | 'CONFIRMADO' | 'ERROR_DE_CONSULTA';

export function MipresView() {
  const { organizationId, hasPermission } = useRole();
  const [tab, setTab] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [requeued, setRequeued] = useState<string[]>([]);

  const pending = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        directionStatus: 'PENDIENTE',
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId],
  );
  const confirmed = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        directionStatus: 'CONFIRMADO',
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId],
  );
  const errored = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        directionStatus: 'ERROR_DE_CONSULTA',
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId],
  );

  const pages: Record<DirectionFilter, { items: AuthorizationItemResponse[] } | null> = {
    PENDIENTE: { items: pending.items },
    CONFIRMADO: { items: confirmed.items },
    ERROR_DE_CONSULTA: { items: errored.items },
  };
  const hooks = [pending, confirmed, errored];
  const tabFilters: DirectionFilter[] = ['PENDIENTE', 'CONFIRMADO', 'ERROR_DE_CONSULTA'];
  const canRecheck = hasPermission('mipres.recheck');

  const handleRecheck = async (itemId: string, numero: string) => {
    setActionError(null);
    try {
      await requestMipresRecheck(itemId, organizationId);
      setRequeued((previous) => [...previous, itemId]);
    } catch (err) {
      setActionError(
        `${numero}: ${err instanceof Error ? err.message : 'No fue posible agendar la revalidación.'}`,
      );
    }
  };

  const buildRows = (filter: DirectionFilter) => {
    const items = pages[filter]?.items ?? [];
    return items.map((item) => {
      const actionColumn =
        canRecheck && filter !== 'CONFIRMADO' && !requeued.includes(item.id)
          ? [
              <button
                key={`recheck-${item.id}`}
                type="button"
                className="btn"
                onClick={() => {
                  void handleRecheck(item.id, item.numeroAutorizacion);
                }}
              >
                Revalidar
              </button>,
            ]
          : [requeued.includes(item.id) ? 'Revalidación agendada' : '—'];
      return [
        <span key="num" style={{ fontWeight: 600 }}>
          {item.numeroAutorizacion}
        </span>,
        patientDocument(item.sourceData),
        patientName(item.sourceData),
        medicationName(item.sourceData),
        item.noPrescripcion || '—',
        COVERAGE_LABELS[item.coverageType],
        DIRECTION_STATUS_LABELS[item.directionStatus],
        ...actionColumn,
      ];
    });
  };

  return (
    <>
      <PageHeader
        title="Direccionamientos MIPRES"
        description="Solo se consulta para registros NO PBS habilitados. Un direccionamiento es vigente cuando la fecha actual es inferior a la fecha máxima."
      />
      {actionError ? (
        <div className="login-error" role="alert" style={{ marginBottom: 14 }}>
          {actionError}
        </div>
      ) : null}
      <KpiGrid>
        <KpiCard
          label="Pendientes"
          value={pending.items.length}
          foot="Esperando direccionamiento"
          icon="P"
          iconBg="#fff4e5"
          iconColor="#b54708"
        />
        <KpiCard
          label="Confirmados"
          value={confirmed.items.length}
          foot="Fecha máxima vigente"
          icon="C"
          iconBg="#eaf8f2"
          iconColor="#16835d"
        />
        <KpiCard
          label="Errores consulta"
          value={errored.items.length}
          foot="Separados de 'sin direccionamiento'"
          icon="E"
          iconBg="#fff0ee"
          iconColor="#b42318"
        />
        <KpiCard
          label="Revalidaciones agendadas"
          value={requeued.length}
          foot="En esta sesión"
          icon="R"
          iconBg="#f3f0ff"
          iconColor="#6941c6"
        />
      </KpiGrid>
      <Card>
        <Tabs
          tabs={['Pendientes', 'Confirmados', 'Errores de consulta']}
          activeTab={tab}
          onChange={setTab}
        >
          {(() => {
            const filter = tabFilters[tab] ?? 'PENDIENTE';
            const currentHook = hooks[tab] ?? pending;
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
                  rows={loading ? undefined : buildRows(filter)}
                  aria-label="Direccionamientos MIPRES"
                  emptyIcon="MI"
                  emptyTitle={loading ? 'Cargando…' : 'No hay direccionamientos en este estado'}
                  emptyDescription={
                    loading
                      ? 'Consultando la API…'
                      : 'Los registros NO PBS que requieran validación aparecerán automáticamente en esta bandeja.'
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
