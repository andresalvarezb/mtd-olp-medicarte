'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { KpiCard, KpiGrid } from '@/components/ui/kpi-card';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { BulkUpdateUpload } from '@/components/bulk-update-upload';
import { TablePagination } from '@/components/ui/table-pagination';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { downloadFile, getIndicators, listAuthorizationItems } from '@/lib/authorization-items-api';
import { patientName, patientDocument, medicationName } from '@/lib/labels';
import type { AuthorizationItemResponse } from '@authorization/contracts';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Documento' },
  { label: 'Paciente' },
  { label: 'Medicamento' },
  { label: 'Punto / sede' },
  { label: 'Versión' },
  { label: 'Última actualización' },
];

export function PuntosAplicacionView() {
  const { organizationId, hasPermission } = useRole();
  const [tab, setTab] = useState(0);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: indicators } = useApiData(() => getIndicators(organizationId), [organizationId]);
  const siteFilter =
    tab === 0 ? ('PENDING_ASSIGNMENT' as const) : tab === 1 ? ('ASSIGNED' as const) : undefined;
  const list = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        operationStatus: 'READY_TO_DISPENSE',
        ...(siteFilter ? { applicationSiteStatus: siteFilter } : {}),
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId, siteFilter],
  );
  const { items, loading, error, reload } = list;

  const canExport = hasPermission('operational_exports.create');
  const handleExport = (format: 'csv' | 'xlsx') => {
    setExporting(format);
    setActionError(null);
    downloadFile(
      '/operational-exports/authorization-items',
      organizationId,
      `medicarte-asignacion-puntos.${format}`,
      { operationType: 'ASSIGN_DISPENSATION_LOCATION', format },
    )
      .catch((err: unknown) =>
        setActionError(err instanceof Error ? err.message : 'No fue posible exportar.'),
      )
      .finally(() => setExporting(null));
  };

  const canAssign = hasPermission('bulk_updates.dispensation_location');

  const rowsFor = (list: AuthorizationItemResponse[]) =>
    list.map((item) => [
      <span key="num" style={{ fontWeight: 600 }}>
        {item.numeroAutorizacion}
      </span>,
      patientDocument(item.sourceData),
      patientName(item.sourceData),
      medicationName(item.sourceData),
      item.lugarDispensacion ?? (
        <StatusBadge key="pend" tone="orange">
          Sin asignar
        </StatusBadge>
      ),
      item.operationalVersion,
      new Date(item.updatedAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }),
    ]);

  const activeList = items;

  return (
    <>
      <PageHeader
        title="Puntos de aplicación"
        description="Medicarte define la sede o dirección donde realizará la aplicación. Cada cambio genera una nueva versión y notifica a OLP."
        actions={
          canExport ? (
            <>
              <button
                type="button"
                className="btn"
                disabled={exporting !== null}
                onClick={() => handleExport('csv')}
              >
                {exporting === 'csv' ? 'Generando…' : 'Exportar base (CSV)'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={exporting !== null}
                onClick={() => handleExport('xlsx')}
              >
                {exporting === 'xlsx' ? 'Generando…' : 'Exportar Excel'}
              </button>
            </>
          ) : null
        }
      />
      <KpiGrid>
        <KpiCard
          label="Pendientes de asignar"
          value={indicators?.pendingDispensationLocation ?? 0}
          foot="Requieren acción de Medicarte"
          icon="PA"
          iconBg="#fff4e5"
          iconColor="#b54708"
        />
        <KpiCard
          label="Pendientes fecha dispensación"
          value={indicators?.pendingDispensationDate ?? 0}
          foot="Reporte por OLP"
          icon="FD"
          iconBg="#eaf8f2"
          iconColor="#16835d"
        />
        <KpiCard
          label="Pendientes fecha aplicación"
          value={indicators?.pendingApplicationDate ?? 0}
          foot="Reporte por Medicarte"
          icon="FA"
          iconBg="#eef4ff"
          iconColor="#2456c7"
        />
        <KpiCard
          label="En esta página"
          value={items.length}
          foot="READY_TO_DISPENSE en la página actual"
          icon="Σ"
          iconBg="#f3f0ff"
          iconColor="#6941c6"
        />
      </KpiGrid>
      <Card>
        {error ? (
          <div className="login-error" role="alert" style={{ marginBottom: 14 }}>
            {error}
          </div>
        ) : null}
        {actionError ? (
          <div className="login-error" role="alert" style={{ marginBottom: 14 }}>
            {actionError}
          </div>
        ) : null}
        {canAssign ? (
          <BulkUpdateUpload
            operationType="ASSIGN_DISPENSATION_LOCATION"
            buttonLabel="Asignar punto (archivo)"
            fileTitle="Archivo de asignación de lugar de dispensación"
            columnsHint="Columnas requeridas: authorization_key, lugar_dispensacion"
            onCompleted={reload}
          />
        ) : null}
        <Tabs tabs={['Pendientes', 'Asignados', 'Todos']} activeTab={tab} onChange={setTab}>
          <DataTable
            columns={COLUMNS}
            rows={loading ? undefined : rowsFor(activeList)}
            aria-label="Puntos de aplicación"
            emptyIcon="PA"
            emptyTitle={loading ? 'Cargando…' : 'No hay registros en esta pestaña'}
            emptyDescription={
              loading
                ? 'Consultando la API…'
                : 'Los registros READY_TO_DISPENSE aparecen aquí; la asignación se realiza por archivo tipado.'
            }
          />
          <TablePagination
            page={list.page}
            hasPrev={list.hasPrev}
            hasNext={list.hasNext}
            onPrev={list.prevPage}
            onNext={list.nextPage}
          />
        </Tabs>
      </Card>
    </>
  );
}
